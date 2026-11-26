// resample(): speexdsp at quality 10, synchronous, interleaved in and out.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadAddon, sine, snrDb } from './helpers.mjs';

const sk = loadAddon();

/** Channel `c` of `n` interleaved channels. */
function channel(pcm, n, c) {
  const out = new Float32Array(pcm.length / n);
  for (let i = 0; i < out.length; i++) out[i] = pcm[i * n + c];
  return out;
}

function interleave(...chans) {
  const out = new Float32Array(chans[0].length * chans.length);
  chans.forEach((ch, c) => ch.forEach((v, i) => { out[i * chans.length + c] = v; }));
  return out;
}

test('48 kHz → 24 kHz keeps a 440 Hz tone (SNR > 60 dB)', () => {
  const out = sk.resample(sine(440, 48000, 1.0), 1, 48000, 24000);
  assert.ok(out instanceof Float32Array);
  assert.equal(out.length, 24000);
  assert.ok(snrDb(out.subarray(1000, 23000), sine(440, 24000, 1.0).subarray(1000, 23000)) > 60);
});

test('44.1 kHz stereo → 24 kHz keeps both channels', () => {
  const src = interleave(sine(440, 44100, 1.0), sine(660, 44100, 1.0));
  const out = sk.resample(src, 2, 44100, 24000);
  assert.equal(out.length, 24000 * 2);
  assert.ok(snrDb(channel(out, 2, 0).subarray(1000, 23000), sine(440, 24000, 1.0).subarray(1000, 23000)) > 60);
  assert.ok(snrDb(channel(out, 2, 1).subarray(1000, 23000), sine(660, 24000, 1.0).subarray(1000, 23000)) > 60);
});

test('upsampling 16 kHz → 24 kHz keeps the tone and the length rule', () => {
  const out = sk.resample(sine(300, 16000, 1.0), 1, 16000, 24000);
  assert.equal(out.length, 24000);
  assert.ok(snrDb(out.subarray(1000, 23000), sine(300, 24000, 1.0).subarray(1000, 23000)) > 60);
});

test('the output length is round(frames * to / from) per channel', () => {
  // 1001 frames at 44.1 kHz → 24 kHz is 544.76 frames, which rounds to 545.
  assert.equal(sk.resample(new Float32Array(1001), 1, 44100, 24000).length, 545);
  assert.equal(sk.resample(new Float32Array(1001 * 2), 2, 44100, 24000).length, 545 * 2);
  assert.equal(sk.resample(new Float32Array(7), 1, 16000, 24000).length, 11);   // 10.5 rounds up
});

test('empty input gives empty output', () => {
  assert.equal(sk.resample(new Float32Array(0), 1, 48000, 24000).length, 0);
});

test('same rate returns an equal copy', () => {
  const x = sine(100, 24000, 0.1);
  const y = sk.resample(x, 1, 24000, 24000);
  assert.notEqual(x, y);
  assert.notEqual(x.buffer, y.buffer);
  assert.deepEqual([...y], [...x]);
});

test('does not modify its input', () => {
  const x = sine(440, 48000, 0.1);
  const before = [...x];
  sk.resample(x, 1, 48000, 24000);
  assert.deepEqual([...x], before);
});

test('rejects bad arguments', () => {
  assert.throws(() => sk.resample(new Float32Array(3), 2, 48000, 24000), /multiple of channels/);
  assert.throws(() => sk.resample([1, 2], 1, 48000, 24000), { name: 'TypeError', message: /pcm must be a Float32Array/ });
  assert.throws(() => sk.resample(new Float32Array(2), 0, 48000, 24000), { name: 'RangeError', message: /channels/ });
  assert.throws(() => sk.resample(new Float32Array(2), 1.5, 48000, 24000), { name: 'TypeError', message: /channels/ });
  assert.throws(() => sk.resample(new Float32Array(2), 1, 0, 24000), { name: 'RangeError', message: /fromRate/ });
  assert.throws(() => sk.resample(new Float32Array(2), 1, 48000, -1), { name: 'RangeError', message: /toRate/ });
  assert.throws(() => sk.resample(new Float32Array(2), 1, '48000', 24000), { name: 'TypeError', message: /fromRate/ });
});
