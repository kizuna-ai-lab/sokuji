# Audio Settings Rearrangement — Slice 1: Outlets — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the one "real" bus with one outlet per spoken row — `other`, `me`, `them`, each on its own device and channel — under the routing, the stores and the session shape, with today's UI mapped onto the model so the branch stays green.

**Architecture:** `src/lib/audio/outlets.ts` names the outlets and resolves a stored choice (device, channel) into a sink; `routes.ts` routes the live legs and passthrough to outlets; `graph.ts` keeps one `<audio>` element per outlet with the pan on the outlet; `playback.ts` sends replay and preview to the outlet of the row they belong to; `audioStore` stores the three choices; `shape.ts` computes `speak` (who hears what) from the provider flags and the switches; `appAudio.readRouting` maps all of it onto the route settings. `EarsBlock`'s swap writes the two channels; everything else the user sees is unchanged.

**Tech Stack:** TypeScript, Zustand, Web Audio (fake context in tests), Vitest.

**Spec:** `docs/superpowers/specs/2026-10-10-audio-settings-rearrangement-design.md` — §2 (outlets), §3 (storage), §4 (the session shape), §9 slice 1.

## Global Constraints

- No migration code: an unknown or malformed stored value falls to its default (spec §3).
- Storage keys stay: `audio.selectedMonitorDeviceId`, `settings.common.textOnly`, `audio.isMonitorMuted`, `settings.routing.participantSpeech`, `settings.common.keepReplayAudio`, `settings.routing.meeting`. New: `audio.outlet.{other,me,them}.device` and `.channel`. Deleted: `settings.routing.faceToFaceSwap` (never read again).
- `participantSpeech` is `boolean | null`; `null` = on in face-to-face, off elsewhere (ruling 1).
- Channel `'auto'` = right for `other` and left for `them` in face-to-face, `both` elsewhere; `me` is always `both` under auto (ruling 2).
- Replay: my translation on `me` in a meeting, `other` in face-to-face; the other's on `them`. Preview defaults to `me` (spec §2.3).
- A centred outlet has no panner in its path (a `StereoPannerNode` at 0 halves a mono clip's level); a panned outlet has one.
- No visible behaviour change in this slice except that face-to-face's swap now writes channels (spec §9).
- Comments in English; conventional commits; every commit ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Tests and tsc run from the worktree with the main checkout's binaries: `/home/jiangzhuo/Desktop/kizunaai/sokuji/node_modules/.bin/vitest run <path>` and `/home/jiangzhuo/Desktop/kizunaai/sokuji/node_modules/.bin/tsc --noEmit -p tsconfig.json` (a pre-existing `TS6133` in `ModernAudioRecorder.ts:78` is not ours).

## Review Focus

1. A stored outlet device that is unplugged: the outlet must fall to the default device, not go silent, and the stored id must survive for when it returns — Task 1's `resolveOutlet` test "an absent device follows the default and keeps nothing else", Task 5's "keeps a stored device the list lacks".
2. Switching face-to-face on and off with channels on `'auto'`: `other`/`them` must move between right/left and centred without a stale panner left in the path — Task 3's "re-wires an outlet from panned to centred and back", Task 8's "resolves auto channels per face-to-face".
3. A replay of my translation while 我也听 is off must still play on `me`'s device (today's rule) — Task 4's "replays my translation on me whatever the live routes say".
4. `participantSpeech` saved as `true` by the old dev toggle, in a meeting on Electron with a whole-system source: `them` must stay false (the recapture rule) — Task 7's "a whole-system source keeps them off whatever the switch says".
5. The provider's entry loading after Start is pressed (the #613 race): `createAppRouting` must notify when `speak` changes, not only when face-to-face flips — Task 8's "notifies when the provider's speech flags land".

---

### Task 1: `outlets.ts` — names, choices, resolution

**Files:**
- Create: `src/lib/audio/outlets.ts`
- Test: `src/lib/audio/outlets.test.ts`

**Interfaces:**
- Produces (everything later tasks import):
  ```ts
  export type OutletName = 'other' | 'me' | 'them';
  export const OUTLET_NAMES: readonly OutletName[];            // ['other', 'me', 'them']
  export type Channel = 'both' | 'left' | 'right';
  export type ChannelChoice = Channel | 'auto';
  export interface OutletChoice { device: string | null; channel: ChannelChoice }
  export const DEFAULT_OUTLET_CHOICE: OutletChoice;            // { device: null, channel: 'auto' }
  export interface OutletSink { device?: string; pan?: -1 | 1 }
  export interface Speak { other: boolean; me: boolean; them: boolean }
  export function isChannelChoice(value: unknown): value is ChannelChoice;
  export function resolveChannel(name: OutletName, choice: ChannelChoice, faceToFace: boolean): Channel;
  export function panOf(channel: Channel): -1 | 1 | undefined;
  export interface OutletContext { defaultDevice: string | undefined; present: ReadonlySet<string>; faceToFace: boolean }
  export function resolveOutlet(name: OutletName, choice: OutletChoice, context: OutletContext): OutletSink;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/audio/outlets.test.ts
import { describe, it, expect } from 'vitest';
import { DEFAULT_OUTLET_CHOICE, isChannelChoice, OUTLET_NAMES, panOf, resolveChannel, resolveOutlet } from './outlets';

describe('resolveChannel', () => {
  it('auto is centred outside face-to-face, for every outlet', () => {
    for (const name of OUTLET_NAMES) expect(resolveChannel(name, 'auto', false)).toBe('both');
  });

  it('auto in face-to-face: the other person right, me left, 我也听 centred (ruling 2)', () => {
    expect(resolveChannel('other', 'auto', true)).toBe('right');
    expect(resolveChannel('them', 'auto', true)).toBe('left');
    expect(resolveChannel('me', 'auto', true)).toBe('both');
  });

  it('a chosen channel holds in every mode', () => {
    expect(resolveChannel('other', 'left', true)).toBe('left');
    expect(resolveChannel('other', 'left', false)).toBe('left');
    expect(resolveChannel('them', 'both', true)).toBe('both');
  });
});

describe('panOf', () => {
  it('maps left to -1, right to 1 and both to no pan', () => {
    expect(panOf('left')).toBe(-1);
    expect(panOf('right')).toBe(1);
    expect(panOf('both')).toBeUndefined();
  });
});

describe('resolveOutlet', () => {
  const present = new Set(['airpods', 'speakers']);

  it('follows the default device when nothing is chosen', () => {
    expect(resolveOutlet('me', DEFAULT_OUTLET_CHOICE, { defaultDevice: 'airpods', present, faceToFace: false })).toEqual({ device: 'airpods' });
  });

  it('uses the chosen device when it is present', () => {
    expect(resolveOutlet('me', { device: 'speakers', channel: 'auto' }, { defaultDevice: 'airpods', present, faceToFace: false })).toEqual({ device: 'speakers' });
  });

  it('an absent device follows the default and keeps nothing else (Review Focus 1)', () => {
    expect(resolveOutlet('me', { device: 'usb-gone', channel: 'right' }, { defaultDevice: 'airpods', present, faceToFace: false })).toEqual({ device: 'airpods', pan: 1 });
  });

  it('no default device at all: the browser default, with the pan still applied', () => {
    expect(resolveOutlet('them', { device: null, channel: 'auto' }, { defaultDevice: undefined, present, faceToFace: true })).toEqual({ pan: -1 });
  });

  it('carries the resolved channel as a pan', () => {
    expect(resolveOutlet('other', DEFAULT_OUTLET_CHOICE, { defaultDevice: 'airpods', present, faceToFace: true })).toEqual({ device: 'airpods', pan: 1 });
    expect(resolveOutlet('other', { device: null, channel: 'left' }, { defaultDevice: 'airpods', present, faceToFace: false })).toEqual({ device: 'airpods', pan: -1 });
  });
});

describe('isChannelChoice', () => {
  it('accepts the four spellings and nothing else', () => {
    for (const v of ['auto', 'both', 'left', 'right']) expect(isChannelChoice(v)).toBe(true);
    for (const v of ['centre', '', null, undefined, 1, true]) expect(isChannelChoice(v)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `/home/jiangzhuo/Desktop/kizunaai/sokuji/node_modules/.bin/vitest run src/lib/audio/outlets.test.ts`
Expected: FAIL — cannot find module `./outlets`.

- [ ] **Step 3: Write the module**

```ts
// src/lib/audio/outlets.ts
/**
 * The outlets (spec 2026-10-10 §2): where the user hears things, one per
 * spoken row of the Audio page — the other person's ear (`other`,
 * face-to-face only), my own playback of my translation (`me`, "我也听")
 * and the other's translation spoken to me (`them`). Each has a device
 * (null: follow the default playback device) and a channel; `resolveOutlet`
 * turns a stored choice into the sink the graph points at.
 */

export type OutletName = 'other' | 'me' | 'them';
export const OUTLET_NAMES: readonly OutletName[] = ['other', 'me', 'them'];

/** Both channels, or one ear of a stereo device. */
export type Channel = 'both' | 'left' | 'right';
/** A stored choice; `'auto'` resolves per context (ruling 2). */
export type ChannelChoice = Channel | 'auto';

export interface OutletChoice {
  /** A device id, or null: the default playback device. */
  device: string | null;
  channel: ChannelChoice;
}

export const DEFAULT_OUTLET_CHOICE: OutletChoice = { device: null, channel: 'auto' };

/** An outlet resolved: the device to point its element at (undefined: the browser default) and its pan. */
export interface OutletSink {
  device?: string;
  pan?: -1 | 1;
}

/** Who hears what (spec §4): the three switches, gated by mode, source and provider. */
export interface Speak {
  /** My translation is spoken to the other side. */
  other: boolean;
  /** …and also to me. */
  me: boolean;
  /** The other's translation is spoken to me. */
  them: boolean;
}

export function isChannelChoice(value: unknown): value is ChannelChoice {
  return value === 'auto' || value === 'both' || value === 'left' || value === 'right';
}

/** `'auto'`: face-to-face puts the other person in the right ear and me in the left; elsewhere everything is centred. */
export function resolveChannel(name: OutletName, choice: ChannelChoice, faceToFace: boolean): Channel {
  if (choice !== 'auto') return choice;
  if (!faceToFace) return 'both';
  return name === 'other' ? 'right' : name === 'them' ? 'left' : 'both';
}

export function panOf(channel: Channel): -1 | 1 | undefined {
  return channel === 'left' ? -1 : channel === 'right' ? 1 : undefined;
}

export interface OutletContext {
  /** The default playback device's id; undefined when none is known. */
  defaultDevice: string | undefined;
  /** The output devices present right now. */
  present: ReadonlySet<string>;
  faceToFace: boolean;
}

/** A chosen device that is not present follows the default; the stored id is left alone for when it returns. */
export function resolveOutlet(name: OutletName, choice: OutletChoice, context: OutletContext): OutletSink {
  const own = choice.device !== null && context.present.has(choice.device) ? choice.device : undefined;
  const device = own ?? context.defaultDevice;
  const pan = panOf(resolveChannel(name, choice.channel, context.faceToFace));
  return { ...(device !== undefined ? { device } : {}), ...(pan !== undefined ? { pan } : {}) };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `/home/jiangzhuo/Desktop/kizunaai/sokuji/node_modules/.bin/vitest run src/lib/audio/outlets.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/audio/outlets.ts src/lib/audio/outlets.test.ts
git commit -m "feat(audio): outlets — names, stored choices and their resolution

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `routes.ts` — the route table over outlets

**Files:**
- Modify: `src/lib/audio/routes.ts` (whole file)
- Test: `src/lib/audio/routes.test.ts` (whole file)

**Interfaces:**
- Consumes: `OutletName`, `OutletSink`, `Speak` from Task 1.
- Produces:
  ```ts
  export type Feed = 'speaker' | 'participant' | 'replay' | 'preview' | 'passthrough';
  export type Outlet = 'virtual' | OutletName;
  export interface Edge { from: Feed; to: Outlet; gain: number }
  export interface RoutingSettings {
    meeting: boolean;
    faceToFace: boolean;
    speak: Speak;
    passthrough: { on: boolean; ratio: number; gate?: 'idle' | 'held' };
    sinks: { virtual?: string } & Record<OutletName, OutletSink>;
  }
  export function routesFor(s: RoutingSettings, held: boolean): Edge[];
  ```
  `Bus`, `Ear`, `earsFor` and `RoutingSettings.monitor/participantSpeech/ears` are gone. `Edge.pan` is gone (the pan is the outlet's). `routesFor` no longer emits replay or preview edges: `playback` adds them (Task 4).

- [ ] **Step 1: Replace the test file**

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `/home/jiangzhuo/Desktop/kizunaai/sokuji/node_modules/.bin/vitest run src/lib/audio/routes.test.ts`
Expected: FAIL — type errors on `faceToFace`/`speak` (vitest reports them as runtime failures or the old edges appear).

- [ ] **Step 3: Replace `routes.ts`**

```ts
// src/lib/audio/routes.ts
/**
 * The route table (spec 2026-10-10 §2.2). Three things, three natures: a
 * route is a switch; the one mix gain is passthrough's ratio (only the
 * virtual device carries a deliberate mix, translation with the original
 * voice underneath); nothing else has a volume. A route ends in an outlet
 * (`outlets.ts`), whose device and channel are the outlet's, not the
 * edge's. Replay and preview are not routed here: the playback adds their
 * edges per clip (`playback.ts`).
 */
import type { OutletName, OutletSink, Speak } from './outlets';

/** What plays. The test tone and a voice sample are previews. */
export type Feed = 'speaker' | 'participant' | 'replay' | 'preview' | 'passthrough';

/** Where it goes: the meeting's virtual microphone, or one of the user's outlets. */
export type Outlet = 'virtual' | OutletName;

export interface Edge {
  from: Feed;
  to: Outlet;
  gain: number;
}

export interface RoutingSettings {
  /** Speaker translation → the virtual device: the meeting hears it. On by default (a dev switch). */
  meeting: boolean;
  /** Two people at one computer (spec 2026-10-08, slice 3): no meeting, no 我也听, no passthrough. */
  faceToFace: boolean;
  /** The three switches, already gated by mode, source and provider (`shape.ts`'s `speakFor`). */
  speak: Speak;
  /**
   * The microphone → the virtual device, under the translation, at `ratio` (0–1).
   * `gate`, under a manual turn mode, ties the route to the key: `'idle'` opens it
   * while the key is up (push-to-translate), `'held'` only while it is down
   * (push-to-talk, as 0.41.1 did). Absent, the key does not matter.
   */
  passthrough: { on: boolean; ratio: number; gate?: 'idle' | 'held' };
  /** The virtual speaker where one exists (Electron), and each outlet resolved. */
  sinks: { virtual?: string } & Record<OutletName, OutletSink>;
}

/** Every live edge the settings ask for. `held`: a manual turn's key is down, which the passthrough's `gate` reads. */
export function routesFor(s: RoutingSettings, held: boolean): Edge[] {
  const edges: Edge[] = [];
  if (s.faceToFace) {
    // Each translation goes to the ear of the person whose language it is in.
    if (s.speak.other) edges.push({ from: 'speaker', to: 'other', gain: 1 });
    if (s.speak.them) edges.push({ from: 'participant', to: 'them', gain: 1 });
    return edges;
  }
  if (s.meeting && s.speak.other) edges.push({ from: 'speaker', to: 'virtual', gain: 1 });
  // 我也听 is a sub-row of 对方听到的翻译: nothing to hear while that is off.
  if (s.speak.other && s.speak.me) edges.push({ from: 'speaker', to: 'me', gain: 1 });
  if (s.speak.them) edges.push({ from: 'participant', to: 'them', gain: 1 });
  const { gate } = s.passthrough;
  if (s.passthrough.on && s.passthrough.ratio > 0 && (gate === undefined || held === (gate === 'held'))) {
    edges.push({ from: 'passthrough', to: 'virtual', gain: Math.min(1, s.passthrough.ratio) });
  }
  return edges;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `/home/jiangzhuo/Desktop/kizunaai/sokuji/node_modules/.bin/vitest run src/lib/audio/routes.test.ts`
Expected: PASS (9 tests). `tsc` now fails in `graph.ts`, `playback.ts`, `appAudio.ts`, `useFaceToFace.ts`, `EarsBlock.tsx` — Tasks 3, 4, 8 and 9 fix them; do not run the whole suite yet.

- [ ] **Step 5: Commit**

```bash
git add src/lib/audio/routes.ts src/lib/audio/routes.test.ts
git commit -m "feat(audio): the route table ends in outlets; replay and preview leave it

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `graph.ts` — one element per outlet, the pan on the outlet

**Files:**
- Modify: `src/lib/audio/graph.ts`
- Test: `src/lib/audio/graph.test.ts`

**Interfaces:**
- Consumes: `Outlet`, `Edge`, `Feed` (Task 2); `OUTLET_NAMES`, `OutletName`, `OutletSink` (Task 1).
- Produces (changed members of `AudioGraph`):
  ```ts
  playOnce(audio: Float32Array, sampleRate: number): OneShot;              // no pan
  route(edges: readonly Edge[]): void;                                       // edges carry no pan
  setSinks(sinks: { virtual?: string } & Record<OutletName, OutletSink>): Promise<void>;
  meter(bus: Outlet): BusMeter | null;
  ```
  Elements are created in this order: `other`, `me`, `them`, then `virtual` (Electron only). Tests rely on it.

- [ ] **Step 1: Update the tests**

In `src/lib/audio/graph.test.ts`:

(a) The setup. Replace the two lines `// The real element is created first, then the virtual one (Electron).` and `const [real, virtualSink] = sinks;` with:

```ts
  // One element per outlet, in OUTLET_NAMES order, then the virtual one (Electron).
  const [other, me, them, virtualSink] = sinks;
  /** Sinks for one outlet device, the others following the browser default. */
  const on = (device: string | undefined, virtual?: string) => ({ virtual, other: {}, me: { device }, them: {} });
```
and return `other, me, them, on` instead of `real` from `setup` (`return { ctx, graph, sinks, other, me, them, virtualSink, on, taps, sent, destinationOf, clip };`). Then, through the file, every `real` in a destructure becomes `me`, every `graph.setSinks({ real: X })` becomes `graph.setSinks(on(X))`, and every `graph.setSinks({ real: X, virtual: Y })` becomes `graph.setSinks(on(X, Y))`; `{ from: 'speaker', to: 'real', gain: 1 }` becomes `{ from: 'speaker', to: 'me', gain: 1 }` (and the same for other feeds). `setupRecovering` (the #246 block) gets the same destructure and the same `on` helper.

(b) Replace the test `'pans an edge through a stereo panner, and replaces it when the pan changes (Review Focus 3)'` with:

```ts
  it('puts a panner in an outlet\'s path only while it has a channel, and re-wires it from panned to centred and back (Review Focus 2)', async () => {
    const { ctx, graph, other, destinationOf, clip } = await setup();
    graph.route([{ from: 'speaker', to: 'other', gain: 1 }]);
    const source = clip('speaker');
    // Centred: no panner between the bus and its stream.
    expect(ctx.panners.map((p) => p.pan.value)).toEqual([0, 0, 0]);
    expect(ctx.panners.every((p) => p.outputs.size === 0)).toBe(true);
    expect(reaches(source, destinationOf(other))).toBe(true);
    await graph.setSinks({ other: { pan: 1 }, me: {}, them: {} });
    expect(ctx.panners[0].pan.value).toBe(1);
    expect(reaches(source, ctx.panners[0])).toBe(true);
    expect(reaches(ctx.panners[0], destinationOf(other))).toBe(true);
    await graph.setSinks({ other: {}, me: {}, them: {} });
    expect(ctx.panners[0].outputs.size).toBe(0);
    expect(reaches(source, destinationOf(other))).toBe(true);
    expect(reaches(source, ctx.panners[0])).toBe(false);
  });

  it('pans each outlet on its own, and keeps a pan across an unchanged setSinks', async () => {
    const { ctx, graph } = await setup();
    await graph.setSinks({ other: { pan: 1 }, me: {}, them: { pan: -1 } });
    expect(ctx.panners.map((p) => p.pan.value)).toEqual([1, 0, -1]);
    expect(ctx.panners[1].outputs.size).toBe(0);
    await graph.setSinks({ other: { pan: 1 }, me: {}, them: { pan: -1 } });
    expect(ctx.panners[0].outputs.size).toBe(1);
    expect(ctx.panners[2].outputs.size).toBe(1);
  });
```

(c) Replace the test `'plays a one-shot through a panner when asked for one ear, and drops it at the end'` with:

```ts
  it('plays a one-shot on the preview feed with no panner of its own: the outlet pans it', async () => {
    const { ctx, graph } = await setup();
    const before = ctx.panners.length;
    const shot = graph.playOnce(new Float32Array(240), 24_000);
    expect(ctx.panners).toHaveLength(before);
    shot.stop();
    await shot.ended;
  });
```

(d) Add to `'createAudioGraph — outputs'`:

```ts
  it('plays every outlet element from the start, each on its own device', async () => {
    const { graph, other, me, them } = await setup();
    expect([other.paused, me.paused, them.paused]).toEqual([false, false, false]);
    await graph.setSinks({ other: { device: 'usb' }, me: { device: 'airpods' }, them: { device: 'airpods' } });
    expect([other.sinkId, me.sinkId, them.sinkId]).toEqual(['usb', 'airpods', 'airpods']);
  });
```

(e) In `'keeps both outputs on their devices and playing across a rebuild'` add, after the `virtualSink.sinkId` assertion, a pan that must survive: set `await graph.setSinks({ ...on('monitor-1', 'cable-1'), them: { pan: -1 } })` at the top instead of `on('monitor-1', 'cable-1')`, and assert at the end `expect(contexts[1].panners.map((p) => p.pan.value)).toEqual([0, 0, -1]); expect(contexts[1].panners[2].outputs.size).toBe(1);`.

(f) `'is null where the platform lacks the bus'` (meters): keep; `graph.meter('virtual')` on `none` stays null, and add `expect(graph.meter('me')).not.toBeNull();`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `/home/jiangzhuo/Desktop/kizunaai/sokuji/node_modules/.bin/vitest run src/lib/audio/graph.test.ts`
Expected: FAIL (type errors / wrong element count).

- [ ] **Step 3: Change `graph.ts`**

Imports: replace `import type { Bus, Edge, Feed } from './routes';` with
```ts
import { OUTLET_NAMES, type OutletName, type OutletSink } from './outlets';
import type { Edge, Feed, Outlet } from './routes';
```

`AudioGraph` (the interface): `playOnce(audio: Float32Array, sampleRate: number): OneShot;` (doc: "Plays a clip at its own rate on the preview feed; the outlet it is routed to pans it."), `setSinks(sinks: { virtual?: string } & Record<OutletName, OutletSink>): Promise<void>;` (doc: "Points each element at its device and gives each outlet its pan; the virtual one stays silent until it has a device. …"), `meter(bus: Outlet): BusMeter | null;`.

`Built`: `buses: Partial<Record<Outlet, GainNode>>; outs: Partial<Record<Outlet, MediaStreamAudioDestinationNode>>; analysers: Partial<Record<Outlet, AnalyserNode>>;` plus two new fields:
```ts
  /** One per outlet, in the path only while the outlet has a channel. */
  panners: Record<OutletName, StereoPannerNode>;
  /** What each outlet's path is wired for right now. */
  wired: Partial<Record<OutletName, -1 | 1>>;
```

In `createAudioGraph`, next to `elements`/`metered`:
```ts
  const elements: Partial<Record<Outlet, SinkElement>> = {};
  const metered = new Set<Outlet>();
  /** Each outlet's pan as last asked for; a rebuild wires it again. */
  const pans: Partial<Record<OutletName, -1 | 1>> = {};
  /**
   * Wires an outlet's path for a pan: bus → panner → stream while it has one,
   * bus → stream otherwise. A centred clip never crosses a panner: at 0 a
   * StereoPannerNode plays a mono clip at -3 dB in each ear.
   */
  const wirePan = (built: Built, name: OutletName, pan: -1 | 1 | undefined): void => {
    const node = built.buses[name]!;
    const out = built.outs[name]!;
    const panner = built.panners[name];
    if (built.wired[name] === pan) return;
    if (built.wired[name] === undefined) node.disconnect(out);
    else { node.disconnect(panner); panner.disconnect(out); }
    if (pan === undefined) {
      node.connect(out);
    } else {
      panner.pan.value = pan;
      node.connect(panner);
      panner.connect(out);
    }
    built.wired[name] = pan;
  };
```
`wireAnalyser`'s parameter type becomes `bus: Outlet`.

In `build(ctx)`, replace the block from `const buses: Partial<Record<Bus, GainNode>> = {};` through `if (virtual.kind === 'tabs') { … }` with:
```ts
    const buses: Partial<Record<Outlet, GainNode>> = {};
    const outs: Partial<Record<Outlet, MediaStreamAudioDestinationNode>> = {};
    const panners = {} as Record<OutletName, StereoPannerNode>;
    const toElement = (bus: Outlet) => {
      const node = gain();
      const out = ctx.createMediaStreamDestination();
      node.connect(out);
      buses[bus] = node;
      outs[bus] = out;
      // Only the first build makes the elements. A rebuild leaves them alone
      // until its swap, so a build that throws leaves them where they were.
      elements[bus] ??= deps.createSink(out.stream);
    };
    for (const name of OUTLET_NAMES) {
      toElement(name);
      panners[name] = ctx.createStereoPanner();
    }
    if (virtual.kind === 'device') toElement('virtual');
    if (virtual.kind === 'tabs') {
      const node = gain();
      buses.virtual = node;
      tapInto(node, (chunk) => virtual.send(chunk));
    }

    const built: Built = { ctx, muted, feeds, buses, outs, taps, analysers: {}, panners, wired: {} };
    for (const name of OUTLET_NAMES) wirePan(built, name, pans[name]);
    for (const bus of metered) wireAnalyser(built, bus);
    return built;
```
(and delete the old `const built: Built = …` / `for (const bus of metered)` lines that followed).

`requested`, `applied`, `playFailing`, `switching` become `Partial<Record<Outlet, …>>`; `play`'s parameter is `bus: Outlet`; `switchBus(bus: Outlet, …)`. Replace the lone `play('real');` after `play`'s definition with `for (const name of OUTLET_NAMES) play(name);`.

`applyRoute`: the edge key is `${edge.from}>${edge.to}`; remove the panner branch — the body of the "new edge" loop becomes:
```ts
      const node = gainOn(ctx, edge.gain);
      feeds[edge.from].connect(node);
      node.connect(buses[edge.to]!);
      edges.set(id, { from: edge.from, node });
```
and `edges`' value type is `{ from: Feed; node: GainNode }`; the old-edge loop drops `edge.panner?.disconnect();`.

In `rebuild`, replace `for (const bus of ['real', 'virtual'] as const) { … }` with
```ts
      for (const bus of Object.keys(elements) as Outlet[]) {
        const element = elements[bus];
        const out = next.outs[bus];
        if (element && out) element.srcObject = out.stream;
      }
```
and each `play('real'); play('virtual');` pair (in `rebuild` and in `resume`) with `for (const bus of Object.keys(elements) as Outlet[]) play(bus);`.

`playOnce(audio, sampleRate)`: delete the `pan` parameter and the panner branch; `into` is always `feeds.preview`, and the ended callback just resolves:
```ts
      const stop = start(ctx, buffer, feeds.preview, ctx.currentTime, resolve);
```

`meter(bus: Outlet)`; `meters` is `Map<Outlet, BusMeter>`; `readMeter(bus: Outlet)`.

`setSinks`:
```ts
    async setSinks(sinks) {
      const switches: Promise<void>[] = [];
      for (const bus of ['virtual', ...OUTLET_NAMES] as const) {
        const element = elements[bus];
        if (!element) continue;
        if (bus !== 'virtual') {
          const pan = sinks[bus].pan;
          if (pans[bus] !== pan) {
            pans[bus] = pan;
            wirePan(current, bus, pan);
          }
        }
        const id = bus === 'virtual' ? sinks.virtual : sinks[bus].device;
        if (id === requested[bus]) continue;
        requested[bus] = id;
        if (bus === 'virtual') {
          // Never play the meeting's audio on whatever device the element is
          // on while a switch is pending or absent (F1).
          applied.virtual = undefined;
          element.pause();
          if (!id) continue;
          if (!element.setSinkId) {
            reportWarning('AudioGraph', 'Could not switch the virtual output: it cannot choose its device', { dedupeKey: 'graph:sink:virtual' });
            requested.virtual = undefined;
            continue;
          }
        }
        switches.push(switchBus(bus, element, id));
      }
      await Promise.all(switches);
    },
```
In `switchBus`'s failure branch the comment "The real element keeps playing" becomes "An outlet's element keeps playing"; the code is unchanged (`play(bus)`).

The file's header comment: "five feeds, one bus per outlet and one for the meeting, the route table applied as a diff of gain edges, each outlet's pan on its own path, …".

- [ ] **Step 4: Run the tests**

Run: `/home/jiangzhuo/Desktop/kizunaai/sokuji/node_modules/.bin/vitest run src/lib/audio/graph.test.ts`
Expected: PASS. If `'the virtual element does not start while its device switch is pending, even when resumed'` or the one-at-a-time tests fail only on the sink helper, fix the test's `on(...)` call, not the graph.

- [ ] **Step 5: Commit**

```bash
git add src/lib/audio/graph.ts src/lib/audio/graph.test.ts
git commit -m "feat(audio): one output element per outlet, the pan on the outlet's path

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: `playback.ts` — replay and preview by outlet

**Files:**
- Modify: `src/lib/audio/playback.ts`
- Test: `src/lib/audio/playback.test.ts`

**Interfaces:**
- Consumes: Task 2's `RoutingSettings`/`Edge`/`Outlet`; Task 3's `graph.playOnce(audio, sampleRate)`.
- Produces (changed members of `Playback`):
  ```ts
  replay(leg: LegName, segment: Segment): void;          // outlet: participant → 'them'; speaker → faceToFace ? 'other' : 'me'
  preview(clip: PreviewClip, outlet?: OutletName): Promise<void>;   // default 'me'
  meter(bus: Outlet): BusMeter | null;
  ```
  `PreviewClip` loses `pan`.

- [ ] **Step 1: Update the tests**

In `src/lib/audio/playback.test.ts`:

(a) `fakeGraph`: `const sinks: Array<Parameters<AudioGraph['setSinks']>[0]> = [];`, `const shots: Array<{ audio: Float32Array; sampleRate: number; stopped: boolean; end: () => void }> = [];`, and `playOnce(audio, sampleRate)` without `pan` (`const shot = { audio, sampleRate, stopped: false, end };`). Add `routes` to `build`'s return (`return { playback, graph, clock, plays, routes, advance, resumed, passthroughPlayed };` after destructuring `routes` from `fakeGraph()`).

(b) `ROUTING`:
```ts
const ROUTING: RoutingSettings = {
  meeting: true,
  faceToFace: false,
  speak: { other: true, me: false, them: false },
  passthrough: { on: true, ratio: 0.2 },
  sinks: { other: {}, me: { device: 'monitor-1' }, them: {} },
};
```
(c) Delete the test `"hands a clip's pan to the graph"`. In `'applies the route table and the sinks at once, and again whenever the routing changes'`, the expected routes are now `[...routesFor(settings, false), { from: 'replay', to: 'me', gain: 1 }, { from: 'preview', to: 'me', gain: 1 }]` — write it as:
```ts
  it('applies the route table plus the replay and preview edges, and again whenever the routing changes', () => {
    const { graph, routes, sinks } = fakeGraph();
    const r = routing();
    createPlayback(graph, r.source);
    const withFixed = (settings: RoutingSettings) => [...routesFor(settings, false), { from: 'replay', to: 'me', gain: 1 }, { from: 'preview', to: 'me', gain: 1 }];
    expect(routes).toEqual([withFixed(ROUTING)]);
    expect(sinks).toEqual([ROUTING.sinks]);
    r.set({ speak: { other: true, me: true, them: false } });
    expect(routes[1]).toEqual(withFixed({ ...ROUTING, speak: { other: true, me: true, them: false } }));
    expect(sinks[1]).toEqual(ROUTING.sinks);
  });
```
(adapt to the existing test's shape if it already uses `routes`/`sinks` this way — keep its other assertions).

(d) Add to `'createPlayback — replay'`:
```ts
  it("routes a replay to the outlet of the row it belongs to: mine to me, the other's to them", () => {
    const { graph, routes } = fakeGraph();
    const playback = createPlayback(graph, routing().source);
    playback.replay('speaker', translation(4, [{ pcm: pcm(100) }]));
    expect(routes.at(-1)).toContainEqual({ from: 'replay', to: 'me', gain: 1 });
    playback.replay('participant', translation(5, [{ pcm: pcm(100) }]));
    expect(routes.at(-1)).toContainEqual({ from: 'replay', to: 'them', gain: 1 });
    expect(routes.at(-1)!.filter((e) => e.from === 'replay')).toHaveLength(1);
  });

  it('replays my translation on the other person\'s outlet in face-to-face', () => {
    const { graph, routes } = fakeGraph();
    const playback = createPlayback(graph, routing({ ...ROUTING, faceToFace: true }).source);
    playback.replay('speaker', translation(4, [{ pcm: pcm(100) }]));
    expect(routes.at(-1)).toContainEqual({ from: 'replay', to: 'other', gain: 1 });
  });

  it('replays my translation on me whatever the live routes say (我也听 off) (Review Focus 3)', () => {
    const { graph, routes } = fakeGraph();
    const playback = createPlayback(graph, routing({ ...ROUTING, speak: { other: false, me: false, them: false } }).source);
    playback.replay('speaker', translation(4, [{ pcm: pcm(100) }]));
    expect(routes.at(-1)).toEqual([{ from: 'replay', to: 'me', gain: 1 }, { from: 'preview', to: 'me', gain: 1 }]);
  });
```
(e) Add to `'createPlayback — preview'`:
```ts
  it('plays a preview on the outlet asked for, me by default', async () => {
    const { graph, routes, shots } = fakeGraph();
    const playback = createPlayback(graph, routing().source);
    const first = playback.preview({ audio: new Float32Array(10), sampleRate: 44100 }, 'them');
    expect(routes.at(-1)).toContainEqual({ from: 'preview', to: 'them', gain: 1 });
    shots[0].end();
    await first;
    const second = playback.preview({ audio: new Float32Array(10), sampleRate: 44100 });
    expect(routes.at(-1)).toContainEqual({ from: 'preview', to: 'me', gain: 1 });
    shots[1].end();
    await second;
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `/home/jiangzhuo/Desktop/kizunaai/sokuji/node_modules/.bin/vitest run src/lib/audio/playback.test.ts`
Expected: FAIL.

- [ ] **Step 3: Change `playback.ts`**

Imports: `import { routesFor, type Edge, type Outlet, type RoutingSettings } from './routes';` and `import type { OutletName } from './outlets';`. `PreviewClip`: delete `pan`. `Playback`:
```ts
  /** Plays a segment's kept speech on the outlet of its row — mine on me (the other person's in face-to-face), the other's on them — replacing any replay in progress. */
  replay(leg: LegName, segment: Segment): void;
  stopReplay(): void;
  /** Plays a clip on an outlet (me unless told otherwise), stopping the previous one; resolves when it ends or is stopped. */
  preview(clip: PreviewClip, outlet?: OutletName): Promise<void>;
  …
  /** What an outlet carries, for a waveform: the virtual one is what the meeting hears. */
  meter(bus: Outlet): BusMeter | null;
```
In `createPlayback`, beside `let held = false;`:
```ts
  /** Where the replay and preview feeds go: the outlet of the row the clip belongs to. */
  let replayOutlet: OutletName = 'me';
  let previewOutlet: OutletName = 'me';
```
`apply`:
```ts
  const apply = () => {
    const settings = routing.get();
    const edges: Edge[] = [
      ...routesFor(settings, held),
      { from: 'replay', to: replayOutlet, gain: 1 },
      { from: 'preview', to: previewOutlet, gain: 1 },
    ];
    const open = edges.some((e) => e.from === 'passthrough');
    if (passthroughOpen && !open) passthroughStream.clear();
    passthroughOpen = open;
    graph.route(edges);
    void graph.setSinks(settings.sinks);
  };
```
`replay`:
```ts
    replay(leg, segment) {
      replayQueue.clear();
      const outlet: OutletName = leg === 'participant' ? 'them' : routing.get().faceToFace ? 'other' : 'me';
      if (outlet !== replayOutlet) {
        replayOutlet = outlet;
        apply();
      }
      void graph.resume();
      …(unchanged)
    },
```
`preview(clip, outlet = 'me')`: after `stopPreview();` and the empty check, before `void graph.resume();`:
```ts
      if (outlet !== previewOutlet) {
        previewOutlet = outlet;
        apply();
      }
```
and `graph.playOnce(clip.audio, clip.sampleRate)`.

- [ ] **Step 4: Run the tests**

Run: `/home/jiangzhuo/Desktop/kizunaai/sokuji/node_modules/.bin/vitest run src/lib/audio/playback.test.ts src/lib/audio/graph.test.ts src/lib/audio/routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/audio/playback.ts src/lib/audio/playback.test.ts
git commit -m "feat(audio): replay and preview play on the outlet of their row

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `audioStore` — the three outlet choices

**Files:**
- Modify: `src/stores/audioStore.ts`
- Test: `src/stores/audioStore.test.ts`

**Interfaces:**
- Consumes: `OutletName`, `OutletChoice`, `DEFAULT_OUTLET_CHOICE`, `isChannelChoice`, `OUTLET_NAMES` (Task 1).
- Produces:
  ```ts
  outlets: Record<OutletName, OutletChoice>;
  setOutletDevice(name: OutletName, device: string | null): void;
  setOutletChannel(name: OutletName, channel: ChannelChoice): void;
  export const useOutlets = () => useAudioStore((s) => s.outlets);
  export const useSetOutletDevice = () => useAudioStore((s) => s.setOutletDevice);
  export const useSetOutletChannel = () => useAudioStore((s) => s.setOutletChannel);
  ```
  Keys: `audio.outlet.<name>.device` (string or null), `audio.outlet.<name>.channel` (`'auto' | 'both' | 'left' | 'right'`).

- [ ] **Step 1: Write the failing tests**

Append to `src/stores/audioStore.test.ts`, after the `'the other side (face-to-face)'` block (same mocked settings service):

```ts
describe('the outlets (spec 2026-10-10 §3)', () => {
  const fresh = () => useAudioStore.setState({ outlets: { other: { device: null, channel: 'auto' }, me: { device: null, channel: 'auto' }, them: { device: null, channel: 'auto' } } });

  it('follows the default device on auto channels until something is chosen', () => {
    fresh();
    expect(useAudioStore.getState().outlets).toEqual({
      other: { device: null, channel: 'auto' }, me: { device: null, channel: 'auto' }, them: { device: null, channel: 'auto' },
    });
  });

  it('persists a device and a channel per outlet, and restores them', async () => {
    fresh();
    useAudioStore.getState().setOutletDevice('them', 'usb-1');
    useAudioStore.getState().setOutletChannel('them', 'left');
    const service = ServiceFactory.getSettingsService();
    expect(await service.getSetting<string | null>('audio.outlet.them.device', null)).toBe('usb-1');
    expect(await service.getSetting<string>('audio.outlet.them.channel', '')).toBe('left');
    fresh();
    await useAudioStore.getState().refreshDevices();
    expect(useAudioStore.getState().outlets.them).toEqual({ device: 'usb-1', channel: 'left' });
    expect(useAudioStore.getState().outlets.me).toEqual({ device: null, channel: 'auto' });
  });

  it('keeps a stored device the list lacks: the choice is kept, following the default until it returns (Review Focus 1)', async () => {
    fresh();
    await ServiceFactory.getSettingsService().setSetting('audio.outlet.me.device', 'usb-gone');
    await useAudioStore.getState().refreshDevices();
    expect(useAudioStore.getState().outlets.me.device).toBe('usb-gone');
  });

  it('reads an unknown channel as auto and a non-string device as none', async () => {
    fresh();
    const service = ServiceFactory.getSettingsService();
    await service.setSetting('audio.outlet.other.channel', 'centre');
    await service.setSetting('audio.outlet.other.device', 42);
    await useAudioStore.getState().refreshDevices();
    expect(useAudioStore.getState().outlets.other).toEqual({ device: null, channel: 'auto' });
  });

  it('back to following the default: a null device is stored as null', async () => {
    fresh();
    useAudioStore.getState().setOutletDevice('me', 'usb-1');
    useAudioStore.getState().setOutletDevice('me', null);
    expect(useAudioStore.getState().outlets.me.device).toBeNull();
    expect(await ServiceFactory.getSettingsService().getSetting<string | null>('audio.outlet.me.device', 'unset')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `/home/jiangzhuo/Desktop/kizunaai/sokuji/node_modules/.bin/vitest run src/stores/audioStore.test.ts -t outlets`
Expected: FAIL — `setOutletDevice is not a function`.

- [ ] **Step 3: Add the state**

In `src/stores/audioStore.ts`:

Imports: `import { DEFAULT_OUTLET_CHOICE, isChannelChoice, OUTLET_NAMES, type ChannelChoice, type OutletChoice, type OutletName } from '../lib/audio/outlets';`.

Below `STORAGE_KEYS`:
```ts
/** Per outlet (spec 2026-10-10 §3): `audio.outlet.<name>.device` and `.channel`. */
const outletKey = (name: OutletName, field: 'device' | 'channel') => `audio.outlet.${name}.${field}`;
const defaultOutlets = (): Record<OutletName, OutletChoice> => ({ other: { ...DEFAULT_OUTLET_CHOICE }, me: { ...DEFAULT_OUTLET_CHOICE }, them: { ...DEFAULT_OUTLET_CHOICE } });
```
In the `AudioStore` interface (find where `otherSide: OtherSide;` and `setOtherSide` are declared and add beside them):
```ts
  /** Each spoken row's output: a device (null: the default playback device) and a channel. */
  outlets: Record<OutletName, OutletChoice>;
  setOutletDevice: (name: OutletName, device: string | null) => void;
  setOutletChannel: (name: OutletName, channel: ChannelChoice) => void;
```
Initial state, after `bothPopoverSeen: false,`: `outlets: defaultOutlets(),`.

Setters, after `setBothPopoverSeen`:
```ts
    setOutletDevice: (name, device) => {
      set((state) => ({ outlets: { ...state.outlets, [name]: { ...state.outlets[name], device } } }));
      void persistSetting(outletKey(name, 'device'), device);
    },
    setOutletChannel: (name, channel) => {
      set((state) => ({ outlets: { ...state.outlets, [name]: { ...state.outlets[name], channel } } }));
      void persistSetting(outletKey(name, 'channel'), channel);
    },
```
Restore, right after the `bothPopoverSeen` restore (`set({ bothPopoverSeen: savedBothPopoverSeen === true });`):
```ts
        const outlets = defaultOutlets();
        for (const name of OUTLET_NAMES) {
          const device = await settingsService.getSetting<unknown>(outletKey(name, 'device'), null);
          const channel = await settingsService.getSetting<unknown>(outletKey(name, 'channel'), 'auto');
          // A device that is not plugged in stays stored: `resolveOutlet` follows the default until it returns.
          outlets[name] = { device: typeof device === 'string' && device !== '' ? device : null, channel: isChannelChoice(channel) ? channel : 'auto' };
        }
        set({ outlets });
```
Hooks, beside `useOtherSide`/`useSetOtherSide` (at the bottom of the file):
```ts
export const useOutlets = () => useAudioStore((state) => state.outlets);
export const useSetOutletDevice = () => useAudioStore((state) => state.setOutletDevice);
export const useSetOutletChannel = () => useAudioStore((state) => state.setOutletChannel);
```

- [ ] **Step 4: Run the tests**

Run: `/home/jiangzhuo/Desktop/kizunaai/sokuji/node_modules/.bin/vitest run src/stores/audioStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/stores/audioStore.ts src/stores/audioStore.test.ts
git commit -m "feat(audio): the audio store keeps each outlet's device and channel

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: `routingStore` — `participantSpeech` as `boolean | null`; the swap goes

**Files:**
- Modify: `src/stores/routingStore.ts`
- Test: `src/stores/routingStore.test.ts`

**Interfaces:**
- Produces: `participantSpeech: boolean | null` (default `null`), `setParticipantSpeech(on: boolean | null)`, `load()` reads `settings.routing.participantSpeech` always (a boolean, else null). `faceToFaceSwap`, `setFaceToFaceSwap` and the key constant are deleted. `PARTICIPANT_SPEECH_SHOWN` stays exported (still `false`) only for `SystemAudioSection`'s hidden switch until slice 2 deletes both; `load()` no longer consults it.

- [ ] **Step 1: Replace the test file**

```ts
// src/stores/routingStore.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { stored, setSetting } = vi.hoisted(() => {
  const stored = new Map<string, unknown>();
  return { stored, setSetting: vi.fn(async (key: string, value: unknown) => { stored.set(key, value); return { success: true }; }) };
});
vi.mock('../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (key: string, def: unknown) => (stored.has(key) ? stored.get(key) : def),
      setSetting,
    }),
  },
}));

import { useRoutingStore } from './routingStore';

beforeEach(() => {
  stored.clear();
  setSetting.mockClear();
  useRoutingStore.setState({ meeting: true, participantSpeech: null });
});

describe('routingStore', () => {
  it('lets the meeting hear the translation, and leaves 我听到的翻译 on auto, until something was saved', async () => {
    await useRoutingStore.getState().load();
    expect(useRoutingStore.getState()).toMatchObject({ meeting: true, participantSpeech: null });
    stored.set('settings.routing.meeting', false);
    stored.set('settings.routing.participantSpeech', true);
    await useRoutingStore.getState().load();
    expect(useRoutingStore.getState()).toMatchObject({ meeting: false, participantSpeech: true });
  });

  it('ignores a saved value that is not a boolean', async () => {
    stored.set('settings.routing.meeting', 'yes');
    stored.set('settings.routing.participantSpeech', 'yes');
    await useRoutingStore.getState().load();
    expect(useRoutingStore.getState()).toMatchObject({ meeting: true, participantSpeech: null });
  });

  it('saves each switch, auto included', async () => {
    useRoutingStore.getState().setMeeting(false);
    useRoutingStore.getState().setParticipantSpeech(false);
    expect(useRoutingStore.getState()).toMatchObject({ meeting: false, participantSpeech: false });
    useRoutingStore.getState().setParticipantSpeech(null);
    expect(useRoutingStore.getState().participantSpeech).toBeNull();
    await vi.waitFor(() => {
      expect(setSetting).toHaveBeenCalledWith('settings.routing.meeting', false);
      expect(setSetting).toHaveBeenCalledWith('settings.routing.participantSpeech', false);
      expect(setSetting).toHaveBeenCalledWith('settings.routing.participantSpeech', null);
    });
  });

  it('knows nothing of a face-to-face swap any more', async () => {
    stored.set('settings.routing.faceToFaceSwap', true);
    await useRoutingStore.getState().load();
    expect('faceToFaceSwap' in useRoutingStore.getState()).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `/home/jiangzhuo/Desktop/kizunaai/sokuji/node_modules/.bin/vitest run src/stores/routingStore.test.ts`
Expected: FAIL (`participantSpeech` loads as `false`; `faceToFaceSwap` present).

- [ ] **Step 3: Change the store**

Replace `src/stores/routingStore.ts` from the imports down with:

```ts
/**
 * The two routing switches (spec 2026-10-10 §3): whether the meeting hears
 * the speaker's translation (on by default; a dev switch), and 我听到的翻译 —
 * the other's translation spoken to me. The latter is `null` until the user
 * touches it: on in face-to-face, off in a meeting (`shape.ts`'s
 * `participantSpeechInput`, ruling 1). The monitor (我也听) and passthrough
 * stay in `audioStore`; each outlet's device and channel too.
 */
import { create } from 'zustand';
import { persistSetting } from '../services/persistSetting';
import { ServiceFactory } from '../services/ServiceFactory';

const MEETING = 'settings.routing.meeting';
const PARTICIPANT_SPEECH = 'settings.routing.participantSpeech';

/**
 * Whether the old participant-speech switch (`ParticipantSpeechSwitch`)
 * renders. Hidden since 2026-10-01; slice 2 of the 2026-10-10 spec replaces
 * it with the 我听到的翻译 row and deletes this with it. The store reads the
 * saved value regardless.
 */
export const PARTICIPANT_SPEECH_SHOWN = false;

interface RoutingStore {
  meeting: boolean;
  /** 我听到的翻译: true/false as chosen; null = auto (on in face-to-face, off elsewhere). */
  participantSpeech: boolean | null;
  load(): Promise<void>;
  setMeeting(on: boolean): void;
  setParticipantSpeech(on: boolean | null): void;
}

export const useRoutingStore = create<RoutingStore>()((set) => ({
  meeting: true,
  participantSpeech: null,
  async load() {
    const settings = ServiceFactory.getSettingsService();
    const [meeting, participantSpeech] = await Promise.all([
      settings.getSetting(MEETING, true),
      settings.getSetting<unknown>(PARTICIPANT_SPEECH, null),
    ]);
    set({
      meeting: typeof meeting === 'boolean' ? meeting : true,
      participantSpeech: typeof participantSpeech === 'boolean' ? participantSpeech : null,
    });
  },
  setMeeting(on) {
    set({ meeting: on });
    void persistSetting(MEETING, on);
  },
  setParticipantSpeech(on) {
    set({ participantSpeech: on });
    void persistSetting(PARTICIPANT_SPEECH, on);
  },
}));
```

- [ ] **Step 4: Run the tests**

Run: `/home/jiangzhuo/Desktop/kizunaai/sokuji/node_modules/.bin/vitest run src/stores/routingStore.test.ts`
Expected: PASS. (`appAudio.ts`, `useFaceToFace.ts`, `EarsBlock.tsx`, `SessionControls.tsx` and their tests still reference `faceToFaceSwap` / a boolean switch: Tasks 7–9.)

- [ ] **Step 5: Commit**

```bash
git add src/stores/routingStore.ts src/stores/routingStore.test.ts
git commit -m "feat(routing): 我听到的翻译 is tri-state (auto/on/off); the face-to-face swap goes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: `shape.ts` + `appShape.ts` — `speakFor` and `speechFromStores`

**Files:**
- Modify: `src/lib/session/shape.ts`, `src/lib/session/appShape.ts`, `src/components/TitleBar/useBalanceShortfall.ts`
- Test: `src/lib/session/shape.test.ts`, `src/lib/session/appShape.test.ts`

**Interfaces:**
- Consumes: `Speak` (Task 1); `participantSpeech: boolean | null` (Task 6).
- Produces (`shape.ts`):
  ```ts
  export function legSpeaks(p: Speaking, leg: LegName, inputs: SpeechInputs): boolean;   // now exported
  export interface SpeakInputs {
    textOnly: boolean;
    participantSpeech: boolean | null;
    isMonitorMuted: boolean;
    legs: readonly LegName[];
    faceToFace: boolean;
    /** `participantSpeechHeard` for the platform and source: the other's translation is not recaptured. */
    heard: boolean;
  }
  export function participantSpeechInput(i: Pick<SpeakInputs, 'participantSpeech' | 'faceToFace' | 'heard'>): boolean;
  export function speakFor(p: Speaking, i: SpeakInputs): Speak;
  ```
  (`appShape.ts`):
  ```ts
  export function speechFromStores(provider?: Pick<AnyProvider, 'speech' | 'participantSpeech'>): Speak;  // default: the selected provider; none loaded → { speech: 'optional' }
  export function speechInputsFromStores(): SpeechInputs;   // unchanged signature; participantSpeech = participantSpeechInput(...)
  ```
  `participantSpeechFromStores` and `participantSpeechSwitchFromStores` are deleted; `readShapeFromStores`, `liveGate` and `useBalanceShortfall` read `speechFromStores(provider).them`.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/session/shape.test.ts` (it already imports from `./shape`; add `participantSpeechInput, speakFor` to that import):

```ts
describe('speakFor — who hears what (spec 2026-10-10 §4)', () => {
  const optional = { speech: 'optional' as const };
  const base = { textOnly: false, participantSpeech: null, isMonitorMuted: false, legs: ['speaker'] as const, faceToFace: false, heard: true };

  it('对方听到的翻译 is Text Only inverted, unless the provider always or never speaks', () => {
    expect(speakFor(optional, base).other).toBe(true);
    expect(speakFor(optional, { ...base, textOnly: true }).other).toBe(false);
    expect(speakFor({ speech: 'always' }, { ...base, textOnly: true }).other).toBe(true);
    expect(speakFor({ speech: 'never' }, base).other).toBe(false);
  });

  it('我听到的翻译 on auto: on in face-to-face, off in a meeting (ruling 1)', () => {
    expect(speakFor(optional, { ...base, faceToFace: true }).them).toBe(true);
    expect(speakFor(optional, base).them).toBe(false);
    expect(speakFor(optional, { ...base, participantSpeech: true }).them).toBe(true);
    expect(speakFor(optional, { ...base, faceToFace: true, participantSpeech: false }).them).toBe(false);
  });

  it("a whole-system source keeps them off whatever the switch says (Review Focus 4)", () => {
    expect(speakFor(optional, { ...base, participantSpeech: true, heard: false }).them).toBe(false);
  });

  it("them follows the provider's participant flag and its speech", () => {
    expect(speakFor({ speech: 'optional', participantSpeech: false }, { ...base, participantSpeech: true }).them).toBe(false);
    expect(speakFor({ speech: 'always' }, base).them).toBe(true);
    expect(speakFor({ speech: 'never' }, { ...base, participantSpeech: true }).them).toBe(false);
  });

  it('我也听 needs the monitor on and 对方听到的翻译 on, and is never face-to-face', () => {
    expect(speakFor(optional, base).me).toBe(true);
    expect(speakFor(optional, { ...base, isMonitorMuted: true }).me).toBe(false);
    expect(speakFor(optional, { ...base, textOnly: true }).me).toBe(false);
    expect(speakFor(optional, { ...base, faceToFace: true }).me).toBe(false);
  });

  it('我也听 in Both is blocked by a source that would recapture it (D12)', () => {
    const both = ['speaker', 'participant'] as const;
    expect(speakFor(optional, { ...base, legs: both, heard: true }).me).toBe(true);
    expect(speakFor(optional, { ...base, legs: both, heard: false }).me).toBe(false);
    // In Me mode the participant source is not captured at all.
    expect(speakFor(optional, { ...base, legs: ['speaker'], heard: false }).me).toBe(true);
  });

  it('participantSpeechInput is the switch resolved and the recapture rule, without the provider', () => {
    expect(participantSpeechInput({ participantSpeech: null, faceToFace: true, heard: true })).toBe(true);
    expect(participantSpeechInput({ participantSpeech: null, faceToFace: false, heard: true })).toBe(false);
    expect(participantSpeechInput({ participantSpeech: true, faceToFace: false, heard: false })).toBe(false);
  });
});
```

In `src/lib/session/appShape.test.ts`: in the import from `./appShape`, replace `participantSpeechFromStores, participantSpeechSwitchFromStores` with `speechFromStores`; in `beforeEach`, `useRoutingStore.setState({ participantSpeech: null });` and add `useAudioStore.setState({ isMonitorMuted: true, mode: 'speaker', otherSide: 'meeting' })` beside the existing audio reset. Then:

(a) In `'reads the text-only switch and the participant's speech: its switch, and a source that will not recapture it'`, replace `expect(participantSpeechSwitchFromStores()).toBe(false);` (both occurrences) with `expect(speechFromStores({ speech: 'optional' }).them).toBe(false);`.

(b) Replace the test `'voices the participant unless Text Only is on (Review Focus 2)'` with:
```ts
  it('voices the participant on auto in face-to-face, and only by the switch in a meeting (ruling 1)', () => {
    pick('soniox');
    useAudioStore.setState({ mode: 'both', otherSide: 'beside' });
    useRoutingStore.setState({ participantSpeech: null });
    expect(speechFromStores({ speech: 'optional' }).them).toBe(true);
    expect(speechInputsFromStores().participantSpeech).toBe(true);
    useRoutingStore.setState({ participantSpeech: false });
    expect(speechFromStores({ speech: 'optional' }).them).toBe(false);
    useAudioStore.setState({ otherSide: 'meeting' });
    useRoutingStore.setState({ participantSpeech: null });
    expect(speechFromStores({ speech: 'optional' }).them).toBe(false);
    // A provider whose participant never speaks stays silent everywhere.
    useAudioStore.setState({ otherSide: 'beside' });
    expect(speechFromStores({ speech: 'optional', participantSpeech: false }).them).toBe(false);
  });

  it('speechFromStores reads the selected provider by default, and treats none as optional', () => {
    useSettingsStore.setState({ textOnly: true });
    expect(speechFromStores().other).toBe(false);
    useSettingsStore.setState({ textOnly: false });
    expect(speechFromStores().other).toBe(true);
  });
```
(c) Every other `participantSpeechFromStores(X)` in the file becomes `speechFromStores(X).them`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `/home/jiangzhuo/Desktop/kizunaai/sokuji/node_modules/.bin/vitest run src/lib/session/shape.test.ts src/lib/session/appShape.test.ts`
Expected: FAIL (`speakFor` not exported; `speechFromStores` undefined).

- [ ] **Step 3: Change `shape.ts`**

Add `import type { Speak } from '../audio/outlets';`. Export `legSpeaks` (`export function legSpeaks(…)`). After it:

```ts
/** What `speakFor` reads from the stores (`appShape.ts`'s `speechFromStores`). */
export interface SpeakInputs {
  textOnly: boolean;
  /** 我听到的翻译 as stored: null = auto. */
  participantSpeech: boolean | null;
  /** 我也听 off (today's monitor mute). */
  isMonitorMuted: boolean;
  legs: readonly LegName[];
  faceToFace: boolean;
  /** `participantSpeechHeard` for the platform and source: the other's translation is not recaptured. */
  heard: boolean;
}

/** 我听到的翻译 before the provider's own flags: the switch resolved (auto = face-to-face), and a source that will not recapture it. */
export function participantSpeechInput(i: Pick<SpeakInputs, 'participantSpeech' | 'faceToFace' | 'heard'>): boolean {
  return (i.participantSpeech ?? i.faceToFace) && i.heard;
}

/**
 * Who hears what (spec 2026-10-10 §4): the three rows of the Audio page's
 * 语音 block, gated by the provider's flags, the mode, face-to-face and the
 * recapture rule. The route table, the run's shape, the balance floor and
 * every surface read this one function.
 */
export function speakFor(p: Speaking, i: SpeakInputs): Speak {
  const inputs: SpeechInputs = { textOnly: i.textOnly, participantSpeech: participantSpeechInput(i) };
  const other = legSpeaks(p, 'speaker', inputs);
  const them = legSpeaks(p, 'participant', inputs);
  // 我也听 is a sub-row of 对方听到的翻译; face-to-face has no monitor of my own
  // voice; in Both a whole-system capture would recapture it (D12).
  const both = i.legs.includes('speaker') && i.legs.includes('participant');
  const me = !i.isMonitorMuted && other && !i.faceToFace && (!both || i.heard);
  return { other, me, them };
}
```

- [ ] **Step 4: Change `appShape.ts`**

Imports: add `import type { Speak } from '../audio/outlets';` and extend the `./shape` import to `{ gate, participantSpeechInput, speakFor, type Refusal, type SpeechInputs }`.

Replace `participantSpeechFromStores` and `participantSpeechSwitchFromStores` (both functions and their comments) with:

```ts
/** `participantSpeechHeard` over the stores: the other's translation, spoken to me, is not recaptured by the participant source. */
function heardFromStores(faceToFace: boolean): boolean {
  return participantSpeechHeard(getEnvironment(), useAudioStore.getState().selectedParticipantSource?.deviceId, faceToFace);
}

/**
 * Who hears what, as the stores stand (spec 2026-10-10 §4): the selected
 * provider's flags over the switches, the mode, face-to-face and the
 * recapture rule. The run's shape, the live gate's floor, the account
 * button's floor, the routing and every surface read it, so they price
 * and play the same legs. Before a provider has loaded it answers as an
 * optional-speech provider would.
 */
export function speechFromStores(provider: Pick<AnyProvider, 'speech' | 'participantSpeech'> | undefined = selectedFromStores()?.provider): Speak {
  const audio = useAudioStore.getState();
  const faceToFace = faceToFaceFromStores();
  return speakFor(provider ?? { speech: 'optional' }, {
    textOnly: useSettingsStore.getState().textOnly,
    participantSpeech: useRoutingStore.getState().participantSpeech,
    isMonitorMuted: audio.isMonitorMuted,
    legs: legsFor(audio.mode),
    faceToFace,
    heard: heardFromStores(faceToFace),
  });
}
```
`speechInputsFromStores`:
```ts
export function speechInputsFromStores(): SpeechInputs {
  const faceToFace = faceToFaceFromStores();
  return {
    textOnly: useSettingsStore.getState().textOnly,
    participantSpeech: participantSpeechInput({ participantSpeech: useRoutingStore.getState().participantSpeech, faceToFace, heard: heardFromStores(faceToFace) }),
  };
}
```
In `readShapeFromStores`: `participantSpeech: speechFromStores(provider).them,`. In `liveGate`: `participantSpeech: speechFromStores(selected.provider).them,`.

- [ ] **Step 5: `useBalanceShortfall.ts`**

Replace the import of `participantSpeechFromStores` with `speechFromStores`, add `useAudioStore((s) => s.isMonitorMuted);` is NOT needed (the floor reads `them` only) — but `them` reads the audio mode, which is already subscribed. Replace `const participantSpeech = participantSpeechFromStores(provider);` with `const participantSpeech = speechFromStores(provider).them;`.

- [ ] **Step 6: Run the tests**

Run: `/home/jiangzhuo/Desktop/kizunaai/sokuji/node_modules/.bin/vitest run src/lib/session src/components/TitleBar/useBalanceShortfall.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/session/shape.ts src/lib/session/shape.test.ts src/lib/session/appShape.ts src/lib/session/appShape.test.ts src/components/TitleBar/useBalanceShortfall.ts
git commit -m "feat(session): speakFor — who hears what, from the provider flags and the switches

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: `appAudio.ts` — `readRouting` over outlets; `earPreview(outlet)`

**Files:**
- Modify: `src/lib/audio/appAudio.ts`
- Test: `src/lib/audio/appAudio.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 2, 4, 5, 7.
- Produces:
  ```ts
  export function readRouting(
    audio: Pick<AudioState, 'isRealVoicePassthroughEnabled' | 'realVoicePassthroughVolume' | 'selectedMonitorDevice' | 'audioMonitorDevices' | 'outlets'>,
    speak: Speak,
    meeting: boolean,
    platform: Platform,
    turnMode: TurnMode,
    faceToFace?: boolean,
  ): RoutingSettings;
  export function createAppRouting(platform: Platform): RoutingSource;   // reads speechFromStores(); subscribes to settingsStore too
  export interface AppAudio {
    playback: Playback;
    testTone(signal?: AbortSignal): Promise<void>;        // on 'me'
    earPreview(outlet: OutletName): Promise<void>;        // the chime on that outlet
  }
  ```

- [ ] **Step 1: Update the tests**

In `src/lib/audio/appAudio.test.ts`:

(a) Imports: add `import { useSettingsStore } from '../../stores/settingsStore';` and `import { DEFAULT_OUTLET_CHOICE } from './outlets';`. Fixtures:
```ts
const AUDIO = {
  isRealVoicePassthroughEnabled: true,
  realVoicePassthroughVolume: 0.3,
  selectedMonitorDevice: { deviceId: 'monitor-1', label: 'Headphones' },
  audioMonitorDevices: [
    { deviceId: 'monitor-1', label: 'Headphones' },
    { deviceId: 'usb-1', label: 'USB speakers' },
    { deviceId: 'cable-1', label: 'CABLE Input (VB-Audio Virtual Cable)', isVirtual: true },
  ],
  outlets: { other: { ...DEFAULT_OUTLET_CHOICE }, me: { ...DEFAULT_OUTLET_CHOICE }, them: { ...DEFAULT_OUTLET_CHOICE } },
};
const SPEAK = { other: true, me: true, them: false };
```
(b) Replace the `describe('readRouting', …)` block's cases with:
```ts
describe('readRouting', () => {
  it('maps the stores onto the route settings: every outlet follows the default device, centred', () => {
    expect(readRouting(AUDIO, SPEAK, true, 'electron', 'auto')).toEqual({
      meeting: true,
      faceToFace: false,
      speak: SPEAK,
      passthrough: { on: true, ratio: 0.3 },
      sinks: { virtual: 'cable-1', other: { device: 'monitor-1' }, me: { device: 'monitor-1' }, them: { device: 'monitor-1' } },
    });
  });

  it('gives an outlet its own device and channel, and follows the default for one that is not present', () => {
    const outlets = { ...AUDIO.outlets, them: { device: 'usb-1', channel: 'left' as const }, me: { device: 'usb-gone', channel: 'right' as const } };
    const { sinks } = readRouting({ ...AUDIO, outlets }, SPEAK, true, 'electron', 'auto');
    expect(sinks.them).toEqual({ device: 'usb-1', pan: -1 });
    expect(sinks.me).toEqual({ device: 'monitor-1', pan: 1 });
  });

  it('resolves auto channels per face-to-face: the other right, me left, centred in a meeting (Review Focus 2)', () => {
    const f2f = readRouting(AUDIO, SPEAK, true, 'electron', 'auto', true);
    expect(f2f.faceToFace).toBe(true);
    expect(f2f.sinks.other).toEqual({ device: 'monitor-1', pan: 1 });
    expect(f2f.sinks.them).toEqual({ device: 'monitor-1', pan: -1 });
    expect(f2f.sinks.me).toEqual({ device: 'monitor-1' });
    expect(readRouting(AUDIO, SPEAK, true, 'electron', 'auto', false).sinks.other).toEqual({ device: 'monitor-1' });
  });

  it('no default device: the outlets fall to the browser default', () => {
    expect(readRouting({ ...AUDIO, selectedMonitorDevice: null }, SPEAK, true, 'electron', 'auto').sinks.me).toEqual({});
  });

  it('looks for a virtual speaker device only in Electron', () => {
    expect(readRouting(AUDIO, SPEAK, true, 'extension', 'auto').sinks.virtual).toBeUndefined();
    expect(readRouting(AUDIO, SPEAK, true, 'web', 'auto').sinks.virtual).toBeUndefined();
    expect(readRouting({ ...AUDIO, audioMonitorDevices: [AUDIO.audioMonitorDevices[0]] }, SPEAK, true, 'electron', 'auto').sinks.virtual).toBeUndefined();
  });

  it('forces the original voice on at full level under push-to-translate, whatever the toggle says, open while idle (1e-3 ruling 4)', () => {
    expect(readRouting({ ...AUDIO, isRealVoicePassthroughEnabled: false, realVoicePassthroughVolume: 0.2 }, SPEAK, true, 'electron', 'push-to-translate').passthrough)
      .toEqual({ on: true, ratio: 1, gate: 'idle' });
    expect(readRouting({ ...AUDIO, isRealVoicePassthroughEnabled: false, realVoicePassthroughVolume: 0.2 }, SPEAK, true, 'electron', 'auto').passthrough)
      .toEqual({ on: false, ratio: 0.2 });
  });

  it('follows the toggle under push-to-talk, open only while the key is held, as 0.41.1 did', () => {
    expect(readRouting({ ...AUDIO, isRealVoicePassthroughEnabled: true, realVoicePassthroughVolume: 0.2 }, SPEAK, true, 'electron', 'push-to-talk').passthrough)
      .toEqual({ on: true, ratio: 0.2, gate: 'held' });
    expect(readRouting({ ...AUDIO, isRealVoicePassthroughEnabled: false, realVoicePassthroughVolume: 0.2 }, SPEAK, true, 'electron', 'push-to-talk').passthrough)
      .toEqual({ on: false, ratio: 0.2, gate: 'held' });
  });
});
```
The old monitor / participantSpeech / whole-system cases are gone (they live in `shape.test.ts`'s `speakFor` now).

(c) In the `createAppRouting` block, wherever a case sets `useRoutingStore.setState({ faceToFaceSwap: … })` to provoke a change, set `useAudioStore.getState().setOutletChannel('them', 'right')` instead, and assert the sink (`get().sinks.them.pan`) rather than `ears`. Add:
```ts
  it('notifies when 对方听到的翻译 flips, and when the provider\'s speech flags land (Review Focus 5)', () => {
    const source = createAppRouting('electron');
    const listener = vi.fn();
    const off = source.subscribe(listener);
    useSettingsStore.setState({ textOnly: true });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(source.get().speak.other).toBe(false);
    useSettingsStore.setState({ textOnly: false });
    off();
  });
```
(Keep the existing face-to-face subscription case: it still flips `faceToFace` through the provider store, now asserting `get().faceToFace`.)

(d) In the `getAppAudio` block, `audio.testTone(signal)` calls lose their `pan`; add:
```ts
  it('plays the ear preview on the outlet asked for', async () => {
    const { audio, live } = await toneAudio();
    const playing = audio.earPreview('them');
    await vi.waitFor(() => expect(live[0].sources).toHaveLength(1));
    live[0].advance(1);
    await playing;
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `/home/jiangzhuo/Desktop/kizunaai/sokuji/node_modules/.bin/vitest run src/lib/audio/appAudio.test.ts`
Expected: FAIL.

- [ ] **Step 3: Change `appAudio.ts`**

Imports: replace the `faceToFaceFromStores` import with `import { faceToFaceFromStores, speechFromStores } from '../session/appShape';`, add `import { useSettingsStore } from '../../stores/settingsStore';`, `import { OUTLET_NAMES, resolveOutlet, type OutletName, type OutletSink, type Speak } from './outlets';`; `PreviewClip` stays imported for `testTone`.

`AppAudio`:
```ts
export interface AppAudio {
  playback: Playback;
  /** Plays the bundled test tone on 我也听's outlet: a fixed route, never into the meeting. A `signal` that aborts before the tone has decoded plays nothing; once playing, `playback.stopPreview()` ends it. */
  testTone(signal?: AbortSignal): Promise<void>;
  /** Plays the synthesized chime on an outlet, as its row's 试听 (face-to-face's ear preview today). */
  earPreview(outlet: OutletName): Promise<void>;
}
```
`readRouting`:
```ts
export function readRouting(
  audio: Pick<AudioState, 'isRealVoicePassthroughEnabled' | 'realVoicePassthroughVolume' | 'selectedMonitorDevice' | 'audioMonitorDevices' | 'outlets'>,
  speak: Speak,
  meeting: boolean,
  platform: Platform,
  turnMode: TurnMode,
  faceToFace = false,
): RoutingSettings {
  const context = {
    defaultDevice: audio.selectedMonitorDevice?.deviceId,
    present: new Set(audio.audioMonitorDevices.map((d) => d.deviceId)),
    faceToFace,
  };
  const sinks = {
    virtual: platform === 'electron' ? findVirtualSpeaker(audio.audioMonitorDevices) : undefined,
  } as { virtual?: string } & Record<OutletName, OutletSink>;
  for (const name of OUTLET_NAMES) sinks[name] = resolveOutlet(name, audio.outlets[name], context);
  return {
    meeting,
    faceToFace,
    speak,
    // 1e-3 ruling 4, today's rule (`isPassthroughActive`): … (the existing comment)
    passthrough: turnMode === 'push-to-translate'
      ? { on: true, ratio: 1, gate: 'idle' }
      : turnMode === 'push-to-talk'
        ? { on: audio.isRealVoicePassthroughEnabled, ratio: audio.realVoicePassthroughVolume, gate: 'held' }
        : { on: audio.isRealVoicePassthroughEnabled, ratio: audio.realVoicePassthroughVolume },
    sinks,
  };
}
```
`createAppRouting`:
```ts
export function createAppRouting(platform: Platform): RoutingSource {
  const read = () => readRouting(useAudioStore.getState(), speechFromStores(), useRoutingStore.getState().meeting, platform, useTurnModeStore.getState().turnMode, faceToFaceFromStores());
  return {
    get: read,
    subscribe(listener) {
      // The provider decides whether "beside me" is face-to-face and what
      // speaks, and only once its entry has loaded, which lands after the pick.
      const key = () => { const s = speechFromStores(); return `${faceToFaceFromStores()}:${s.other}:${s.me}:${s.them}`; };
      let last = key();
      const notify = () => {
        last = key();
        listener();
      };
      const offAudio = useAudioStore.subscribe(notify);
      const offSwitches = useRoutingStore.subscribe(notify);
      const offSettings = useSettingsStore.subscribe(notify);
      const offTurnMode = useTurnModeStore.subscribe(notify);
      const offProvider = useProviderStore.subscribe(() => { if (key() !== last) notify(); });
      return () => {
        offAudio();
        offSwitches();
        offSettings();
        offTurnMode();
        offProvider();
      };
    },
  };
}
```
In `build()`: `async testTone(signal) { … await playback.preview(clip); }` (no pan) and `earPreview: (outlet) => playback.preview(earTone(), outlet),`.

- [ ] **Step 4: Run the tests**

Run: `/home/jiangzhuo/Desktop/kizunaai/sokuji/node_modules/.bin/vitest run src/lib/audio`
Expected: PASS for the whole folder.

- [ ] **Step 5: Commit**

```bash
git add src/lib/audio/appAudio.ts src/lib/audio/appAudio.test.ts
git commit -m "feat(audio): the page's routing resolves each outlet from the stores

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Today's UI on the model — `useFaceToFace`, `EarsBlock`, the dev controls

**Files:**
- Modify: `src/components/MainPanel/useFaceToFace.ts`, `src/components/FaceToFace/EarsBlock.tsx`, `src/components/Conversation/ConversationList.tsx` (its `Ear` import), `src/components/dev/SessionControls.tsx` (only if tsc complains), `src/components/Conversation/ConversationList.test.tsx` (its `earsFor` import)
- Test: `src/components/MainPanel/useFaceToFace.test.ts`, `src/components/FaceToFace/EarsBlock.test.tsx`, `src/components/dev/SessionControls.test.tsx`, `src/components/MainPanel/MainPanel.test.tsx` (mock shape only)

**Interfaces:**
- Consumes: `speechFromStores` (Task 7), `useOutlets`/`useSetOutletChannel` (Task 5), `resolveChannel` (Task 1), `earPreview(outlet)` (Task 8).
- Produces (`FaceToFaceView`, unchanged fields plus one):
  ```ts
  export type Ear = 'left' | 'right';            // moved here from routes.ts
  export interface FaceToFaceView {
    offered: boolean; active: boolean;
    /** The other person's ear is the left one (their outlet's channel resolved). */
    swap: boolean;
    /** The ear each leg's translation plays in: speaker = the `other` outlet, participant = `them`. */
    ears: Record<LegName, Ear>;
    me: string | null; other: string | null;
    speaks: Readonly<Record<LegName, boolean>>;   // { speaker: speak.other, participant: speak.them }
  }
  ```
  `earsLegend` and `voicedEars` read `view.ears` instead of `earsFor(view.swap)`.

- [ ] **Step 1: Update the tests**

`src/components/MainPanel/useFaceToFace.test.ts`: in `beforeEach`, replace `useRoutingStore.setState({ faceToFaceSwap: false, participantSpeech: false });` with `useRoutingStore.setState({ participantSpeech: null }); useAudioStore.setState({ outlets: { other: { device: null, channel: 'auto' }, me: { device: null, channel: 'auto' }, them: { device: null, channel: 'auto' } }, isMonitorMuted: true });`. The first case's expected object gains `ears: { speaker: 'right', participant: 'left' }`. Replace `'voices both legs face-to-face with the participant switch off, and neither under Text Only'` with:
```ts
  it('voices both legs face-to-face on auto; Text Only silences mine, the switch theirs', () => {
    pick('soniox');
    const { result } = renderHook(() => useFaceToFace());
    expect(result.current.speaks).toEqual({ speaker: true, participant: true });
    act(() => { useSettingsStore.setState({ textOnly: true }); });
    expect(result.current.speaks).toEqual({ speaker: false, participant: true });
    act(() => { useRoutingStore.setState({ participantSpeech: false }); });
    expect(result.current.speaks).toEqual({ speaker: false, participant: false });
  });

  it('reads the ears from the outlets: a channel picked for them swaps them, live', () => {
    pick('soniox');
    const { result } = renderHook(() => useFaceToFace());
    expect(result.current).toMatchObject({ swap: false, ears: { speaker: 'right', participant: 'left' } });
    act(() => { useAudioStore.getState().setOutletChannel('them', 'right'); useAudioStore.getState().setOutletChannel('other', 'left'); });
    expect(result.current).toMatchObject({ swap: true, ears: { speaker: 'left', participant: 'right' } });
  });
```
The `earsLegend`/`voicedEars` `view` fixtures gain `ears: { speaker: 'right', participant: 'left' }`, and the "unless swapped" case sets `ears: { speaker: 'left', participant: 'right' }` (with `swap: true`) instead of `swap: true` alone.

`src/components/FaceToFace/EarsBlock.test.tsx`: the `f2f` fixture gains `ears: { speaker: 'right', participant: 'left' }` (and the swapped case sets `f2f.swap = true; f2f.ears = { speaker: 'left', participant: 'right' };`). Replace the routing-store mock with an audio-store mock:
```ts
const outlets = { setOutletChannel: vi.fn() };
vi.mock('../../stores/audioStore', () => ({
  useSetOutletChannel: () => outlets.setOutletChannel,
}));
```
(`beforeEach` clears `outlets.setOutletChannel`.) The tone mock becomes `const tone = vi.fn(async (_outlet: 'other' | 'me' | 'them') => {});`. `'previews each ear panned to its side'` asserts `toHaveBeenCalledWith('them')` for the left ear (mine) and `toHaveBeenCalledWith('other')` for the right. `'the swap button writes the opposite'`:
```ts
  it('the swap button writes each outlet the other one\'s channel', () => {
    render(<EarsBlock />);
    fireEvent.click(screen.getByRole('button', { name: 'Swap left and right' }));
    expect(outlets.setOutletChannel).toHaveBeenCalledWith('other', 'left');
    expect(outlets.setOutletChannel).toHaveBeenCalledWith('them', 'right');
  });
```
`src/components/MainPanel/MainPanel.test.tsx` and any other test that mocks `useFaceToFace`'s return: add `ears: { speaker: 'right', participant: 'left' }` to the mocked view (grep `speaks: {` in `src/components` tests). `src/components/Conversation/ConversationList.test.tsx`: drop the `earsFor` import (its `ears` const is literal already).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `/home/jiangzhuo/Desktop/kizunaai/sokuji/node_modules/.bin/vitest run src/components/MainPanel/useFaceToFace.test.ts src/components/FaceToFace/EarsBlock.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Change `useFaceToFace.ts`**

```ts
import { resolveChannel } from '../../lib/audio/outlets';
import type { LegName } from '../../lib/conversation/types';
import { speechFromStores } from '../../lib/session/appShape';
import { presentProviders } from '../../providers/registry';
import useAudioStore from '../../stores/audioStore';
import { useProviderStore } from '../../stores/providerStore';
import { useRoutingStore } from '../../stores/routingStore';
import { useSettingsStore } from '../../stores/settingsStore';

/** One ear of a stereo device. */
export type Ear = 'left' | 'right';

export interface FaceToFaceView {
  offered: boolean;
  active: boolean;
  /** The other person's ear is the left one: their outlet's channel resolved (an auto channel puts them right). */
  swap: boolean;
  /** The ear each leg's translation plays in: mine on the `other` outlet, theirs on `them`. A centred outlet counts as the right ear here (face-to-face's auto never is). */
  ears: Record<LegName, Ear>;
  me: string | null;
  other: string | null;
  /** Whether each leg's translation is voiced in a run started now: `speakFor`'s `other` and `them`. */
  speaks: Readonly<Record<LegName, boolean>>;
}

export function useFaceToFace(): FaceToFaceView {
  const selected = useProviderStore((s) => s.selected);
  const entries = useProviderStore((s) => s.entries);
  const mode = useAudioStore((s) => s.mode);
  const otherSide = useAudioStore((s) => s.otherSide);
  const outlets = useAudioStore((s) => s.outlets);
  // The rest of what `speechFromStores` reads, subscribed so `speaks` follows the switches and the source.
  useSettingsStore((s) => s.textOnly);
  useRoutingStore((s) => s.participantSpeech);
  useAudioStore((s) => s.isMonitorMuted);
  useAudioStore((s) => s.selectedParticipantSource?.deviceId);
  const providers = presentProviders();
  const provider = providers.find((p) => p.id === selected) ?? providers[0];
  const pair = provider ? entries[provider.id]?.pair ?? null : null;
  const offered = provider?.faceToFace === true && pair !== null;
  const active = offered && mode === 'both' && otherSide === 'beside';
  const earOf = (channel: 'both' | 'left' | 'right'): Ear => (channel === 'left' ? 'left' : 'right');
  const ears: Record<LegName, Ear> = {
    speaker: earOf(resolveChannel('other', outlets.other.channel, active)),
    participant: earOf(resolveChannel('them', outlets.them.channel, active)),
  };
  const speak = speechFromStores(provider);
  return {
    offered,
    active,
    swap: ears.participant === 'right',
    ears,
    me: pair?.source ?? null,
    other: pair?.target ?? null,
    speaks: { speaker: speak.other, participant: speak.them },
  };
}
```
`earsLegend` and `voicedEars`: replace `const ears = earsFor(view.swap);` with `const ears = view.ears;` (both functions); their doc comments stay.

- [ ] **Step 4: Change `EarsBlock.tsx`**

Imports: drop `useRoutingStore` and `earsFor`; add `import { useSetOutletChannel } from '../../stores/audioStore';`. In the component: `const setOutletChannel = useSetOutletChannel();`. `const mine = earsFor(f2f.swap).participant === ear;` becomes `const mine = f2f.ears.participant === ear;`. The preview's `pan` becomes `const outlet = mine ? 'them' : 'other';` and the click calls `app.earPreview(outlet)`. The swap button's `onClick`:
```ts
          onClick={() => {
            // Each outlet takes the other one's ear.
            setOutletChannel('other', f2f.ears.participant);
            setOutletChannel('them', f2f.ears.speaker);
          }}
```

- [ ] **Step 5: `ConversationList.tsx`, tsc, then the dev controls**

`ConversationList.tsx:4` imports `type Ear` from `'../../lib/audio/routes'`, which Task 2 removed: change it to `import type { Ear } from '../MainPanel/useFaceToFace';` (the only other importer, `useFaceToFace.ts`, now defines it).

Run: `/home/jiangzhuo/Desktop/kizunaai/sokuji/node_modules/.bin/tsc --noEmit -p tsconfig.json 2>&1 | grep -v "ModernAudioRecorder.ts(78"`
Expected: no output. If `SessionControls.tsx:143` complains about `setParticipantSpeech(e.target.checked)`, it does not (a boolean is a `boolean | null`); if `SessionControls.tsx:154`'s `audio.testTone()` or `SpinePreview.tsx` pass a pan, drop the argument. Fix whatever tsc names, nothing else.

- [ ] **Step 6: Run the touched tests**

Run: `/home/jiangzhuo/Desktop/kizunaai/sokuji/node_modules/.bin/vitest run src/components/MainPanel src/components/FaceToFace src/components/Conversation src/components/dev src/components/TitleBar`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/MainPanel/useFaceToFace.ts src/components/MainPanel/useFaceToFace.test.ts src/components/FaceToFace/EarsBlock.tsx src/components/FaceToFace/EarsBlock.test.tsx src/components/Conversation/ConversationList.tsx src/components/Conversation/ConversationList.test.tsx src/components/MainPanel/MainPanel.test.tsx src/components/dev
git commit -m "refactor(face-to-face): the ears read the outlets; the swap writes two channels

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: The whole suite, the builds, CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` (the Audio bullets), nothing else unless the suite says so.

- [ ] **Step 1: Run everything**

Run: `/home/jiangzhuo/Desktop/kizunaai/sokuji/node_modules/.bin/vitest run > /tmp/aec-slice1-suite.log 2>&1; tail -6 /tmp/aec-slice1-suite.log`
Expected: `Test Files … passed`, no failures. A failure in a file this plan did not name means a reader of the changed types this plan missed: fix it in the file the failure names, in the shape the nearest task used, and note it in the ledger.

Run: `npm run build 2>&1 | tail -3` and `npm run extension:build 2>&1 | tail -3` (from the worktree; the extension build needs `extension/node_modules` — if absent, symlink the main checkout's as the 2026-10-09 session did, and remove the link afterwards).
Expected: both succeed.

- [ ] **Step 2: CLAUDE.md**

In "3. Audio Processing Pipeline", the Playback bullet becomes: "Playback (`src/lib/audio/playback.ts`): a clip queue per leg and one for replay, the routes kept live from the routing settings, the passthrough stream; replay and preview play on the outlet of their row". In "5. Audio", add: "`src/lib/audio/outlets.ts`: the outlets — `other` (face-to-face's other person), `me` (我也听), `them` (我听到的翻译) — each a stored device and channel (`audio.outlet.<name>.*`) resolved to a sink; `graph.ts` keeps one `<audio>` element per outlet and the virtual one, the pan on the outlet's path". In "Audio Handling", replace the routing sentence with: "the routing read live from `audioStore`, `routingStore`, `settingsStore` and `turnModeStore` through `speechFromStores` (`src/lib/session/appShape.ts`): who hears what".

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: outlets in CLAUDE.md

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
