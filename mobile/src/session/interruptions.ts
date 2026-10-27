// What the session does when the OS interrupts the audio session (a phone
// call, Siri, another app taking the microphone) or the audio route changes.
export interface InterruptionHandler {
  onInterruption(e: { type: 'began' | 'ended'; shouldResume: boolean }): void;
  onRouteChange(e: { reason: string }): void;
}

export function createInterruptionHandler(o: {
  pauseCapture(): void;
  resumeCapture(): void;
  log(line: string): void;
}): InterruptionHandler {
  return {
    onInterruption(e) {
      if (e.type === 'began') {
        o.pauseCapture();
        return;
      }
      // Ended. The OS says whether the app may take the microphone back; without
      // that permission (another app kept it) capture stays paused, and the log says so.
      if (e.shouldResume) o.resumeCapture();
      else o.log('interruption ended without permission to resume: capture stays paused');
    },
    // The input stays the phone's own microphone whatever is plugged in or paired
    // (R14), so a route change is noted and nothing else.
    onRouteChange(e) {
      o.log(`audio route changed: ${e.reason}`);
    },
  };
}
