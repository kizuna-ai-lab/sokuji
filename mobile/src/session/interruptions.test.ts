import { describe, it, expect } from 'vitest';
import { createInterruptionHandler } from './interruptions';

// A phone call, Siri, another app taking the audio session: the OS says it
// began and later that it ended, with or without permission to resume.
function harness() {
  const calls: string[] = [];
  const handler = createInterruptionHandler({
    pauseCapture: () => calls.push('pause'),
    resumeCapture: () => calls.push('resume'),
    log: (line) => calls.push(`log:${line}`),
  });
  return { handler, calls };
}

describe('createInterruptionHandler', () => {
  it('pauses capture when an interruption begins', () => {
    const { handler, calls } = harness();
    handler.onInterruption({ type: 'began', shouldResume: false });
    expect(calls).toEqual(['pause']);
  });

  it('resumes capture when the interruption ends and the OS says to resume', () => {
    const { handler, calls } = harness();
    handler.onInterruption({ type: 'began', shouldResume: false });
    handler.onInterruption({ type: 'ended', shouldResume: true });
    expect(calls).toEqual(['pause', 'resume']);
  });

  it('leaves capture paused, and says so, when the interruption ends without permission to resume', () => {
    const { handler, calls } = harness();
    handler.onInterruption({ type: 'began', shouldResume: false });
    handler.onInterruption({ type: 'ended', shouldResume: false });
    expect(calls.filter((c) => c === 'resume')).toEqual([]);
    expect(calls.some((c) => c.startsWith('log:'))).toBe(true);
  });

  it('neither pauses nor resumes on a route change', () => {
    const { handler, calls } = harness();
    handler.onRouteChange({ reason: 'newDeviceAvailable' });
    expect(calls.filter((c) => c === 'pause' || c === 'resume')).toEqual([]);
  });
});
