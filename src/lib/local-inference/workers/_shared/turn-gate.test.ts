import { describe, it, expect } from 'vitest';
import { FrameProcessor, type FrameProcessorOptions } from '@ricky0123/vad-web/dist/frame-processor';
import { Message } from '@ricky0123/vad-web/dist/messages';
import { TurnGate, TurnLink, openTurnLink, type TurnGateOptions, type TurnRequest } from './turn-gate';
import type { TurnPredictRequest } from './turn-protocol';

const FRAME = 512;
const SPEECH = 0.9;
const GRAY = 0.4;
const SILENCE = 0.1;

const gateWith = (over: Partial<TurnGateOptions> = {}) => new TurnGate({
  triggerFrames: 3,
  threshold: 0.5,
  positiveThreshold: 0.5,
  negativeThreshold: 0.35,
  preSpeechPadFrames: 2,
  minSpeechFrames: 1,
  redemptionFrames: 10,
  ...over,
});

/** Feeds frames numbered from 0, each filled with its own number, so a window shows where it starts. */
function feeder(gate: TurnGate) {
  let n = 0;
  const feed = (count: number, probability: number, speaking: boolean): TurnRequest[] => {
    const requests: TurnRequest[] = [];
    for (let i = 0; i < count; i++) {
      const request = gate.push(new Float32Array(FRAME).fill(n++), probability, speaking);
      if (request) requests.push(request);
    }
    return requests;
  };
  return {
    idle: (count = 1) => feed(count, SILENCE, false),
    loudIdle: (count = 1) => feed(count, SPEECH, false),
    speech: (count = 1) => feed(count, SPEECH, true),
    gray: (count = 1) => feed(count, GRAY, true),
    silence: (count = 1) => feed(count, SILENCE, true),
  };
}

describe('TurnGate — when it asks', () => {
  it('asks at the trigger frame of silence after speech, once per run', () => {
    const f = feeder(gateWith());
    f.idle(2);
    f.speech(4);
    expect(f.silence(2)).toEqual([]);
    expect(f.silence(1)).toHaveLength(1);
    expect(f.silence(20)).toEqual([]);
  });

  it('never asks while the processor is not speaking', () => {
    const f = feeder(gateWith());
    expect(f.loudIdle(5)).toEqual([]);
    expect(f.idle(50)).toEqual([]);
  });

  it('restarts the run on a frame between the thresholds', () => {
    const f = feeder(gateWith());
    f.speech();
    f.silence(2);
    f.gray();
    expect(f.silence(2)).toEqual([]);
    expect(f.silence(1)).toHaveLength(1);
  });

  it('asks again after speech returns, with a newer id', () => {
    const f = feeder(gateWith());
    f.speech();
    const [first] = f.silence(3);
    f.speech();
    const [second] = f.silence(3);
    expect(second.id).toBeGreaterThan(first.id);
  });
});

describe('TurnGate — the minimum speech', () => {
  it('asks nothing until the segment holds the minimum speech', () => {
    const f = feeder(gateWith({ minSpeechFrames: 5 }));
    f.speech(4);
    expect(f.silence(10)).toEqual([]);
  });

  it('asks once the speech reaches it', () => {
    const f = feeder(gateWith({ minSpeechFrames: 5 }));
    f.speech(5);
    expect(f.silence(3)).toHaveLength(1);
  });

  it('counts speech across the pauses of one segment', () => {
    const f = feeder(gateWith({ minSpeechFrames: 5 }));
    f.speech(3);
    expect(f.silence(3)).toEqual([]);
    f.speech(2);
    expect(f.silence(3)).toHaveLength(1);
  });

  it('starts the count over with each segment', () => {
    const gate = gateWith({ minSpeechFrames: 5 });
    const f = feeder(gate);
    f.speech(4);
    f.idle();
    f.speech(2);
    expect(f.silence(3)).toEqual([]);
    gate.reset();
    f.speech(3);
    expect(f.silence(3)).toEqual([]);
  });
});

describe('TurnGate — which answer ends the segment', () => {
  function asked() {
    const gate = gateWith();
    const f = feeder(gate);
    f.speech();
    const [request] = f.silence(3);
    return { gate, f, request };
  }

  it('the latest request, above the threshold', () => {
    const { gate, request } = asked();
    expect(gate.shouldEnd(request.id, 0.5)).toBe(false);
    expect(gate.shouldEnd(request.id, 0.51)).toBe(true);
  });

  it('not a stale one', () => {
    const { gate, f, request } = asked();
    f.speech();
    const [latest] = f.silence(3);
    expect(gate.shouldEnd(request.id, 0.9)).toBe(false);
    expect(gate.shouldEnd(latest.id, 0.9)).toBe(true);
  });

  it('not once speech came back', () => {
    const { gate, f, request } = asked();
    f.speech();
    expect(gate.shouldEnd(request.id, 0.9)).toBe(false);
  });

  it('still after a frame between the thresholds', () => {
    const { gate, f, request } = asked();
    f.gray();
    expect(gate.shouldEnd(request.id, 0.9)).toBe(true);
  });

  it('not after the processor ended the segment', () => {
    const { gate, f, request } = asked();
    f.idle();
    expect(gate.shouldEnd(request.id, 0.9)).toBe(false);
  });

  it('not after the worker ended it', () => {
    const { gate, request } = asked();
    gate.reset();
    expect(gate.shouldEnd(request.id, 0.9)).toBe(false);
  });
});

describe('TurnGate — the window', () => {
  it('starts at speech start minus the pre-speech pad', () => {
    const f = feeder(gateWith());
    f.idle(3);
    f.speech(2);
    const [request] = f.silence(3);
    expect(request.window).toHaveLength((2 + 2 + 3) * FRAME);
    expect(request.window[0]).toBe(1);
    expect(request.window[request.window.length - 1]).toBe(7);
  });

  it('takes only the pad there is', () => {
    const f = feeder(gateWith());
    f.idle(1);
    f.speech(1);
    const [request] = f.silence(3);
    expect(request.window).toHaveLength(5 * FRAME);
    expect(request.window[0]).toBe(0);
  });

  it('has no pad right after the processor ended a segment', () => {
    const f = feeder(gateWith());
    f.speech(1);
    f.idle(1);
    f.speech(1);
    const [request] = f.silence(3);
    expect(request.window[0]).toBe(2);
    expect(request.window).toHaveLength(4 * FRAME);
  });

  it('has no pad right after the worker ended one', () => {
    const gate = gateWith();
    const f = feeder(gate);
    f.speech(1);
    f.silence(1);
    gate.reset();
    f.speech(1);
    const [request] = f.silence(3);
    expect(request.window[0]).toBe(2);
  });

  it('keeps the last 8 s of a longer segment', () => {
    const f = feeder(gateWith());
    f.speech(300);
    const [request] = f.silence(3);
    expect(request.window).toHaveLength(128_000);
    expect(request.window[0]).toBe(53);
    expect(request.window[request.window.length - 1]).toBe(302);
  });
});

class FakePort {
  sent: Array<{ message: TurnPredictRequest; transfer: Transferable[] }> = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  closed = false;
  postMessage(message: TurnPredictRequest, transfer: Transferable[]) { this.sent.push({ message, transfer }); }
  close() { this.closed = true; }
  answer(data: unknown) { this.onmessage?.({ data } as MessageEvent); }
}

const frame = () => new Float32Array(FRAME);

describe('TurnLink', () => {
  function asking() {
    const port = new FakePort();
    const link = new TurnLink(port as unknown as MessagePort, gateWith());
    link.afterFrame(frame(), SPEECH, true);
    for (let i = 0; i < 3; i++) link.afterFrame(frame(), SILENCE, true);
    return { port, link, request: port.sent[0].message };
  }

  it('posts the request with its window transferred', () => {
    const { port, request } = asking();
    expect(port.sent).toHaveLength(1);
    expect(request.type).toBe('predict');
    expect(port.sent[0].transfer).toHaveLength(1);
    expect(port.sent[0].transfer[0]).toBe(request.window.buffer);
  });

  it('ends the segment on the frame after a yes, once, returning that probability', () => {
    const { port, link, request } = asking();
    port.answer({ id: request.id, probability: 0.9 });
    expect(link.afterFrame(frame(), SILENCE, true)).toBe(0.9);
    port.answer({ id: request.id, probability: 0.9 });
    expect(link.afterFrame(frame(), SILENCE, true)).toBeNull();
  });

  it('changes nothing on a no or a failed prediction', () => {
    const { port, link, request } = asking();
    port.answer({ id: request.id, probability: 0.2 });
    expect(link.afterFrame(frame(), SILENCE, true)).toBeNull();
    port.answer({ id: request.id, error: 'bad input' });
    expect(link.afterFrame(frame(), SILENCE, true)).toBeNull();
  });

  it('drops an answer that arrived before the worker ended the segment itself', () => {
    const { port, link, request } = asking();
    port.answer({ id: request.id, probability: 0.9 });
    link.reset();
    expect(link.afterFrame(frame(), SILENCE, true)).toBeNull();
  });

  it('asks nothing after speech under the minimum, so a "complete" answer cannot end it', () => {
    const port = new FakePort();
    const link = new TurnLink(port as unknown as MessagePort, gateWith({ minSpeechFrames: 5 }));
    for (let i = 0; i < 4; i++) link.afterFrame(frame(), SPEECH, true);
    for (let i = 0; i < 10; i++) link.afterFrame(frame(), SILENCE, true);
    expect(port.sent).toHaveLength(0);
    port.answer({ id: 1, probability: 0.99 });
    expect(link.afterFrame(frame(), SILENCE, true)).toBeNull();
  });

  it('asks once the speech reached the minimum, and a "complete" answer ends it', () => {
    const port = new FakePort();
    const link = new TurnLink(port as unknown as MessagePort, gateWith({ minSpeechFrames: 5 }));
    for (let i = 0; i < 5; i++) link.afterFrame(frame(), SPEECH, true);
    for (let i = 0; i < 3; i++) link.afterFrame(frame(), SILENCE, true);
    expect(port.sent).toHaveLength(1);
    port.answer({ id: port.sent[0].message.id, probability: 0.99 });
    expect(link.afterFrame(frame(), SILENCE, true)).toBe(0.99);
  });

  it('stops listening and closes the port', () => {
    const { port, link } = asking();
    link.close();
    expect(port.closed).toBe(true);
    expect(port.onmessage).toBeNull();
  });
});

// Normal would have kept a reply that starts within Max Wait of the last
// speech, as part of that segment; after a Smart end it is its own segment, and
// one too short for the processor would be dropped as a misfire.
describe('TurnLink — a short reply after a Smart end', () => {
  /** Ends a segment by Smart with 4 frames of silence counted: Normal (10) would wait 6 more. */
  function endedBySmart() {
    const port = new FakePort();
    const link = new TurnLink(port as unknown as MessagePort, gateWith({ minSpeechFrames: 3 }));
    for (let i = 0; i < 3; i++) link.afterFrame(frame(), SPEECH, true);
    for (let i = 0; i < 3; i++) link.afterFrame(frame(), SILENCE, true);
    port.answer({ id: port.sent[0].message.id, probability: 0.9 });
    expect(link.afterFrame(frame(), SILENCE, true)).toBe(0.9);
    return link;
  }

  it('hands back a reply that starts before Normal would have ended the segment', () => {
    const link = endedBySmart();
    for (let i = 0; i < 5; i++) link.afterFrame(frame(), SILENCE, false);
    link.afterFrame(frame(), SPEECH, true);
    link.afterFrame(frame(), SILENCE, true);
    expect(link.rescue()).toHaveLength((2 + 1 + 1) * FRAME);
  });

  it('hands back nothing once Normal would have ended the segment', () => {
    const link = endedBySmart();
    for (let i = 0; i < 6; i++) link.afterFrame(frame(), SILENCE, false);
    link.afterFrame(frame(), SPEECH, true);
    expect(link.rescue()).toBeNull();
  });

  it('counts only the frames Normal counts: those under the silence threshold', () => {
    const link = endedBySmart();
    for (let i = 0; i < 20; i++) link.afterFrame(frame(), GRAY, false);
    link.afterFrame(frame(), SPEECH, true);
    expect(link.rescue()).not.toBeNull();
  });

  it('hands it back once', () => {
    const link = endedBySmart();
    link.afterFrame(frame(), SPEECH, true);
    expect(link.rescue()).not.toBeNull();
    expect(link.rescue()).toBeNull();
  });

  it('hands back nothing after a segment the processor ended itself', () => {
    const link = new TurnLink(new FakePort() as unknown as MessagePort, gateWith({ minSpeechFrames: 3 }));
    for (let i = 0; i < 3; i++) link.afterFrame(frame(), SPEECH, true);
    for (let i = 0; i < 10; i++) link.afterFrame(frame(), SILENCE, true);
    link.afterFrame(frame(), SILENCE, false);
    link.afterFrame(frame(), SPEECH, true);
    expect(link.rescue()).toBeNull();
  });

  it('hands back nothing after the worker ended the segment itself', () => {
    const link = endedBySmart();
    link.reset();
    link.afterFrame(frame(), SPEECH, true);
    expect(link.rescue()).toBeNull();
  });

  describe('against the real FrameProcessor', () => {
    /**
     * Drives frames the way a vad-web worker does: process(), then afterFrame(),
     * endSegment() on a Smart end, rescue() on a misfire. Every request is
     * answered "complete" before the next frame.
     */
    async function drive(probs: number[]) {
      const port = new FakePort();
      let i = 0;
      const processor = new FrameProcessor(
        async () => ({ isSpeech: probs[i], notSpeech: 1 - probs[i] }),
        () => {},
        { positiveSpeechThreshold: 0.5, negativeSpeechThreshold: 0.35, redemptionMs: 320, minSpeechMs: 96, preSpeechPadMs: 64, submitUserSpeechOnPause: false },
        32,
      );
      processor.resume();
      const link = openTurnLink(port as unknown as MessagePort, { smartTurn: { checkAfter: 0.1, threshold: 0.5 } }, processor)!;
      const seen: string[] = [];
      let answered = 0;
      for (i = 0; i < probs.length; i++) {
        const f = frame();
        let probability = 0;
        await processor.process(f, (ev) => {
          if (ev.msg === Message.FrameProcessed) probability = ev.probs.isSpeech;
          if (ev.msg === Message.SpeechEnd) seen.push('end');
          if (ev.msg === Message.VADMisfire) seen.push(link.rescue() ? 'misfire kept' : 'misfire dropped');
        });
        if (link.afterFrame(f, probability, processor.speaking)) {
          processor.endSegment(() => {});
          seen.push('smart end');
        }
        for (; answered < port.sent.length; answered++) port.answer({ id: port.sent[answered].message.id, probability: 0.9 });
      }
      return seen;
    }

    // Smart ends the sentence on its 5th quiet frame; the processor's redemption is 10.
    const sentence = [...Array(5).fill(SPEECH), ...Array(5).fill(SILENCE)];
    const reply = [SPEECH, SPEECH, ...Array(12).fill(SILENCE)];
    const quiet = (n: number) => Array(n).fill(SILENCE);

    async function underNormal(probs: number[]) {
      const normal = new FrameProcessor(
        async () => ({ isSpeech: 0, notSpeech: 1 }),
        () => {},
        { positiveSpeechThreshold: 0.5, negativeSpeechThreshold: 0.35, redemptionMs: 320, minSpeechMs: 96, preSpeechPadMs: 64, submitUserSpeechOnPause: false },
        32,
      );
      let i = 0;
      normal.modelProcessFunc = async () => ({ isSpeech: probs[i], notSpeech: 1 - probs[i] });
      normal.resume();
      const seen: string[] = [];
      for (i = 0; i < probs.length; i++) {
        await normal.process(frame(), (ev) => {
          if (ev.msg === Message.SpeechEnd) seen.push('end');
          if (ev.msg === Message.VADMisfire) seen.push('misfire');
        });
      }
      return seen;
    }

    it('keeps a reply that starts on the last frame Normal would still have waited', async () => {
      expect(await underNormal([...sentence, ...quiet(4), ...reply])).toEqual(['end']);
      expect(await drive([...sentence, ...quiet(4), ...reply])).toEqual(['smart end', 'misfire kept']);
    });

    it('drops it as before from the frame Normal would have ended the sentence', async () => {
      expect(await underNormal([...sentence, ...quiet(5), ...reply])).toEqual(['end', 'misfire']);
      expect(await drive([...sentence, ...quiet(5), ...reply])).toEqual(['smart end', 'misfire dropped']);
    });
  });
});

describe('openTurnLink', () => {
  const smart = { checkAfter: 0.3, threshold: 0.5 };
  const processor = (over: Partial<FrameProcessorOptions> = {}) => new FrameProcessor(
    async () => ({ isSpeech: 0, notSpeech: 1 }),
    () => {},
    {
      positiveSpeechThreshold: 0.5,
      negativeSpeechThreshold: 0.35,
      redemptionMs: 1400,
      minSpeechMs: 32,
      preSpeechPadMs: 800,
      submitUserSpeechOnPause: false,
      ...over,
    },
    32,
  );
  const open = (port: FakePort, checkAfter: number, over: Partial<FrameProcessorOptions> = {}) =>
    openTurnLink(port as unknown as MessagePort, { smartTurn: { checkAfter, threshold: 0.5 } }, processor(over))!;

  it('needs a port, Smart Turn in the VAD config, and the processor', () => {
    expect(openTurnLink(undefined, { smartTurn: smart }, processor())).toBeNull();
    expect(openTurnLink(new FakePort() as unknown as MessagePort, { threshold: 0.3 }, processor())).toBeNull();
    expect(openTurnLink(new FakePort() as unknown as MessagePort, { smartTurn: smart }, null)).toBeNull();
  });

  it('asks after ceil(checkAfter / 32 ms) frames of silence', () => {
    const port = new FakePort();
    const link = open(port, 0.3);
    link.afterFrame(frame(), SPEECH, true);
    for (let i = 0; i < 9; i++) link.afterFrame(frame(), SILENCE, true);
    expect(port.sent).toHaveLength(0);
    link.afterFrame(frame(), SILENCE, true);
    expect(port.sent).toHaveLength(1);
  });

  it("takes the silence threshold from the processor", () => {
    const port = new FakePort();
    const link = open(port, 0.1, { negativeSpeechThreshold: 0.2 });
    link.afterFrame(frame(), SPEECH, true);
    for (let i = 0; i < 4; i++) link.afterFrame(frame(), 0.25, true);
    expect(port.sent).toHaveLength(0);
    for (let i = 0; i < 4; i++) link.afterFrame(frame(), SILENCE, true);
    expect(port.sent).toHaveLength(1);
  });

  it('pads the window as the processor does', () => {
    const port = new FakePort();
    const link = open(port, 0.1, { preSpeechPadMs: 64 });
    for (let i = 0; i < 5; i++) link.afterFrame(frame(), SILENCE, false);
    link.afterFrame(frame(), SPEECH, true);
    for (let i = 0; i < 4; i++) link.afterFrame(frame(), SILENCE, true);
    expect(port.sent[0].message.window).toHaveLength((2 + 1 + 4) * FRAME);
  });

  it("waits for the processor's minimum speech", () => {
    const port = new FakePort();
    const link = open(port, 0.1, { minSpeechMs: 160 });
    for (let i = 0; i < 4; i++) link.afterFrame(frame(), SPEECH, true);
    for (let i = 0; i < 4; i++) link.afterFrame(frame(), SILENCE, true);
    expect(port.sent).toHaveLength(0);
    link.afterFrame(frame(), SPEECH, true);
    for (let i = 0; i < 4; i++) link.afterFrame(frame(), SILENCE, true);
    expect(port.sent).toHaveLength(1);
  });

  it("takes Normal's wait from the processor's redemption", () => {
    // Smart ends after 5 quiet frames; then one more quiet frame and a reply.
    const replyAfterSmartEnd = (redemptionMs: number) => {
      const port = new FakePort();
      const link = open(port, 0.1, { redemptionMs });
      link.afterFrame(frame(), SPEECH, true);
      for (let i = 0; i < 4; i++) link.afterFrame(frame(), SILENCE, true);
      port.answer({ id: port.sent[0].message.id, probability: 0.9 });
      expect(link.afterFrame(frame(), SILENCE, true)).toBe(0.9);
      link.afterFrame(frame(), SILENCE, false);
      link.afterFrame(frame(), SPEECH, true);
      return link.rescue();
    };
    expect(replyAfterSmartEnd(192)).toBeNull();
    expect(replyAfterSmartEnd(1400)).not.toBeNull();
  });
});
