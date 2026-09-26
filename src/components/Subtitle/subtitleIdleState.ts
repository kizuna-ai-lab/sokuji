// src/components/Subtitle/subtitleIdleState.ts
//
// What the subtitle window shows while no session is running.
export type SubtitleIdleState =
  | { kind: 'ready' }
  | { kind: 'ended' }
  | { kind: 'starting'; completed?: number; total?: number }
  | { kind: 'failed'; message: string }
  /** The new runner's provider is not ready (plan 1d-2): its reason, in words the provider gave. */
  | { kind: 'unready'; message: string; /** Where Settings fixes it (`settingsTargetForCode`); null or absent: nowhere. */ target?: string | null };
