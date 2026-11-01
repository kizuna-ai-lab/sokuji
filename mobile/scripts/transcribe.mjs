#!/usr/bin/env node
// Transcribe WAV files with Soniox real-time STT, the way the app connects (stt-rt-v5, pcm_s16le,
// the file's own sample rate, language identification on). Prints the final text per file.
// Usage: SONIOX_API_KEY_FILE=key.txt node transcribe.mjs [--region us|eu|jp] [--hints zh,en] a.wav b.wav …
// Needs Node 22 (built-in WebSocket). Cost: Soniox real-time rate for the files' duration (seconds).
import fs from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : dflt; };
const region = opt('--region', 'us');
const hints = opt('--hints', '').split(',').filter(Boolean);
const jsonOut = opt('--json', ''); // optional: write every final token (text, start_ms, end_ms, language) per file
const dump = {};
const keyFile = process.env.SONIOX_API_KEY_FILE;
const key = (keyFile ? fs.readFileSync(keyFile, 'utf8') : process.env.SONIOX_API_KEY ?? '').trim();
if (!key) { console.error('SONIOX_API_KEY_FILE or SONIOX_API_KEY'); process.exit(2); }
const host = `stt-rt${region === 'us' ? '' : `.${region}`}.soniox.com`;

function readWav(path) {
  const b = fs.readFileSync(path);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`${path}: not a WAV`);
  let o = 12, fmt = null, data = null;
  while (o + 8 <= b.length) {
    const id = b.toString('ascii', o, o + 4), size = b.readUInt32LE(o + 4);
    if (id === 'fmt ') fmt = { format: b.readUInt16LE(o + 8), channels: b.readUInt16LE(o + 10), rate: b.readUInt32LE(o + 12), bits: b.readUInt16LE(o + 22) };
    if (id === 'data') data = b.subarray(o + 8, o + 8 + size);
    o += 8 + size + (size % 2);
  }
  if (!fmt || !data) throw new Error(`${path}: missing fmt/data`);
  if (fmt.format !== 1 || fmt.bits !== 16) throw new Error(`${path}: need 16-bit PCM (got format ${fmt.format}, ${fmt.bits} bit)`);
  if (fmt.channels !== 1) { // take the first channel
    const n = data.length / 2 / fmt.channels, mono = Buffer.alloc(n * 2);
    for (let i = 0; i < n; i++) mono.writeInt16LE(data.readInt16LE(i * fmt.channels * 2), i * 2);
    data = mono;
  }
  return { pcm: data, rate: fmt.rate, seconds: data.length / 2 / fmt.rate };
}

function transcribe(path) {
  const { pcm, rate, seconds } = readWav(path);
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`wss://${host}/transcribe-websocket`, ['soniox-api-key', key]);
    const finals = []; let partial = '';
    const timer = setTimeout(() => { ws.close(); reject(new Error('timeout')); }, 60000 + seconds * 2000);
    ws.onopen = () => {
      ws.send(JSON.stringify({ model: 'stt-rt-v5', audio_format: 'pcm_s16le', sample_rate: rate, num_channels: 1, enable_language_identification: true, ...(hints.length ? { language_hints: hints } : {}) }));
      // Real-time pacing is not required for a file; chunks of 100 ms keep frames small.
      const step = Math.round(rate * 0.1) * 2;
      for (let i = 0; i < pcm.length; i += step) ws.send(pcm.subarray(i, i + step));
      ws.send(''); // end of audio must be an empty TEXT frame (an empty binary frame is ignored and the server times out, 408)
    };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.error_code) { clearTimeout(timer); ws.close(); return reject(new Error(`${m.error_code} ${m.error_message}`)); }
      partial = '';
      for (const t of m.tokens ?? []) { if (t.text === '<end>' || t.text === '<fin>') continue; if (t.is_final) finals.push(t); else partial += t.text; }
      if (m.finished) { clearTimeout(timer); ws.close(); resolve({ seconds, text: finals.map((t) => t.text).join(''), languages: [...new Set(finals.map((t) => t.language).filter(Boolean))], tokens: finals.map((t) => ({ text: t.text, start_ms: t.start_ms, end_ms: t.end_ms, language: t.language })) }); }
    };
    ws.onerror = (e) => { clearTimeout(timer); reject(new Error(`socket error ${e.message ?? ''}`)); };
    ws.onclose = (e) => { clearTimeout(timer); reject(new Error(`socket closed ${e.code}`)); };
  });
}

for (const path of args) {
  try {
    const r = await transcribe(path);
    console.log(`\n== ${path} (${r.seconds.toFixed(1)} s, languages ${r.languages.join(',') || '?'})\n${r.text || '(nothing recognised)'}`);
    dump[path] = { seconds: r.seconds, text: r.text, tokens: r.tokens };
  } catch (err) { console.log(`\n== ${path}: FAILED ${err.message}`); }
}
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(dump, null, 1));
