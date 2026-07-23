import { describe, it, expect, vi } from 'vitest';
import { voiceStoreFor, validateVoiceClip, normalizePeak } from './nativeVoiceStores';
import { addNativeVoice } from '../nativeVoiceStorage';

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
    expect((await s.list())[0]).toEqual({ id: 1, name: 'Clip', hasTranscript: false });
    const p = await s.resolveApply(1);
    expect(p).toEqual({ kind: 'clip', audio: new Float32Array([0.5]), sampleRate: 24000, transcript: undefined });
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

  it('clip store surfaces transcripts', async () => {
    const { listNativeVoices } = await import('../nativeVoiceStorage');
    vi.mocked(listNativeVoices).mockResolvedValueOnce([
      { id: 1, name: 'A', audio: [0.5] as unknown as ArrayBuffer, sampleRate: 24000, createdAt: 0, transcript: 'hi' },
      { id: 2, name: 'B', audio: [0.5] as unknown as ArrayBuffer, sampleRate: 24000, createdAt: 0 },
    ]);
    const { getNativeVoice } = await import('../nativeVoiceStorage');
    vi.mocked(getNativeVoice).mockResolvedValueOnce({
      id: 1, name: 'A', audio: [0.5] as unknown as ArrayBuffer, sampleRate: 24000, createdAt: 0, transcript: 'hi',
    });

    const s = voiceStoreFor('clip', 'qwen3-tts-0.6b')!;
    const list = await s.list();
    expect(list).toEqual([
      { id: 1, name: 'A', hasTranscript: true },
      { id: 2, name: 'B', hasTranscript: false },
    ]);
    const p = await s.resolveApply(1);
    expect(p).toMatchObject({ kind: 'clip', sampleRate: 24000, transcript: 'hi' });
  });

  it('clip store onRecord forwards the transcript to storage', async () => {
    const s = voiceStoreFor('clip', 'qwen3-tts-0.6b')!;
    // Non-silent samples: an all-zero clip fails validateVoiceClip's loudness
    // check regardless of the transcript feature under test here.
    await s.onRecord!(new Float32Array(72000).fill(0.3), 24000, 'spoken words');
    expect(vi.mocked(addNativeVoice)).toHaveBeenCalledWith(expect.any(String), expect.anything(), 24000, 'spoken words');
  });
});

describe('validateVoiceClip', () => {
  it('flags clips outside the accepted duration / loudness range', () => {
    expect(validateVoiceClip(new Float32Array(16000).fill(0.3), 16000)).toBe('too_short'); // 1s
    expect(validateVoiceClip(new Float32Array(16000 * 25).fill(0.3), 16000)).toBe('too_long'); // 25s
    expect(validateVoiceClip(new Float32Array(16000 * 5), 16000)).toBe('silent'); // 5s of zeros
    expect(validateVoiceClip(new Float32Array(16000 * 5).fill(0.3), 16000)).toBeNull();
  });

  it('accepts a genuine but QUIET / pause-heavy recording (peak-based, not mean-abs)', () => {
    // Reproduces the reported bug: a low-gain web recording (peak ~0.06, lots of
    // quiet/pauses) has mean-abs well below the old 0.005 threshold yet is real
    // speech. Peak-based validation must accept it.
    const clip = new Float32Array(16000 * 5); // 5s, mostly quiet
    for (let i = 0; i < 16000; i++) clip[i] = 0.06; // 1s of quiet signal, rest ~0
    // mean-abs ≈ 0.06 * 1/5 = 0.012... make it lower: only 0.2s of signal
    clip.fill(0);
    for (let i = 0; i < 3200; i++) clip[i] = 0.06; // 0.2s -> mean-abs ≈ 0.0024 (< old 0.005)
    expect(validateVoiceClip(clip, 16000)).toBeNull(); // peak 0.06 > 0.01 -> not silent
    // a truly silent clip with only sub-threshold noise is still rejected
    const noise = new Float32Array(16000 * 5).fill(0.003);
    expect(validateVoiceClip(noise, 16000)).toBe('silent'); // peak 0.003 < 0.01
  });
});

describe('normalizePeak', () => {
  it('scales a quiet clip up to ~0.95 peak and is a no-op for silence', () => {
    const quiet = new Float32Array([0, 0.06, -0.03, 0.06, 0]);
    const out = normalizePeak(quiet);
    expect(Math.max(...Array.from(out, Math.abs))).toBeCloseTo(0.95, 5);
    // relative shape preserved
    expect(out[1] / out[2]).toBeCloseTo(quiet[1] / quiet[2], 5);
    // silence unchanged (no divide-by-tiny blowup)
    const silence = new Float32Array(10);
    expect(Array.from(normalizePeak(silence))).toEqual(Array.from(silence));
  });
});
