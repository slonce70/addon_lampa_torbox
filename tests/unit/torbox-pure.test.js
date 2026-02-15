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

test('security and compatibility guards are present in plugin source', () => {
  const pluginPath = path.resolve(__dirname, '..', '..', 'torbox-lampa-plugin.js');
  const plugin = fs.readFileSync(pluginPath, 'utf8');

  assert.match(plugin, /Utils\.escapeHtml\(primaryTracker\)/);
  assert.match(plugin, /title:\s*Utils\.escapeHtml\(clean \|\| file\.name \|\| translate\('torbox_no_title'\)\)/);
  assert.match(plugin, /filter\.chosen\('filter', chosen\)/);
  assert.match(plugin, /Utils\.escapeHtml\(`\$\{f\.title\}: \$\{state\.filters\[f\.stype\]\}`\)/);
  assert.match(plugin, /Lampa\.Manifest\.plugins = manifest/);
});

test('external parser failover remains sequential', () => {
  const pluginPath = path.resolve(__dirname, '..', '..', 'torbox-lampa-plugin.js');
  const plugin = fs.readFileSync(pluginPath, 'utf8');

  assert.match(plugin, /for \(const p of parsers\)/);
  assert.match(plugin, /if \(list\.length > 0\)\s*{[\s\S]*?break;/);
});
