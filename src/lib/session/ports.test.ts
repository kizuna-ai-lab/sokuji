import { describe, it, expect, vi } from 'vitest';
import { guardPorts, type RunnerDeps } from './ports';

describe('guardPorts — analytics', () => {
  it('redacts every string value before the port sees it', () => {
    const track = vi.fn();
    const secret = 'sk-proj-abcdefghijklmnopqrstuvwxyz0123456789';
    const deps = { playback: { audio() {}, held() {}, clear() {}, live() {} }, analytics: { track } } as unknown as RunnerDeps;
    guardPorts(deps).analytics.track('error_occurred', { error_type: 'x', error_message: `failed with ${secret}`, severity: 'high', recoverable: true });
    const sent = track.mock.calls[0][1] as { error_message: string };
    expect(sent.error_message).not.toContain(secret);
    expect(sent.error_message).toContain('failed with');
  });
});
