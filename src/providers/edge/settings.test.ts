import { describe, it, expect } from 'vitest';
import { migrateEdgeSettings } from './settings';

const inputs = (legacy: Record<string, unknown>) => ({ legacy, credentials: {} });

describe('migrateEdgeSettings', () => {
  it("migrates each direction's Edge voice and the speed from the local settings", () => {
    expect(migrateEdgeSettings({}, inputs({
      'settings.localInference.voices': { 'en→ja': { edge: 'ja-JP-NanamiNeural', speaker: 3 }, 'ja→en': { speaker: 1 } },
      'settings.localInference.ttsSpeed': 1.2,
    }))).toEqual({ voices: { 'en→ja': 'ja-JP-NanamiNeural' }, speed: 1.2 });
  });

  it("keeps Edge's own stored values over the local ones", () => {
    expect(migrateEdgeSettings({}, inputs({
      voices: { 'en→ja': 'ja-JP-KeitaNeural' }, speed: 0.9,
      'settings.localInference.voices': { 'en→ja': { edge: 'ja-JP-NanamiNeural' } },
      'settings.localInference.ttsSpeed': 1.2,
    }))).toEqual({ voices: { 'en→ja': 'ja-JP-KeitaNeural' }, speed: 0.9 });
  });

  it('takes each of the two from wherever it is stored', () => {
    expect(migrateEdgeSettings({}, inputs({ speed: 0.8, 'settings.localInference.voices': { 'a→b': { edge: 'x' } } })))
      .toEqual({ voices: { 'a→b': 'x' }, speed: 0.8 });
  });

  it('is the defaults with nothing stored anywhere', () => {
    expect(migrateEdgeSettings({}, inputs({}))).toEqual({ voices: {}, speed: 1 });
  });

  it('drops what is not a voice name or a finite number', () => {
    expect(migrateEdgeSettings({}, inputs({
      'settings.localInference.voices': { 'a→b': { edge: 5 }, 'c→d': 'x', 'e→f': { edge: '' }, 'g→h': { edge: 'ok' } },
      'settings.localInference.ttsSpeed': Number.NaN,
    }))).toEqual({ voices: { 'g→h': 'ok' }, speed: 1 });
    expect(migrateEdgeSettings({}, inputs({ voices: { 'a→b': 3, 'c→d': 'v' }, speed: 'fast', 'settings.localInference.ttsSpeed': 1.5 })))
      .toEqual({ voices: { 'c→d': 'v' }, speed: 1.5 });
    expect(migrateEdgeSettings({}, inputs({ 'settings.localInference.voices': ['x'], 'settings.localInference.ttsSpeed': '1.2' })))
      .toEqual({ voices: {}, speed: 1 });
  });

  it("falls back to the local table's Edge voices when Edge's own voices hold no valid entry", () => {
    const local = { 'settings.localInference.voices': { 'a→b': { edge: 'x' } } };
    expect(migrateEdgeSettings({}, inputs({ voices: {}, ...local })).voices).toEqual({ 'a→b': 'x' });
    expect(migrateEdgeSettings({}, inputs({ voices: { 'a→b': 3, 'c→d': '' }, ...local })).voices).toEqual({ 'a→b': 'x' });
  });
});
