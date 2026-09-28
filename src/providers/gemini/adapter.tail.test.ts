/**
 * Live Translate under push-to-talk (Gemini/AST2 follow-up, ruling 4): a
 * release keeps its press's activity open and sends real-time silence
 * until the model has been quiet, then `activityEnd`. The owner's probe
 * showed why: the model runs about a second behind its input, and with
 * nothing sent between presses the last words of a press waited for the
 * next one. On `FakeSocket` and a virtual clock.
 */
import { describe, it, expect } from 'vitest';
import { flush } from '../../lib/contract/testing/drive';
import { FRAME_SAMPLES } from './tail';
import { AUTO_CTX, DIALOGUE, liveGemini, SERVER, TRANSLATE } from './testing';
import { base64ToPcm } from './wire';

const MANUAL = { ...AUTO_CTX, turns: 'manual' as const };
/** A capture chunk: 2 048 samples of 24 kHz voice. */
const chunk = () => new Int16Array(2_048).fill(1_000);

type Sent = { setup?: unknown; realtimeInput?: { audio?: { data: string }; activityStart?: object; activityEnd?: object; text?: string } };

/** What went up, by kind: `silence` for a tail frame, `audio` for anything else. */
function kinds(sent: Sent[]): string[] {
  return sent.map((f) => {
    if (f.setup) return 'setup';
    const input = f.realtimeInput!;
    if (input.audio) {
      const pcm = base64ToPcm(input.audio.data);
      return pcm.length === FRAME_SAMPLES && pcm.every((s) => s === 0) ? 'silence' : 'audio';
    }
    return Object.keys(input)[0];
  });
}
const times = (n: number, kind: string) => new Array<string>(n).fill(kind);

describe('Live Translate: the release tail (Gemini/AST2 follow-up, ruling 4)', () => {
  it("keeps the press's activity open through real-time silence until the model has been quiet 1 s, then ends it (Gemini/AST2 follow-up, choices 11, 12)", async () => {
    const h = await liveGemini({ model: TRANSLATE, context: MANUAL });
    h.session.beginTurn();
    h.session.appendAudio(chunk());
    h.session.endTurn();
    expect(kinds(h.sent() as Sent[])).toEqual(['setup', 'activityStart', 'audio']);
    expect(h.frames('turn.tail')).toEqual([undefined]);
    // The probe: the press's last words, transcribed about a second after the release, then translated.
    h.clock.advance(900);
    h.socket().receive(SERVER.input('します。'));
    h.clock.advance(400);
    h.socket().receive(SERVER.output(' here to help.'));
    h.clock.advance(1_000);
    expect(kinds(h.sent() as Sent[]).slice(-1)).toEqual(['silence']);
    expect(h.frames('turn.tail_end')).toEqual([]);
    h.clock.advance(100);
    expect(kinds(h.sent() as Sent[])).toEqual(['setup', 'activityStart', 'audio', ...times(23, 'silence'), 'activityEnd']);
    expect(h.frames('turn.tail_end')).toEqual([{ reason: 'quiet', silenceMs: 2_300, lastOutputMs: 1_300 }]);
    expect(h.frames('realtime_input.activity_end')).toEqual([undefined]);
    // Nothing more goes up; once the segments' own silence timers have run, no timer is left.
    h.clock.advance(5_000);
    expect(h.sent()).toHaveLength(27);
    expect(h.timers()).toBe(0);
  });

  it('stops at 3 s after the release, and ends the activity then', async () => {
    const h = await liveGemini({ model: TRANSLATE, context: MANUAL });
    h.session.beginTurn();
    h.session.endTurn();
    for (let at = 250; at <= 4_000; at += 250) {
      h.clock.advance(250);
      h.socket().receive(SERVER.output(' more'));
    }
    expect(h.frames('turn.tail_end')).toEqual([{ reason: 'cap', silenceMs: 3_000, lastOutputMs: 3_000 }]);
    expect(kinds(h.sent() as Sent[]).filter((k) => k === 'activityEnd')).toHaveLength(1);
  });

  it("a press during the tail ends it: the last press's activityEnd, then the new activityStart", async () => {
    const h = await liveGemini({ model: TRANSLATE, context: MANUAL });
    h.session.beginTurn();
    h.session.endTurn();
    h.clock.advance(300);
    h.session.beginTurn();
    expect(kinds(h.sent() as Sent[])).toEqual(['setup', 'activityStart', ...times(3, 'silence'), 'activityEnd', 'activityStart']);
    expect(h.frames('turn.tail_end')).toEqual([{ reason: 'press', silenceMs: 300, lastOutputMs: null }]);
    h.clock.advance(5_000);
    expect(kinds(h.sent() as Sent[])).toHaveLength(7);
  });

  it("a cancel runs the same tail, framed cancelled, and its activityEnd says so", async () => {
    const h = await liveGemini({ model: TRANSLATE, context: MANUAL });
    h.session.beginTurn();
    h.session.cancelTurn();
    h.clock.advance(1_100);
    expect(h.frames('turn.tail')).toEqual([{ cancelled: true }]);
    expect(h.frames('turn.tail_end')).toEqual([{ reason: 'quiet', silenceMs: 1_000, lastOutputMs: null, cancelled: true }]);
    expect(h.frames('realtime_input.activity_end')).toEqual([{ cancelled: true }]);
  });

  it("typed text during the tail ends it first, so the text's own activity marks never nest in the press's", async () => {
    const h = await liveGemini({ model: TRANSLATE, context: MANUAL });
    h.session.beginTurn();
    h.session.endTurn();
    h.clock.advance(200);
    h.session.appendText('hello');
    expect(kinds(h.sent() as Sent[])).toEqual(['setup', 'activityStart', 'silence', 'silence', 'activityEnd', 'activityStart', 'text', 'activityEnd']);
    expect(h.frames('turn.tail_end')).toEqual([{ reason: 'text', silenceMs: 200, lastOutputMs: null }]);
  });

  it('stop during the tail sends nothing more, says nothing, and leaves no timer', async () => {
    const h = await liveGemini({ model: TRANSLATE, context: MANUAL });
    h.session.beginTurn();
    h.session.endTurn();
    h.clock.advance(200);
    const sent = h.sent().length;
    await h.session.stop();
    h.clock.advance(5_000);
    expect(h.socket().sent).toHaveLength(sent);
    expect(h.frames('turn.tail_end')).toEqual([]);
    expect(h.timers()).toBe(0);
  });

  it('a lost connection during the tail drops it silently: the new connection is sent no activityEnd', async () => {
    const h = await liveGemini({ model: TRANSLATE, context: MANUAL });
    h.session.beginTurn();
    h.session.endTurn();
    h.clock.advance(200);
    h.socket().serverClose(1011, 'Internal error');
    await flush();
    h.socket().open();
    h.socket().receive(SERVER.setupComplete());
    await flush();
    h.clock.advance(5_000);
    expect(kinds(h.socket().sentJson<Sent>())).toEqual(['setup']);
    expect(h.frames('turn.tail_end')).toEqual([]);
    expect(h.timers()).toBe(0);
  });

  it('a dialogue model sends its activityEnd at once: its turn is answered whole, no tail (Gemini/AST2 follow-up, choice 13)', async () => {
    const h = await liveGemini({ model: DIALOGUE, context: MANUAL });
    h.session.beginTurn();
    h.session.appendAudio(chunk());
    h.session.endTurn();
    expect(kinds(h.sent() as Sent[])).toEqual(['setup', 'activityStart', 'audio', 'activityEnd']);
    h.clock.advance(5_000);
    expect(h.sent()).toHaveLength(4);
    expect(h.frames('turn.tail')).toEqual([]);
  });

  it('automatic turns never tail: the keys send nothing', async () => {
    const h = await liveGemini({ model: TRANSLATE });
    h.session.beginTurn();
    h.session.endTurn();
    h.clock.advance(5_000);
    expect(kinds(h.sent() as Sent[])).toEqual(['setup']);
    expect(h.timers()).toBe(0);
  });
});
