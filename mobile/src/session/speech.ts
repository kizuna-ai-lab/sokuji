// Plays the translation's speech: PCM chunks from the Soniox TTS stream,
// scheduled back to back on an AudioContext so they play gaplessly.
//
// Two channels from the first version: the translation plays on both, and a
// voice can be panned to one ear — what the later face-to-face scene uses
// (R14), the only caller of 'left' / 'right'.
export type Pan = 'both' | 'left' | 'right';

export interface SpeechPlayer {
  play(pcm: Int16Array, pan?: Pan): void;
  stop(): void;
  queuedSeconds(): number;
}

// The slice of react-native-audio-api's AudioContext the player uses (also what the tests fake).
export interface PlayerContext {
  readonly currentTime: number;
  readonly destination: unknown;
  createBuffer(channels: number, length: number, sampleRate: number): {
    copyToChannel(source: Float32Array, channel: number): void;
  };
  createBufferSource(): {
    buffer: unknown;
    connect(destination: unknown): void;
    start(when?: number): void;
    stop(): void;
  };
}

export function createSpeechPlayer(o: { context: PlayerContext; sampleRate: number }): SpeechPlayer {
  const { context, sampleRate } = o;
  let nextAt = 0;
  const live = new Set<{ stop(): void }>();

  return {
    play(pcm, pan = 'both') {
      const samples = new Float32Array(pcm.length);
      for (let i = 0; i < pcm.length; i++) samples[i] = pcm[i] / 32768;
      const silence = new Float32Array(pcm.length);
      const buffer = context.createBuffer(2, pcm.length, sampleRate);
      buffer.copyToChannel(pan === 'right' ? silence : samples, 0);
      buffer.copyToChannel(pan === 'left' ? silence : samples, 1);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      const at = Math.max(context.currentTime, nextAt);
      source.start(at);
      nextAt = at + pcm.length / sampleRate;
      live.add(source);
    },
    stop() {
      for (const source of live) {
        try {
          source.stop();
        } catch {
          // Already ended.
        }
      }
      live.clear();
      nextAt = 0;
    },
    queuedSeconds() {
      return Math.max(0, nextAt - context.currentTime);
    },
  };
}
