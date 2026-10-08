import { describe, it, expect } from 'vitest';
import { earsFor, routesFor, type RoutingSettings } from './routes';

const OFF: RoutingSettings = {
  meeting: false,
  monitor: false,
  participantSpeech: false,
  passthrough: { on: false, ratio: 0.2 },
  sinks: {},
};

describe('routesFor', () => {
  it('always routes replay and preview to the real device, and nothing into the meeting', () => {
    expect(routesFor(OFF, false)).toEqual([
      { from: 'replay', to: 'real', gain: 1 },
      { from: 'preview', to: 'real', gain: 1 },
    ]);
  });

  it("routes the speaker's translation to the meeting and to the monitor, each by its own switch", () => {
    expect(routesFor({ ...OFF, meeting: true }, false)).toContainEqual({ from: 'speaker', to: 'virtual', gain: 1 });
    expect(routesFor({ ...OFF, meeting: true }, false)).not.toContainEqual(expect.objectContaining({ from: 'speaker', to: 'real' }));
    expect(routesFor({ ...OFF, monitor: true }, false)).toContainEqual({ from: 'speaker', to: 'real', gain: 1 });
  });

  it("routes the participant's translation to the real device only with the opt-in, and never into the meeting", () => {
    expect(routesFor(OFF, false).some((e) => e.from === 'participant')).toBe(false);
    const on = routesFor({ ...OFF, participantSpeech: true }, false).filter((e) => e.from === 'participant');
    expect(on).toEqual([{ from: 'participant', to: 'real', gain: 1 }]);
  });

  it('mixes passthrough into the meeting at its ratio, and closes it while push-to-translate is held', () => {
    const s = { ...OFF, passthrough: { on: true, ratio: 0.3 } };
    expect(routesFor(s, false)).toContainEqual({ from: 'passthrough', to: 'virtual', gain: 0.3 });
    expect(routesFor(s, true)).toContainEqual({ from: 'passthrough', to: 'virtual', gain: 0.3 });
    const translate = { ...OFF, passthrough: { on: true, ratio: 1, gate: 'idle' as const } };
    expect(routesFor(translate, false)).toContainEqual({ from: 'passthrough', to: 'virtual', gain: 1 });
    expect(routesFor(translate, true).some((e) => e.from === 'passthrough')).toBe(false);
    expect(routesFor({ ...s, passthrough: { on: true, ratio: 0 } }, false).some((e) => e.from === 'passthrough')).toBe(false);
    expect(routesFor({ ...s, passthrough: { on: false, ratio: 0.3 } }, false).some((e) => e.from === 'passthrough')).toBe(false);
  });

  it('opens passthrough under push-to-talk only while the key is held, as 0.41.1 did', () => {
    const s = { ...OFF, passthrough: { on: true, ratio: 0.3, gate: 'held' as const } };
    expect(routesFor(s, false).some((e) => e.from === 'passthrough')).toBe(false);
    expect(routesFor(s, true)).toContainEqual({ from: 'passthrough', to: 'virtual', gain: 0.3 });
    expect(routesFor({ ...s, passthrough: { ...s.passthrough, on: false } }, true).some((e) => e.from === 'passthrough')).toBe(false);
  });

  it('caps the ratio at unity', () => {
    expect(routesFor({ ...OFF, passthrough: { on: true, ratio: 3 } }, false)).toContainEqual({ from: 'passthrough', to: 'virtual', gain: 1 });
  });
});

describe('routesFor — face-to-face ears', () => {
  const F2F: RoutingSettings = { ...OFF, meeting: true, monitor: true, participantSpeech: true, passthrough: { on: true, ratio: 0.3 }, ears: { swap: false } };

  it('pans my translation to their ear and theirs to mine, and sends nothing into the meeting', () => {
    expect(routesFor(F2F, false)).toEqual([
      { from: 'replay', to: 'real', gain: 1 },
      { from: 'preview', to: 'real', gain: 1 },
      { from: 'speaker', to: 'real', gain: 1, pan: 1 },
      { from: 'participant', to: 'real', gain: 1, pan: -1 },
    ]);
  });

  it('mirrors both ears on a swap (Review Focus 3)', () => {
    const swapped = routesFor({ ...F2F, ears: { swap: true } }, false);
    expect(swapped).toContainEqual({ from: 'speaker', to: 'real', gain: 1, pan: -1 });
    expect(swapped).toContainEqual({ from: 'participant', to: 'real', gain: 1, pan: 1 });
  });

  it("drops the participant's edge when it does not speak (Text Only)", () => {
    expect(routesFor({ ...F2F, participantSpeech: false }, false).some((e) => e.from === 'participant')).toBe(false);
  });
});

describe('earsFor', () => {
  it('puts the participant (my language) left by default', () => {
    expect(earsFor(false)).toEqual({ speaker: 'right', participant: 'left' });
    expect(earsFor(true)).toEqual({ speaker: 'left', participant: 'right' });
  });
});
