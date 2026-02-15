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

// 3) README: current version and changelog should contain the same version.
const readme = readText(readmePath);
const readmeVerMatch = readme.match(/Текущая версия:\s*\*\*([0-9]+\.[0-9]+\.[0-9]+)\*\*/);
if (!readmeVerMatch) fail('Cannot find "Текущая версия: **x.y.z**" in README.md');
const readmeVersion = readmeVerMatch[1];
if (readmeVersion !== version) {
  fail(`README.md version mismatch: README=${readmeVersion} but plugin VERSION=${version}`);
}
if (!readme.includes(`### ${version}`)) {
  fail(`README.md changelog is missing heading "### ${version}"`);
}

// 4) README should include TV checklist section (manual QA baseline).
if (!/Ручной чек-лист на TV/.test(readme)) {
  fail('README.md does not contain "Ручной чек-лист на TV" section');
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
if (!/for \(const p of parsers\)/.test(plugin) || !/if \(list\.length > 0\)\s*{[\s\S]*?break;/.test(plugin)) {
  fail('Expected sequential parser failover loop with break on first success');
}

// 7) Test files should exist.
if (!fs.existsSync(unitTestPath)) fail('Unit test file is missing: tests/unit/torbox-pure.test.js');
if (!fs.existsSync(e2eTestPath)) fail('E2E smoke file is missing: tests/e2e/focus-smoke.spec.js');

console.log('[validate] OK:', { version });
