// src/lib/audio/routes.test.ts
import { describe, it, expect } from 'vitest';
import { routesFor, type RoutingSettings } from './routes';

const OFF: RoutingSettings = {
  meeting: false,
  faceToFace: false,
  speak: { other: false, me: false, them: false },
  passthrough: { on: false, ratio: 0.2 },
  sinks: { other: {}, me: {}, them: {} },
};
const ALL = { other: true, me: true, them: true };

describe('routesFor', () => {
  it('routes nothing by itself: replay and preview are the playback\'s to add', () => {
    expect(routesFor(OFF, false)).toEqual([]);
  });

  it('sends my translation into the meeting only when the meeting switch and 对方听到的翻译 are both on', () => {
    expect(routesFor({ ...OFF, meeting: true, speak: { ...OFF.speak, other: true } }, false)).toEqual([{ from: 'speaker', to: 'virtual', gain: 1 }]);
    expect(routesFor({ ...OFF, meeting: true }, false)).toEqual([]);
    expect(routesFor({ ...OFF, speak: { ...OFF.speak, other: true } }, false)).toEqual([]);
  });

  it('sends my translation to me (我也听) only under 对方听到的翻译', () => {
    expect(routesFor({ ...OFF, speak: { other: true, me: true, them: false } }, false)).toContainEqual({ from: 'speaker', to: 'me', gain: 1 });
    expect(routesFor({ ...OFF, speak: { other: false, me: true, them: false } }, false)).toEqual([]);
  });

  it("sends the other's translation to them (我听到的翻译) by its own switch, never into the meeting", () => {
    const edges = routesFor({ ...OFF, meeting: true, speak: { other: false, me: false, them: true } }, false);
    expect(edges).toEqual([{ from: 'participant', to: 'them', gain: 1 }]);
  });

  it('mixes passthrough into the meeting at its ratio, and closes it while push-to-translate is held', () => {
    const s = { ...OFF, speak: { ...OFF.speak, other: true }, passthrough: { on: true, ratio: 0.3 } };
    expect(routesFor(s, false)).toContainEqual({ from: 'passthrough', to: 'virtual', gain: 0.3 });
    expect(routesFor(s, true)).toContainEqual({ from: 'passthrough', to: 'virtual', gain: 0.3 });
    const translate = { ...OFF, speak: { ...OFF.speak, other: true }, passthrough: { on: true, ratio: 1, gate: 'idle' as const } };
    expect(routesFor(translate, false)).toContainEqual({ from: 'passthrough', to: 'virtual', gain: 1 });
    expect(routesFor(translate, true).some((e) => e.from === 'passthrough')).toBe(false);
    expect(routesFor({ ...s, passthrough: { on: true, ratio: 0 } }, false).some((e) => e.from === 'passthrough')).toBe(false);
    expect(routesFor({ ...s, passthrough: { on: false, ratio: 0.3 } }, false).some((e) => e.from === 'passthrough')).toBe(false);
  });

  it('cuts passthrough while 对方听到的翻译 is off, push-to-translate\'s managed one included', () => {
    const plain = { ...OFF, passthrough: { on: true, ratio: 0.3 } };
    expect(routesFor(plain, false).some((e) => e.from === 'passthrough')).toBe(false);
    const idle = { ...OFF, passthrough: { on: true, ratio: 1, gate: 'idle' as const } };
    expect(routesFor(idle, false).some((e) => e.from === 'passthrough')).toBe(false);
    expect(routesFor(idle, true).some((e) => e.from === 'passthrough')).toBe(false);
  });

  it('opens passthrough under push-to-talk only while the key is held, as 0.41.1 did', () => {
    const s = { ...OFF, speak: { ...OFF.speak, other: true }, passthrough: { on: true, ratio: 0.3, gate: 'held' as const } };
    expect(routesFor(s, false).some((e) => e.from === 'passthrough')).toBe(false);
    expect(routesFor(s, true)).toContainEqual({ from: 'passthrough', to: 'virtual', gain: 0.3 });
    expect(routesFor({ ...s, passthrough: { ...s.passthrough, on: false } }, true).some((e) => e.from === 'passthrough')).toBe(false);
  });

  it('caps the ratio at unity', () => {
    expect(routesFor({ ...OFF, speak: { ...OFF.speak, other: true }, passthrough: { on: true, ratio: 3 } }, false)).toContainEqual({ from: 'passthrough', to: 'virtual', gain: 1 });
  });
});

describe('routesFor — face-to-face', () => {
  const F2F: RoutingSettings = { ...OFF, meeting: true, faceToFace: true, speak: ALL, passthrough: { on: true, ratio: 0.3 } };

  it('sends my translation to the other person and theirs to me; nothing into the meeting, to me, or passed through', () => {
    expect(routesFor(F2F, false)).toEqual([
      { from: 'speaker', to: 'other', gain: 1 },
      { from: 'participant', to: 'them', gain: 1 },
    ]);
  });

  it('drops each edge with its switch', () => {
    expect(routesFor({ ...F2F, speak: { ...ALL, other: false } }, false)).toEqual([{ from: 'participant', to: 'them', gain: 1 }]);
    expect(routesFor({ ...F2F, speak: { ...ALL, them: false } }, false)).toEqual([{ from: 'speaker', to: 'other', gain: 1 }]);
  });
});
