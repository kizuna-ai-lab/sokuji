/**
 * A 3.x dialogue model's input held while the model's turn runs (Gemini
 * hold, ruling 1): from the user's turn close to the model's
 * `turnComplete`, then sent in order, the audio as one frame. The owner's
 * probes showed why: a 3.x model paces `turnComplete` to a simulated
 * real-time playback of its answer, and input inside that turn cut the
 * answer or lost its own start; held to `turnComplete`, both translations
 * came through whole, 12 of 12. On `FakeSocket` and a virtual clock.
 */
import { describe, it, expect } from 'vitest';
import { flush } from '../../lib/contract/testing/drive';
import { SETUP_TIMEOUT_MS } from './adapter';
import { HOLD_CARRY_MS, HOLD_IDLE_MS, HOLD_MARGIN_MS, SPLIT_END_MS } from './hold';
import { AUTO_CTX, BARGE_IN, DIALOGUE, liveGemini, SERVER, serverFrame, TRANSLATE } from './testing';
import { base64ToPcm } from './wire';

type Live = Awaited<ReturnType<typeof liveGemini>>;

/** A capture chunk: 2 048 samples of 24 kHz voice, `fill` each. */
const chunk = (fill = 1_000) => new Int16Array(2_048).fill(fill);

type Sent = { setup?: unknown; realtimeInput?: { audio?: { data: string }; activityStart?: object; activityEnd?: object; text?: string } };

/** What went up, by kind — an audio frame as `audio ×<samples>` — after the setup. */
function wire(sent: Sent[]): string[] {
  return sent.slice(1).map((f) => {
    const input = f.realtimeInput!;
    if (input.audio) return `audio ×${base64ToPcm(input.audio.data).length}`;
    return Object.keys(input)[0];
  });
}

describe('a 3.x dialogue model under automatic turns (Gemini hold, ruling 1)', () => {
  it("holds the microphone from the server's ACTIVITY_END to the model's turnComplete, sends what it held as one frame, and goes on live: each answer pairs with its own utterance", async () => {
    const h = await liveGemini({ model: BARGE_IN });
    h.session.appendAudio(chunk());
    // The probe: 3.8 transcribes the turn just before its ACTIVITY_END, the activity still open (choice 2).
    h.socket().receive(SERVER.voiceActivity('ACTIVITY_START', '0.760s'));
    h.socket().receive(SERVER.input('Lyrical Time の番組へようこそ。'));
    expect(h.frames('turn.hold')).toEqual([]);
    h.socket().receive(SERVER.voiceActivity('ACTIVITY_END', '6.760s'));
    expect(h.frames('turn.hold')).toEqual([{ cause: 'voice_activity' }]);
    // The second utterance starts while the first's answer plays: held.
    for (let i = 0; i < 3; i++) h.session.appendAudio(chunk(2_000 + i));
    h.clock.advance(300);
    h.socket().receive(SERVER.output('Welcome to the Lyrical Time program.'));
    h.socket().receive(SERVER.audio(48_000));
    h.socket().receive(SERVER.generationComplete());
    expect(wire(h.sent() as Sent[])).toEqual(['audio ×2048']);
    // The server's simulated playback of those 2 s ends.
    h.clock.advance(2_000);
    h.socket().receive(SERVER.turnComplete());
    expect(wire(h.sent() as Sent[])).toEqual(['audio ×2048', 'audio ×6144']);
    const burst = base64ToPcm((h.sent()[2] as { realtimeInput: { audio: { data: string } } }).realtimeInput.audio.data);
    expect([burst[0], burst[2_048], burst[4_096]]).toEqual([2_000, 2_001, 2_002]);
    expect(h.frames('turn.hold_end')).toEqual([{ reason: 'turn_complete', heldMs: 2_300, audioMs: 256, actions: 0, withdrawn: 0, playbackEndMs: 2_300 }]);
    const order = h.of('frame').map((f) => f.payload.type);
    expect(order.slice(order.indexOf('server_content.turn_complete'))).toEqual(['server_content.turn_complete', 'turn.hold_end']);
    // Live again.
    h.session.appendAudio(chunk());
    expect(wire(h.sent() as Sent[])).toHaveLength(3);
    // The burst's own turn: its ACTIVITY_END holds again, and its answer is turn 2.
    h.socket().receive(SERVER.voiceActivity('ACTIVITY_START', '7.520s'));
    h.socket().receive(SERVER.voiceActivity('ACTIVITY_END', '13.520s'));
    h.socket().receive(SERVER.input('Real Time の翻訳機へようこそ。'));
    h.socket().receive(SERVER.output('Welcome to the real-time translator.'));
    h.socket().receive(SERVER.turnComplete());
    expect(h.frames('turn.hold')).toEqual([{ cause: 'voice_activity' }, { cause: 'voice_activity' }]);
    expect(h.of('segmentOpened').map((e) => [e.payload.side, e.payload.origin])).toEqual([['source', 't1'], ['translation', 't1'], ['source', 't2'], ['translation', 't2']]);
    expect(h.timers()).toBe(0);
  });

  it('with no voice activity from the server, the first input transcription of a model turn begins it, else its first output — a transcription or a part (choice 2)', async () => {
    const h = await liveGemini({ model: BARGE_IN });
    h.socket().receive(SERVER.input('Hello.'));
    h.socket().receive(SERVER.output('こんにちは。'));
    h.socket().receive(SERVER.turnComplete());
    h.socket().receive(SERVER.output('どうも。'));
    h.socket().receive(SERVER.turnComplete());
    h.socket().receive(SERVER.audio(2_400));
    h.socket().receive(SERVER.turnComplete());
    expect(h.frames('turn.hold')).toEqual([{ cause: 'input_transcription' }, { cause: 'model_output' }, { cause: 'model_output' }]);
  });

  it("on a model that sends voice activity, a transcription that comes after its own turnComplete begins no hold: the user's next words go up live, not after the idle cap (choice 2)", async () => {
    const h = await liveGemini({ model: BARGE_IN });
    h.socket().receive(SERVER.voiceActivity('ACTIVITY_START'));
    h.socket().receive(SERVER.voiceActivity('ACTIVITY_END'));
    h.socket().receive(SERVER.output('Answer one.'));
    h.socket().receive(SERVER.audio(2_400));
    h.socket().receive(SERVER.turnComplete());
    // Google: the transcription is sent "independently", with "no guaranteed ordering".
    h.socket().receive(SERVER.input('late words'));
    h.session.appendAudio(chunk());
    expect(h.frames('turn.hold')).toEqual([{ cause: 'voice_activity' }]);
    expect(wire(h.sent() as Sent[])).toEqual(['audio ×2048']);
  });

  it("interrupted and waitingForInput end the model's turn for the fallbacks, as turnComplete does: the next turn's first output begins a hold (choices 2, 4)", async () => {
    const h = await liveGemini({ model: BARGE_IN });
    h.socket().receive(SERVER.audio(2_400));
    h.clock.advance(100 + HOLD_MARGIN_MS);
    // Let go at its cap: the same model turn's later output begins none.
    h.socket().receive(SERVER.output('b'));
    expect(h.frames('turn.hold')).toHaveLength(1);
    h.socket().receive(SERVER.interrupted());
    h.socket().receive(SERVER.output('c'));
    expect(h.frames('turn.hold')).toHaveLength(2);
    h.socket().receive(SERVER.waitingForInput());
    h.socket().receive(SERVER.output('d'));
    expect(h.frames('turn.hold')).toEqual([{ cause: 'model_output' }, { cause: 'model_output' }, { cause: 'model_output' }]);
  });

  it("counts every model audio part at its own rate toward the cap, on a leg that does not speak too — the participant's, the same as the speaker's (ruling 3; choices 1, 6)", async () => {
    const h = await liveGemini({ model: BARGE_IN, context: { ...AUTO_CTX, speech: false } });
    h.socket().receive(SERVER.voiceActivity('ACTIVITY_END'));
    h.session.appendAudio(chunk());
    // 200 ms at 24 kHz, and 100 ms at 16 kHz, which is skipped: the server plays both.
    h.socket().receive(SERVER.audio(4_800));
    h.socket().receive(SERVER.audio(1_600, 'audio/pcm;rate=16000'));
    expect(h.of('audio')).toEqual([]);
    h.clock.advance(300 + HOLD_MARGIN_MS - 1);
    expect(wire(h.sent() as Sent[])).toEqual([]);
    h.clock.advance(1);
    expect(h.frames('turn.hold_end')).toEqual([{ reason: 'cap', heldMs: 300 + HOLD_MARGIN_MS, audioMs: 85, actions: 0, withdrawn: 0, playbackEndMs: 300 }]);
    expect(wire(h.sent() as Sent[])).toEqual(['audio ×2048']);
    // The late turnComplete lets nothing go twice.
    h.socket().receive(SERVER.turnComplete());
    expect(h.frames('turn.hold_end')).toHaveLength(1);
  });

  it('interrupted during a hold lets nothing go; the turnComplete that trails it does (choice 4)', async () => {
    const h = await liveGemini({ model: BARGE_IN });
    h.socket().receive(SERVER.voiceActivity('ACTIVITY_END'));
    h.session.appendAudio(chunk());
    h.socket().receive(SERVER.interrupted());
    expect(wire(h.sent() as Sent[])).toEqual([]);
    h.socket().receive(SERVER.turnComplete());
    expect(wire(h.sent() as Sent[])).toEqual(['audio ×2048']);
  });

  it("the split's pause follows the session's own Silence Duration: a 700 ms pause splits a release at the default 500 ms, not at 1 500 ms (choice 15)", async () => {
    const causes: string[][] = [];
    for (const vadSilenceDurationMs of [500, 1_500]) {
      const h = await liveGemini({ model: BARGE_IN, patch: { vadSilenceDurationMs } });
      h.socket().receive(SERVER.voiceActivity('ACTIVITY_START'));
      h.socket().receive(SERVER.voiceActivity('ACTIVITY_END'));
      for (const fill of [1_000, 1_000, 1_000, 0, 0, 0, 0, 0, 0, 0, 2_000, 2_000, 2_000]) h.session.appendAudio(new Int16Array(2_400).fill(fill));
      h.socket().receive(SERVER.turnComplete());
      causes.push((h.frames('turn.hold') as Array<{ cause: string }>).map((p) => p.cause));
    }
    expect(causes).toEqual([['voice_activity', 'split'], ['voice_activity']]);
  });

  it("a waitingForInput in the same message as the turnComplete that began a split leaves that split's hold alone: the next onset stays held until the server's END for what went up, or the split's wait (choices 4, 14)", async () => {
    const h = await liveGemini({ model: BARGE_IN });
    h.socket().receive(SERVER.voiceActivity('ACTIVITY_START'));
    h.socket().receive(SERVER.voiceActivity('ACTIVITY_END'));
    // Held: an utterance's end, a 700 ms pause, the next onset.
    for (const fill of [1_000, 1_000, 1_000, 0, 0, 0, 0, 0, 0, 0, 2_000, 2_000, 2_000]) h.session.appendAudio(new Int16Array(2_400).fill(fill));
    h.socket().receive(serverFrame({ serverContent: { turnComplete: true, waitingForInput: true } }));
    expect(h.frames('turn.hold')).toEqual([{ cause: 'voice_activity' }, { cause: 'split' }]);
    expect(h.frames('turn.hold_end')).toMatchObject([{ reason: 'turn_complete', keptMs: 300 }]);
    expect(wire(h.sent() as Sent[])).toEqual(['audio ×24000']);
    h.clock.advance(SPLIT_END_MS - 1);
    expect(wire(h.sent() as Sent[])).toEqual(['audio ×24000']);
    // Its own wait bounds it: 2 s for the 1 s that went up.
    h.clock.advance(1);
    expect(h.frames('turn.hold_end')).toMatchObject([{ reason: 'turn_complete' }, { reason: 'split_timeout' }]);
    expect(wire(h.sent() as Sent[])).toEqual(['audio ×24000', 'audio ×7200']);
  });

  it('waitingForInput lets go at once: the model is not generating (choice 4)', async () => {
    const h = await liveGemini({ model: BARGE_IN });
    h.socket().receive(SERVER.voiceActivity('ACTIVITY_END'));
    h.session.appendAudio(chunk());
    h.socket().receive(SERVER.waitingForInput());
    expect(wire(h.sent() as Sent[])).toEqual(['audio ×2048']);
    expect(h.frames('turn.hold_end').map((s) => (s as { reason: string }).reason)).toEqual(['waiting_for_input']);
  });

  it.each([
    ['a goAway', (h: Live) => h.socket().receive(SERVER.goAway())],
    ['a close', (h: Live) => h.socket().serverClose(1011, 'Internal error')],
  ] as const)("%s during a hold carries what was held, and the gap's audio after it, to the new connection, sent as one frame once its setup is answered; no cap runs meanwhile, and the new connection holds nothing (choice 10)", async (_cause, lose) => {
    const h = await liveGemini({ model: BARGE_IN });
    h.socket().receive(SERVER.voiceActivity('ACTIVITY_END'));
    h.session.appendAudio(chunk(7));
    const first = h.socket();
    lose(h);
    await flush();
    // The user goes on speaking while the connection is re-made; the idle cap would have let go by now.
    h.session.appendAudio(chunk(8));
    h.clock.advance(HOLD_IDLE_MS);
    expect(h.frames('turn.hold_end')).toEqual([]);
    h.socket().open();
    h.socket().receive(SERVER.setupComplete());
    await flush();
    expect(wire(h.sent() as Sent[])).toEqual(['audio ×4096']);
    const burst = base64ToPcm((h.sent()[1] as { realtimeInput: { audio: { data: string } } }).realtimeInput.audio.data);
    expect([burst[0], burst[2_048]]).toEqual([7, 8]);
    expect(h.frames('turn.hold_end')).toEqual([{ reason: 'reconnect', heldMs: HOLD_IDLE_MS, audioMs: 171, actions: 0, withdrawn: 0, playbackEndMs: null, carried: true }]);
    // Nothing of it went to the old connection; after it, live.
    expect(wire(first.sentJson<Sent>())).toEqual([]);
    h.session.appendAudio(chunk());
    expect(wire(h.sent() as Sent[])).toEqual(['audio ×4096', 'audio ×2048']);
    expect(h.timers()).toBe(0);
  });

  it("a slow reconnect carries at most 5 s of the gap's audio under automatic turns: the held start whole, the gap's first 5 s, the rest dropped and said (choice 10)", async () => {
    const h = await liveGemini({ model: BARGE_IN });
    h.socket().receive(SERVER.voiceActivity('ACTIVITY_END'));
    h.session.appendAudio(chunk(7));
    h.socket().serverClose(1011, 'Internal error');
    await flush();
    // The first attempt opens and never answers; the user speaks on through its setup's bound and the backoff: 17 s.
    h.socket().open();
    for (let i = 0; i < 170; i++) h.session.appendAudio(new Int16Array(2_400).fill(8));
    h.clock.advance(SETUP_TIMEOUT_MS);
    await flush();
    h.clock.advance(2_000);
    await flush();
    h.socket().open();
    h.socket().receive(SERVER.setupComplete());
    await flush();
    expect(wire(h.sent() as Sent[])).toEqual([`audio ×${2_048 + (HOLD_CARRY_MS * 24_000) / 1000}`]);
    expect(h.frames('turn.hold_end')).toEqual([{ reason: 'reconnect', heldMs: SETUP_TIMEOUT_MS + 2_000, audioMs: 5_085, actions: 0, withdrawn: 0, playbackEndMs: null, carried: true, droppedMs: 12_000 }]);
    expect(h.timers()).toBe(0);
  });

  it('stop during the reconnect sends nothing of what was held, on either connection, says nothing, and leaves no timer (choice 11)', async () => {
    const h = await liveGemini({ model: BARGE_IN });
    h.socket().receive(SERVER.voiceActivity('ACTIVITY_END'));
    h.session.appendAudio(chunk());
    const first = h.socket();
    h.socket().receive(SERVER.goAway());
    await flush();
    const attempt = h.socket();
    await h.session.stop();
    await flush();
    h.clock.advance(20_000);
    expect(wire(first.sentJson<Sent>())).toEqual([]);
    expect(attempt.sent).toEqual([]);
    expect(h.sockets.all).toHaveLength(2);
    expect(h.frames('turn.hold_end')).toEqual([]);
    expect(h.timers()).toBe(0);
  });

  it('stop during a hold sends nothing more, says nothing, and leaves no timer (choice 11)', async () => {
    const h = await liveGemini({ model: BARGE_IN });
    h.socket().receive(SERVER.voiceActivity('ACTIVITY_END'));
    h.session.appendAudio(chunk());
    const sent = h.socket().sent.length;
    await h.session.stop();
    expect(h.timers()).toBe(0);
    h.clock.advance(20_000);
    expect(h.socket().sent).toHaveLength(sent);
    expect(h.frames('turn.hold_end')).toEqual([]);
  });

  it.each([['2.5', DIALOGUE], ['Live Translate', TRANSLATE]] as const)('%s never holds: its audio goes live whatever the server says (ruling 2)', async (_name, model) => {
    const h = await liveGemini({ model });
    h.socket().receive(SERVER.voiceActivity('ACTIVITY_START'));
    h.socket().receive(SERVER.voiceActivity('ACTIVITY_END'));
    h.socket().receive(SERVER.input('Hello.'));
    h.socket().receive(SERVER.output('こんにちは。'));
    h.session.appendAudio(chunk());
    expect(wire(h.sent() as Sent[])).toEqual(['audio ×2048']);
    expect(h.frames('turn.hold')).toEqual([]);
  });
});

/** Utterances' speech in the stream: from, to (ms). */
type Speech = ReadonlyArray<readonly [number, number]>;

/**
 * One of the owner's batch-2 probe sessions (2026-09-29, Japanese speech), replayed through the adapter: the capture's
 * 100 ms chunks — each a steady level inside an utterance's speech and silence outside it: the clips stand in by their
 * loudness only — and the server's messages the hold reads, each at its time in the stream. Each answer's audio comes
 * as one part at its first part's arrival, all of its length: the cap reads only those two.
 */
function replay(h: Live, speech: Speech, streamMs: number, server: ReadonlyArray<readonly [number, ArrayBuffer]>): void {
  const t0 = h.clock.now();
  const to = (at: number) => h.clock.advance(t0 + at - h.clock.now());
  let next = 0;
  const upTo = (at: number) => {
    for (; next < server.length && server[next][0] <= at; next++) {
      to(server[next][0]);
      h.socket().receive(server[next][1]);
    }
  };
  for (let at = 0; at < streamMs; at += 100) {
    upTo(at);
    to(at);
    const voiced = speech.some(([from, until]) => at < until && at + 100 > from);
    h.session.appendAudio(new Int16Array(2_400).fill(voiced ? 1_000 : 0));
  }
  upTo(Infinity);
}

/** The wire's runs: each entry with how many times it came in a row. */
function runs(list: readonly string[]): Array<[string, number]> {
  const out: Array<[string, number]> = [];
  for (const e of list) {
    const last = out[out.length - 1];
    if (last && last[0] === e) last[1] += 1;
    else out.push([e, 1]);
  }
  return out;
}

describe('a 3.x dialogue model under automatic turns: one utterance per release, and a new start (Gemini hold, ruling 4)', () => {
  it("3.8, three sentences 1.1 s apart: each release lets one utterance go and holds the next onset until the server has closed and answered it — three answers, one per utterance, where the first rule's single burst stalled on the idle cap (choice 14)", async () => {
    const h = await liveGemini({ model: BARGE_IN });
    // Batch 2, `seq` at 1 100 ms on gemini-3.8-live, its `turn2` session (the first rule's `turn` session of the same
    // clips released U2's end and U3's onset in one burst; the server opened U3 while a hold begun on U2's lagging
    // ACTIVITY_END kept its end, to the idle cap). At the default silence, 500 ms, the probe's own: a 600 ms split pause.
    replay(h, [[60, 5_250], [6_350, 7_800], [8_900, 11_470]], 18_600, [
      [287, SERVER.voiceActivity('ACTIVITY_START', '0.240s')],
      [6_074, SERVER.input('Lyrical Theme of Fanfare にようこそ。自然な会話をお手伝いします。')],
      [6_075, SERVER.voiceActivity('ACTIVITY_END', '6.040s')],
      [6_532, SERVER.audio(116_401)],
      [6_532, SERVER.output('Welcome to Lyrical ')],
      [7_713, SERVER.generationComplete()],
      [11_415, SERVER.turnComplete()],
      [11_848, SERVER.voiceActivity('ACTIVITY_START', '6.600s')],
      [12_393, SERVER.input('少々お待ちください。')],
      [12_393, SERVER.voiceActivity('ACTIVITY_END', '8.520s')],
      [13_044, SERVER.audio(25_921)],
      [13_044, SERVER.output('Please wait ')],
      [13_299, SERVER.generationComplete()],
      [14_136, SERVER.turnComplete()],
      [14_314, SERVER.voiceActivity('ACTIVITY_START', '9.040s')],
      [15_252, SERVER.input('電車が十分遅れています。')],
      [15_252, SERVER.voiceActivity('ACTIVITY_END', '12.280s')],
      [16_062, SERVER.audio(60_240)],
      [16_062, SERVER.output('The train is ')],
      [16_560, SERVER.generationComplete()],
      [18_577, SERVER.turnComplete()],
    ]);
    expect(h.frames('turn.hold')).toEqual([{ cause: 'voice_activity' }, { cause: 'split' }, { cause: 'split' }]);
    expect(h.frames('turn.hold_end')).toEqual([
      { reason: 'turn_complete', heldMs: 5_340, audioMs: 5_400, actions: 0, withdrawn: 0, playbackEndMs: 5_307, keptMs: 2_600 },
      { reason: 'turn_complete', heldMs: 2_721, audioMs: 5_300, actions: 0, withdrawn: 0, playbackEndMs: 2_709, keptMs: 0 },
      { reason: 'turn_complete', heldMs: 4_441, audioMs: 4_400, actions: 0, withdrawn: 0, playbackEndMs: 4_436 },
    ]);
    // U2 and its pause at answer 1's end; U3, from its onset, only at answer 2's; the silence after it at answer 3's.
    const sent = wire(h.sent() as Sent[]);
    expect(runs(sent)).toEqual([['audio ×2400', 61], ['audio ×67200', 1], ['audio ×127200', 1], ['audio ×105600', 1]]);
    const bursts = (h.sent() as Sent[]).slice(62).map((f) => base64ToPcm(f.realtimeInput!.audio!.data));
    expect(bursts.map((b) => [b[0], b[b.length - 1]])).toEqual([[0, 0], [1_000, 0], [0, 0]]);
    expect(h.of('segmentOpened').map((e) => [e.payload.side, e.payload.origin])).toEqual([
      ['source', 't1'], ['translation', 't1'], ['source', 't2'], ['translation', 't2'], ['source', 't3'], ['translation', 't3'],
    ]);
    expect(h.timers()).toBe(0);
  });

  it("3.1, a monologue: the split's hold consumes the server's close of what it let go, 1.58 s after it and inside its 2 s wait — where the probe's 1.5 s wait ran out (choice 14)", async () => {
    const h = await liveGemini({ model: BARGE_IN });
    // Batch 2, `mono` (pauses 800/1 200/1 000/1 500 ms) on gemini-3.1-flash-live-preview, its `turn2` session, to its
    // first split's ACTIVITY_END. The probe's own wait was 1.5 s: it ran out 70 ms before that END, 3.1 cut the pending
    // answer before any output (failure mode (b)) and answered two utterances together. The session's later messages
    // answer what that timeout sent, so the replay stops at the END; the late-END path is `hold.test.ts`'s.
    replay(h, [[50, 3_470], [4_270, 6_530], [7_730, 10_660], [11_660, 14_170], [15_670, 18_710]], 9_400, [
      [182, SERVER.voiceActivity('ACTIVITY_START', '0.160s')],
      [4_398, SERVER.input('今日 は 雨 が 降り そう な の で 傘 を 持っ て 行き ます 。')],
      [4_398, SERVER.voiceActivity('ACTIVITY_END', '4.280s')],
      [4_535, SERVER.audio(77_761)],
      [4_535, SERVER.output('It looks')],
      [5_437, SERVER.generationComplete()],
      [7_806, SERVER.turnComplete()],
      [8_317, SERVER.voiceActivity('ACTIVITY_START', '4.600s')],
      [9_388, SERVER.input('ドア を 閉め て ください 。')],
      [9_388, SERVER.voiceActivity('ACTIVITY_END', '7.160s')],
    ]);
    // Split at 7 806 ms (3.3 s let go, so a 2 s wait), its END at 9 388: consumed, no hold of its own.
    expect(h.frames('turn.hold')).toEqual([{ cause: 'voice_activity' }, { cause: 'split' }]);
    expect(h.frames('turn.hold_end')).toEqual([
      { reason: 'turn_complete', heldMs: 3_408, audioMs: 3_500, actions: 0, withdrawn: 0, playbackEndMs: 3_377, keptMs: 200 },
    ]);
    // The wait is over: past it the split's hold still holds U3's onset, for its answer's turnComplete.
    h.clock.advance(SPLIT_END_MS);
    expect(h.frames('turn.hold_end')).toHaveLength(1);
    const sent = wire(h.sent() as Sent[]);
    expect(runs(sent)).toEqual([['audio ×2400', 44], ['audio ×79200', 1]]);
  });
});
