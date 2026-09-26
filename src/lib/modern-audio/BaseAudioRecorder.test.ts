import { describe, it, expect } from 'vitest';
import { BaseAudioRecorder } from './BaseAudioRecorder';

class Probe extends BaseAudioRecorder {
  protected getLogPrefix(): string {
    return '[Probe]';
  }

  capture(stream: MediaStream | null): void {
    this.stream = stream;
  }
}

describe('BaseAudioRecorder.getStream', () => {
  it('exposes the capture stream while there is one', () => {
    const probe = new Probe();
    expect(probe.getStream()).toBeNull();
    const stream = { id: 's1' } as MediaStream;
    probe.capture(stream);
    expect(probe.getStream()).toBe(stream);
  });
});
