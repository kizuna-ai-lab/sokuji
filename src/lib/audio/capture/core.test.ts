import { describe, it, expect, vi } from 'vitest';
import { createSourceCore, TRACK_ENDED } from './core';

const reportErrorSpy = vi.hoisted(() => vi.fn());
vi.mock('../../diagnostics/report', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../diagnostics/report')>();
  return { ...actual, reportError: reportErrorSpy };
});

/** A track whose `ended` the test fires, and a stream holding it. */
function fakeStream() {
  const track = new EventTarget() as MediaStreamTrack;
  const stream = { getAudioTracks: () => [track] } as unknown as MediaStream;
  const end = () => track.dispatchEvent(new Event('ended'));
  return { track, stream, end };
}

function setup(o: { muted?: () => boolean } = {}) {
  const release = vi.fn(async () => {});
  const core = createSourceCore({ muted: o.muted ?? (() => false), track: () => undefined, release });
  return { core, release };
}

const chunk = () => new Int16Array(4);

describe('createSourceCore', () => {
  it('hands each chunk to every listener, and stops handing it after unsubscribe', () => {
    const { core } = setup();
    const a = vi.fn();
    const b = vi.fn();
    const offA = core.onPcm(a);
    core.onPcm(b);
    core.deliver(chunk());
    offA();
    core.deliver(chunk());
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
  });

  it('delivers nothing while muted, and resumes when unmuted', () => {
    let muted = true;
    const { core } = setup({ muted: () => muted });
    const heard = vi.fn();
    core.onPcm(heard);
    core.deliver(chunk());
    muted = false;
    core.deliver(chunk());
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('keeps delivering to the others when a listener throws, and reports it once per failing streak', () => {
    const { core } = setup();
    reportErrorSpy.mockClear();
    core.onPcm(() => { throw new Error('sink detached'); });
    const heard = vi.fn();
    core.onPcm(heard);
    core.deliver(chunk());
    core.deliver(chunk());
    expect(heard).toHaveBeenCalledTimes(2);
    expect(reportErrorSpy).toHaveBeenCalledTimes(1);
  });

  it('ends once, from a watched track, and delivers nothing after', () => {
    const { core } = setup();
    const { stream, end } = fakeStream();
    core.watch(stream);
    const ended = vi.fn();
    const heard = vi.fn();
    core.onEnded(ended);
    core.onPcm(heard);
    end();
    end();
    core.end('again');
    core.deliver(chunk());
    expect(ended.mock.calls).toEqual([[TRACK_ENDED]]);
    expect(core.ended).toBe(true);
    expect(heard).not.toHaveBeenCalled();
  });

  it('stops watching a track once unwatched', () => {
    const { core } = setup();
    const { stream, end } = fakeStream();
    const unwatch = core.watch(stream);
    const ended = vi.fn();
    core.onEnded(ended);
    unwatch();
    end();
    expect(ended).not.toHaveBeenCalled();
  });

  it('passes a degradation to its listeners', () => {
    const { core } = setup();
    const heard = vi.fn();
    core.onDegraded(heard);
    core.degrade({ code: 'silent_no_permission', message: 'nothing heard yet' });
    expect(heard).toHaveBeenCalledWith({ code: 'silent_no_permission', message: 'nothing heard yet' });
  });

  it('hands a degradation raised before anyone listened to the first listener only', () => {
    const { core } = setup();
    core.degrade({ code: 'app_capture_monitor_missing', message: 'widened while opening' });
    const first = vi.fn();
    const second = vi.fn();
    core.onDegraded(first);
    core.onDegraded(second);
    expect(first).toHaveBeenCalledWith({ code: 'app_capture_monitor_missing', message: 'widened while opening' });
    expect(second).not.toHaveBeenCalled();
  });

  it('releases once however often it is stopped, and a stopped source never reports an end', async () => {
    const { core, release } = setup();
    const { stream, end } = fakeStream();
    core.watch(stream);
    const ended = vi.fn();
    core.onEnded(ended);
    await Promise.all([core.stop(), core.stop()]);
    await core.stop();
    end();
    core.end('late');
    expect(release).toHaveBeenCalledTimes(1);
    expect(core.stopped).toBe(true);
    expect(ended).not.toHaveBeenCalled();
  });

  it('exposes the current track', () => {
    const { track } = fakeStream();
    let current: MediaStreamTrack | undefined;
    const core = createSourceCore({ muted: () => false, track: () => current, release: async () => {} });
    expect(core.track).toBeUndefined();
    current = track;
    expect(core.track).toBe(track);
  });

  it("reports each listener's own failing streak", () => {
    const { core } = setup();
    reportErrorSpy.mockClear();
    let bFails = false;
    core.onPcm(() => { throw new Error('a broke'); });
    core.onPcm(() => { if (bFails) throw new Error('b broke'); });
    core.deliver(chunk());
    bFails = true;
    core.deliver(chunk());
    core.deliver(chunk());
    expect(reportErrorSpy).toHaveBeenCalledTimes(2);
  });

  it('a listener added during a delivery hears the next chunk, not the current one', () => {
    const { core } = setup();
    const late = vi.fn();
    let added = false;
    core.onPcm(() => {
      if (!added) {
        added = true;
        core.onPcm(late);
      }
    });
    core.deliver(chunk());
    expect(late).not.toHaveBeenCalled();
    core.deliver(chunk());
    expect(late).toHaveBeenCalledTimes(1);
  });

  it('drops a held degradation once the source has ended', () => {
    const { core } = setup();
    core.degrade({ code: 'app_capture_monitor_missing', message: 'widened while opening' });
    core.end('gone');
    const heard = vi.fn();
    core.onDegraded(heard);
    expect(heard).not.toHaveBeenCalled();
  });
});
