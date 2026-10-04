#!/usr/bin/env node
// scripts/check-viewer-bundle.mjs
//
// After `vite build`: the LAN viewer page's files (per build/asset-manifest.json)
// must not include the main app's entry chunk, viewer.html must load nothing
// from another origin, and the viewer's code must not carry catalog subtrees
// other than `viewer` (which would mean the JSON named-export import pulled
// whole catalogs in). Spec 2026-10-04 §11.5, §13.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { viewerAssets } = require('../electron/caption-share-core.js');

const root = process.cwd();
const build = join(root, 'build');
const manifest = JSON.parse(readFileSync(join(build, 'asset-manifest.json'), 'utf8'));
const files = [...viewerAssets(manifest, 'viewer.html')];
const problems = [];

if (files.length === 0) problems.push('viewer.html is not in build/asset-manifest.json');
const mainEntry = manifest['index.html']?.file;
if (mainEntry && files.includes(mainEntry)) problems.push(`the main app entry ${mainEntry} is on the viewer allowlist`);

const html = readFileSync(join(build, 'viewer.html'), 'utf8');
for (const m of html.matchAll(/(?:src|href)="(?:https?:)?\/\/[^"]*"/g)) problems.push(`viewer.html loads from another origin: ${m[0]}`);

const ja = JSON.parse(readFileSync(join(root, 'src/locales/ja/translation.json'), 'utf8'));
const sentinels = [];
const walk = (node) => {
  for (const value of Object.values(node)) {
    if (typeof value === 'string') { if (value.length >= 8) sentinels.push(value); } else walk(value);
  }
};
for (const [key, value] of Object.entries(ja)) {
  if (key === 'viewer') continue;
  if (typeof value === 'string') { if (value.length >= 8) sentinels.push(value); } else walk(value);
}
const code = files.filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(build, f), 'utf8')).join('\n');
const leaked = sentinels.filter((s) => code.includes(s));
if (leaked.length > 0) problems.push(`${leaked.length} strings from other ja catalog subtrees are in the viewer bundle, e.g. "${leaked[0]}"`);

if (problems.length > 0) {
  for (const p of problems) process.stderr.write(`${p}\n`);
  process.exit(1);
}
process.stdout.write(`viewer bundle ok: ${files.length} files\n`);
