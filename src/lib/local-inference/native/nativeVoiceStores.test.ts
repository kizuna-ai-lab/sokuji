import { describe, it, expect, vi } from 'vitest';
import { voiceStoreFor, validateVoiceClip } from './nativeVoiceStores';

vi.mock('../nativeVoiceStorage', () => ({
  listNativeVoices: vi.fn().mockResolvedValue([{ id: 1, name: 'Clip', audio: [0.5], sampleRate: 24000 }]),
  getNativeVoice: vi.fn().mockImplementation(async () => ({ id: 1, name: 'Clip', audio: [0.5], sampleRate: 24000 })),
  addNativeVoice: vi.fn(),
  renameNativeVoice: vi.fn(),
  deleteNativeVoice: vi.fn(),
}));
vi.mock('../voiceStorage', () => ({
  listVoices: vi.fn().mockResolvedValue([{ id: 2, name: 'Style', jsonData: new Blob([JSON.stringify({ style_ttl: { dims: [1], data: [3] }, style_dp: { dims: [1], data: [4] } })]) }]),
  getVoice: vi.fn().mockImplementation(async () => ({ id: 2, name: 'Style', jsonData: new Blob([JSON.stringify({ style_ttl: { dims: [1], data: [3] }, style_dp: { dims: [1], data: [4] } })]) })),
  addVoice: vi.fn(),
  renameVoice: vi.fn(),
  deleteVoice: vi.fn(),
  VoiceImportError: class extends Error {},
}));

describe('voiceStoreFor', () => {
  it('clip store resolves audio payload', async () => {
    const s = voiceStoreFor('clip', 'moss-tts-nano')!;
    expect(s.kind).toBe('clip');
    expect(s.capability.importModes).toEqual(['record', 'upload']);
    expect((await s.list())[0]).toEqual({ id: 1, name: 'Clip' });
    const p = await s.resolveApply(1);
    expect(p).toEqual({ kind: 'clip', audio: new Float32Array([0.5]), sampleRate: 24000 });
  });

  it('style store resolves style payload', async () => {
    const s = voiceStoreFor('style', 'supertonic-3')!;
    expect(s.kind).toBe('style');
    expect(s.capability.importModes).toEqual(['upload']);
    expect((await s.list())[0]).toEqual({ id: 2, name: 'Style' });
    const p = await s.resolveApply(2);
    expect(p).toEqual({ kind: 'style', styleTtl: { dims: [1], data: [3] }, styleDp: { dims: [1], data: [4] } });
  });

  it('none -> null', () => {
    expect(voiceStoreFor('none', 'x')).toBeNull();
  });
});

describe('validateVoiceClip', () => {
  it('flags clips outside the accepted duration / loudness range', () => {
    expect(validateVoiceClip(new Float32Array(16000).fill(0.3), 16000)).toBe('too_short'); // 1s
    expect(validateVoiceClip(new Float32Array(16000 * 25).fill(0.3), 16000)).toBe('too_long'); // 25s
    expect(validateVoiceClip(new Float32Array(16000 * 5), 16000)).toBe('silent'); // 5s of zeros
    expect(validateVoiceClip(new Float32Array(16000 * 5).fill(0.3), 16000)).toBeNull();
  });
});
