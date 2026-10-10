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
  /** Two people at one computer (spec 2026-10-08, slice 3): no meeting, no I hear it too, no passthrough. */
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
  // I hear it too is a sub-row of Translation the other side hears: nothing to hear while that is off.
  if (s.speak.other && s.speak.me) edges.push({ from: 'speaker', to: 'me', gain: 1 });
  if (s.speak.them) edges.push({ from: 'participant', to: 'them', gain: 1 });
  const { gate } = s.passthrough;
  // Passthrough is a sub-row of Translation the other side hears too: nothing passes while that is off, push-to-translate's managed one included.
  if (s.speak.other && s.passthrough.on && s.passthrough.ratio > 0 && (gate === undefined || held === (gate === 'held'))) {
    edges.push({ from: 'passthrough', to: 'virtual', gain: Math.min(1, s.passthrough.ratio) });
  }
  return edges;
}
