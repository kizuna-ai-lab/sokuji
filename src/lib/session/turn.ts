import { SAMPLE_RATE } from '../contract/adapter';

/** A chunk whose mean absolute amplitude reaches this share of full scale counts as voice (today's `isSilentAudio` threshold). */
export const VOICED_LEVEL = 0.01;

/** A turn holding less voice than this is cancelled rather than ended (today: five 100 ms chunks). */
export const MIN_VOICED_MS = 500;

export function isVoiced(pcm: Int16Array): boolean {
  if (pcm.length === 0) return false;
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) sum += Math.abs(pcm[i]) / 32768;
  return sum / pcm.length >= VOICED_LEVEL;
}

/**
 * One press of the key (spec: "Turns belong to the run"). Each press gets its
 * own count, so a press landing while the last release is still ending cannot
 * reset that turn's count.
 */
export class Turn {
  private voicedMs = 0;
  private open = true;

  constructor(readonly startedAt: number) {}

  get isOpen(): boolean {
    return this.open;
  }

  /** Counts a chunk sent during the turn. */
  add(pcm: Int16Array): void {
    if (this.open && isVoiced(pcm)) this.voicedMs += (pcm.length / SAMPLE_RATE) * 1000;
  }

  /** Closes the turn: 'end' when it held enough voice, else 'cancel'; null when it was already closed. */
  close(): 'end' | 'cancel' | null {
    if (!this.open) return null;
    this.open = false;
    return this.voicedMs >= MIN_VOICED_MS ? 'end' : 'cancel';
  }
}
