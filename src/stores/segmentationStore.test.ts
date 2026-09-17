import { describe, it, expect, beforeEach } from 'vitest';
import { useSegmentationStore } from './segmentationStore';
import { MODEL_IDS } from '../lib/segmentation/PunctuationRuntime';

beforeEach(() => { useSegmentationStore.getState().resetSession(); });

describe('segmentationStore', () => {
  it('starts every model as not-downloaded with no progress and no error', () => {
    const initialState = useSegmentationStore.getInitialState();
    for (const model of ['fireredpunc', 'edge-punct-en', 'sat-3l-sm'] as const) {
      expect(initialState.models[model]).toEqual({ status: 'not-downloaded', percent: 0, error: null });
    }
  });

  it('records a status and clears the error when it recovers', () => {
    const { setModelStatus } = useSegmentationStore.getState();
    setModelStatus('fireredpunc', 'error', 'network unreachable');
    expect(useSegmentationStore.getState().models.fireredpunc.error).toBe('network unreachable');
    setModelStatus('fireredpunc', 'ready');
    expect(useSegmentationStore.getState().models.fireredpunc).toEqual({ status: 'ready', percent: 100, error: null });
  });

  it('tracks download progress', () => {
    useSegmentationStore.getState().setModelProgress('sat-3l-sm', 42);
    expect(useSegmentationStore.getState().models['sat-3l-sm'].percent).toBe(42);
  });

  it('keeps a downloaded model downloaded across a session reset', () => {
    useSegmentationStore.getState().setModelStatus('edge-punct-en', 'ready');
    useSegmentationStore.getState().resetSession();
    // 'ready' is a session fact; 'downloaded' is not.
    expect(useSegmentationStore.getState().models['edge-punct-en'].status).toBe('downloaded');
  });

  // Important 2 of the fix round: this store starts every model
  // 'not-downloaded' and nothing ever seeded it from what modelStore already
  // knows is on disk, so a model the user has already downloaded rendered a
  // Download button forever. These pin the mapping seedFromModelStatuses()
  // does between modelStore's on-disk vocabulary and this store's own.
  describe('seedFromModelStatuses', () => {
    beforeEach(() => {
      // The outer beforeEach only calls resetSession(), which deliberately
      // preserves a 'downloaded' status across resets — not a hard reset to
      // blank — so a prior test in this file could leave residual state a
      // seeding test must not depend on. Force a known-blank state instead.
      useSegmentationStore.setState({
        models: {
          'fireredpunc': { status: 'not-downloaded', percent: 0, error: null },
          'edge-punct-en': { status: 'not-downloaded', percent: 0, error: null },
          'sat-3l-sm': { status: 'not-downloaded', percent: 0, error: null },
        },
      });
    });

    it('maps an on-disk "downloaded" model onto this store\'s vocabulary, found through MODEL_IDS', () => {
      useSegmentationStore.getState().seedFromModelStatuses({ [MODEL_IDS['fireredpunc']]: 'downloaded' });
      expect(useSegmentationStore.getState().models.fireredpunc).toEqual({ status: 'downloaded', percent: 100, error: null });
    });

    it('maps an on-disk "error" status the same way', () => {
      useSegmentationStore.getState().seedFromModelStatuses({ [MODEL_IDS['edge-punct-en']]: 'error' });
      expect(useSegmentationStore.getState().models['edge-punct-en']).toEqual({ status: 'error', percent: 0, error: null });
    });

    it('leaves a model with no on-disk data at "not-downloaded"', () => {
      useSegmentationStore.getState().seedFromModelStatuses({});
      expect(useSegmentationStore.getState().models['sat-3l-sm'].status).toBe('not-downloaded');
    });

    it('does not treat an in-flight on-disk download as a fact to seed', () => {
      // modelStore.initialize() always resets a stale in-flight download back
      // to 'not_downloaded' on a fresh launch — a live 'downloading' here
      // would never legitimately describe an on-disk fact at seed time.
      useSegmentationStore.getState().seedFromModelStatuses({ [MODEL_IDS['sat-3l-sm']]: 'downloading' });
      expect(useSegmentationStore.getState().models['sat-3l-sm'].status).toBe('not-downloaded');
    });

    it('never overwrites a session fact, even one richer than modelStore has a word for', () => {
      useSegmentationStore.getState().setModelStatus('fireredpunc', 'ready');
      useSegmentationStore.getState().seedFromModelStatuses({ [MODEL_IDS['fireredpunc']]: 'not_downloaded' });
      expect(useSegmentationStore.getState().models.fireredpunc.status).toBe('ready');
    });
  });
});
