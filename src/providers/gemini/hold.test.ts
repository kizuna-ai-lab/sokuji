import { describe, it, expect } from 'vitest';
import { trackedClock } from '../../lib/contract/testing/trackedClock';
import {
  GATE_FRAME_MS,
  GATE_PEAK_DIVISOR,
  HOLD_CARRY_MS,
  HOLD_IDLE_MS,
  HOLD_MARGIN_MS,
  InputHold,
  SPLIT_END_MS,
  SPLIT_PAUSE_FLOOR_MS,
  SPLIT_PAUSE_MARGIN_MS,
  splitPauseMs,
  type HoldCause,
  type HoldSummary,
} from './hold';

/** A hold: under automatic turns, at the default end-of-speech silence, every probe session's, unless one is given. */
function hold(o: { manual?: boolean; silenceMs?: number } = {}) {
  const { clock, timers } = trackedClock();
  const sent: Int16Array[] = [];
  const began: HoldCause[] = [];
  const ended: HoldSummary[] = [];
  /** Every callback and held send, in the order they ran. */
  const log: string[] = [];
  const h = new InputHold({
    clock,
    ...(o.manual ? { manual: true as const } : { manual: false as const, silenceMs: o.silenceMs ?? 500 }),
    send: (pcm) => { sent.push(pcm); log.push(`audio ${Array.from(pcm.subarray(0, 4)).join(',')} ×${pcm.length}`); },
    began: (cause) => { began.push(cause); log.push(`began ${cause}`); },
    ended: (s) => { ended.push(s); log.push(`ended ${s.reason}`); },
  });
  /** A held send that logs its name when it runs. */
  const action = (name: string, then?: () => void) => h.defer(() => { log.push(name); then?.(); });
  return { h, clock, timers, sent, began, ended, log, action };
}
/** `n` samples of 24 kHz pcm, each `fill`: 2 400 are 100 ms. */
const pcm = (n: number, fill = 1) => new Int16Array(n).fill(fill);
/** `ms` of 24 kHz audio at one level: speech at 1 000 by default. */
const tone = (ms: number, level = 1_000) => pcm((ms * 24_000) / 1000, level);
/** `ms` of silence. */
const hush = (ms: number) => tone(ms, 0);

describe("a 3.x dialogue model's input hold (Gemini hold, ruling 1)", () => {
  it('lets go 2 s past the computed playback end, and 10 s after its begin while no model audio has come (ruling 3); carries at most 5 s of a reconnect gap\'s audio under automatic turns (choice 10); lets one utterance go at a time — up to a pause 100 ms past the session\'s silence and at least 200 ms, waiting at least 2 s for its close — found by 10 ms frames 20 dB under the loudest (choices 14, 15)', () => {
    expect([HOLD_MARGIN_MS, HOLD_IDLE_MS, HOLD_CARRY_MS]).toEqual([2_000, 10_000, 5_000]);
    expect([SPLIT_PAUSE_MARGIN_MS, SPLIT_PAUSE_FLOOR_MS, SPLIT_END_MS, GATE_FRAME_MS, GATE_PEAK_DIVISOR]).toEqual([100, 200, 2_000, 10, 10]);
  });

  it("begins at the server's ACTIVITY_END, holds what comes, and lets it go at turnComplete — the audio as one frame — saying what it held (choices 2, 4, 5)", () => {
    const { h, clock, timers, sent, began, ended, log, action } = hold();
    h.voiceActivity('ACTIVITY_START');
    h.voiceActivity('ACTIVITY_END');
    expect(began).toEqual(['voice_activity']);
    expect(h.holding).toBe(true);
    h.audio(pcm(2_400, 1));
    clock.advance(300);
    h.output(2_000);
    h.audio(pcm(2_400, 2));
    action('a held send');
    clock.advance(2_000);
    expect(sent).toEqual([]);
    h.turnComplete();
    expect(log).toEqual(['began voice_activity', 'ended turn_complete', 'audio 1,1,1,1 ×4800', 'a held send']);
    expect(Array.from(sent[0].subarray(2_398, 2_402))).toEqual([1, 1, 2, 2]);
    expect(ended).toEqual([{ reason: 'turn_complete', heldMs: 2_300, audioMs: 200, actions: 1, withdrawn: 0, playbackEndMs: 2_300 }]);
    expect(h.holding).toBe(false);
    expect(timers()).toBe(0);
  });

  it('keeps the order: each unbroken run of audio one frame, each held send in its place (choice 5)', () => {
    const { h, log, action } = hold();
    h.begin('voice_activity');
    h.audio(pcm(2, 1));
    action('A');
    h.audio(pcm(2, 2));
    h.audio(pcm(2, 3));
    action('B');
    h.turnComplete();
    expect(log).toEqual(['began voice_activity', 'ended turn_complete', 'audio 1,1 ×2', 'A', 'audio 2,2,3,3 ×4', 'B']);
  });

  it('a held send that begins a new hold stops the release there: what follows it stays held until that hold lets go (choice 5)', () => {
    const { h, log, action, ended } = hold({ manual: true });
    h.begin('activity_end');
    action('press 2 starts');
    h.audio(pcm(2, 2));
    action('press 2 ends', () => h.begin('activity_end'));
    action('press 3 starts');
    h.audio(pcm(2, 3));
    h.turnComplete();
    expect(log).toEqual(['began activity_end', 'ended turn_complete', 'press 2 starts', 'audio 2,2 ×2', 'press 2 ends', 'began activity_end']);
    expect(h.holding).toBe(true);
    h.turnComplete();
    expect(log.slice(6)).toEqual(['ended turn_complete', 'press 3 starts', 'audio 3,3 ×2']);
    // Each hold says what it held when it let go: the first, all of it; the second, what the first's release left.
    expect(ended.map((s) => s.actions)).toEqual([3, 1]);
  });

  it("falls back to a model turn's first model output when no ACTIVITY_END came — or its first input transcription, on a session that has heard no voice activity — never while the server says the user is speaking (choice 2)", () => {
    const input = hold();
    input.h.input();
    expect(input.began).toEqual(['input_transcription']);

    const output = hold();
    output.h.output();
    expect(output.began).toEqual(['model_output']);

    const speaking = hold();
    speaking.h.voiceActivity('ACTIVITY_START');
    // 3.8 transcribes the turn just before its ACTIVITY_END, with the activity still open (the owner's probe).
    speaking.h.input();
    speaking.h.output(100);
    expect(speaking.began).toEqual([]);
    speaking.h.voiceActivity('ACTIVITY_END');
    expect(speaking.began).toEqual(['voice_activity']);

    // A transcription that comes after its own turnComplete, on a session that has heard voice activity: no turn close.
    const heard = hold();
    heard.h.voiceActivity('ACTIVITY_START');
    heard.h.voiceActivity('ACTIVITY_END');
    heard.h.turnComplete();
    heard.h.input();
    expect(heard.began).toEqual(['voice_activity']);
    expect(heard.h.holding).toBe(false);
    // Its answer's output still is (a typed text's, say).
    heard.h.output();
    expect(heard.began).toEqual(['voice_activity', 'model_output']);
  });

  it('a fallback begins one hold per model turn: once a hold has begun in it, the turn\'s later output begins none, even after a cap; ACTIVITY_END always does (choice 2)', () => {
    const { h, clock, began, ended } = hold();
    h.output(100);
    clock.advance(100 + HOLD_MARGIN_MS);
    expect(ended.map((s) => s.reason)).toEqual(['cap']);
    h.output(100);
    h.input();
    expect(began).toEqual(['model_output']);
    // The user speaks again inside the same model turn: the server's close still begins a hold.
    h.voiceActivity('ACTIVITY_START');
    h.voiceActivity('ACTIVITY_END');
    expect(began).toEqual(['model_output', 'voice_activity']);
    h.turnComplete();
    // A new model turn: its first output begins one again.
    h.output(100);
    expect(began).toEqual(['model_output', 'voice_activity', 'model_output']);
  });

  it("under manual turns the server's signals begin nothing: the leg's own activityEnd does (choice 3)", () => {
    const { h, began } = hold({ manual: true });
    h.voiceActivity('ACTIVITY_START');
    h.voiceActivity('ACTIVITY_END');
    h.input();
    h.output(100);
    expect(began).toEqual([]);
    h.begin('activity_end');
    expect(began).toEqual(['activity_end']);
  });

  it('begins one hold at a time: a second begin is the same hold, one timer', () => {
    const { h, began, timers } = hold();
    h.begin('voice_activity');
    h.begin('activity_end');
    h.voiceActivity('ACTIVITY_END');
    expect(began).toEqual(['voice_activity']);
    expect(timers()).toBe(1);
  });

  it('interrupted lets nothing go: the turnComplete that trails it does (choice 4)', () => {
    const { h, sent, ended } = hold();
    h.begin('voice_activity');
    h.audio(pcm(2));
    h.interrupted();
    expect(h.holding).toBe(true);
    expect(sent).toEqual([]);
    h.turnComplete();
    expect(ended.map((s) => s.reason)).toEqual(['turn_complete']);
    expect(sent).toHaveLength(1);
  });

  it('waitingForInput lets go at once: the model waits for the user (choice 4)', () => {
    const { h, sent, ended } = hold();
    h.waitingForInput();
    expect(ended).toEqual([]);
    h.begin('voice_activity');
    h.audio(pcm(2));
    h.waitingForInput();
    expect(ended.map((s) => s.reason)).toEqual(['waiting_for_input']);
    expect(sent).toHaveLength(1);
  });

  it('turnComplete with nothing held says nothing and sends nothing', () => {
    const { h, sent, ended, timers } = hold();
    h.turnComplete();
    expect([sent, ended]).toEqual([[], []]);
    expect(timers()).toBe(0);
  });

  it('holds a copy: the capture may reuse its buffer', () => {
    const { h, sent } = hold();
    h.begin('voice_activity');
    const buffer = pcm(3, 7);
    h.audio(buffer);
    buffer.fill(0);
    h.turnComplete();
    expect(Array.from(sent[0])).toEqual([7, 7, 7]);
  });

  describe('the cap (choice 6)', () => {
    /** The model's answer: `chunks` parts of `ms` each, the first `lead` ms after the begin, then one every `every` ms — faster than real time, as every probe turn was. */
    function answer(t: ReturnType<typeof hold>, o: { lead: number; chunks: number; ms: number; every: number }) {
      t.clock.advance(o.lead);
      for (let i = 0; i < o.chunks; i++) {
        if (i > 0) t.clock.advance(o.every);
        t.h.output(o.ms);
      }
    }

    it('a long answer holds past 8 s, to its turnComplete at its playback end', () => {
      const t = hold();
      t.h.voiceActivity('ACTIVITY_END');
      t.h.audio(pcm(2_400));
      // 20 s of answer, generated in under 5 s.
      answer(t, { lead: 300, chunks: 20, ms: 1_000, every: 220 });
      t.clock.advance(8_000 - t.clock.now());
      expect(t.h.holding).toBe(true);
      t.clock.advance(20_300 - t.clock.now());
      expect(t.h.holding).toBe(true);
      t.h.turnComplete();
      expect(t.ended).toEqual([{ reason: 'turn_complete', heldMs: 20_300, audioMs: 100, actions: 0, withdrawn: 0, playbackEndMs: 20_300 }]);
      expect(t.timers()).toBe(0);
    });

    it('with turnComplete late, a long answer still holds to its playback end plus the margin, recomputed as the audio arrives', () => {
      const t = hold();
      t.h.voiceActivity('ACTIVITY_END');
      answer(t, { lead: 300, chunks: 20, ms: 1_000, every: 220 });
      t.clock.advance(20_300 + HOLD_MARGIN_MS - 1 - t.clock.now());
      expect(t.h.holding).toBe(true);
      t.clock.advance(1);
      expect(t.ended).toEqual([{ reason: 'cap', heldMs: 20_300 + HOLD_MARGIN_MS, audioMs: 0, actions: 0, withdrawn: 0, playbackEndMs: 20_300 }]);
    });

    it('a short answer lets go at its computed end when turnComplete is late, and the late turnComplete lets nothing go twice', () => {
      const t = hold();
      t.h.voiceActivity('ACTIVITY_END');
      t.h.audio(pcm(2_400, 5));
      answer(t, { lead: 300, chunks: 4, ms: 1_000, every: 200 });
      t.clock.advance(4_300 + HOLD_MARGIN_MS - 1 - t.clock.now());
      expect(t.sent).toEqual([]);
      t.clock.advance(1);
      expect(t.ended).toEqual([{ reason: 'cap', heldMs: 4_300 + HOLD_MARGIN_MS, audioMs: 100, actions: 0, withdrawn: 0, playbackEndMs: 4_300 }]);
      expect(t.sent).toHaveLength(1);
      t.clock.advance(1_000);
      t.h.turnComplete();
      expect(t.ended).toHaveLength(1);
      expect(t.sent).toHaveLength(1);
      expect(t.timers()).toBe(0);
    });

    it('a hold with no model audio lets go 10 s after it began', () => {
      const t = hold();
      t.h.voiceActivity('ACTIVITY_END');
      t.h.audio(pcm(2_400));
      // A transcription or a text part is no audio: nothing to compute an end from.
      t.h.output();
      t.clock.advance(HOLD_IDLE_MS - 1);
      expect(t.h.holding).toBe(true);
      t.clock.advance(1);
      expect(t.ended).toEqual([{ reason: 'idle', heldMs: HOLD_IDLE_MS, audioMs: 100, actions: 0, withdrawn: 0, playbackEndMs: null }]);
      expect(t.sent).toHaveLength(1);
    });

    it("counts the model turn's audio that came before the hold began", () => {
      const t = hold();
      t.h.voiceActivity('ACTIVITY_START');
      t.h.output(1_000);
      t.clock.advance(2_500);
      t.h.voiceActivity('ACTIVITY_END');
      // Its 1 s of audio began at 0: the cap is due 1 s plus the margin from 0, not from the begin.
      const due = 1_000 + HOLD_MARGIN_MS - 2_500;
      t.clock.advance(due - 1);
      expect(t.h.holding).toBe(true);
      t.clock.advance(1);
      expect(t.ended).toEqual([{ reason: 'cap', heldMs: due, audioMs: 0, actions: 0, withdrawn: 0, playbackEndMs: -1_500 }]);
    });

    it('a hold begun by a turnComplete\'s release counts from the next turn: no audio yet, so 10 s', () => {
      const t = hold({ manual: true });
      t.h.begin('activity_end');
      t.h.output(1_000);
      t.h.defer(() => t.h.begin('activity_end'));
      t.h.turnComplete();
      expect(t.began).toEqual(['activity_end', 'activity_end']);
      t.clock.advance(HOLD_IDLE_MS);
      expect(t.ended.map((s) => s.reason)).toEqual(['turn_complete', 'idle']);
    });

    it('a wall clock stepped back never stretches it past the audio received plus the margin', () => {
      const { clock: base, timers } = trackedClock();
      let offset = 0;
      const clock = { now: () => base.now() - offset, setTimeout: (fn: () => void, ms: number) => base.setTimeout(fn, ms) };
      const ended: HoldSummary[] = [];
      const h = new InputHold({ clock, manual: false, silenceMs: 500, send: () => {}, began: () => {}, ended: (s) => ended.push(s) });
      h.voiceActivity('ACTIVITY_END');
      h.output(1_000);
      base.advance(500);
      offset = 3_600_000;
      h.output(1_000);
      // The 2 s of audio received plus the margin, from the second part: an hour's step back adds nothing.
      base.advance(2_000 + HOLD_MARGIN_MS - 1);
      expect(ended).toEqual([]);
      base.advance(1);
      expect(ended.map((s) => s.reason)).toEqual(['cap']);
      expect(timers()).toBe(0);
    });
  });

  it("withdraws a held send and the audio held after it — a voiceless press's — keeping a held send that follows, and says so; false once it has gone (choice 7)", () => {
    const { h, log, action, ended, sent } = hold({ manual: true });
    h.begin('activity_end');
    const press = action('press starts');
    h.audio(pcm(2_400));
    action('typed text');
    h.audio(pcm(2_400));
    expect(h.holds(press)).toBe(true);
    expect(h.withdraw(press)).toBe(true);
    expect(h.holds(press)).toBe(false);
    h.turnComplete();
    expect(log).toEqual(['began activity_end', 'ended turn_complete', 'typed text']);
    expect(sent).toEqual([]);
    expect(ended).toEqual([{ reason: 'turn_complete', heldMs: 0, audioMs: 0, actions: 1, withdrawn: 1, playbackEndMs: null }]);
    expect(h.withdraw(press)).toBe(false);

    const gone = hold({ manual: true });
    gone.h.begin('activity_end');
    const sentPress = gone.action('press starts');
    gone.h.turnComplete();
    expect(gone.h.holds(sentPress)).toBe(false);
    expect(gone.h.holds(null)).toBe(false);
    expect(gone.h.withdraw(sentPress)).toBe(false);
  });

  it("a lost connection carries what is held, and what comes before the next connection is set up, with no cap meanwhile; that setup lets it all go, in order, said as carried (choice 10)", () => {
    const { h, clock, log, action, ended, timers } = hold();
    h.voiceActivity('ACTIVITY_START');
    h.voiceActivity('ACTIVITY_END');
    h.output(1_000);
    h.audio(pcm(2_400, 1));
    action('typed text');
    h.carry();
    expect(h.holding).toBe(true);
    expect(timers()).toBe(0);
    // Past both caps: nothing lets go while there is no connection.
    clock.advance(HOLD_IDLE_MS + HOLD_MARGIN_MS);
    h.audio(pcm(2_400, 2));
    expect(ended).toEqual([]);
    h.reconnected();
    expect(log).toEqual(['began voice_activity', 'ended reconnect', 'audio 1,1,1,1 ×2400', 'typed text', 'audio 2,2,2,2 ×2400']);
    expect(ended).toEqual([{ reason: 'reconnect', heldMs: HOLD_IDLE_MS + HOLD_MARGIN_MS, audioMs: 200, actions: 1, withdrawn: 0, playbackEndMs: null, carried: true }]);
    expect(h.holding).toBe(false);
    expect(timers()).toBe(0);
    // Nothing carried, nothing to let go.
    h.reconnected();
    expect(ended).toHaveLength(1);
  });

  it("under automatic turns a carried hold keeps at most 5 s of the gap's audio — its first, a chunk straddling the bound trimmed — and says what it dropped; what it held before the loss, and its held sends, are kept whole (choice 10)", () => {
    const { h, log, action, ended, sent } = hold();
    h.voiceActivity('ACTIVITY_END');
    // 3 s held before the loss: never bounded.
    h.audio(pcm(72_000, 1));
    h.carry();
    // 8 s of the gap, in 2 s chunks, then text: 5 s kept (2 + 2 + 1 of the third), 3 s dropped (1 of the third, and the fourth whole).
    for (const fill of [2, 3, 4, 5]) h.audio(pcm(48_000, fill));
    action('typed text');
    h.reconnected();
    expect(log.slice(2)).toEqual(['audio 1,1,1,1 ×192000', 'typed text']);
    expect(sent[0].length).toBe(72_000 + (HOLD_CARRY_MS * 24_000) / 1000);
    expect(Array.from(sent[0].subarray(191_998))).toEqual([4, 4]);
    expect(ended).toEqual([{ reason: 'reconnect', heldMs: 0, audioMs: 8_000, actions: 1, withdrawn: 0, playbackEndMs: null, carried: true, droppedMs: 3_000 }]);
  });

  it('under manual turns a carried hold keeps all of the gap: the presses bound it, and says nothing dropped (choice 10)', () => {
    const { h, ended, sent } = hold({ manual: true });
    h.begin('activity_end');
    h.carry();
    for (let i = 0; i < 4; i++) h.audio(pcm(48_000));
    h.reconnected();
    expect(sent.map((p) => p.length)).toEqual([192_000]);
    expect(ended).toEqual([{ reason: 'reconnect', heldMs: 0, audioMs: 8_000, actions: 0, withdrawn: 0, playbackEndMs: null, carried: true }]);
  });

  it("a lost connection forgets the old session's speaking state and model turn, but not that the model sends voice activity: the input fallback stays off, the output one is armed (choices 2, 10)", () => {
    // A fresh hold, never told of voice activity, falls back to a transcription again after a lost connection.
    const fresh = hold();
    fresh.h.input();
    fresh.h.carry();
    fresh.h.reconnected();
    fresh.h.input();
    expect(fresh.began).toEqual(['input_transcription', 'input_transcription']);

    // One that has heard it does not, across the loss; the user left speaking on the old session speaks on no new one.
    const heard = hold();
    heard.h.voiceActivity('ACTIVITY_START');
    heard.h.carry();
    heard.h.reconnected();
    heard.h.input();
    expect(heard.began).toEqual([]);
    heard.h.output();
    expect(heard.began).toEqual(['model_output']);
  });

  it('cancel drops what is held and says nothing: nothing goes up after it, and no timer is left (choice 11)', () => {
    const { h, clock, log, action, ended, sent, timers } = hold();
    h.begin('voice_activity');
    h.audio(pcm(2_400));
    action('typed text');
    h.cancel();
    expect(timers()).toBe(0);
    clock.advance(HOLD_IDLE_MS);
    h.turnComplete();
    expect([sent, ended]).toEqual([[], []]);
    expect(log).toEqual(['began voice_activity']);
  });

  describe('a new start, and one utterance per release (choice 14)', () => {
    it('an ACTIVITY_START during a hold lets it go at once: the server is hearing speech that went up before the hold, and must hear its end', () => {
      const { h, clock, sent, began, ended, timers } = hold();
      // Batch 2, 3.8 at a 1 100 ms pause under the first rule: a hold begun on an ACTIVITY_END that lagged a released
      // burst, and the next utterance's ACTIVITY_START 10 ms later — then held to the idle cap. Now let go at once.
      h.voiceActivity('ACTIVITY_START');
      h.voiceActivity('ACTIVITY_END');
      h.audio(tone(100));
      clock.advance(10);
      h.voiceActivity('ACTIVITY_START');
      expect(ended).toEqual([{ reason: 'voice_activity_start', heldMs: 10, audioMs: 100, actions: 0, withdrawn: 0, playbackEndMs: null }]);
      expect(sent.map((p) => p.length)).toEqual([2_400]);
      expect(h.holding).toBe(false);
      expect(timers()).toBe(0);
      // Live until the server closes that utterance.
      h.voiceActivity('ACTIVITY_END');
      expect(began).toEqual(['voice_activity', 'voice_activity']);
    });

    it('under manual turns an ACTIVITY_START lets nothing go: the server only mirrors the leg\'s own marks (choice 3)', () => {
      const { h, sent } = hold({ manual: true });
      h.begin('activity_end');
      h.audio(tone(100));
      h.voiceActivity('ACTIVITY_START');
      expect(h.holding).toBe(true);
      expect(sent).toEqual([]);
    });

    it('an ACTIVITY_START between interrupted and the turnComplete that trails it lets go at that turnComplete: nothing held goes between the two (choice 4)', () => {
      const { h, log, action, sent } = hold();
      h.voiceActivity('ACTIVITY_END');
      h.audio(tone(100));
      action('typed text');
      // 3 of the multi batches' 53 interrupts reached the client before the ACTIVITY_START that set them off.
      h.interrupted();
      h.voiceActivity('ACTIVITY_START');
      expect(h.holding).toBe(true);
      expect(sent).toEqual([]);
      h.turnComplete();
      expect(log).toEqual(['began voice_activity', 'ended voice_activity_start', 'audio 1000,1000,1000,1000 ×2400', 'typed text']);
      expect(h.holding).toBe(false);
      // That end is over: the next hold's START lets it go at once again.
      h.voiceActivity('ACTIVITY_END');
      h.voiceActivity('ACTIVITY_START');
      expect(h.holding).toBe(false);
    });

    it("a release lets one utterance go — the held audio up to the first pause after speech of 600 ms, at the default silence — and holds the next onset, and what comes, until the server's ACTIVITY_END for what went up, then to that answer's turnComplete", () => {
      const { h, clock, sent, began, ended, timers } = hold();
      h.voiceActivity('ACTIVITY_START');
      h.voiceActivity('ACTIVITY_END');
      // Held while the answer plays: the end of one utterance, a pause, the next one's onset.
      h.audio(tone(300));
      h.audio(hush(700));
      h.audio(tone(300, 2_000));
      h.output(1_000);
      clock.advance(1_000);
      h.turnComplete();
      expect(sent.map((p) => [p[0], p.length])).toEqual([[1_000, 24_000]]);
      expect(ended).toEqual([{ reason: 'turn_complete', heldMs: 1_000, audioMs: 1_300, actions: 0, withdrawn: 0, playbackEndMs: 1_000, keptMs: 300 }]);
      expect(began).toEqual(['voice_activity', 'split']);
      h.audio(tone(200, 3_000));
      // The utterance that went up opens and closes at the server: its START is expected, its END awaited — neither
      // lets go, nor begins another hold.
      h.voiceActivity('ACTIVITY_START');
      clock.advance(900);
      h.voiceActivity('ACTIVITY_END');
      expect(began).toEqual(['voice_activity', 'split']);
      clock.advance(SPLIT_END_MS);
      expect(h.holding).toBe(true);
      h.output(500);
      clock.advance(500);
      h.turnComplete();
      expect(ended[1]).toEqual({ reason: 'turn_complete', heldMs: 1_400 + SPLIT_END_MS, audioMs: 500, actions: 0, withdrawn: 0, playbackEndMs: 1_400 + SPLIT_END_MS });
      expect(sent.map((p) => [p[0], p.length])).toEqual([[1_000, 24_000], [2_000, 12_000]]);
      expect(h.holding).toBe(false);
      expect(timers()).toBe(0);
    });

    it("with no ACTIVITY_END within its wait, a split's hold lets all the rest go, pauses and all: that pause closed no turn; the late END begins a hold of its own, which the next START lets go", () => {
      const { h, clock, sent, began, ended, timers } = hold();
      h.voiceActivity('ACTIVITY_END');
      h.audio(tone(300));
      h.audio(hush(700));
      h.audio(tone(300, 2_000));
      h.turnComplete();
      h.audio(tone(100, 3_000));
      h.audio(hush(700));
      h.audio(tone(100, 4_000));
      clock.advance(SPLIT_END_MS - 1);
      expect(h.holding).toBe(true);
      clock.advance(1);
      expect(ended[1]).toEqual({ reason: 'split_timeout', heldMs: SPLIT_END_MS, audioMs: 1_200, actions: 0, withdrawn: 0, playbackEndMs: null });
      expect(sent.map((p) => [p[0], p.length])).toEqual([[1_000, 24_000], [2_000, 28_800]]);
      // An END after the wait has run out — 70 ms, and the next utterance's START 89 ms after it: the shape batch 2's 3.1
      // monologue showed twice at a 1.5 s wait.
      clock.advance(70);
      h.voiceActivity('ACTIVITY_END');
      h.audio(tone(100));
      clock.advance(89);
      h.voiceActivity('ACTIVITY_START');
      expect(began).toEqual(['voice_activity', 'split', 'voice_activity']);
      expect(ended.map((s) => s.reason)).toEqual(['turn_complete', 'split_timeout', 'voice_activity_start']);
      expect(timers()).toBe(0);
    });

    it("the split's pause follows the session's end-of-speech silence: 100 ms past it, never under 200 ms (choice 15)", () => {
      expect([50, 500, 1_500].map(splitPauseMs)).toEqual([200, 600, 1_600]);
      // A 700 ms pause: a close at the default silence, 500 ms, and so a split; not one at 1 500 ms.
      const held = (t: ReturnType<typeof hold>) => {
        t.h.voiceActivity('ACTIVITY_END');
        t.h.audio(tone(300));
        t.h.audio(hush(700));
        t.h.audio(tone(300, 2_000));
        t.h.turnComplete();
      };
      const slow = hold({ silenceMs: 1_500 });
      held(slow);
      expect(slow.sent.map((p) => p.length)).toEqual([31_200]);
      expect(slow.began).toEqual(['voice_activity']);
      const usual = hold({ silenceMs: 500 });
      held(usual);
      expect(usual.sent.map((p) => p.length)).toEqual([24_000]);
      expect(usual.began).toEqual(['voice_activity', 'split']);
    });

    it("the split's wait grows with what it let go — half as long as that audio plays, when that is past 2 s: an 8.8 s utterance waits 4.4 s, and its END at 3.9 s is consumed", () => {
      const t = hold();
      t.h.voiceActivity('ACTIVITY_END');
      t.h.audio(tone(8_100));
      t.h.audio(hush(700));
      t.h.audio(tone(300, 2_000));
      t.h.turnComplete();
      expect(t.ended[0]).toMatchObject({ audioMs: 9_100, keptMs: 300 });
      t.clock.advance(3_900);
      t.h.voiceActivity('ACTIVITY_END');
      t.clock.advance(1_000);
      expect(t.h.holding).toBe(true);
      expect(t.ended).toHaveLength(1);
      // Without that END the wait runs out at 4.4 s, not 2 s.
      const u = hold();
      u.h.voiceActivity('ACTIVITY_END');
      u.h.audio(tone(8_100));
      u.h.audio(hush(700));
      u.h.audio(tone(300, 2_000));
      u.h.turnComplete();
      u.clock.advance(4_399);
      expect(u.h.holding).toBe(true);
      u.clock.advance(1);
      expect(u.ended[1]).toMatchObject({ reason: 'split_timeout', heldMs: 4_400 });
    });

    it("after a split's END a START lets its hold go, as any START does: that utterance is closed, and the START is a new one", () => {
      const { h, clock, sent, began, ended, timers } = hold();
      h.voiceActivity('ACTIVITY_END');
      h.audio(tone(300));
      h.audio(hush(700));
      h.audio(tone(300, 2_000));
      h.turnComplete();
      h.voiceActivity('ACTIVITY_START');
      clock.advance(900);
      h.voiceActivity('ACTIVITY_END');
      h.audio(tone(100, 3_000));
      clock.advance(100);
      h.voiceActivity('ACTIVITY_START');
      expect(ended.map((e) => e.reason)).toEqual(['turn_complete', 'voice_activity_start']);
      expect(sent.map((p) => [p[0], p.length])).toEqual([[1_000, 24_000], [2_000, 9_600]]);
      expect(began).toEqual(['voice_activity', 'split']);
      expect(timers()).toBe(0);
    });

    it('content after an interrupted ends its wait for the trailing turnComplete: a START during a hold then lets it go at once (choice 4)', () => {
      for (const content of ['output', 'input'] as const) {
        const { h, ended } = hold();
        h.voiceActivity('ACTIVITY_END');
        // No turnComplete follows this one.
        h.interrupted();
        if (content === 'output') h.output();
        else h.input();
        h.audio(tone(100));
        h.voiceActivity('ACTIVITY_START');
        expect(ended.map((e) => e.reason)).toEqual(['voice_activity_start']);
      }
    });

    it("waitingForInput ends the model's turn before it lets go: a split's hold arms its cap from a fresh turn, not the last answer's audio (choice 4)", () => {
      const { h, clock, ended } = hold();
      h.voiceActivity('ACTIVITY_END');
      h.output(1_000);
      h.audio(tone(300));
      h.audio(hush(700));
      h.audio(tone(300, 2_000));
      clock.advance(500);
      h.waitingForInput();
      h.voiceActivity('ACTIVITY_END');
      // The last answer's 1 s would cap it 2.5 s from here; a fresh turn has no audio, so the idle cap.
      clock.advance(1_000 + HOLD_MARGIN_MS);
      expect(h.holding).toBe(true);
      clock.advance(HOLD_IDLE_MS - 1_000 - HOLD_MARGIN_MS);
      expect(ended.map((e) => [e.reason, e.playbackEndMs])).toEqual([['waiting_for_input', 1_000], ['idle', null]]);
    });

    it('held audio that ends in such a pause goes up whole, and the leg holds on the same way: speech right after it waits', () => {
      const { h, sent, began, ended } = hold();
      h.voiceActivity('ACTIVITY_END');
      h.audio(tone(300));
      h.audio(hush(700));
      h.turnComplete();
      expect(sent.map((p) => p.length)).toEqual([24_000]);
      expect(ended[0].keptMs).toBe(0);
      expect(began).toEqual(['voice_activity', 'split']);
      h.audio(tone(100));
      expect(sent).toHaveLength(1);
    });

    it('no pause of 600 ms after speech, or none after any speech, and the release lets all go as one frame', () => {
      const cases: Array<[Int16Array[], number[]]> = [
        [[tone(300), hush(590), tone(300)], [28_560]],
        [[hush(700), tone(300)], [24_000]],
        [[hush(700)], [16_800]],
        [[tone(300), hush(600), tone(300)], [21_600]],
      ];
      for (const [parts, lengths] of cases) {
        const t = hold();
        t.h.voiceActivity('ACTIVITY_END');
        for (const p of parts) t.h.audio(p);
        t.h.turnComplete();
        expect(t.sent.map((p) => p.length)).toEqual(lengths);
      }
    });

    it('a held send made before the pause goes with its utterance; one made after it waits with the next (choice 8)', () => {
      const { h, log, action } = hold();
      h.voiceActivity('ACTIVITY_END');
      h.audio(tone(300));
      action('text 1');
      h.audio(tone(100));
      h.audio(hush(700));
      action('text 2');
      h.audio(tone(300, 2_000));
      h.turnComplete();
      expect(log).toEqual(['began voice_activity', 'ended turn_complete', 'audio 1000,1000,1000,1000 ×7200', 'text 1', 'audio 1000,1000,1000,1000 ×19200', 'began split']);
      h.voiceActivity('ACTIVITY_END');
      h.turnComplete();
      expect(log.slice(6)).toEqual(['ended turn_complete', 'text 2', 'audio 2000,2000,2000,2000 ×7200']);
    });

    it('only automatic turns split, on a session that has heard voice activity, at turnComplete, waitingForInput or a reconnect; the cap and the idle cap let all go', () => {
      const held = (t: ReturnType<typeof hold>) => {
        t.h.audio(tone(300));
        t.h.audio(hush(700));
        t.h.audio(tone(300));
      };
      // Push-to-talk: the leg's own marks already end each utterance (choice 5) — whatever voice activity the server mirrors.
      const manual = hold({ manual: true });
      manual.h.voiceActivity('ACTIVITY_START');
      manual.h.voiceActivity('ACTIVITY_END');
      manual.h.begin('activity_end');
      held(manual);
      manual.h.turnComplete();
      // A model that sends no voice activity sends no ACTIVITY_END for a split to wait for.
      const unheard = hold();
      unheard.h.output();
      held(unheard);
      unheard.h.turnComplete();
      const cap = hold();
      cap.h.voiceActivity('ACTIVITY_END');
      held(cap);
      cap.h.output(100);
      cap.clock.advance(100 + HOLD_MARGIN_MS);
      const idle = hold();
      idle.h.voiceActivity('ACTIVITY_END');
      held(idle);
      idle.clock.advance(HOLD_IDLE_MS);
      for (const t of [manual, unheard, cap, idle]) {
        expect(t.sent.map((p) => p.length)).toEqual([31_200]);
        expect(t.h.holding).toBe(false);
      }
      const waiting = hold();
      waiting.h.voiceActivity('ACTIVITY_END');
      held(waiting);
      waiting.h.waitingForInput();
      const reconnect = hold();
      reconnect.h.voiceActivity('ACTIVITY_END');
      held(reconnect);
      reconnect.h.carry();
      reconnect.h.reconnected();
      for (const t of [waiting, reconnect]) {
        expect(t.sent.map((p) => p.length)).toEqual([24_000]);
        expect(t.began).toEqual(['voice_activity', 'split']);
      }
    });

    it("a lost connection ends a split's wait — no timer runs while carried — and the new connection's release splits again; a stop leaves no timer (choices 10, 11)", () => {
      const { h, clock, sent, began, ended, timers } = hold();
      h.voiceActivity('ACTIVITY_END');
      h.audio(tone(300));
      h.audio(hush(700));
      h.audio(tone(300, 2_000));
      h.turnComplete();
      h.carry();
      expect(timers()).toBe(0);
      clock.advance(SPLIT_END_MS + HOLD_IDLE_MS);
      expect(h.holding).toBe(true);
      // The gap: the held onset's utterance ends, a pause, the next one starts.
      h.audio(hush(700));
      h.audio(tone(100, 3_000));
      h.reconnected();
      expect(ended[1]).toEqual({ reason: 'reconnect', heldMs: SPLIT_END_MS + HOLD_IDLE_MS, audioMs: 1_100, actions: 0, withdrawn: 0, playbackEndMs: null, carried: true, keptMs: 100 });
      expect(sent.map((p) => [p[0], p.length])).toEqual([[1_000, 24_000], [2_000, 24_000]]);
      expect(began).toEqual(['voice_activity', 'split', 'split']);
      expect(timers()).toBe(2);
      h.cancel();
      expect(timers()).toBe(0);
      clock.advance(SPLIT_END_MS);
      expect(sent).toHaveLength(2);
    });

    it('the gate: speech is a 10 ms frame above a tenth of the held audio\'s loudest, its frames running across chunks of any size (choice 15)', () => {
      // A voice at 1 000, a floor between at 100 (a tenth: a pause) or 101 (speech: no pause), in 128-sample chunks —
      // an AudioWorklet's render quantum, smaller than a frame.
      const run = (floor: number) => {
        const t = hold();
        t.h.voiceActivity('ACTIVITY_END');
        const stream = new Int16Array(31_200);
        stream.fill(1_000, 0, 7_200);
        stream.fill(floor, 7_200, 24_000);
        stream.fill(1_000, 24_000);
        for (let i = 0; i < stream.length; i += 128) t.h.audio(stream.slice(i, i + 128));
        t.h.turnComplete();
        return t;
      };
      const pause = run(100);
      // The onset's first frame begins in the chunk from sample 23 936: that chunk, and what follows, stays held.
      expect(pause.sent.map((p) => p.length)).toEqual([23_936]);
      expect(pause.ended[0].keptMs).toBe(303);
      expect(run(101).sent.map((p) => p.length)).toEqual([31_200]);
    });
  });
});
