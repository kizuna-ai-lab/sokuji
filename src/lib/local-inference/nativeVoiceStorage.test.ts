import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { addNativeVoice, listNativeVoices, getNativeVoice, renameNativeVoice, deleteNativeVoice, resetNativeVoiceStorageForTesting } from './nativeVoiceStorage';

beforeEach(async () => { await resetNativeVoiceStorageForTesting(); });

it('add then list returns the voice with audio + sampleRate', async () => {
  const v = await addNativeVoice('My Voice', new Float32Array([0.1, -0.2, 0.3]), 16000);
  const all = await listNativeVoices();
  expect(all.map((x) => x.name)).toEqual(['My Voice']);
  const got = await getNativeVoice(v.id);
  expect(got!.sampleRate).toBe(16000);
  expect(new Float32Array(got!.audio).length).toBe(3);
});
it('uniquifies duplicate names', async () => {
  await addNativeVoice('V', new Float32Array([0]), 16000);
  const b = await addNativeVoice('V', new Float32Array([0]), 16000);
  expect(b.name).not.toBe('V');
});
it('rename and delete work', async () => {
  const v = await addNativeVoice('A', new Float32Array([0]), 16000);
  await renameNativeVoice(v.id, 'B');
  expect((await getNativeVoice(v.id))!.name).toBe('B');
  await deleteNativeVoice(v.id);
  expect(await getNativeVoice(v.id)).toBeUndefined();
});
