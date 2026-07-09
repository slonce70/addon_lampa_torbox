#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function fail(msg) {
  console.error('[validate] FAIL:', msg);
  process.exit(1);
}

function readText(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch (e) {
    fail(`Cannot read ${p}: ${e && e.message ? e.message : String(e)}`);
  }
}

const root = path.resolve(__dirname, '..');
const pluginPath = path.join(root, 'torbox-lampa-plugin.js');
const readmePath = path.join(root, 'README.md');
const readmeUkPath = path.join(root, 'README.uk.md');
const unitTestPath = path.join(root, 'tests', 'unit', 'torbox-pure.test.js');
const e2eTestPath = path.join(root, 'tests', 'e2e', 'focus-smoke.spec.js');

const plugin = readText(pluginPath);

// 1) Syntax check: compile only (do not execute).
try {
  // eslint-disable-next-line no-new-func
  new Function(plugin);
} catch (e) {
  fail(`torbox-lampa-plugin.js has a syntax error: ${e && e.message ? e.message : String(e)}`);
}

// 2) Version consistency: VERSION const and bootstrap log should match.
const versionMatch = plugin.match(/const\s+VERSION\s*=\s*'([^']+)'/);
if (!versionMatch) fail('Cannot find VERSION constant in torbox-lampa-plugin.js');
const version = versionMatch[1];

const bootMatch = plugin.match(/boot\s+strap'\s*,\s*'([^']+)'/);
if (!bootMatch) fail("Cannot find boot strap console.log version in torbox-lampa-plugin.js");
const bootVersion = bootMatch[1];

if (bootVersion !== version) {
  fail(`Version mismatch in torbox-lampa-plugin.js: VERSION=${version} but boot strap log=${bootVersion}`);
}

// 3) READMEs (en + uk): the declared version must match the plugin VERSION.
const readme = readText(readmePath);
const readmeVerMatch = readme.match(/Current version:\s*\*\*([0-9]+\.[0-9]+\.[0-9]+)\*\*/);
if (!readmeVerMatch) fail('Cannot find "Current version: **x.y.z**" in README.md');
if (readmeVerMatch[1] !== version) {
  fail(`README.md version mismatch: README=${readmeVerMatch[1]} but plugin VERSION=${version}`);
}

const readmeUk = readText(readmeUkPath);
const readmeUkVerMatch = readmeUk.match(/Поточна версія:\s*\*\*([0-9]+\.[0-9]+\.[0-9]+)\*\*/);
if (!readmeUkVerMatch) fail('Cannot find "Поточна версія: **x.y.z**" in README.uk.md');
if (readmeUkVerMatch[1] !== version) {
  fail(`README.uk.md version mismatch: README=${readmeUkVerMatch[1]} but plugin VERSION=${version}`);
}

// 4) READMEs should include the TV checklist section (manual QA baseline).
if (!/Manual TV checklist/.test(readme)) {
  fail('README.md does not contain "Manual TV checklist" section');
}
if (!/Ручний чек-лист на TV/.test(readmeUk)) {
  fail('README.uk.md does not contain "Ручний чек-лист на TV" section');
}

// 5) Sanity: TV filter focus integration must exist.
if (!plugin.includes('.filter--filter')) {
  fail('Expected torbox-lampa-plugin.js to reference ".filter--filter" (TV filter focus integration)');
}

// 6) Security/compatibility regressions.
if (!/Utils\.escapeHtml\(primaryTracker\)/.test(plugin)) {
  fail('Expected tracker field to be escaped (Utils.escapeHtml(primaryTracker))');
}
if (!/title:\s*Utils\.escapeHtml\(clean \|\| file\.name \|\| translate\('torbox_no_title'\)\)/.test(plugin)) {
  fail('Expected episode title to be escaped with Utils.escapeHtml(...)');
}
if (!/Lampa\.Manifest\.plugins\s*=\s*manifest/.test(plugin)) {
  fail('Expected manifest registration via setter push: Lampa.Manifest.plugins = manifest');
}
if (!/for \(const p of passParsers\)/.test(plugin) || !/if \(normalized\.validCount > 0\)\s*{[\s\S]*?return\s*{/.test(plugin)) {
  fail('Expected parser failover loop to stop only on the first valid normalized result');
}
if (!/PUBLIC_PARSER_TIMEOUT_MS:\s*5\s*\*\s*1000/.test(plugin) || !/TORBOX_API_TIMEOUT_MS:\s*20\s*\*\s*1000/.test(plugin)) {
  fail('Expected separate timeout constants for public parsers and TorBox API');
}
if (!/ParserHealth\.markFailure/.test(plugin) || !/cooldown_skip/.test(plugin)) {
  fail('Expected parser cooldown handling and diagnostics trail');
}

// 7) Test files should exist.
if (!fs.existsSync(unitTestPath)) fail('Unit test file is missing: tests/unit/torbox-pure.test.js');
if (!fs.existsSync(e2eTestPath)) fail('E2E smoke file is missing: tests/e2e/focus-smoke.spec.js');

console.log('[validate] OK:', { version });
