import { describe, it, expect, beforeEach, vi } from 'vitest';

const { persistSetting } = vi.hoisted(() => ({ persistSetting: vi.fn(async () => {}) }));
vi.mock('../services/persistSetting', () => ({ persistSetting }));

import { TURN_DETECTION_DEFAULTS } from '../lib/turn/turnDetectionSettings';
import { loadTurnDetection, useTurnDetectionStore } from './turnDetectionStore';

/** A fake service over a Map from key to value. */
const serviceOf = (stored: Map<string, unknown>) => ({ getSetting: async (key: string, def: unknown) => (stored.has(key) ? stored.get(key) : def) }) as never;

beforeEach(() => {
  persistSetting.mockClear();
  useTurnDetectionStore.setState({ settings: TURN_DETECTION_DEFAULTS });
});

describe('loadTurnDetection', () => {
  it('reads settings.localInference.vadThreshold once and writes settings.turnDetection.threshold', async () => {
    const stored = new Map<string, unknown>([['settings.localInference.vadThreshold', 0.45]]);
    await loadTurnDetection(serviceOf(stored));
    expect(useTurnDetectionStore.getState().settings.threshold).toBe(0.45);
    expect(persistSetting).toHaveBeenCalledTimes(1);
    expect(persistSetting).toHaveBeenCalledWith('settings.turnDetection.threshold', 0.45);
    // What the first load wrote is what the next one finds: nothing more to write.
    stored.set('settings.turnDetection.threshold', 0.45);
    persistSetting.mockClear();
    await loadTurnDetection(serviceOf(stored));
    expect(persistSetting).not.toHaveBeenCalled();
  });
  it('carries each of the nine legacy keys over once', async () => {
    const legacy: Record<string, unknown> = {
      vadThreshold: 0.45, vadNegativeThreshold: 0.2, vadMinSilenceDuration: 0.9, vadMinSpeechDuration: 0.5,
      vadPreSpeechPadDuration: 0.6, vadMaxSpeechDuration: 25, vadEndOfTurn: 'smart', smartTurnCheckAfter: 0.4, smartTurnThreshold: 0.6,
    };
    const stored = new Map<string, unknown>(Object.entries(legacy).map(([k, v]) => [`settings.localInference.${k}`, v]));
    await loadTurnDetection(serviceOf(stored));
    const expected: Record<string, unknown> = {
      threshold: 0.45, negativeThreshold: 0.2, minSilence: 0.9, minSpeech: 0.5, prePad: 0.6, maxSpeech: 25,
      endOfTurn: 'smart', smartTurnCheckAfter: 0.4, smartTurnThreshold: 0.6,
    };
    expect(persistSetting).toHaveBeenCalledTimes(9);
    for (const [k, v] of Object.entries(expected)) expect(persistSetting).toHaveBeenCalledWith(`settings.turnDetection.${k}`, v);
    expect(useTurnDetectionStore.getState().settings).toEqual(expected);
  });
  it('writes nothing when nothing is stored', async () => {
    await loadTurnDetection(serviceOf(new Map()));
    expect(persistSetting).not.toHaveBeenCalled();
    expect(useTurnDetectionStore.getState().settings).toEqual(TURN_DETECTION_DEFAULTS);
  });
});

describe('turnDetectionStore', () => {
  it('update persists only the fields that changed, clamped', () => {
    useTurnDetectionStore.getState().update({ threshold: 0.3, minSilence: 3 });
    expect(persistSetting).toHaveBeenCalledTimes(1);
    expect(persistSetting).toHaveBeenCalledWith('settings.turnDetection.minSilence', 2);
    expect(useTurnDetectionStore.getState().settings.minSilence).toBe(2);
  });
  it('dragging the threshold below the silence threshold and back keeps the stored silence threshold', () => {
    const { update } = useTurnDetectionStore.getState();
    update({ threshold: 0.5 });
    update({ negativeThreshold: 0.4 });
    persistSetting.mockClear();
    update({ threshold: 0.3 });
    expect(useTurnDetectionStore.getState().settings.negativeThreshold).toBe(0.4);
    expect(persistSetting).not.toHaveBeenCalledWith('settings.turnDetection.negativeThreshold', expect.anything());
    update({ threshold: 0.5 });
    expect(useTurnDetectionStore.getState().settings.negativeThreshold).toBe(0.4);
  });
  it('restoreDefaults puts the eight sliders back and keeps Normal / Smart', () => {
    useTurnDetectionStore.getState().update({ threshold: 0.6, maxSpeech: 20, endOfTurn: 'smart' });
    persistSetting.mockClear();
    useTurnDetectionStore.getState().restoreDefaults();
    expect(useTurnDetectionStore.getState().settings).toEqual({ ...TURN_DETECTION_DEFAULTS, endOfTurn: 'smart' });
    expect(persistSetting).toHaveBeenCalledWith('settings.turnDetection.threshold', 0.3);
    expect(persistSetting).not.toHaveBeenCalledWith('settings.turnDetection.endOfTurn', expect.anything());
  });
});
