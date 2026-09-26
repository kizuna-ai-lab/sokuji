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
}

export interface RoutingSettings {
  /** Speaker translation → the virtual device: the meeting hears it. On by default (new). */
  meeting: boolean;
  /** Speaker translation → the real device: the user monitors it. */
  monitor: boolean;
  /** Participant translation → the real device: the participant-TTS opt-in, off by default. */
  participantSpeech: boolean;
  /** The microphone → the virtual device, under the translation, at `ratio` (0–1). */
  passthrough: { on: boolean; ratio: number };
  /** Output device ids: the monitor device, and the virtual speaker where one exists (Electron). */
  sinks: { real?: string; virtual?: string };
}

/** Every edge the settings ask for. `held`: push-to-translate's key is down, which closes the original-voice route. */
export function routesFor(s: RoutingSettings, held: boolean): Edge[] {
  // Replay and preview are fixed routes to the real device, never into the meeting.
  const edges: Edge[] = [
    { from: 'replay', to: 'real', gain: 1 },
    { from: 'preview', to: 'real', gain: 1 },
  ];
  if (s.meeting) edges.push({ from: 'speaker', to: 'virtual', gain: 1 });
  if (s.monitor) edges.push({ from: 'speaker', to: 'real', gain: 1 });
  if (s.participantSpeech) edges.push({ from: 'participant', to: 'real', gain: 1 });
  if (s.passthrough.on && !held && s.passthrough.ratio > 0) {
    edges.push({ from: 'passthrough', to: 'virtual', gain: Math.min(1, s.passthrough.ratio) });
  }
  return edges;
}
