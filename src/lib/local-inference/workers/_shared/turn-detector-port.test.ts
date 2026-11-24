/**
 * The detector's leg and the recognizer's inbox over a real MessageChannel, through a stop: the epoch both
 * start at (`INITIAL_EPOCH`) and the first raise (`INITIAL_EPOCH + 1`, what the adapter's first `stop()` sends).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { SegmentInbox, type DecodeTag } from './segment-inbox';
import { DetectorLeg } from './turn-detector-leg';
import { INITIAL_EPOCH, type DetectorNotice, type DetectorOutput, type RecognizerTaken } from './turn-detector-protocol';

const tick = () => new Promise<void>((r) => setTimeout(r, 15));

function rig() {
  const { port1: detectorPort, port2: recognizerPort } = new MessageChannel();
  const notices: DetectorNotice[] = [];
  const leg = new DetectorLeg({
    core: { turns: 'manual', vad: {}, limit: {} },
    post: (msg: DetectorOutput, transfer) => detectorPort.postMessage(msg, transfer),
    notify: (n) => notices.push(n),
  });
  detectorPort.onmessage = (e: MessageEvent<RecognizerTaken>) => leg.taken(e.data);
  const started: DecodeTag[] = [];
  const releases: Array<() => void> = [];
  const inbox = new SegmentInbox(
    recognizerPort,
    (_audio, _start, tag) => new Promise<void>((resolve) => { started.push(tag); releases.push(resolve); }),
    () => {},
    () => {},
  );
  /** One manual press = one segment. */
  const press = async (id: number) => {
    leg.begin(id);
    leg.push(new Int16Array(2400).fill(1000));
    leg.drain();
    await leg.core.idle();
  };
  cleanup = () => { detectorPort.close(); recognizerPort.close(); };
  return { leg, inbox, notices, started, releases, press };
}

let cleanup: (() => void) | undefined;
afterEach(() => { cleanup?.(); cleanup = undefined; });

describe('detector leg and recognizer inbox over a port', () => {
  it('a stop to INITIAL_EPOCH raises nothing: queued segments are still decoded, in the same epoch', async () => {
    const t = rig();
    await t.press(1); await t.press(2); await tick();
    t.leg.stop(INITIAL_EPOCH); t.inbox.stop(INITIAL_EPOCH);
    t.releases[0](); await tick();
    expect(t.started.map((x) => [x.epoch, x.press])).toEqual([[INITIAL_EPOCH, 1], [INITIAL_EPOCH, 2]]);
    t.releases[1](); await tick();
  });

  it('segments cut before the first raise are never decoded after it; those cut after carry INITIAL_EPOCH + 1', async () => {
    const t = rig();
    await t.press(1); await t.press(2); await t.press(3); await tick();
    expect(t.started.map((x) => x.press)).toEqual([1]); // 1 is decoding, 2 and 3 wait
    const next = INITIAL_EPOCH + 1;
    t.leg.stop(next); t.inbox.stop(next);
    await t.press(4); await tick();
    t.releases[0](); await tick(); // the decode in flight finishes; the queued old ones were dropped
    expect(t.started.map((x) => [x.press, x.epoch])).toEqual([[1, INITIAL_EPOCH], [4, next]]);
    t.releases[1](); await tick();
    expect(t.notices).toEqual([]); // the dropped segments were acked, so the detector's decode queue is not full
  });
});
