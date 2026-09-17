import { describe, it, expect, beforeEach } from 'vitest';
import { useSegmentationStore } from './segmentationStore';

beforeEach(() => { useSegmentationStore.getState().resetSession(); });

describe('segmentationStore', () => {
  it('starts every model as not-downloaded with no progress and no error', () => {
    const state = useSegmentationStore.getState();
    for (const model of ['fireredpunc', 'edge-punct-en', 'sat-3l-sm'] as const) {
      expect(state.models[model]).toEqual({ status: 'not-downloaded', percent: 0, error: null });
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
});
