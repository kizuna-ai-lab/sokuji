// src/lib/audio/previewClip.ts
//
// A clip a preview plays: its own module, so the provider definition (`PreviewPort`) names it without reaching the
// playback engine. Types only.

/** A voice sample or the test tone, at its own rate. */
export interface PreviewClip {
  audio: Float32Array;
  sampleRate: number;
}
