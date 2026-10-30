import { describe, it, expect } from 'vitest';
import { createSpeechPlayer } from './speech';

// A fake of react-native-audio-api's AudioContext: buffers with channel data,
// sources that record when they were started and stopped.
function fakeContext(rate = 16000) {
  const sources: Array<{ at: number; channels: Float32Array[]; stopped: boolean }> = [];
  const context = {
    currentTime: 0,
    sampleRate: rate,
    destination: {},
    createBuffer(channels: number, length: number, sampleRate: number) {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return {
        numberOfChannels: channels, length, sampleRate,
        copyToChannel: (src: Float32Array, ch: number) => { data[ch].set(src); },
        getChannelData: (ch: number) => data[ch],
        channels: data,
      };
    },
    createBufferSource() {
      const entry = { at: -1, channels: [] as Float32Array[], stopped: false };
      return {
        buffer: null as { channels: Float32Array[] } | null,
        connect() {},
        start(when: number) { entry.at = when; entry.channels = this.buffer?.channels ?? []; sources.push(entry); },
        stop() { entry.stopped = true; },
      };
    },
  };
  return { context, sources };
}

describe('createSpeechPlayer', () => {
  it('schedules chunks back to back and knows how much is queued', () => {
    const { context, sources } = fakeContext();
    const player = createSpeechPlayer({ context: context as never, sampleRate: 16000 });
    player.play(new Int16Array(1600));
    player.play(new Int16Array(1600));
    player.play(new Int16Array(800));
    expect(sources.map((s) => s.at)).toEqual([0, 0.1, 0.2]);
    expect(player.queuedSeconds()).toBeCloseTo(0.25, 6);
  });

  it('stop() stops what was scheduled and empties the queue', () => {
    const { context, sources } = fakeContext();
    const player = createSpeechPlayer({ context: context as never, sampleRate: 16000 });
    player.play(new Int16Array(1600));
    player.stop();
    expect(sources.every((s) => s.stopped)).toBe(true);
    expect(player.queuedSeconds()).toBe(0);
  });

  // A spoken session lasts hours: a finished chunk's buffer must not be kept.
  it('forgets sources that have finished playing', () => {
    const { context } = fakeContext();
    const player = createSpeechPlayer({ context: context as never, sampleRate: 16000 });
    player.play(new Int16Array(1600));
    player.play(new Int16Array(1600));
    player.play(new Int16Array(1600));
    expect(player.held()).toBe(3);
    context.currentTime = 1;
    player.play(new Int16Array(1600));
    expect(player.held()).toBe(1);
  });

  it('pans a voice to one ear and plays both channels by default', () => {
    const { context, sources } = fakeContext();
    const player = createSpeechPlayer({ context: context as never, sampleRate: 16000 });
    const loud = new Int16Array([16384, -16384]);
    player.play(loud, 'left');
    player.play(loud, 'both');
    expect(Array.from(sources[0].channels[0])).toEqual([0.5, -0.5]);
    expect(Array.from(sources[0].channels[1])).toEqual([0, 0]);
    expect(Array.from(sources[1].channels[0])).toEqual([0.5, -0.5]);
    expect(Array.from(sources[1].channels[1])).toEqual([0.5, -0.5]);
  });
});
