import { describe, it, expect, beforeEach } from 'vitest';
import useSessionStore from './sessionStore';

describe('sessionStore start/stop requests', () => {
  beforeEach(() => {
    useSessionStore.setState({
      startSessionVersion: 0,
      stopSessionVersion: 0,
      startGate: { canStart: false, reason: null },
      isInitializing: false,
      initProgress: null,
    });
  });

  it('starts with both request counters at zero', () => {
    const state = useSessionStore.getState();
    expect(state.startSessionVersion).toBe(0);
    expect(state.stopSessionVersion).toBe(0);
  });

  it('bumps only the start counter on requestSessionStart', () => {
    useSessionStore.getState().requestSessionStart();
    expect(useSessionStore.getState().startSessionVersion).toBe(1);
    expect(useSessionStore.getState().stopSessionVersion).toBe(0);
  });

  it('bumps monotonically so repeated requests are distinguishable', () => {
    useSessionStore.getState().requestSessionStart();
    useSessionStore.getState().requestSessionStart();
    expect(useSessionStore.getState().startSessionVersion).toBe(2);
  });

  it('bumps only the stop counter on requestSessionStop', () => {
    useSessionStore.getState().requestSessionStop();
    expect(useSessionStore.getState().stopSessionVersion).toBe(1);
    expect(useSessionStore.getState().startSessionVersion).toBe(0);
  });

  it('stores the mirrored start gate verbatim', () => {
    useSessionStore.getState().setStartGate({
      canStart: false,
      reason: 'missing-device',
      deviceScope: 'speaker',
    });
    expect(useSessionStore.getState().startGate).toEqual({
      canStart: false,
      reason: 'missing-device',
      deviceScope: 'speaker',
    });
  });

  it('stores initialization progress and clears it back to null', () => {
    useSessionStore.getState().setInitProgress({ completed: 3, total: 5 });
    expect(useSessionStore.getState().initProgress).toEqual({ completed: 3, total: 5 });
    useSessionStore.getState().setInitProgress(null);
    expect(useSessionStore.getState().initProgress).toBeNull();
  });

  // endSession is the "session is over" transition. The mirrored gate belongs
  // to MainPanel's live configuration, not to the session, so it must survive
  // — otherwise the subtitle window would show a blocked Start after every
  // normal stop until MainPanel's next mirror effect happens to run.
  it('keeps the mirrored gate across endSession', () => {
    useSessionStore.getState().setStartGate({ canStart: true, reason: null });
    useSessionStore.getState().endSession();
    expect(useSessionStore.getState().startGate).toEqual({ canStart: true, reason: null });
  });
});
