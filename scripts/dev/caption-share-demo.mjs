#!/usr/bin/env node
// scripts/dev/caption-share-demo.mjs
//
// Render check for the LAN caption viewer: serves build/ through the real
// caption-share server and feeds sample captions, so the viewer and present
// pages can be opened and looked at without the desktop app.
// Usage: npx vite build && node scripts/dev/caption-share-demo.mjs
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { createCaptionShareServer } = require('../../electron/caption-share-server.js');
const { viewerAssets } = require('../../electron/caption-share-core.js');

const build = join(process.cwd(), 'build');
const manifest = JSON.parse(await readFile(join(build, 'asset-manifest.json'), 'utf8'));
const allowed = viewerAssets(manifest, 'viewer.html');
const server = createCaptionShareServer({
  assets: { allowed: async () => allowed, read: (rel) => readFile(join(build, rel)).catch(() => null) },
});

const pair = { source: 'ja', target: 'zh-CN' };
const { port } = await server.start({ phase: 'live', pair, allowSave: true });
const lines = [
  ['speaker', '今日はローカルで動く音声翻訳の話をします。', '今天讲一讲在自己电脑上跑的语音翻译。'],
  ['speaker', '会場の皆さんのスマホやパソコンで字幕が見られます。', '大家的手机和电脑都能看到字幕。'],
  ['participant', '这个延迟大概有多少？', 'この遅延はどれくらいですか？'],
  ['speaker', 'だいたい一秒ぐらいです。', '大概一秒左右。'],
];
let n = 0;
const at = Date.now();
const entry = ([leg, src, tr], i, final) => ({
  id: `demo:${i}`, leg, t: at + i * 4000,
  languages: leg === 'speaker' ? pair : { source: pair.target, target: pair.source },
  source: [{ key: `demo:${leg}:${i}a:0`, text: src, final: true }],
  translation: [{ key: `demo:${leg}:${i}b:0`, text: final ? tr : tr.slice(0, Math.ceil(tr.length / 2)), final }],
});
setInterval(() => {
  const i = n % lines.length;
  server.patch({ upsert: [entry(lines[i], n, false)], remove: [] });
  setTimeout(() => server.patch({ upsert: [entry(lines[i], n - 1, true)], remove: [] }), 1500);
  n += 1;
}, 3000);
server.setPresent({ url: `http://127.0.0.1:${port}/`, pair, phase: 'live', viewers: 3, wifi: { ssid: 'Meetup-Guest', password: 'example-pass' } });
process.stdout.write(`viewer:  http://127.0.0.1:${port}/\npresent: http://127.0.0.1:${port}/present\n`);
