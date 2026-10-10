/**
 * The route table (spec: "Playback" → "Routing"). Three things, three
 * natures: a route is a switch; the one mix gain is passthrough's ratio (only
 * the virtual device carries a deliberate mix, translation with the original
 * voice underneath); nothing else has a volume.
 */

/** What plays. The test tone is a preview. */
export type Feed = 'speaker' | 'participant' | 'replay' | 'preview' | 'passthrough';

/** Where it goes: the user's output device, or the one the meeting hears. */
export type Bus = 'real' | 'virtual';

export interface Edge {
  from: Feed;
  to: Bus;
  gain: number;
  /** Face-to-face's ears: -1 the left channel, 1 the right. Absent: centred. */
  pan?: -1 | 1;
}

/** One ear of the real device's two (face-to-face). */
export type Ear = 'left' | 'right';

/** The ear each leg's translation plays in: the participant's (into my language) is mine, left unless swapped. */
export function earsFor(swap: boolean): Record<'speaker' | 'participant', Ear> {
  return swap ? { speaker: 'left', participant: 'right' } : { speaker: 'right', participant: 'left' };
}

export interface RoutingSettings {
  /** Speaker translation → the virtual device: the meeting hears it. On by default (new). */
  meeting: boolean;
  /** Speaker translation → the real device: the user monitors it. */
  monitor: boolean;
  /** Participant translation → the real device: the participant-TTS opt-in, off by default. */
  participantSpeech: boolean;
  /**
   * The microphone → the virtual device, under the translation, at `ratio` (0–1).
   * `gate`, under a manual turn mode, ties the route to the key: `'idle'` opens it
   * while the key is up (push-to-translate), `'held'` only while it is down
   * (push-to-talk, as 0.41.1 did). Absent, the key does not matter.
   */
  passthrough: { on: boolean; ratio: number; gate?: 'idle' | 'held' };
  /** Output device ids: the monitor device, and the virtual speaker where one exists (Electron). */
  sinks: { real?: string; virtual?: string };
  /** Face-to-face (slice 3): both translations on the real device, one per ear; no meeting. Absent: not face-to-face. */
  ears?: { swap: boolean };
}

/** Every edge the settings ask for. `held`: a manual turn's key is down, which the passthrough's `gate` reads. */
export function routesFor(s: RoutingSettings, held: boolean): Edge[] {
  // Replay and preview are fixed routes to the real device, never into the meeting.
  const edges: Edge[] = [
    { from: 'replay', to: 'real', gain: 1 },
    { from: 'preview', to: 'real', gain: 1 },
  ];
  if (s.ears) {
    // Two people at one computer: no meeting, no monitor of my own voice, no passthrough —
    // each translation goes to the ear of the person whose language it is in.
    const ears = earsFor(s.ears.swap);
    const pan = (ear: Ear): -1 | 1 => (ear === 'left' ? -1 : 1);
    edges.push({ from: 'speaker', to: 'real', gain: 1, pan: pan(ears.speaker) });
    if (s.participantSpeech) edges.push({ from: 'participant', to: 'real', gain: 1, pan: pan(ears.participant) });
    return edges;
  }
  if (s.meeting) edges.push({ from: 'speaker', to: 'virtual', gain: 1 });
  if (s.monitor) edges.push({ from: 'speaker', to: 'real', gain: 1 });
  if (s.participantSpeech) edges.push({ from: 'participant', to: 'real', gain: 1 });
  const { gate } = s.passthrough;
  if (s.passthrough.on && s.passthrough.ratio > 0 && (gate === undefined || held === (gate === 'held'))) {
    edges.push({ from: 'passthrough', to: 'virtual', gain: Math.min(1, s.passthrough.ratio) });
  }
  return edges;
}
