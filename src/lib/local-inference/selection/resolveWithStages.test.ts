// A stored line-up in the local engine's resolution: Bing and Edge where the line-up names them, and nothing at
// all for a stage another provider serves.
import { describe, expect, it } from 'vitest';
import { resolveWasmDirection } from './resolveWithStages';

const ctx = { modelStatuses: {}, webgpuAvailable: false, deviceFeatures: [] };

describe('a direction resolved under a stored line-up', () => {
  it('an all-local line-up with Bing and Edge: both run, and recognition is still this machine\'s to find', () => {
    const r = resolveWasmDirection('en', 'ja', {}, ctx, { translation: 'bing', speech: 'edge' });
    expect(r.translation?.modelId).toBe('bing-translator');
    expect(r.tts?.modelId).toBe('edge-tts');
    // No recognition model is downloaded here: that is noted, as before.
    expect(r.asr).toBeNull();
    expect(r.notes.some((n) => n.stage === 'asr')).toBe(true);
  });

  it('only speech is this provider\'s: Edge speaks, and nothing resolves or is noted for recognition and translation', () => {
    const r = resolveWasmDirection('en', 'ja', {}, ctx, { translation: null, speech: 'edge' });
    expect(r).toMatchObject({ asr: null, translation: null, tts: { modelId: 'edge-tts' } });
    expect(r.notes).toEqual([]);
    expect(r.prunes).toEqual([]);
  });

  it('only a local voice is this provider\'s: its missing model is noted, the stages served elsewhere are not', () => {
    const r = resolveWasmDirection('en', 'ja', {}, ctx, { translation: null, speech: 'local' });
    expect(r).toMatchObject({ asr: null, translation: null, tts: null });
    expect(r.notes.map((n) => n.stage)).toEqual(['tts']);
  });

  it('another provider speaks: no speech model resolves or is noted, and a stored choice for it is not pruned', () => {
    const selections = { 'en→ja': { asr: { modelId: '' }, translation: { modelId: '' }, tts: { modelId: 'a-model-that-is-gone' } } };
    const r = resolveWasmDirection('en', 'ja', selections, ctx, { translation: 'bing', speech: null });
    expect(r.translation?.modelId).toBe('bing-translator');
    expect(r.tts).toBeNull();
    expect(r.notes.some((n) => n.stage === 'tts')).toBe(false);
    expect(r.prunes.some((p) => p.stage === 'tts')).toBe(false);
    // The same choice is pruned once this machine speaks again.
    expect(resolveWasmDirection('en', 'ja', selections, ctx, { translation: 'bing', speech: 'local' }).prunes.some((p) => p.stage === 'tts')).toBe(true);
  });

  it('another provider transcribes and this one translates: a downloaded translation model resolves, and nothing resolves or is noted for recognition', () => {
    const downloaded = { ...ctx, modelStatuses: { 'opus-mt-en-jap': 'downloaded' as const, 'sensevoice-int8': 'downloaded' as const } };
    const r = resolveWasmDirection('en', 'ja', {}, downloaded, { translation: 'local', speech: null, transcription: null });
    expect(r.translation?.modelId).toBe('opus-mt-en-jap');
    expect(r.asr).toBeNull();
    expect(r.notes.some((n) => n.stage === 'asr')).toBe(false);
    // Not downloaded: nothing translates, and Bing does not stand in for it.
    const none = resolveWasmDirection('en', 'ja', {}, ctx, { translation: 'local', speech: null, transcription: null });
    expect(none.translation).toBeNull();
    expect(none.notes.map((n) => n.stage)).toEqual(['translation']);
  });

  it('this one transcribes and another provider translates: a downloaded recognition model resolves, and nothing resolves or is noted for translation', () => {
    const downloaded = { ...ctx, modelStatuses: { 'opus-mt-en-jap': 'downloaded' as const, 'sensevoice-int8': 'downloaded' as const } };
    const r = resolveWasmDirection('en', 'ja', {}, downloaded, { translation: null, speech: null, transcription: 'local' });
    expect(r.asr?.modelId).toBe('sensevoice-int8');
    expect(r.translation).toBeNull();
    expect(r.notes.some((n) => n.stage === 'translation')).toBe(false);
    // Not downloaded: nothing recognises, and that is noted.
    const none = resolveWasmDirection('en', 'ja', {}, ctx, { translation: null, speech: null, transcription: 'local' });
    expect(none.asr).toBeNull();
    expect(none.translation).toBeNull();
    expect(none.notes.map((n) => n.stage)).toEqual(['asr']);
  });
});
