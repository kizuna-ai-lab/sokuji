import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadAddon, nativeDir } from './helpers.mjs';

const sk = loadAddon();
sk.init({ moduleDir: nativeDir() });

test('one profile per device, same order and index', () => {
  const ds = sk.devices(), ps = sk.deviceProfiles();
  assert.deepEqual(ps.map((p) => p.index), ds.map((d) => d.index));
  const cpu = ps.find((p) => p.kind === 'cpu');
  assert.ok(cpu.known && cpu.cpuFeatures.length > 0);
});

test('free memory is positive for every device', () => {
  for (const d of sk.devices()) assert.ok(sk.deviceFreeMem(d.index) > 0);
});

test('op coverage: a recorded asr family on CPU', async () => {
  const cpu = sk.devices().find((d) => d.kind === 'cpu');
  const cov = await sk.deviceSupportsOps(cpu.index, 'asr', 'whisper', ['q8_0']);
  assert.ok(cov.checked.length > 0);
  assert.equal(cov.allSupported, cov.unsupported.length === 0);
});

test('op coverage: unknown family rejects with NOT_FOUND', async () => {
  await assert.rejects(sk.deviceSupportsOps(0, 'asr', 'no-such-family', ['q8_0']),
    (e) => e.name === 'NativeError' && e.status === -4);
});

test('audio families are sorted and include supertonic', () => {
  const f = sk.audioFamilies();
  assert.deepEqual(f, [...f].sort());
  assert.ok(f.includes('supertonic'));
});
