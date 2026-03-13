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
  const xt = params.get('xt') || '';
  const val = decodeURIComponent(xt.replace(/^urn:btih:/i, ''));
  normalized = normalize(val);
  return normalized;
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
