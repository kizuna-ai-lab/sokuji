import { describe, it, expect, vi } from 'vitest';
import type { EchoMonitorHooks } from '../../modern-audio/EchoMonitor';
import { createVirtualClock } from '../../contract/clock';
import { createFakeSource } from '../../../providers/fake/source';
import { createEchoWatch, type EchoMonitorLike } from './echoWatch';

function fakeMonitor() {
  const log: string[] = [];
  let hooks!: EchoMonitorHooks;
  let running = false;
  const monitor: EchoMonitorLike = {
    pushMic: () => { log.push('mic'); },
    pushParticipant: () => { log.push('participant'); },
    start: () => { log.push('start'); running = true; },
    stop: () => { log.push('stop'); running = false; },
    get running() { return running; },
  };
  return { monitor, log, hooks: () => hooks, create: (h: EchoMonitorHooks) => { hooks = h; return monitor; } };
}

function tap() {
  const reads: string[] = [];
  return { reads, read: vi.fn(() => { reads.push('read'); return Float32Array.of(0.5); }) };
}

describe('createEchoWatch', () => {
  it("feeds the speaker's capture to the microphone probe and the participant's to the participant probe", () => {
    const fake = fakeMonitor();
    const watch = createEchoWatch(tap(), fake.create);
    const clock = createVirtualClock(0);
    const speaker = createFakeSource(clock, { voiced: true });
    const participant = createFakeSource(clock, { voiced: true });
    watch.attach('speaker', speaker);
    watch.attach('participant', participant);
    clock.advance(100);
    expect(fake.log.filter((e) => e !== 'start')).toEqual(['mic', 'participant']);
  });

  it('starts with the first source, draining the tap first, and stops after the last', () => {
    const fake = fakeMonitor();
    const t = tap();
    const watch = createEchoWatch(t, fake.create);
    const clock = createVirtualClock(0);
    const detachA = watch.attach('speaker', createFakeSource(clock));
    const detachB = watch.attach('participant', createFakeSource(clock));
    expect(t.read).toHaveBeenCalledTimes(1);
    expect(fake.log).toEqual(['start']);
    detachA();
    detachA();
    expect(fake.log).toEqual(['start']);
    detachB();
    expect(fake.log).toEqual(['start', 'stop']);
  });

  it('stops feeding a detached source', () => {
    const fake = fakeMonitor();
    const watch = createEchoWatch(tap(), fake.create);
    const clock = createVirtualClock(0);
    const source = createFakeSource(clock);
    const detach = watch.attach('speaker', source);
    detach();
    clock.advance(300);
    expect(fake.log).not.toContain('mic');
  });

  it('reads the reference from the tts tap', () => {
    const fake = fakeMonitor();
    const t = tap();
    createEchoWatch(t, fake.create);
    expect([...fake.hooks().readPlayedTts()]).toEqual([0.5]);
  });

  it('hands a notice to the one listener, the latest, until it is removed', () => {
    const fake = fakeMonitor();
    const watch = createEchoWatch(tap(), fake.create);
    const first = vi.fn();
    const second = vi.fn();
    watch.onNotice(first);
    watch.onNotice(second);
    const state = { cause: 'tts-echo' as const, lagMs: 120, rho: 0.7 };
    fake.hooks().onChange(state);
    watch.onNotice(null);
    fake.hooks().onChange(null);
    expect(first).not.toHaveBeenCalled();
    expect(second.mock.calls).toEqual([[state]]);
  });

  it('prints the diagnostics line only while diagnostics are on', () => {
    const fake = fakeMonitor();
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const watch = createEchoWatch(tap(), fake.create);
    fake.hooks().onDiagnostic?.('rho=0.1');
    watch.setDiagnostics(true);
    fake.hooks().onDiagnostic?.('rho=0.2');
    expect(info.mock.calls.map(([line]) => line)).toEqual(['[Sokuji] [EchoMonitor] rho=0.2']);
    info.mockRestore();
  });
});
