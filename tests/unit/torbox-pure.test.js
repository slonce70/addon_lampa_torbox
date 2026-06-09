const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function isHex40(s) {
  return typeof s === 'string' && /^[a-fA-F0-9]{40}$/.test(s);
}

function isBase32Btih(s) {
  return typeof s === 'string' && /^[A-Z2-7]{32}$/.test(s);
}

function base32ToHex(b32) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of b32) {
    const val = alphabet.indexOf(c);
    if (val < 0) throw new Error('Invalid base32 char');
    bits += val.toString(2).padStart(5, '0');
  }
  const out = [];
  for (let i = 0; i + 4 <= bits.length; i += 4) {
    out.push(parseInt(bits.slice(i, i + 4), 2).toString(16));
  }
  const hex = out.join('').toLowerCase();
  return hex.length >= 40 ? hex.slice(0, 40) : hex.padEnd(40, '0');
}

function btihFromMagnetOrFields(obj = {}) {
  const direct = obj.InfoHash || obj.infoHash || obj.Hash || obj.hash || null;
  const normalize = (raw) => {
    if (!raw) return null;
    const s = String(raw).trim();
    if (isHex40(s)) return s.toLowerCase();
    const upper = s.toUpperCase();
    if (isBase32Btih(upper)) return base32ToHex(upper);
    return null;
  };

  let normalized = normalize(direct);
  if (normalized) return normalized;

  const magnet = obj.MagnetUri || obj.magnet || obj.magnetUri || '';
  if (!magnet || typeof magnet !== 'string') return null;

  const q = magnet.split('?')[1] || '';
  const params = new URLSearchParams(q);
  const xt = (params.getAll('xt') || []).find((v) => /^urn:btih:/i.test(v)) || '';
  const raw = xt.replace(/^urn:btih:/i, '');
  let val;
  try {
    val = decodeURIComponent(raw);
  } catch {
    val = raw;
  }
  normalized = normalize(val);
  return normalized;
}

function buildSearchQuery(movie = {}) {
  const searchTitle = (movie.title || movie.name || '').trim();
  const searchOriginal = (movie.original_title || movie.original_name || '').trim();
  const yearRaw = (movie.year || movie.release_date || movie.first_air_date || '').toString();
  const searchYear = yearRaw ? yearRaw.slice(0, 4) : '';
  return {
    Query: `${searchTitle} ${searchYear}`.trim(),
    title: searchTitle,
    title_original: searchOriginal,
    year: searchYear,
  };
}

function normalizeCustomParsers(customStr = '') {
  return String(customStr)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && s.length > 3)
    .map((entry, i) => {
      try {
        const u = new URL(/^https?:\/\//i.test(entry) ? entry : `https://${entry}`);
        const host = `${u.host}${u.pathname.replace(/\/+$/, '')}`;
        return host ? { name: `Custom ${i + 1}`, url: host, key: '' } : null;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function normalizeProgress(p) {
  const n = Number(p);
  if (!isFinite(n) || n < 0) return 0;
  if (n <= 1) return Math.max(0, Math.min(100, n * 100));
  return Math.max(0, Math.min(100, n));
}

function downloadPhase(d) {
  if (!d || typeof d !== 'object') return 'downloading';
  const finished =
    d.download_state === 'completed' || d.download_state === 'uploading' || !!d.download_finished;
  const hasFiles = Array.isArray(d.files) && d.files.length > 0;
  if (finished && hasFiles) return 'ready';
  const downloadDone =
    finished || normalizeProgress(d.progress) >= 100 || d.download_state === 'cached';
  return downloadDone ? 'finalizing' : 'downloading';
}

function buildProxyUrl(base, target) {
  const raw = String(base || '').trim();
  if (!raw) return raw;

  try {
    const proxyUrl = new URL(raw);
    proxyUrl.searchParams.set('url', target);
    return proxyUrl.toString();
  } catch (_) {
    if (raw.includes('{url}')) return raw.replace('{url}', encodeURIComponent(target));
    if (raw.includes('%s')) return raw.replace('%s', encodeURIComponent(target));

    const hasQuery = raw.includes('?');
    const endsWithJoin = /[?&]$/.test(raw);
    if (/[?&]url=/.test(raw)) {
      return raw.replace(/([?&]url=)[^&#]*/i, (_, prefix) => `${prefix}${encodeURIComponent(target)}`);
    }
    const joiner = hasQuery ? (endsWithJoin ? '' : '&') : '?';
    return `${raw}${joiner}url=${encodeURIComponent(target)}`;
  }
}

function normalizeParserResults(rawResults = []) {
  const items = Array.isArray(rawResults) ? rawResults : [];
  const entriesByHash = new Map();
  let invalidCount = 0;

  items.forEach((item) => {
    const hash = btihFromMagnetOrFields(item);
    if (!hash) {
      invalidCount += 1;
      return;
    }
    if (!entriesByHash.has(hash)) entriesByHash.set(hash, item);
  });

  return {
    rawCount: items.length,
    validCount: entriesByHash.size,
    invalidCount,
    entriesByHash,
  };
}

function classifyParserFailure(err = {}) {
  const statusCode = Number(err?.status) || 0;
  const message = String(err?.message || '');
  const lower = message.toLowerCase();

  if (Number(err?.timeoutMs) > 0 || /timeout|timed out|time out/i.test(message)) {
    return { status: 'timeout', cooldown: true, reason: message || 'timeout', statusCode };
  }
  if (statusCode >= 500) {
    return { status: 'http_error', cooldown: true, reason: `http_${statusCode}`, statusCode };
  }
  if (statusCode >= 400) {
    return { status: 'http_error', cooldown: false, reason: `http_${statusCode}`, statusCode };
  }
  if (
    /err_connection_closed|ssl|tls|handshake|fetch failed|network|econnreset|connection closed|connection reset/.test(lower)
  ) {
    return { status: 'network', cooldown: true, reason: message || 'network', statusCode };
  }
  return { status: 'network', cooldown: true, reason: message || 'network', statusCode };
}

function createParserHealth(cooldownMs, now) {
  const map = new Map();

  const getCooldownUntil = (domain) => {
    const raw = Number(map.get(domain)?.cooldownUntil) || 0;
    if (raw > now()) return raw;
    if (raw) {
      map.set(domain, Object.assign({}, map.get(domain), { cooldownUntil: 0 }));
    }
    return 0;
  };

  return {
    getCooldownUntil,
    isCoolingDown(domain) {
      return getCooldownUntil(domain) > now();
    },
    markFailure(domain, kind) {
      const entry = {
        lastFailureAt: now(),
        lastFailureKind: String(kind || 'failure'),
        cooldownUntil: now() + cooldownMs,
      };
      map.set(domain, Object.assign({}, map.get(domain), entry));
      return map.get(domain);
    },
    markSuccess(domain) {
      const entry = Object.assign({}, map.get(domain), {
        lastSuccessAt: now(),
        cooldownUntil: 0,
      });
      map.set(domain, entry);
      return entry;
    },
  };
}

async function runParserSearch({ parsers, fetchParser, now, health, parserTimeoutMs }) {
  const parserAttempts = [];
  let selectedParser = null;

  const activeParsers = parsers.filter((parser) => !health.isCoolingDown(parser.url));
  const useCooldownAwarePass = activeParsers.length > 0;
  const passParsers = useCooldownAwarePass ? activeParsers : parsers;

  if (useCooldownAwarePass) {
    parsers
      .filter((parser) => health.isCoolingDown(parser.url))
      .forEach((parser) => {
        const cooldownUntil = health.getCooldownUntil(parser.url);
        parserAttempts.push({
          name: parser.name,
          domain: parser.url,
          status: 'cooldown_skip',
          raw_count: 0,
          valid_count: 0,
          invalid_count: 0,
          cooldown_until: cooldownUntil ? new Date(cooldownUntil).toISOString() : null,
          reason: 'cooldown_active',
        });
      });
  }

  for (const parser of passParsers) {
    try {
      const json = await fetchParser(parser, parserTimeoutMs);
      const normalized = normalizeParserResults(json?.Results || []);
      const attempt = {
        name: parser.name,
        domain: parser.url,
        status: normalized.validCount > 0 ? 'success' : normalized.rawCount > 0 ? 'invalid_payload' : 'empty',
        raw_count: normalized.rawCount,
        valid_count: normalized.validCount,
        invalid_count: normalized.invalidCount,
        cooldown_until: null,
      };
      parserAttempts.push(attempt);

      if (normalized.validCount > 0) {
        health.markSuccess(parser.url);
        selectedParser = {
          name: parser.name,
          domain: parser.url,
          raw_count: normalized.rawCount,
          valid_count: normalized.validCount,
        };
        return { parser: selectedParser, entriesByHash: normalized.entriesByHash, diagnostics: parserAttempts };
      }

      if (attempt.status === 'invalid_payload') {
        const updated = health.markFailure(parser.url, attempt.status);
        attempt.cooldown_until = updated?.cooldownUntil ? new Date(updated.cooldownUntil).toISOString() : null;
      }
    } catch (err) {
      const failure = classifyParserFailure(err);
      const attempt = {
        name: parser.name,
        domain: parser.url,
        status: failure.status,
        raw_count: 0,
        valid_count: 0,
        invalid_count: 0,
        cooldown_until: null,
        reason: failure.reason,
      };
      if (failure.cooldown) {
        const updated = health.markFailure(parser.url, failure.status);
        attempt.cooldown_until = updated?.cooldownUntil ? new Date(updated.cooldownUntil).toISOString() : null;
      }
      parserAttempts.push(attempt);
    }
  }

  const err = new Error(
    parserAttempts.some((attempt) => attempt.status === 'invalid_payload')
      ? 'public parsers returned invalid data'
      : 'public parsers unavailable or returned no results'
  );
  err.diagnostics = parserAttempts;
  throw err;
}

test('base32/hex BTIH parsing works', () => {
  assert.equal(base32ToHex('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'), '0000000000000000000000000000000000000000');
  assert.equal(btihFromMagnetOrFields({ Hash: '0123456789abcdef0123456789abcdef01234567' }), '0123456789abcdef0123456789abcdef01234567');
  assert.equal(
    btihFromMagnetOrFields({ MagnetUri: 'magnet:?xt=urn:btih:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }),
    '0000000000000000000000000000000000000000'
  );
});

test('btih is extracted from hybrid magnets regardless of xt order', () => {
  // btmh listed first must not shadow the btih (URLSearchParams.get would return btmh)
  assert.equal(
    btihFromMagnetOrFields({
      MagnetUri:
        'magnet:?xt=urn:btmh:1220caf1e1c30e81cb361b8e0d0c1e2f3a4b5c6d7e8f9&xt=urn:btih:0123456789abcdef0123456789abcdef01234567',
    }),
    '0123456789abcdef0123456789abcdef01234567'
  );
  // btih first still works
  assert.equal(
    btihFromMagnetOrFields({
      MagnetUri: 'magnet:?xt=urn:btih:fedcba9876543210fedcba9876543210fedcba98&xt=urn:btmh:1220ab',
    }),
    'fedcba9876543210fedcba9876543210fedcba98'
  );
});

test('malformed percent-encoding in magnet does not throw or discard siblings', () => {
  // A stray % survives URLSearchParams decoding; a second decodeURIComponent would throw.
  assert.doesNotThrow(() => btihFromMagnetOrFields({ MagnetUri: 'magnet:?xt=urn:btih:%' }));
  const normalized = normalizeParserResults([
    { Title: 'broken', MagnetUri: 'magnet:?xt=urn:btih:%ZZ' },
    { Title: 'good', Hash: '0123456789abcdef0123456789abcdef01234567' },
  ]);
  // the good sibling is still kept rather than the whole batch being lost
  assert.equal(normalized.validCount, 1);
  assert.equal(normalized.entriesByHash.size, 1);
});

test('search query falls back to series name/first_air_date fields', () => {
  // Movie card: title/year present
  const movie = buildSearchQuery({ title: 'Dune', original_title: 'Dune', year: '2021' });
  assert.equal(movie.Query, 'Dune 2021');
  assert.equal(movie.title, 'Dune');
  assert.equal(movie.year, '2021');

  // Series card: only name/original_name/first_air_date present (no title/year)
  const series = buildSearchQuery({
    name: 'Severance',
    original_name: 'Severance',
    first_air_date: '2022-02-18',
  });
  assert.equal(series.Query, 'Severance 2022');
  assert.equal(series.title, 'Severance');
  assert.equal(series.title_original, 'Severance');
  assert.equal(series.year, '2022');
});

test('custom parser URLs are normalized to host (+path), dropping junk and invalid entries', () => {
  // full URL keeps host+path but drops query/fragment; bare domain keeps host;
  // a host with whitespace is invalid and dropped; empty/short entries are filtered.
  const parsers = normalizeCustomParsers('https://good.example/api/?x=1#frag, bad host.example, plain.example/, , a');
  assert.deepEqual(
    parsers.map((p) => p.url),
    ['good.example/api', 'plain.example']
  );
});

test('downloadPhase distinguishes downloading / finalizing / ready', () => {
  // Still downloading: progress < 100, not finished, no files
  assert.equal(downloadPhase({ download_state: 'downloading', progress: 0.45, files: [] }), 'downloading');
  // Downloaded to 100% but files not ready yet (caching) -> finalizing, not a stale ETA
  assert.equal(downloadPhase({ download_state: 'downloading', progress: 1, files: [] }), 'finalizing');
  assert.equal(downloadPhase({ download_state: 'downloading', progress: 100, files: [] }), 'finalizing');
  // download_finished flag set but files not listed yet -> finalizing
  assert.equal(downloadPhase({ download_state: 'downloading', progress: 0.99, download_finished: true, files: [] }), 'finalizing');
  // explicit cached state without files yet -> finalizing
  assert.equal(downloadPhase({ download_state: 'cached', progress: 0.8, files: [] }), 'finalizing');
  // Ready: finished AND has files
  assert.equal(downloadPhase({ download_state: 'completed', progress: 1, files: [{ id: 0, name: 'a.mkv' }] }), 'ready');
  assert.equal(downloadPhase({ download_state: 'uploading', progress: 1, files: [{ id: 0, name: 'a.mkv' }] }), 'ready');
  // finished but no files -> still finalizing (not ready), so we never resolve early
  assert.equal(downloadPhase({ download_state: 'completed', progress: 1, files: [] }), 'finalizing');
  // garbage input degrades to downloading
  assert.equal(downloadPhase(null), 'downloading');
});

test('proxy URL builder covers URL, placeholder and query modes', () => {
  assert.match(buildProxyUrl('https://proxy.example/?x=1', 'https://api.example/x'), /url=https%3A%2F%2Fapi\.example%2Fx/);
  assert.match(
    buildProxyUrl('https://proxy.example/{url}', 'https://api.example/x'),
    /\?url=https%3A%2F%2Fapi\.example%2Fx/
  );
  assert.match(
    buildProxyUrl('https://proxy.example?url=old', 'https://api.example/x'),
    /^https:\/\/proxy\.example\/?\?url=https%3A%2F%2Fapi\.example%2Fx$/
  );
});

test('normalizeParserResults keeps only entries with valid hashes', () => {
  const normalized = normalizeParserResults([
    { Title: 'bad', MagnetUri: 'magnet:?dn=nohash' },
    { Title: 'good', Hash: '0123456789abcdef0123456789abcdef01234567' },
    { Title: 'dup', Hash: '0123456789abcdef0123456789abcdef01234567' },
  ]);

  assert.equal(normalized.rawCount, 3);
  assert.equal(normalized.validCount, 1);
  assert.equal(normalized.invalidCount, 1);
  assert.equal(normalized.entriesByHash.size, 1);
});

test('first valid parser stops the chain', async () => {
  const calls = [];
  let currentTime = 0;
  const now = () => currentTime;
  const health = createParserHealth(15 * 60 * 1000, now);
  const parsers = [
    { name: 'Custom 1', url: 'custom.example' },
    { name: 'Viewbox', url: 'jacred.viewbox.dev' },
  ];

  const result = await runParserSearch({
    parsers,
    parserTimeoutMs: 5000,
    now,
    health,
    fetchParser: async (parser, timeoutMs) => {
      calls.push({ parser: parser.name, timeoutMs });
      return {
        Results: [{ Hash: '0123456789abcdef0123456789abcdef01234567', Title: `${parser.name} ok` }],
      };
    },
  });

  assert.deepEqual(calls, [{ parser: 'Custom 1', timeoutMs: 5000 }]);
  assert.equal(result.parser.name, 'Custom 1');
  assert.equal(result.entriesByHash.size, 1);
});

test('empty first parser falls back to second parser', async () => {
  const calls = [];
  let currentTime = 0;
  const now = () => currentTime;
  const health = createParserHealth(15 * 60 * 1000, now);
  const parsers = [
    { name: 'Viewbox', url: 'jacred.viewbox.dev' },
    { name: 'Jacred', url: 'jacred.xyz' },
  ];

  const result = await runParserSearch({
    parsers,
    parserTimeoutMs: 5000,
    now,
    health,
    fetchParser: async (parser) => {
      calls.push(parser.name);
      if (parser.name === 'Viewbox') return { Results: [] };
      return { Results: [{ Hash: '0123456789abcdef0123456789abcdef01234567' }] };
    },
  });

  assert.deepEqual(calls, ['Viewbox', 'Jacred']);
  assert.equal(result.parser.name, 'Jacred');
});

test('non-empty invalid payload falls back to next parser and enters cooldown', async () => {
  let currentTime = 1000;
  const now = () => currentTime;
  const health = createParserHealth(15 * 60 * 1000, now);
  const parsers = [
    { name: 'Viewbox', url: 'jacred.viewbox.dev' },
    { name: 'Jacred', url: 'jacred.xyz' },
  ];

  const result = await runParserSearch({
    parsers,
    parserTimeoutMs: 5000,
    now,
    health,
    fetchParser: async (parser) => {
      if (parser.name === 'Viewbox') return { Results: [{ Title: 'missing hash', MagnetUri: 'magnet:?dn=bad' }] };
      return { Results: [{ Hash: '0123456789abcdef0123456789abcdef01234567' }] };
    },
  });

  assert.equal(result.parser.name, 'Jacred');
  assert.ok(health.isCoolingDown('jacred.viewbox.dev'));
  assert.equal(result.diagnostics[0].status, 'invalid_payload');
});

test('timeout uses parser timeout and falls back quickly', async () => {
  const calls = [];
  let currentTime = 0;
  const now = () => currentTime;
  const health = createParserHealth(15 * 60 * 1000, now);
  const parsers = [
    { name: 'Viewbox', url: 'jacred.viewbox.dev' },
    { name: 'Jacred', url: 'jacred.xyz' },
  ];

  const result = await runParserSearch({
    parsers,
    parserTimeoutMs: 5000,
    now,
    health,
    fetchParser: async (parser, timeoutMs) => {
      calls.push({ parser: parser.name, timeoutMs });
      if (parser.name === 'Viewbox') throw { message: 'Request timeout (5 s)', timeoutMs };
      return { Results: [{ Hash: '0123456789abcdef0123456789abcdef01234567' }] };
    },
  });

  assert.deepEqual(calls, [
    { parser: 'Viewbox', timeoutMs: 5000 },
    { parser: 'Jacred', timeoutMs: 5000 },
  ]);
  assert.equal(result.parser.name, 'Jacred');
  assert.ok(health.isCoolingDown('jacred.viewbox.dev'));
});

test('network failure enters cooldown and next search skips broken parser', async () => {
  const calls = [];
  let currentTime = 100;
  const now = () => currentTime;
  const health = createParserHealth(15 * 60 * 1000, now);
  const parsers = [
    { name: 'Viewbox', url: 'jacred.viewbox.dev' },
    { name: 'Jacred', url: 'jacred.xyz' },
  ];

  await runParserSearch({
    parsers,
    parserTimeoutMs: 5000,
    now,
    health,
    fetchParser: async (parser) => {
      calls.push(parser.name);
      if (parser.name === 'Viewbox') throw new Error('ERR_CONNECTION_CLOSED');
      return { Results: [{ Hash: '0123456789abcdef0123456789abcdef01234567' }] };
    },
  });

  calls.length = 0;
  currentTime += 1000;

  const result = await runParserSearch({
    parsers,
    parserTimeoutMs: 5000,
    now,
    health,
    fetchParser: async (parser) => {
      calls.push(parser.name);
      return { Results: [{ Hash: 'fedcba9876543210fedcba9876543210fedcba98' }] };
    },
  });

  assert.deepEqual(calls, ['Jacred']);
  assert.equal(result.parser.name, 'Jacred');
});

test('when all parsers are cooling down the chain retries full pass', async () => {
  let currentTime = 500;
  const now = () => currentTime;
  const health = createParserHealth(15 * 60 * 1000, now);
  const parsers = [
    { name: 'Viewbox', url: 'jacred.viewbox.dev' },
    { name: 'Jacred', url: 'jacred.xyz' },
  ];

  health.markFailure('jacred.viewbox.dev', 'timeout');
  health.markFailure('jacred.xyz', 'network');

  const calls = [];
  const result = await runParserSearch({
    parsers,
    parserTimeoutMs: 5000,
    now,
    health,
    fetchParser: async (parser) => {
      calls.push(parser.name);
      if (parser.name === 'Viewbox') return { Results: [] };
      return { Results: [{ Hash: '0123456789abcdef0123456789abcdef01234567' }] };
    },
  });

  assert.deepEqual(calls, ['Viewbox', 'Jacred']);
  assert.equal(result.parser.name, 'Jacred');
});

test('all parser failures surface a diagnostics trail', async () => {
  let currentTime = 0;
  const now = () => currentTime;
  const health = createParserHealth(15 * 60 * 1000, now);
  const parsers = [
    { name: 'Viewbox', url: 'jacred.viewbox.dev' },
    { name: 'Jacred', url: 'jacred.xyz' },
  ];

  await assert.rejects(
    runParserSearch({
      parsers,
      parserTimeoutMs: 5000,
      now,
      health,
      fetchParser: async (parser) => {
        if (parser.name === 'Viewbox') throw new Error('ERR_CONNECTION_CLOSED');
        return { Results: [{ Title: 'bad payload', MagnetUri: 'magnet:?dn=bad' }] };
      },
    }),
    (err) => {
      assert.match(err.message, /invalid data/);
      assert.equal(err.diagnostics.length, 2);
      assert.equal(err.diagnostics[0].status, 'network');
      assert.equal(err.diagnostics[1].status, 'invalid_payload');
      return true;
    }
  );
});

test('movie and single-file flows open file list instead of autoplay', () => {
  const pluginPath = path.resolve(__dirname, '..', '..', 'torbox-lampa-plugin.js');
  const plugin = fs.readFileSync(pluginPath, 'utf8');

  const selectStart = plugin.indexOf('const selectFile = (torrentData) => {');
  assert.notEqual(selectStart, -1, 'selectFile function should exist');

  const selectEnd = plugin.indexOf('const beginPendingPlayback =', selectStart);
  assert.notEqual(selectEnd, -1, 'selectFile block should end before pending playback helpers');

  const selectFileBlock = plugin.slice(selectStart, selectEnd);
  const rememberedLookup = selectFileBlock.indexOf('const remembered = getRememberedFile(torrentData, vids);');

  assert.match(
    selectFileBlock,
    /const openFileList = \(preferredFile = null\) => \{[\s\S]*state\.view\s*=\s*'episodes';[\s\S]*state\.current_torrent_data\s*=\s*torrentData;[\s\S]*drawEpisodes\(torrentData, preferredFile\);[\s\S]*\};/
  );
  assert.notEqual(rememberedLookup, -1, 'remembered file lookup should remain for movie/file resume behavior');
  assert.match(selectFileBlock, /if \(remembered\) \{[\s\S]*openFileList\(remembered\);[\s\S]*return;/);
  assert.match(selectFileBlock, /if \(!isSeriesContent\(\) && getAutoPickMovieFile\(\)\) \{[\s\S]*const best = pickBestVideoFile\(vids\);[\s\S]*openFileList\(best\);[\s\S]*return;/);
  assert.match(selectFileBlock, /openFileList\(\);\s*\};/);
  assert.doesNotMatch(selectFileBlock, /play\(torrentData, remembered\)/);
  assert.doesNotMatch(selectFileBlock, /play\(torrentData, vids\[0\]\)/);
  assert.doesNotMatch(selectFileBlock, /play\(torrentData, best\)/);
});

test('file list explicitly focuses preferred, last played or first file item', () => {
  const pluginPath = path.resolve(__dirname, '..', '..', 'torbox-lampa-plugin.js');
  const plugin = fs.readFileSync(pluginPath, 'utf8');

  const drawStart = plugin.indexOf('const drawEpisodes = (torrentData, preferredFile = null) => {');
  assert.notEqual(drawStart, -1, 'drawEpisodes function should exist');

  const drawEnd = plugin.indexOf('const _getPlayerConfig =', drawStart);
  assert.notEqual(drawEnd, -1, 'drawEpisodes block should end before player config helper');

  const drawEpisodesBlock = plugin.slice(drawStart, drawEnd);
  assert.match(drawEpisodesBlock, /const preferredFocusId =[\s\S]*preferredFile[\s\S]*String\(preferredFile\.id\)/);
  assert.match(drawEpisodesBlock, /const storedLastPlayedId = Store\.get\(`torbox_last_played_file_\$\{mid\}_\$\{torrentKey\}`/);
  assert.match(drawEpisodesBlock, /let focusEl = null;[\s\S]*let firstFileEl = null;/);
  assert.match(drawEpisodesBlock, /if \(!firstFileEl\) firstFileEl = item;/);
  assert.match(drawEpisodesBlock, /const shouldFocus = preferredFocusId \? fileIdStr === preferredFocusId : isLastPlayed;/);
  assert.match(drawEpisodesBlock, /if \(focusEl \|\| firstFileEl\) focusElement\(focusEl \|\| firstFileEl\);/);
});

test('file download action is separate from playback', () => {
  const pluginPath = path.resolve(__dirname, '..', '..', 'torbox-lampa-plugin.js');
  const plugin = fs.readFileSync(pluginPath, 'utf8');

  assert.match(plugin, /FILE_DOWNLOAD:\s*'file_download'/);
  assert.match(plugin, /root\.find\('\.torbox-file-download\.selector'\)/);
  assert.match(plugin, /if \(element\.hasClass\('torbox-file-download'\)\) return FocusZones\.FILE_DOWNLOAD;/);
  assert.match(plugin, /torbox-file-download selector/);
  assert.match(plugin, /const link = await resolveFileDownloadLink\(torrentData, file\);/);

  const drawStart = plugin.indexOf('const drawEpisodes = (torrentData, preferredFile = null) => {');
  const drawEnd = plugin.indexOf('const _getPlayerConfig =', drawStart);
  const drawEpisodesBlock = plugin.slice(drawStart, drawEnd);
  assert.match(drawEpisodesBlock, /\.on\('hover:enter', \(\) => \{[\s\S]*play\(torrentData, file,/);
  assert.match(drawEpisodesBlock, /downloadBtn[\s\S]*e\.stopPropagation\(\);[\s\S]*downloadFileLink\(torrentData, file, downloadBtn\);/);

  const downloadStart = plugin.indexOf('const downloadFileLink = async');
  const downloadEnd = plugin.indexOf('const play = async', downloadStart);
  const downloadBlock = plugin.slice(downloadStart, downloadEnd);
  assert.match(downloadBlock, /resolveFileDownloadLink\(torrentData, file\)/);
  assert.match(downloadBlock, /Lampa\.Utils\.copyTextToClipboard\(link/);
  assert.doesNotMatch(downloadBlock, /play\(torrentData, file/);
  assert.doesNotMatch(downloadBlock, /_markWatched/);
  assert.doesNotMatch(downloadBlock, /Favorite\.add/);
  assert.doesNotMatch(downloadBlock, /Store\.set/);
  assert.doesNotMatch(downloadBlock, /LOG\([^)]*link/);
});

test('file download starts a download path after requestdl resolves', () => {
  const pluginPath = path.resolve(__dirname, '..', '..', 'torbox-lampa-plugin.js');
  const plugin = fs.readFileSync(pluginPath, 'utf8');

  assert.match(plugin, /const getFileDownloadFilename = \(file\) =>/);
  assert.match(plugin, /const prepareFileDownloadOpen = \(file\) =>/);
  assert.match(plugin, /const startFileDownload = \(link, file, opener\) =>/);
  assert.match(plugin, /document\.createElement\('a'\)/);
  assert.match(plugin, /\.setAttribute\('download', filename\)/);
  assert.match(plugin, /opener\.opener = null/);
  assert.match(plugin, /AndroidJS\.openBrowser\(link\)/);
  assert.match(plugin, /Lampa\.Android\.openBrowser\(link\)/);
  assert.match(plugin, /window\.open\(link, '_blank', 'noopener'\)/);
  assert.match(plugin, /return 'system';/);
  assert.match(plugin, /return 'attempted';/);
  assert.match(plugin, /return 'copy_only';/);
  assert.match(plugin, /torbox_download_attempted/);

  const downloadStart = plugin.indexOf('const downloadFileLink = async');
  const downloadEnd = plugin.indexOf('const play = async', downloadStart);
  const downloadBlock = plugin.slice(downloadStart, downloadEnd);

  const prepareIndex = downloadBlock.indexOf('opener = prepareFileDownloadOpen(file);');
  const resolveIndex = downloadBlock.indexOf('await resolveFileDownloadLink(torrentData, file);');
  const startIndex = downloadBlock.indexOf('const downloadState = startFileDownload(link, file, opener);');

  assert.ok(prepareIndex > -1, 'download must prepare a browser/open target before awaiting requestdl');
  assert.ok(resolveIndex > -1, 'download must still resolve a TorBox requestdl link');
  assert.ok(startIndex > -1, 'download must launch the resolved link through the download strategy');
  assert.ok(prepareIndex < resolveIndex, 'preparing the open target must stay in the user activation path');
  assert.ok(resolveIndex < startIndex, 'download launch should happen after requestdl returns a link');
});

test('security and failover guards are present in plugin source', () => {
  const pluginPath = path.resolve(__dirname, '..', '..', 'torbox-lampa-plugin.js');
  const plugin = fs.readFileSync(pluginPath, 'utf8');

  assert.match(plugin, /Utils\.escapeHtml\(primaryTracker\)/);
  assert.match(plugin, /title:\s*Utils\.escapeHtml\(clean \|\| file\.name \|\| translate\('torbox_no_title'\)\)/);
  assert.match(plugin, /function normalizeParserResults/);
  assert.match(plugin, /if \(normalized\.validCount > 0\)/);
  assert.match(plugin, /ParserHealth\.markFailure/);
  assert.match(plugin, /PUBLIC_PARSER_TIMEOUT_MS: 5 \* 1000/);
  assert.match(plugin, /TORBOX_API_TIMEOUT_MS: 20 \* 1000/);
});

test('audit hardening fixes are present in plugin source', () => {
  const pluginPath = path.resolve(__dirname, '..', '..', 'torbox-lampa-plugin.js');
  const plugin = fs.readFileSync(pluginPath, 'utf8');

  // Series-aware parser query (falls back to .name / first_air_date)
  assert.match(plugin, /const searchTitle = \(movie\.title \|\| movie\.name \|\| ''\)\.trim\(\);/);
  assert.match(plugin, /movie\.original_title \|\| movie\.original_name/);
  assert.match(plugin, /movie\.year \|\| movie\.release_date \|\| movie\.first_air_date/);

  // Hybrid magnet btih extraction + safe decode
  assert.match(plugin, /params\.getAll\('xt'\)[\s\S]*find\(\(v\) => \/\^urn:btih:\/i\.test\(v\)\)/);
  assert.match(plugin, /val = decodeURIComponent\(raw\);/);

  // Escaping of previously-unescaped dynamic fields
  assert.match(plugin, /file_id: Utils\.escapeHtml\(String\(file\.id\)\)/);
  assert.match(plugin, /const apiDetail = Utils\.escapeHtml\(String\(json\.detail \|\| json\.message \|\| ''\)\)/);
  assert.match(plugin, /titleParts\.push\(`\[\$\{Utils\.escapeHtml\(String\(snapshot\.quality\)\)\}\]`\)/);

  // Last-played key scoped per torrent (file ids are per-torrent)
  assert.match(plugin, /torbox_last_played_file_\$\{mid\}_\$\{torrentKey\}/);
  assert.match(plugin, /torbox_last_played_file_\$\{mid\}_\$\{torrentHashOrId\}/);

  // Abort hygiene: removable listener, checkCached break, cleared poll timer
  assert.match(plugin, /outerSignal\.removeEventListener\('abort', onOuterAbort\)/);
  assert.match(plugin, /if \(signal\?\.aborted\) break;/);
  assert.match(plugin, /if \(pollTimer\) clearTimeout\(pollTimer\);/);
});


test('plugin source does not ship a hardcoded TorBox API key fallback', () => {
  const pluginPath = path.resolve(__dirname, '..', '..', 'torbox-lampa-plugin.js');
  const plugin = fs.readFileSync(pluginPath, 'utf8');

  assert.doesNotMatch(plugin, /DEFAULT_API_KEY/);
  assert.doesNotMatch(plugin, /const\s+[A-Z_]*API[A-Z_]*KEY[A-Z_]*\s*=\s*['\"][0-9a-f-]{20,}['\"]/i);
  assert.match(plugin, /if \(!b64\) return '';/);
  assert.match(plugin, /return atob\(b64\) \|\| '';/);
  assert.match(plugin, /return '';/);
});

test('UI fixes (cached-toggle active style + finalizing state) are present in plugin source', () => {
  const pluginPath = path.resolve(__dirname, '..', '..', 'torbox-lampa-plugin.js');
  const plugin = fs.readFileSync(pluginPath, 'utf8');

  // Cached-only "active" no longer shares the focus fill: focus/hover rule must NOT
  // include the --active selector, and --active gets its own non-focus style.
  assert.doesNotMatch(
    plugin,
    /\.torbox-cached-toggle\.torbox-cached-toggle--active, \.torbox-cached-toggle\.focus/
  );
  assert.match(plugin, /\.torbox-cached-toggle\.torbox-cached-toggle--active:not\(\.focus\):not\(:hover\)/);

  // "Finalizing" download phase + message wired into the tracker
  assert.match(plugin, /downloadPhase\(d\)\s*{[\s\S]*return downloadDone \? 'finalizing' : 'downloading';/);
  assert.match(plugin, /const phase = Utils\.downloadPhase\(d\);/);
  assert.match(plugin, /if \(phase === 'finalizing'\)/);
  assert.match(plugin, /translate\('torbox_loading_finalizing'\)/);
  assert.match(plugin, /torbox_loading_finalizing:\s*{/);
});
