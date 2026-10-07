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

describe('voiceStoreFor', () => {
  it('clip store resolves audio payload', async () => {
    const s = voiceStoreFor('clip', 'moss-tts-nano')!;
    expect(s.kind).toBe('clip');
    expect(s.capability.importModes).toEqual(['record', 'upload']);
    expect((await s.list())[0]).toEqual({ id: 1, name: 'Clip', hasTranscript: false });
    const p = await s.resolveApply(1);
    expect(p).toEqual({ kind: 'clip', audio: new Float32Array([0.5]), sampleRate: 24000, transcript: undefined });
  });

  it('none -> null', () => {
    expect(voiceStoreFor('none', 'x')).toBeNull();
  });

  it('the old style-vector store is gone: an unrecognized custom value resolves to null', () => {
    // 'style' died with the ONNX Supertonic backend (Task 5's catalog rewire)
    // and the renderer's setStyleVoice sender (Task 6) -- voiceCapability()
    // can no longer produce it, but the switch's default branch still
    // degrades safely for any legacy/unexpected value rather than throwing.
    expect(voiceStoreFor('style' as never, 'supertonic-3')).toBeNull();
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

describe('per-model clip limits', () => {
  it('OmniVoice declares an 8s max; unlisted models keep the 20s default', () => {
    const omni = voiceStoreFor('clip', 'omnivoice-0.6b')!;
    expect(omni.capability.maxClipSeconds).toBe(8);
    expect(omni.capability.minClipSeconds).toBe(3);
    const other = voiceStoreFor('clip', 'qwen3-tts-0.6b')!;
    expect(other.capability.maxClipSeconds).toBe(20);
  });

  it('validateVoiceClip enforces the passed-in max (a 10s clip: ok at 20s, too_long at 8s)', () => {
    const clip = new Float32Array(16000 * 10).fill(0.3); // 10s
    expect(validateVoiceClip(clip, 16000)).toBeNull();
    expect(validateVoiceClip(clip, 16000, 8)).toBe('too_long');
  });

  it('the omnivoice clip store rejects a 10s recording as too_long', async () => {
    const s = voiceStoreFor('clip', 'omnivoice-0.6b')!;
    await expect(s.onRecord!(new Float32Array(16000 * 10).fill(0.3), 16000))
      .rejects.toMatchObject({ code: 'too_long' });
  });

  it('Audio8 keeps the 20s default, stated explicitly', () => {
    const s = voiceStoreFor('clip', 'audio8-tts-0.6b')!;
    expect(s.capability.maxClipSeconds).toBe(20);
    expect(s.capability.minClipSeconds).toBe(3);
  });

  it('GLM-TTS takes the 10s its vendor recommends at most', () => {
    expect(voiceStoreFor('clip', 'glm-tts')!.capability.maxClipSeconds).toBe(10);
  });
});

describe('CosyVoice 3 clip window', () => {
  it('keeps the default 3-20s window (audio.cpp sets no ceiling of its own)', () => {
    const s = voiceStoreFor('clip', 'cosyvoice3')!;
    expect(s.capability.minClipSeconds).toBe(3);
    expect(s.capability.maxClipSeconds).toBe(20);
  });
});

describe('FireRedTTS-3 Base clip window', () => {
  it('keeps the default 3-20s window (audio.cpp sets no ceiling of its own)', () => {
    const s = voiceStoreFor('clip', 'fireredtts3-base')!;
    expect(s.capability.minClipSeconds).toBe(3);
    expect(s.capability.maxClipSeconds).toBe(20);
  });
});

describe('MOSS-TTS-Local v1.5 clip window', () => {
  it('keeps the default 3-20s window (audio.cpp sets no ceiling of its own)', () => {
    const s = voiceStoreFor('clip', 'moss-tts-local-1.5')!;
    expect(s.capability.minClipSeconds).toBe(3);
    expect(s.capability.maxClipSeconds).toBe(20);
  });
});

describe('VibeVoice 1.5B clip window', () => {
  it('caps the reference at 10s, as audio.cpp does for a voice prompt off CUDA', () => {
    const s = voiceStoreFor('clip', 'vibevoice-1.5b')!;
    expect(s.capability.maxClipSeconds).toBe(10);
    expect(s.capability.minClipSeconds).toBe(3);
  });
});

describe('Chatterbox clip window', () => {
  it('keeps the default 3-20s window (the speaker embedding reads the whole clip)', () => {
    const s = voiceStoreFor('clip', 'chatterbox')!;
    expect(s.capability.minClipSeconds).toBe(3);
    expect(s.capability.maxClipSeconds).toBe(20);
  });
});

describe('Confucius4-TTS clip window', () => {
  it('keeps the default 3-20s window (audio.cpp sets no ceiling of its own)', () => {
    const s = voiceStoreFor('clip', 'confucius4')!;
    expect(s.capability.minClipSeconds).toBe(3);
    expect(s.capability.maxClipSeconds).toBe(20);
  });
});

describe('Irodori TTS 500M v3 clip window', () => {
  it('keeps the default 3-20s window (its card asks for a short reference clip)', () => {
    const s = voiceStoreFor('clip', 'irodori-tts-500m-v3')!;
    expect(s.capability.minClipSeconds).toBe(3);
    expect(s.capability.maxClipSeconds).toBe(20);
  });
});

describe('Irodori TTS v4 clip window', () => {
  it('allows 40s on the v4.1 Anime card: the v4.1-Small card recommends about 30s or more, and was evaluated on 30-40s references', () => {
    const s = voiceStoreFor('clip', 'irodori-tts-v4.1-anime')!;
    expect(s.capability.maxClipSeconds).toBe(40);
    expect(s.capability.minClipSeconds).toBe(3);
  });

  it('allows the same 40s on the v4 Small card, whose GGUF embeds the same model card', () => {
    const s = voiceStoreFor('clip', 'irodori-tts-v4-small')!;
    expect(s.capability.maxClipSeconds).toBe(40);
    expect(s.capability.minClipSeconds).toBe(3);
  });

  it('the clip store accepts a 25s recording and rejects a 41s one as too_long', async () => {
    const s = voiceStoreFor('clip', 'irodori-tts-v4-small')!;
    vi.mocked(addNativeVoice).mockClear();
    await s.onRecord!(new Float32Array(16000 * 25).fill(0.3), 16000);
    expect(vi.mocked(addNativeVoice)).toHaveBeenCalledTimes(1);
    await expect(s.onRecord!(new Float32Array(16000 * 41).fill(0.3), 16000))
      .rejects.toMatchObject({ code: 'too_long' });
    expect(vi.mocked(addNativeVoice)).toHaveBeenCalledTimes(1);
  });
});

describe('Higgs Audio v3 clip window', () => {
  it('keeps the default 3-20s window (audio.cpp sets no ceiling of its own)', () => {
    const s = voiceStoreFor('clip', 'higgs-audio-v3-4b')!;
    expect(s.capability.minClipSeconds).toBe(3);
    expect(s.capability.maxClipSeconds).toBe(20);
  });
});

describe('Fish Audio S2 Pro clip window', () => {
  it('keeps the default 3-20s window (audio.cpp sets no ceiling of its own)', () => {
    const s = voiceStoreFor('clip', 'fish-audio-s2-pro')!;
    expect(s.capability.minClipSeconds).toBe(3);
    expect(s.capability.maxClipSeconds).toBe(20);
  });
});

describe('Breeze-TTS 2 clip window', () => {
  it('keeps the default 3-20s window (audio.cpp sets no ceiling of its own)', () => {
    const s = voiceStoreFor('clip', 'breeze-tts-2')!;
    expect(s.capability.minClipSeconds).toBe(3);
    expect(s.capability.maxClipSeconds).toBe(20);
  });
});
