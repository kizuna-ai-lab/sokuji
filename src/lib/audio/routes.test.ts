import { describe, it, expect } from 'vitest';
import { routesFor, type RoutingSettings } from './routes';

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
    expect(routesFor(s, true).some((e) => e.from === 'passthrough')).toBe(false);
    expect(routesFor({ ...s, passthrough: { on: true, ratio: 0 } }, false).some((e) => e.from === 'passthrough')).toBe(false);
    expect(routesFor({ ...s, passthrough: { on: false, ratio: 0.3 } }, false).some((e) => e.from === 'passthrough')).toBe(false);
  });

  it('caps the ratio at unity', () => {
    expect(routesFor({ ...OFF, passthrough: { on: true, ratio: 3 } }, false)).toContainEqual({ from: 'passthrough', to: 'virtual', gain: 1 });
  });
});
