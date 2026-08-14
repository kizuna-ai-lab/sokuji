import { describe, expect, it, vi } from 'vitest';
import { OpenAITranslateWebRTCClient } from './OpenAITranslateWebRTCClient';

/**
 * getInputFrequencies contract test — pins the IClient addition made for the
 * mic-waveform fallback (MainPanel's render loop falls back to the client's
 * own LOCAL-capture analyser for native-capture WebRTC sessions, since those
 * never start the shared recorder). Mirrors OpenAIWebRTCClient.test.ts's
 * equivalent case.
 */
describe('OpenAITranslateWebRTCClient.getInputFrequencies', () => {
  it('returns null before a local stream (and its analyser) exists', () => {
    // No session has connected (no getUserMedia call has happened yet), so
    // the bridge's LOCAL analyser has nothing to report.
    const client = new OpenAITranslateWebRTCClient({ apiKey: 'sk-test' });

    expect(client.getInputFrequencies()).toBeNull();
  });

  it('delegates to the bridge LOCAL analyser, not the remote/output one', () => {
    // getInputFrequencies() must forward to the bridge's getLocalFrequencies
    // (mic input), never to getFrequencies (remote/AI output) — the spy
    // proves forwarding rather than both coincidentally returning null.
    const client = new OpenAITranslateWebRTCClient({ apiKey: 'sk-test' });
    const bridge = (client as any).audioBridge;
    const localSpy = vi.spyOn(bridge, 'getLocalFrequencies')
      .mockReturnValue({ values: new Float32Array([0.5]) });
    const remoteSpy = vi.spyOn(bridge, 'getFrequencies');

    const result = client.getInputFrequencies();

    expect(localSpy).toHaveBeenCalledTimes(1);
    expect(remoteSpy).not.toHaveBeenCalled();
    expect(result).toEqual({ values: new Float32Array([0.5]) });
  });
});
