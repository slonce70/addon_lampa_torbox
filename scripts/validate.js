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
const planPath = path.join(root, 'plan.md');

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

// 4) Plan: must exist and include the TV checklist marker (manual QA baseline).
if (!fs.existsSync(planPath)) fail('plan.md is missing');
const plan = readText(planPath);
if (!/Ручной чек-лист\s*\(TV\)/.test(plan)) {
  fail('plan.md does not contain "Ручной чек-лист (TV)" section');
}

// 5) Sanity: TV filter focus integration must exist.
if (!plugin.includes('.filter--filter')) {
  fail('Expected torbox-lampa-plugin.js to reference ".filter--filter" (TV filter focus integration)');
}

console.log('[validate] OK:', { version });

