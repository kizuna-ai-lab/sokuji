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
  it('restoreDefaults puts the eight sliders back and keeps Normal / Smart', () => {
    useTurnDetectionStore.getState().update({ threshold: 0.6, maxSpeech: 20, endOfTurn: 'smart' });
    persistSetting.mockClear();
    useTurnDetectionStore.getState().restoreDefaults();
    expect(useTurnDetectionStore.getState().settings).toEqual({ ...TURN_DETECTION_DEFAULTS, endOfTurn: 'smart' });
    expect(persistSetting).toHaveBeenCalledWith('settings.turnDetection.threshold', 0.3);
    expect(persistSetting).not.toHaveBeenCalledWith('settings.turnDetection.endOfTurn', expect.anything());
  });
});
