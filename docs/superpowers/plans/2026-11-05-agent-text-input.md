# Soniox Agent Text Input (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On desktop, Sokuji sends Soniox the text of each speech chunk it queues on one of the user's outlets, on the STT socket that hears the microphone, so the app's own read-aloud translation is kept out of recognition.

**Architecture:** The STT stream gains the `enable_agent_text_input` flag and `sendAgentText`. Every microphone socket of a run that may speak asks for the flag, and a Soniox session exposes `agentText` through an optional contract method. Playback reports which of the user's outlets each queued clip plays on, and when a voice's queue empties. A run-level `AgentTextFeed` turns these facts, the rows' text and the chunks' ranges into sends on the speaker session. The new switch and a manual turn's key gate the sends live.

**Tech Stack:** TypeScript (strict), React, Zustand, i18next (30 catalogs), Vitest with `FakeSocket`, the virtual clock and the playback's fake graph.

**Spec:** `docs/superpowers/specs/2026-11-05-agent-text-input-design.md`. This plan covers §4 only. §6, §7 and §8 are not tasks, except Task 9's checklist.

**Amended after the measurement (2026-11-05):** split Both sends no agent text and does not ask for the flag; the flag is asked for only when the switch is on at Start, and the switch is read at Start (spec §4.1, §4.3). The switch later moved from the Speech section into the Soniox settings as a Soniox setting (spec §4.4), replacing Tasks 7–8's store field, runner port and Speech-section row. Where this plan says "every microphone socket of a run that may speak", "read at each chunk" or describes those pieces, the spec now rules.

## Global Constraints

- The model stays `stt-rt-v6` (`SONIOX_STT_MODEL`). `sttStream.ts` takes no new import: the mobile app shares it (`domFree.test.ts`).
- Agent text goes only to an STT socket that transcribes **the microphone**, and only for speech played on a **local outlet** (`me`, `them`, `other`). Speech that goes only to the virtual microphone is never sent (§4.1).
- **Per chunk, at enqueue:** send the text of that chunk's range. "A chunk with no range yet sends nothing; its text goes with the next chunk that has one, so no text is lost" (§4.2).
- "When a voice's queue goes idle, send `end_of_segment: true` on the socket that received that voice's text." When queued speech is dropped, send `end_of_segment: true` for that voice "and nothing more of the dropped text" (§4.2).
- Two voices may share one socket. "Each voice opens and closes its own turns" (§4.2).
- "Text is sent only while the socket is open." A resume's new socket gets text from the next chunk on. "Nothing is replayed" (§4.2).
- Manual turns: send "only while the microphone's audio is actually reaching that socket: always in automatic turns, and in a manual mode only while the key is held." A chunk queued with the key up is not re-sent (§4.2).
- `enable_agent_text_input: true` goes "on every socket that transcribes the microphone in a session that may speak at all", "whatever the switch and the local outlets say at Start" (§4.3).
- `sendAgentText(text, endOfSegment)` sends `{"type":"agent_text","text":…,"end_of_segment":…}` only while the socket is open. "Every frame sent is logged (`stt.agent_text`)" (§4.3).
- The switch reads "Keep the read-aloud translation out of recognition". It is on by default, works in managed and own-key mode, and can change during a session (from the next chunk). Its description follows §4.4. It is in all 30 catalogs, with real translations (§4.4).
- Nothing changes in the backend or on mobile. No echo-cancellation change, no ducking, no barge-in (§2, §3).
- An adapter speaks only through its events (CLAUDE.md, "Inside an adapter session"). Record failures with `reportError` / `reportWarning`, never with `console.error` / `console.warn`.
- Worktree: `/home/jiangzhuo/Desktop/kizunaai/sokuji-agent-text`, branch `feat/agent-text-input`. Run `npm ci --ignore-scripts` once. Run tests with `npx vitest run <files>` and types with `npx tsc --noEmit`. **Never** run vite, Electron, `npm run dev` or anything else that launches the app. No `git stash`.
- Use conventional commits. `git add` takes explicit paths only. Every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Nothing is pushed and no pull request is opened until the owner approves that specific act, naming `kizuna-ai-lab/sokuji` and the branch.

## Review Focus

1. **Provisional ranges that stop short of their TTS stream's text.** This happens when the pace estimate runs slow. The last words of a sentence must still be sent while their clip is queued, and must not be sent once it has played. Task 5 (`the words the provisional ranges had not reached…`, `a fill-in after the voice went idle…`) and Task 6 (`a fill-in reaches the feed`) pin it.
2. **A chunk whose voice is not its row's leg, or whose voice's core does not hear the microphone.** Examples: split Both's participant voice, and face-to-face's tail read in the other voice. Its text must go to the speaker session, keyed by its voice, and each voice must close its own segment. Task 5 (`two voices on one socket…`) and Task 6 (`split Both: the participant row's chunk…`) pin it.
3. **A voice's queue cleared mid-segment.** The causes are Translation I hear switched off, Stop, Clear, or a rebuilt context. The expected result is one `end_of_segment`, then nothing of the dropped text: no late fill-in, and no overlap from a later chunk. Task 4 (`onVoiceIdle: a clear…`), Task 5 (`a clear mid-segment…`) and Task 6 (`a stop closes…`) pin it.
4. **The switch or a manual turn's key changing mid-segment.** Text stops or starts from the next chunk only. Skipped text is never sent later. The queue going idle still closes an open segment. Task 5 (`the switch…`, `a manual turn's key up…`) and Task 6 (`reads the switch…`, `push-to-talk…`) pin it.
5. **An own-key 503 resume mid-segment.** Nothing is sent while the socket is down. The new socket gets no `end_of_segment` for the old socket's segment. The resumed socket still asks for agent text, and the next chunk opens a new segment. Task 2 (`a resumed socket asks again`), Task 3 (`nothing while a resume replaces the socket…`), Task 5 (`a reconnect mid-segment…`) and Task 6 (`a reconnecting speaker leg…`) pin it.

## File map

| File | Responsibility |
|---|---|
| `src/providers/soniox/sttStream.ts` | Wire: the flag in the config frame, `sendAgentText` (Task 1) |
| `src/lib/provider/types.ts`, `src/lib/session/{types,run}.ts`, `src/providers/soniox/{config,adapter}.ts` | `shared.speaks`; the flag on the microphone socket (Task 2) |
| `src/lib/contract/adapter.ts`, `src/providers/soniox/adapter.ts` | `AdapterSession.agentText?`; the Soniox session sends and logs the frame (Task 3) |
| `src/lib/session/ports.ts`, `src/lib/audio/playback.ts` | `audio()` returns the outlets a clip plays on; `onVoiceIdle` (Task 4) |
| `src/lib/session/agentText.ts` (new) | `agentTextTarget` (§4.1) and `AgentTextFeed`: what to send, when, to whom (Task 5) |
| `src/lib/session/run.ts`, `ports.ts` | The run feeds its events, playback's answers and the gates to the feed (Task 6) |
| `src/stores/settingsStore.ts`, `src/lib/session/appShape.ts`, `src/app/session.ts` | The switch's state, wired to the runner and the playback (Task 7) |
| `src/lib/provider/{types,managed}.ts`, `src/providers/soniox/provider.ts`, `SpeechOutputSection.tsx`, 30 catalogs | The switch on screen, for Soniox and its managed twin (Task 8) |
| `docs/superpowers/notes/2026-11-05-agent-text-measurement.md` (new) | The §8 checklist the pull request quotes (Task 9) |

---

### Task 1: The STT stream's agent text

**Files:**
- Modify: `src/providers/soniox/sttStream.ts` (`SonioxSttConfig` :52-81, the `onopen` frame :141-168, beside `sendAudio` :213-217)
- Test: `src/providers/soniox/sttStream.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:

```ts
// SonioxSttConfig
/** Soniox agent text input: the client may send the text its own voice is about to play. Falsy: key omitted (wire unchanged). */
enableAgentTextInput?: boolean;
// SonioxSttStream
/** `{"type":"agent_text","text":…,"end_of_segment":…}`, only while open and only on a stream connected with `enableAgentTextInput` (Soniox ends a stream that gets agent text without it). Returns whether it was sent. */
sendAgentText(text: string, endOfSegment: boolean): boolean;
```

- [ ] **Step 1: Write the failing tests**

Port the four tests of `git show b876cf244 -- src/providers/soniox/sttStream.test.ts` (branch `exp/agent-text-probe`). Drop "(experiment)" from their names, and use `describe('agent text input', …)`. Their key assertions:

```ts
it('asks for agent text in the config frame only when configured (wire unchanged otherwise)', …
  expect(JSON.parse(on.ws.sent[0] as string).enable_agent_text_input).toBe(true);
  expect('enable_agent_text_input' in JSON.parse(ws.sent[0] as string)).toBe(false); // undefined and false
it('sends an agent_text frame, the text as given and the segment end, while open', …
  expect(ws.sent.slice(1).map((d) => JSON.parse(d as string))).toEqual([
    { type: 'agent_text', text: 'There are ', end_of_segment: false },
    { type: 'agent_text', text: '', end_of_segment: true },
  ]);
it('sends nothing while the socket is not open: before it opens and after it closes', …
  expect(s.sendAgentText('early', false)).toBe(false); expect(s.sendAgentText('late', true)).toBe(false); expect(ws.sent).toHaveLength(1);
it('sends nothing on a stream configured without agent text: Soniox would end it', …
  expect(s.sendAgentText('hello', false)).toBe(false); expect(ws.sent).toHaveLength(1);
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/providers/soniox/sttStream.test.ts`
Expected: FAIL. `s.sendAgentText is not a function`, and the flag is missing from the frame.

- [ ] **Step 3: Implement the flag and `sendAgentText` in `sttStream.ts`**

`connect` records, per socket, whether the config asked. The frame spreads `enable_agent_text_input: true` right after `enable_speaker_diarization`. `sendAgentText` does not touch `lastAudioAt`: the keepalive is about audio.

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/providers/soniox/sttStream.test.ts src/providers/soniox/domFree.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/providers/soniox/sttStream.ts src/providers/soniox/sttStream.test.ts
git commit -m "feat(soniox): agent text on the STT stream" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Every microphone socket of a run that may speak asks for it

**Files:**
- Modify: `src/lib/provider/types.ts` (`SharedSettings` :129-140)
- Modify: `src/lib/session/types.ts:43` (`RunShape.shared`)
- Modify: `src/lib/session/run.ts:151-165` (`runOpen`: compute `contexts` before `shared`)
- Modify: `src/providers/soniox/config.ts` (`SonioxConfig.stt`, `buildSoniox`)
- Modify: `src/providers/soniox/adapter.ts:327-348` (`SonioxCore.sttConfig`)
- Test: `src/providers/soniox/config.test.ts`, `src/providers/soniox/adapter.both.test.ts` (its `both()` gains `speaks?: boolean`, spread into `shared`), `src/providers/soniox/adapter.test.ts`, `src/lib/session/runner.test.ts`

**Interfaces:**
- Consumes: `SonioxSttConfig.enableAgentTextInput` (Task 1).
- Produces:

```ts
// SharedSettings
/** Some leg of this run produces translated speech (its context's `speech`), fixed at start: a builder may ready a socket for it (Soniox agent text, spec 2026-11-05 §4.3). Set by the run; absent: false. */
speaks?: boolean;
// RunShape — the run adds it, as it adds `models`
shared: Omit<SharedSettings, 'models' | 'speaks'>;
// SonioxConfig['stt']
/** Ask for agent text on this leg's socket: the speaker's leg, whose socket hears the microphone, in a run that may speak (§4.3). Absent: off. */
agentText?: true;
```

The rules: `Run.open` passes `speaks: shape.legs.some((leg) => contexts[leg]!.speech)`. `buildSoniox` sets `stt.agentText: true` exactly when `!shared.reversed(context.direction) && shared.speaks === true`, whatever this leg's own `context.speech` says. `sttConfig()` adds `enableAgentTextInput: true` exactly when the primary request's `config.stt.agentText` is set.

- [ ] **Step 1: Write the failing tests**

`config.test.ts` (its `AUTO_CTX` is the *participant's* direction there, `ja → en`):

```ts
describe('buildSoniox — agent text (spec 2026-11-05 §4.3)', () => {
  const SPEAKER: SessionContext = { ...AUTO_CTX, direction: { source: 'en', target: 'ja' } };
  const SPEAKS = { ...SHARED, speaks: true };
  it("asks on the speaker's leg of a run that may speak, even when that leg itself is text-only", () => {
    expect(buildSoniox(SPEAKER, SONIOX_DEFAULTS, SPEAKS).stt.agentText).toBe(true);
    expect(buildSoniox({ ...SPEAKER, speech: false }, SONIOX_DEFAULTS, SPEAKS).stt.agentText).toBe(true);
  });
  it("never on the participant's leg: its socket does not hear the microphone", () => {
    expect(buildSoniox(AUTO_CTX, SONIOX_DEFAULTS, SPEAKS).stt).not.toHaveProperty('agentText');
  });
  it('never in a run that speaks nowhere', () => {
    for (const speaks of [false, undefined]) expect(buildSoniox(SPEAKER, SONIOX_DEFAULTS, { ...SHARED, speaks }).stt).not.toHaveProperty('agentText');
  });
});
```

`adapter.both.test.ts`:

```ts
it('split: only the speaker socket asks for agent text, the participant speaking alone included (§4.3)', async () => {
  const h = both({ sharedBoth: false, participantSpeaks: true, speaks: true });
  h.openAll(); await h.starting;
  const [spk, par] = h.sttSockets();
  expect(spk.sentJson<Json>()[0]).toMatchObject({ enable_agent_text_input: true });
  expect(par.sentJson<Json>()[0]).not.toHaveProperty('enable_agent_text_input');
});
it('shared and face-to-face: the one socket asks', … // both({ speaks: true }) and both({ faceToFace: true, speaks: true }): [0] has enable_agent_text_input: true
it('without shared.speaks no socket asks', … // both({ sharedBoth: false }): neither first frame has the key
```

`adapter.test.ts`:

```ts
it('a resumed socket asks again (Review Focus 5)', async () => {
  const h = await live({ shared: { ...SHARED, speaks: true } });
  await resumeOnce(h);
  expect(h.sttSockets().map((s) => s.sentJson<Json>()[0].enable_agent_text_input)).toEqual([true, true]);
});
```

`runner.test.ts`:

```ts
it('tells every builder whether the run speaks at all (shared.speaks, spec 2026-11-05 §4.3)', async () => {
  const cases = [[false, false, ['speaker'], true], [true, false, ['speaker'], false], [true, true, ['speaker', 'participant'], true]] as const;
  for (const [textOnly, participantSpeech, legs, expected] of cases) {
    const seen: Array<boolean | undefined> = [];
    const provider = { ...fakeProvider, build: (c: never, s: never, shared: SharedSettings) => { seen.push(shared.speaks); return fakeProvider.build(c, s, shared); } } as AnyProvider;
    const { runner } = setup({ shape: { provider, textOnly, participantSpeech, legs } });
    await runner.start();
    expect(seen).toEqual(legs.map(() => expected));
    await runner.stop();
  }
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/providers/soniox/config.test.ts src/providers/soniox/adapter.both.test.ts src/providers/soniox/adapter.test.ts src/lib/session/runner.test.ts`
Expected: FAIL. `stt.agentText` and `shared.speaks` are undefined, and no frame carries `enable_agent_text_input`.

- [ ] **Step 3: Implement the rules above in the five files**

- [ ] **Step 4: Run the tests and the types**

Run: the Step 2 command, then `npx tsc --noEmit`
Expected: PASS. tsc reports no errors. Existing config-frame tests are unchanged, because `SHARED` has no `speaks`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/provider/types.ts src/lib/session/types.ts src/lib/session/run.ts src/providers/soniox/config.ts src/providers/soniox/adapter.ts src/providers/soniox/config.test.ts src/providers/soniox/adapter.both.test.ts src/providers/soniox/adapter.test.ts src/lib/session/runner.test.ts
git commit -m "feat(soniox): ask for agent text on every microphone socket of a run that may speak" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: A Soniox session sends agent text

**Files:**
- Modify: `src/lib/contract/adapter.ts` (`AdapterSession`, after `setSpeech?`)
- Modify: `src/providers/soniox/adapter.ts` (`SonioxCore.session` :264-277, and a private `agentText` beside `endTurn`)
- Create: `src/providers/soniox/adapter.agentText.test.ts`

**Interfaces:**
- Consumes: `SonioxSttStream.sendAgentText` (Task 1); `shared.speaks` → `stt.agentText` (Task 2).
- Produces:

```ts
// AdapterSession
/**
 * Soniox agent text (spec 2026-11-05): text this app's own voice is about to play where the microphone can
 * hear it, sent on this session's STT socket; `endOfSegment` closes that voice's turn. Returns whether it was
 * sent: never while the socket is down or once stopped, never on a socket not opened for it. Absent: none taken.
 */
agentText?(text: string, endOfSegment: boolean): boolean;
```

`SonioxCore.agentText(text, endOfSegment)` returns false once the core has ended or while it has no socket. Otherwise it returns `this.stt.sendAgentText(…)`. Each send is framed as `this.frame('out', 'stt.agent_text', { text, end_of_segment: endOfSegment })`. Every leg's facade calls the same core.

- [ ] **Step 1: Write the failing tests**

Harness: generalize `faceToFace()` from `git show 7792f1007 -- src/providers/soniox/adapter.agentText.test.ts` into `open(mode: 'me' | 'other' | 'split' | 'shared' | 'faceToFace')`. Both legs speak. Each leg is built by `buildSoniox` with `{ ...shared, speaks: true }`; `reversed` is `direction.source === 'ja'`. A lone session (`me`, `other`) is keyed by the leg it runs. The harness returns `{ sessions, sttSockets, openAll, agentFrames(i), logged() }`: `agentFrames(i)` holds the `agent_text` frames STT socket `i` received, and `logged()` holds the `stt.agent_text` payloads framed on the core's first leg.

```ts
it('face-to-face: either leg sends on the one socket, each send framed stt.agent_text', async () => {
  const h = await open('faceToFace');
  expect(h.sessions.speaker!.agentText!('こんにちは', false)).toBe(true);
  expect(h.sessions.participant!.agentText!('你好', false)).toBe(true);
  expect(h.agentFrames(0)).toEqual([{ type: 'agent_text', text: 'こんにちは', end_of_segment: false }, { type: 'agent_text', text: '你好', end_of_segment: false }]);
  expect(h.logged()).toEqual([{ text: 'こんにちは', end_of_segment: false }, { text: '你好', end_of_segment: false }]);
});
it("split Both: the speaker session sends on the speaker core's socket; the participant session sends nothing", async () => {
  const h = await open('split');
  expect(h.sessions.participant!.agentText!('Hello.', false)).toBe(false);
  expect(h.sessions.speaker!.agentText!('Hello.', false)).toBe(true);
  expect(h.agentFrames(1)).toEqual([]);
  expect(h.agentFrames(0)).toEqual([{ type: 'agent_text', text: 'Hello.', end_of_segment: false }]);
});
it('nothing while a resume replaces the socket; the resumed socket takes the next (Review Focus 5)', async () => {
  const h = await open('me');
  h.sttSockets()[0].receive(ERROR_503); h.sttSockets()[0].serverClose(1011); await flush();
  expect(h.sessions.speaker!.agentText!('lost', false)).toBe(false);
  h.openAll(); await flush();
  expect(h.sessions.speaker!.agentText!('next', false)).toBe(true);
  expect(h.agentFrames(1)).toEqual([{ type: 'agent_text', text: 'next', end_of_segment: false }]);
});
it('nothing once stopped', …   // await sessions.speaker.stop(); agentText('late', true) === false; no agent frame
it('Other mode: nothing, since its socket never asked', … // open('other'): sessions.participant.agentText('x', false) === false
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/providers/soniox/adapter.agentText.test.ts`
Expected: FAIL. `agentText` is undefined on the session.

- [ ] **Step 3: Add `agentText?` to `AdapterSession` and implement it on `SonioxCore` as stated**

- [ ] **Step 4: Run the Soniox suite and the types**

Run: `npx vitest run src/providers/soniox src/lib/contract && npx tsc --noEmit`
Expected: PASS. The conformance suite is unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/lib/contract/adapter.ts src/providers/soniox/adapter.ts src/providers/soniox/adapter.agentText.test.ts
git commit -m "feat(soniox): a session sends agent text on its STT socket" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Playback reports where a clip plays and when a voice is done

**Files:**
- Modify: `src/lib/session/ports.ts` (`PlaybackPort` :13-26, `guardPorts` :95-142)
- Modify: `src/lib/audio/playback.ts` (`Playback` :44-59, `apply` :112-126, `audio` :153-164)
- Modify: `src/app/session.ts:144`: the port returns `playback?.audio(…) ?? []`
- Modify: every `PlaybackPort` fake that `npx tsc --noEmit` flags gets `audio: () => []`. Expected: `src/lib/session/runner.hooks.test.ts:51`, `src/providers/fake/leased.test.ts:77,240`, `src/providers/palabraai/adapter.runner.test.ts:69`, `src/providers/soniox/kizuna.test.ts:110`.
- Test: `src/lib/audio/playback.test.ts`, `src/lib/session/ports.test.ts`

**Interfaces:**
- Consumes: `OutletName` (`src/lib/audio/outlets.ts`), `Edge`, `routesFor` (`routes.ts`).
- Produces:

```ts
// PlaybackPort
/** …as today. Returns the user's outlets (me, them, other) this clip plays on now; empty when it plays only into the meeting or was dropped. */
audio(leg: LegName, ref: number | undefined, pcm: Int16Array, voice?: LegName): readonly OutletName[];
/** A voice's queue holds nothing any more: its last clip played out, or a clear dropped what was queued (a stop, Clear, Translation I hear switched off, a rebuilt context). Returns the unsubscribe. Absent: never heard. */
onVoiceIdle?(listener: (voice: LegName) => void): () => void;
// Playback (playback.ts) redeclares it required
onVoiceIdle(listener: (voice: LegName) => void): () => void;
```

The rules:
- `audio` returns the edges from the last `apply()` whose `from` is the voice and whose `to` is not `'virtual'`. It returns `[]` for a clip it drops.
- `onVoiceIdle` covers the speaker and participant queues, never replay. It fires when a queue's `pending` drops from above 0 to 0, whether its last clip ended or a clear emptied it. A clear of an empty queue fires nothing.
- `guardPorts`: `audio` returns `playback.audio(…) ?? []`, and `[]` when it throws. `onVoiceIdle` is passed through only when the port has it. A subscribe that throws is reported once (`playback.onVoiceIdle`) and returns a no-op unsubscribe.

- [ ] **Step 1: Write the failing tests**

`playback.test.ts`:

```ts
describe('createPlayback — where clips play, and when a voice is done (agent text)', () => {
  it("audio answers the user's outlets of the clip's voice, never the virtual one", () => {
    const r = routing(); const playback = createPlayback(fakeGraph().graph, r.source);
    expect(playback.audio('speaker', 1, pcm(100))).toEqual([]);
    r.set({ speak: { other: true, me: true, them: true } });
    expect(playback.audio('speaker', 1, pcm(100))).toEqual(['me']);
    expect(playback.audio('participant', 2, pcm(100))).toEqual(['them']);
    expect(playback.audio('participant', 3, pcm(100), 'speaker')).toEqual(['me']);
    r.set({ faceToFace: true });
    expect(playback.audio('speaker', 4, pcm(100))).toEqual(['other']);
  });
  it('audio answers none for a clip it drops: Translation I hear off, or a row left unheard', () => {
    const r = routing(); const playback = createPlayback(fakeGraph().graph, r.source);
    r.set({ speak: { other: true, me: false, them: false } });
    expect(playback.audio('participant', 5, pcm(100))).toEqual([]);
    r.set({ speak: { other: true, me: false, them: true } });
    expect(playback.audio('participant', 5, pcm(100))).toEqual([]);
    expect(playback.audio('participant', 6, pcm(100))).toEqual(['them']);
  });
  it("onVoiceIdle: once a voice's last queued clip has played, not between clips that follow on", () => {
    const { graph, advance } = fakeGraph(); const playback = createPlayback(graph, routing().source);
    const idle: LegName[] = []; playback.onVoiceIdle((v) => idle.push(v));
    playback.audio('speaker', 1, pcm(100)); playback.audio('speaker', 1, pcm(100));
    advance(0.2); expect(idle).toEqual([]);
    advance(0.1); expect(idle).toEqual(['speaker']);
  });
  it('onVoiceIdle: a clear, Translation I hear switched off and a rebuilt context end what was queued (Review Focus 3)', () => {
    const { graph, reset } = fakeGraph(); const r = routing(); const playback = createPlayback(graph, r.source);
    const idle: LegName[] = []; playback.onVoiceIdle((v) => idle.push(v));
    playback.audio('participant', 1, pcm(100));
    r.set({ speak: { other: true, me: false, them: false } });
    playback.audio('speaker', 2, pcm(100)); reset();
    playback.audio('speaker', 3, pcm(100)); playback.clear();
    expect(idle).toEqual(['participant', 'speaker', 'speaker']);
  });
  it('stops calling a listener once it unsubscribes', …   // off(); queue and clear → no call
});
```

`ports.test.ts`:

```ts
it('audio answers the outlets, and none from a port that throws or answers nothing', …
  // a port answering ['me'] → ['me']; one answering undefined → []; one throwing → [] and reported once
it('passes onVoiceIdle through when the port has it, and only then', …
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lib/audio/playback.test.ts src/lib/session/ports.test.ts`
Expected: FAIL. `audio` returns `undefined`, and `onVoiceIdle is not a function`.

- [ ] **Step 3: Implement the rules above, then fix the fakes tsc names**

- [ ] **Step 4: Run the tests, the session suites and the types**

Run: `npx vitest run src/lib/audio src/lib/session src/app src/providers && npx tsc --noEmit`
Expected: PASS. tsc reports no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/session/ports.ts src/lib/audio/playback.ts src/app/session.ts src/lib/audio/playback.test.ts src/lib/session/ports.test.ts src/lib/session/runner.hooks.test.ts src/providers/fake/leased.test.ts src/providers/palabraai/adapter.runner.test.ts src/providers/soniox/kizuna.test.ts
git commit -m "feat(playback): say where each clip plays and when a voice goes idle" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The agent text feed

**Files:**
- Create: `src/lib/session/agentText.ts`
- Create: `src/lib/session/agentText.test.ts`

**Interfaces:**
- Consumes: `OutletName`; `AdapterSession['agentText']` (Task 3); `Ref`, `TextRange` (`src/lib/contract/adapter.ts`); `LegName`. Tests also use `routesFor` and `RoutingSettings`.
- Produces:

```ts
/** §4.1: the leg whose session hears the microphone (the speaker's; in shared Both and face-to-face the one socket's own) when a clip plays on one of the user's outlets; null otherwise. A voice matters only through its outlets: split Both's participant voice crosses to the speaker core. */
export function agentTextTarget(legs: readonly LegName[], outlets: readonly OutletName[]): LegName | null;

export interface AgentTextFeedOptions {
  legs: readonly LegName[];
  /** The switch, read at each chunk (§4.4). */
  enabled(): boolean;
  /** The microphone's audio reaches its socket now: automatic turns, or a manual turn's key held (§4.2). */
  micOpen(): boolean;
  session(leg: LegName): Pick<AdapterSession, 'agentText'> | undefined;
}

export class AgentTextFeed {
  constructor(o: AgentTextFeedOptions);
  /** `segmentText`: a row's text as its adapter last sent it, which its ranges index. */
  rowText(leg: LegName, ref: Ref, text: string): void;
  /** One `audio` event of `leg`'s row, with the outlets playback returned for it. */
  audio(leg: LegName, e: { ref?: Ref; range?: TextRange; voice?: LegName }, outlets: readonly OutletName[]): void;
  /** `speechRanges`: the filled-in ranges of `leg`'s row. */
  ranges(leg: LegName, e: { ref: Ref; ranges: ReadonlyArray<{ index: number; range: TextRange }> }): void;
  /** Playback's `onVoiceIdle`. */
  voiceIdle(voice: LegName): void;
  /** A leg said `reconnecting`. */
  reconnecting(leg: LegName): void;
}
```

The rules (the algorithm the signatures leave open):
1. **Index.** Every `audio` event with a `ref` takes the next index of `(leg, ref)`, starting at 0, whatever playback did with it. This is the adapter's numbering, the one `speechRanges` names. An `audio` event with no ref is ignored.
2. **Local chunk.** A chunk counts only when `agentTextTarget(legs, outlets)` names a leg. It then belongs to its voice, `e.voice ?? leg`. It is registered *live* (index, target) only when `enabled() && micOpen()` at enqueue. It stays live until that voice goes idle, the target reconnects, or a placement for it is gated or refused (rule 3).
3. **Placing text.** Keep one `sentTo` per `(voice, leg, ref)`. For a range `[a, b]`: `from = max(a, sentTo)` and `to = min(b, rowText.length)`. When `to > from`, set `sentTo = to`. Then, only if `enabled() && micOpen()`, call `agentText(rowText.slice(from, to), false)` on the target. A `true` answer opens the voice's segment, held by that target. A placement that is gated, or that the socket refuses, ends the chunk's live state. A placement with nothing to send leaves it as it is. A chunk with no range places nothing.
4. **Fill-in.** `ranges` places every entry that is live for a voice again, by rule 3, with its filled-in range. This sends the words the provisional ranges had not reached. A chunk queued while the switch was off or the key was up, or whose text the socket refused, is not live, so its fill-in sends nothing: text continues from the next chunk.
5. **Voice idle.** `voiceIdle(voice)` sends `agentText('', true)` to the leg that holds the voice's open segment, whatever the switch and the key say. The segment then closes and the voice's live entries are forgotten. `sentTo` is kept, so dropped text never goes later.
6. **Reconnect.** `reconnecting(leg)` closes, without a frame, every segment `leg` holds, and forgets the live entries that target `leg`. Nothing is replayed on the next socket.

- [ ] **Step 1: Write the failing tests**

```ts
const BASE: RoutingSettings = { meeting: true, faceToFace: false, speak: { other: true, me: false, them: true }, passthrough: { on: false, ratio: 0 }, sinks: { other: {}, me: {}, them: {} } };
const outletsOf = (patch: Partial<RoutingSettings>, voice: LegName) =>
  routesFor({ ...BASE, ...patch }, false).filter((e) => e.from === voice && e.to !== 'virtual').map((e) => e.to as OutletName);
const BOTH: LegName[] = ['speaker', 'participant'];

describe('agentTextTarget — spec §4.1, row by row', () => {
  it.each([
    ['face-to-face: my voice on other', BOTH, { faceToFace: true }, 'speaker', 'speaker'],
    ['face-to-face: their voice on them', BOTH, { faceToFace: true }, 'participant', 'speaker'],
    ['Both: my voice, I hear it too on', BOTH, { speak: { other: true, me: true, them: true } }, 'speaker', 'speaker'],
    ['Both: my voice, I hear it too off', BOTH, {}, 'speaker', null],
    ['Both: their voice on them (split crosses to the speaker core)', BOTH, {}, 'participant', 'speaker'],
    ['Me: I hear it too on', ['speaker'], { speak: { other: true, me: true, them: false } }, 'speaker', 'speaker'],
    ['Me: the meeting only', ['speaker'], { speak: { other: true, me: false, them: false } }, 'speaker', null],
    ['Other: no microphone', ['participant'], { speak: { other: false, me: false, them: true } }, 'participant', null],
  ] as const)('%s', (_name, legs, patch, voice, target) => expect(agentTextTarget(legs, outletsOf(patch, voice))).toBe(target));
});

function setup() {
  const sent: Array<[LegName, string, boolean]> = [];
  const gate = { enabled: true, mic: true, up: true };
  const feed = new AgentTextFeed({
    legs: BOTH, enabled: () => gate.enabled, micOpen: () => gate.mic,
    session: (leg) => ({ agentText: (text: string, end: boolean) => { if (gate.up) sent.push([leg, text, end]); return gate.up; } }),
  });
  feed.rowText('speaker', 1, 'Hello there. How are you?');
  return { feed, sent, gate, texts: () => sent.map(([, t, e]) => [t, e]) };
}
const ME: OutletName[] = ['me'];

describe('AgentTextFeed', () => {
  it("sends each local chunk's stretch of its row as it is queued", …
    // [0,6] then [6,13] on ME → [['speaker','Hello ',false],['speaker','there. ',false]]
  it('sends nothing for a chunk on none of my outlets', …   // outlets [] → sent []
  it('a chunk with no range sends nothing; the next range carries its text', …
    // { ref: 1 } → []; then [0,13] → [['Hello there. ', false]]
  it('never sends a stretch twice', …   // [0,6] then [3,13] → 'Hello ', 'there. '
  it("closes a voice's segment once when its queue goes idle, and only a segment something opened", …
    // voiceIdle first → []; [0,6]; voiceIdle twice → [['Hello ',false],['',true]]
  it('a send the socket refused opens no segment', …   // gate.up=false; [0,6]; gate.up=true; voiceIdle → sent []
  it('the words the provisional ranges had not reached go with the fill-in, while the chunk is queued (Review Focus 1)', () => {
    const { feed, texts } = setup();
    feed.audio('speaker', { ref: 1, range: [0, 6] }, ME);
    feed.audio('speaker', { ref: 1, range: [6, 9] }, ME);
    feed.ranges('speaker', { ref: 1, ranges: [{ index: 0, range: [0, 7] }, { index: 1, range: [7, 13] }] });
    expect(texts()).toEqual([['Hello ', false], ['the', false], ['re. ', false]]);
  });
  it('a fill-in after the voice went idle sends nothing: that speech has played (Review Focus 1)', …
    // [0,6]; voiceIdle; ranges index 0 [0,13] → [['Hello ',false],['',true]]
  it('two voices on one socket open and close their own segments, a row read in the other voice keyed by that voice (Review Focus 2)', () => {
    const { feed, sent } = setup();
    feed.rowText('participant', 1, 'こんにちは。');
    feed.audio('speaker', { ref: 1, range: [0, 6] }, ['other']);
    feed.audio('participant', { ref: 1, range: [0, 6] }, ['them']);
    feed.audio('speaker', { ref: 1, range: [6, 13], voice: 'participant' }, ['them']);
    feed.voiceIdle('speaker');
    expect(sent).toEqual([['speaker', 'Hello ', false], ['speaker', 'こんにちは。', false], ['speaker', 'there. ', false], ['speaker', '', true]]);
    feed.voiceIdle('participant');
    expect(sent).toHaveLength(5);
  });
  it('a clear mid-segment ends it, and nothing of the dropped text goes after (Review Focus 3)', () => {
    const { feed, texts } = setup();
    feed.audio('speaker', { ref: 1, range: [0, 6] }, ME);
    feed.audio('speaker', { ref: 1, range: [6, 13] }, ME);
    feed.voiceIdle('speaker');
    feed.ranges('speaker', { ref: 1, ranges: [{ index: 1, range: [6, 25] }] });
    feed.audio('speaker', { ref: 1, range: [6, 19] }, ME);
    expect(texts()).toEqual([['Hello ', false], ['there. ', false], ['', true], ['How ar', false]]);
  });
  it('the switch, read at each chunk: off places text unsent, the idle still closes; on again sends from the next chunk only (Review Focus 4)', () => {
    const { feed, gate, texts } = setup();
    feed.audio('speaker', { ref: 1, range: [0, 6] }, ME);
    gate.enabled = false;
    feed.audio('speaker', { ref: 1, range: [6, 13] }, ME);
    feed.voiceIdle('speaker');
    gate.enabled = true;
    feed.audio('speaker', { ref: 1, range: [6, 19] }, ME);
    expect(texts()).toEqual([['Hello ', false], ['', true], ['How ar', false]]);
  });
  it("a manual turn's key up: nothing sent, and not later when the key goes down (Review Focus 4)", () => {
    const { feed, gate, texts } = setup();
    gate.mic = false;
    feed.audio('speaker', { ref: 1, range: [0, 6] }, ME);
    gate.mic = true;
    feed.audio('speaker', { ref: 1, range: [0, 13] }, ME);
    expect(texts()).toEqual([['there. ', false]]);
  });
  it('a reconnect mid-segment: no end frame for the next socket, nothing replayed; the next chunk opens a new segment (Review Focus 5)', () => {
    const { feed, texts } = setup();
    feed.audio('speaker', { ref: 1, range: [0, 6] }, ME);
    feed.reconnecting('speaker');
    feed.ranges('speaker', { ref: 1, ranges: [{ index: 0, range: [0, 13] }] });
    feed.voiceIdle('speaker');
    feed.audio('speaker', { ref: 1, range: [6, 13] }, ME);
    expect(texts()).toEqual([['Hello ', false], ['there. ', false]]);
  });
  it("a reconnect on a socket that holds no segment (split Both's participant core) closes nothing", …
    // [0,6]; reconnecting('participant'); voiceIdle → texts() ends with ['', true]
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lib/session/agentText.test.ts`
Expected: FAIL. Cannot find module `./agentText`.

- [ ] **Step 3: Implement `agentTextTarget` and `AgentTextFeed` by rules 1–6**

The row texts, indices and `sentTo` marks live as long as the run, as L1's rows do.

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/lib/session/agentText.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/session/agentText.ts src/lib/session/agentText.test.ts
git commit -m "feat(session): agent text feed and its routing rule (spec §4.1, §4.2)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The run sends agent text as speech is queued

**Files:**
- Modify: `src/lib/session/ports.ts` (`RunnerDeps`)
- Modify: `src/lib/session/run.ts` (the constructor; `runOpen` after `host.step('opening')` :200; `onEvent` :526-587)
- Create: `src/lib/session/runner.agentText.test.ts`

**Interfaces:**
- Consumes: `PlaybackPort.audio` → outlets, `onVoiceIdle?` (Task 4); `AgentTextFeed` (Task 5); `AdapterSession.agentText?` (Task 3).
- Produces:

```ts
// RunnerDeps
/** Keep the read-aloud translation out of recognition, live (spec 2026-11-05 §4.4): read at each chunk. Absent: nothing is sent. */
agentText?: { get(): boolean };
```

The wiring:
- The run owns one `AgentTextFeed` (`agentTextFeed`), built with:
  - `legs: shape.legs`
  - `enabled: () => deps.agentText?.get() ?? false`
  - `micOpen: () => shape.turnMode === 'auto' || this.turn?.isOpen === true`
  - `session: (leg) => this.sessions.get(leg)`
- In `onEvent`, past the `ending` check:
  - `segmentText` → `rowText`
  - `audio` → `audio(leg, payload, playback.audio(…))`
  - `speechRanges` → `ranges`
  - `reconnecting` → `reconnecting(leg)`, besides what it does today
- In `runOpen`, after `host.step('opening')`: subscribe with `deps.playback.onVoiceIdle?.((voice) => this.agentTextFeed.voiceIdle(voice))`, and defer the unsubscribe on the stack as `'agent text'`. The runner calls `playback.clear()` before `run.close()`, so a stop still closes an open segment while the sessions are open.

- [ ] **Step 1: Write the failing tests**

Harness `setup({ legs?, turnMode?, switchPort? })`:
- Use `createRunner` with `createFakeSource(clock)` sources.
- The provider is `{ ...fakeProvider, start }`. Its `start` names the leg by `request.context.direction.source === 'en'`, keeps that leg's `events`, and returns a session whose `agentText` appends `` `${leg}:${JSON.stringify([text, end])}` `` to `log` and returns true. The session's `stop` appends `` `${leg}:stop` ``.
- The playback answers `audio: () => outlets.now`, with `['me']` by default. Its `onVoiceIdle` keeps the listener, and its `clear` calls that listener for both voices.
- Unless `switchPort` is false, `agentText: { get: () => on.value }`.
- Helpers:
  - `row(leg, ref, text)` sends `segmentOpened` (`side: 'translation'`) and then `segmentText`.
  - `chunk(leg, ref, range?, voice?)` sends `audio` with 240 samples.
  - `idle(voice)` calls the kept listener.
  - `events(leg)` returns that leg's kept `AdapterEvents`.

```ts
it("sends a chunk queued on my outlet on the speaker session", async () => {
  const h = setup(); await h.runner.start();
  h.row('speaker', 1, 'Hello there.'); h.chunk('speaker', 1, [0, 6]);
  expect(h.log).toEqual(['speaker:["Hello ",false]']);
});
it("split Both: the participant row's chunk on them goes to the speaker session, never the participant's (Review Focus 2)", async () => {
  const h = setup({ legs: ['speaker', 'participant'] }); h.outlets.now = ['them']; await h.runner.start();
  h.row('participant', 1, 'こんにちは。'); h.chunk('participant', 1, [0, 6]);
  expect(h.log).toEqual(['speaker:["こんにちは。",false]']);
});
it('a stop closes the open segment before any session stops (Review Focus 3)', async () => {
  const h = setup(); await h.runner.start();
  h.row('speaker', 1, 'Hello there.'); h.chunk('speaker', 1, [0, 6]);
  await h.runner.stop();
  expect(h.log).toEqual(['speaker:["Hello ",false]', 'speaker:["",true]', 'speaker:stop']);
});
it('reads the switch at each chunk (Review Focus 4)', …
  // on.value=false → chunk [0,6] → log []; on.value=true → chunk [6,12] → ['speaker:["there.",false]']
it('push-to-talk: nothing while the key is up; after a press, only the next chunk goes (Review Focus 4)', async () => {
  const h = setup({ turnMode: 'push-to-talk' }); await h.runner.start();
  h.row('speaker', 1, 'Hello there.'); h.chunk('speaker', 1, [0, 6]);
  expect(h.log).toEqual([]);
  h.runner.press(); h.chunk('speaker', 1, [6, 12]);
  h.runner.release(); h.idle('speaker');
  expect(h.log).toEqual(['speaker:["there.",false]', 'speaker:["",true]']);
});
it('a fill-in reaches the feed: the rest of the sentence goes while its chunk is queued (Review Focus 1)', …
  // chunk [0,6]; events('speaker').speechRanges({ ref: 1, ranges: [{ index: 0, range: [0, 12] }] }) → + 'speaker:["there.",false]'
it('a reconnecting speaker leg leaves no segment for the next socket (Review Focus 5)', …
  // chunk [0,6]; events('speaker').reconnecting(); idle('speaker') → no end frame; reconnected(); chunk [6,12] → sent
it('without the switch port nothing is sent', …   // switchPort false → log [] after a chunk
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lib/session/runner.agentText.test.ts`
Expected: FAIL. `log` is empty because nothing calls `agentText`.

- [ ] **Step 3: Wire the feed into `run.ts` and add `RunnerDeps.agentText`, as stated**

- [ ] **Step 4: Run the session suites and the types**

Run: `npx vitest run src/lib/session && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/session/ports.ts src/lib/session/run.ts src/lib/session/runner.agentText.test.ts
git commit -m "feat(session): the run sends agent text as speech is queued" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The switch's store, wired to the runner

**Files:**
- Modify: `src/stores/settingsStore.ts`: beside `keepReplayAudio` in each place it appears (`CommonSettings` :64-75, `defaultCommonSettings` :160-172, the store's fields :220-232, the setter :454-460, `loadSettings` :693 and :737, the selectors :866-867)
- Modify: `src/lib/session/appShape.ts` (beside `appReplayAudio` :217-223)
- Modify: `src/app/session.ts` (the runner's deps :131-167, the playback load :224)
- Modify: each mocked `playback` the suite flags with `onVoiceIdle is not a function` gets `onVoiceIdle: () => () => {}`. Expected: the ten files with a mocked `passthrough`: `src/app/{session,AppSessionRoot,useAppSession,useRun}.test.*`, `src/components/dev/{SpinePreview,SessionControls}.test.tsx`, `src/components/MainPanel/MainPanel{,.tone,.microphone}.test.tsx`, `src/components/Subtitle/SubtitleTakeover.test.tsx`.
- Test: `src/stores/settingsStore.test.ts`, `src/lib/session/appShape.test.ts`, `src/app/session.test.ts`

**Interfaces:**
- Consumes: `Playback.onVoiceIdle` (Task 4); `RunnerDeps.agentText` (Task 6).
- Produces:
  - `agentText: boolean`: default `true`, key `settings.common.agentText`.
  - `setAgentText(agentText: boolean): Promise<void>`: persists, and rolls back on a failed write, as `setKeepReplayAudio` does.
  - `useAgentText()` and `useSetAgentText()`.
  - `export const appAgentText: { get(): boolean }` (it reads `useSettingsStore.getState().agentText`).
- `session.ts` passes `agentText: appAgentText`. The port's `onVoiceIdle` adds to a listener set the session owns. When the playback loads, it is subscribed once and forwards to that set.

- [ ] **Step 1: Write the failing tests**

```ts
// settingsStore.test.ts, mirroring describe('keepReplayAudio')
describe('agentText (spec 2026-11-05 §4.4)', () => {
  it('defaults to true when storage has no stored value', …   // set false first; loadSettings with fallbacks → true
  it('setAgentText(false) updates state and persists', …       // expect(mockSetSetting).toHaveBeenCalledWith('settings.common.agentText', false)
  it('rolls back state when persistence fails', …
});
// appShape.test.ts
it('appAgentText reads the switch as it stands', () => {
  useSettingsStore.setState({ agentText: false }); expect(appAgentText.get()).toBe(false);
  useSettingsStore.setState({ agentText: true }); expect(appAgentText.get()).toBe(true);
});
// session.test.ts (its mocked playback gains onVoiceIdle: vi.fn(() => () => {}))
it("subscribes to the playback's voice idles once, when it loads", async () => {
  const { session } = await setup();
  expect(playback.onVoiceIdle).not.toHaveBeenCalled();
  await session.audio(); await session.audio();
  expect(playback.onVoiceIdle).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/stores/settingsStore.test.ts src/lib/session/appShape.test.ts src/app/session.test.ts`
Expected: FAIL. `agentText` is undefined, `appAgentText` is not exported, and `onVoiceIdle` is never called.

- [ ] **Step 3: Implement the store field, `appAgentText` and the session wiring; fix the flagged mocks**

- [ ] **Step 4: Run the app and component suites and the types**

Run: `npx vitest run src/stores src/lib/session src/app src/components && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

Stage the ones Step 3 touched by name.

```bash
git add src/stores/settingsStore.ts src/lib/session/appShape.ts src/app/session.ts src/stores/settingsStore.test.ts src/lib/session/appShape.test.ts src/app/session.test.ts <each mock file fixed>
git commit -m "feat(settings): keep the read-aloud translation out of recognition, wired to the run" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The switch in the Speech section, in 30 catalogs

**Files:**
- Modify: `src/lib/provider/types.ts` (capabilities, beside `faceToFace?` :392)
- Modify: `src/lib/provider/managed.ts:74` (the twin keeps it)
- Modify: `src/providers/soniox/provider.ts` (`agentText: true`)
- Modify: `src/components/Settings/sections/SpeechOutputSection.tsx` (a row just before "Keep spoken translations for replay" :330)
- Modify: `src/locales/*/translation.json` (all 30): `audioPanel.agentText` and `audioPanel.agentTextTip`, after `audioPanel.keepReplayNothingSpoken`
- Test: `src/components/Settings/sections/SpeechOutputSection.test.tsx`, `src/lib/provider/managed.test.ts`

**Interfaces:**
- Consumes: `useAgentText`, `useSetAgentText` (Task 7).
- Produces:

```ts
// Provider
/** Its STT socket takes the text its own voice is about to play (Soniox agent text, spec 2026-11-05): the Speech section offers the switch. Absent: no switch. */
agentText?: true;
```

English copy (spec §4.4; the copy owner may reword it before merge):
- `audioPanel.agentText`: `Keep the read-aloud translation out of recognition`
- `audioPanel.agentTextTip`: `Sends the text about to be read aloud to the recognition service ahead of playback, so speech from your speakers is not taken for someone talking. When speech plays on this computer, this adds a small charge (a few US cents per hour of speech).`

Each other catalog gets a real translation that uses that catalog's own words for "translation", "recognition" and "read aloud" from its existing `audioPanel.*` strings. Keep "US cents" as a currency the reader understands.

The row is drawn only when `provider?.agentText === true`. It is a `SettingRow` with the label and the tooltip. Its switch is `{ checked: agentText, onChange: () => setAgentText(!agentText) }`, never greyed and never disabled, because it changes from the next chunk, during a run too.

- [ ] **Step 1: Write the failing tests**

```ts
// SpeechOutputSection.test.tsx: the existing first test expects seven rows and seven tooltip triggers
expect(labels).toEqual(['Default playback device', 'Translation the other side hears', 'I hear it too', 'Passthrough', 'Translation I hear', 'Keep the read-aloud translation out of recognition', 'Keep spoken translations for replay']);

describe('SpeechOutputSection — Keep the read-aloud translation out of recognition (spec 2026-11-05 §4.4)', () => {
  const LABEL = 'Keep the read-aloud translation out of recognition';
  it('shows the setting, flips it, and stays live during a run', () => {
    useSettingsStore.setState({ agentText: true });
    mount(true);
    expect(sw(LABEL)).toHaveAttribute('aria-checked', 'true');
    expect(sw(LABEL)).not.toBeDisabled();
    fireEvent.click(sw(LABEL));
    expect(useSettingsStore.getState().agentText).toBe(false);
  });
  it('says what it sends and that it costs a little', () => {
    mount();
    expect(tooltips).toContain('Sends the text about to be read aloud to the recognition service ahead of playback, so speech from your speakers is not taken for someone talking. When speech plays on this computer, this adds a small charge (a few US cents per hour of speech).');
  });
  it('is absent for a provider whose socket takes no agent text', () => {
    useProviderStore.setState({ selected: 'local_inference', entries: { local_inference: { settings: LOCAL_INFERENCE_DEFAULTS, credentials: {}, pair: { source: 'ja', target: 'en' } } } } as never);
    mount();
    expect(screen.queryByText(LABEL)).toBeNull();
  });
});
// managed.test.ts
it("keeps the base's agent text capability, and adds none", () => {
  expect(managed({ ...fakeProvider, agentText: true } as never, OVERRIDES).agentText).toBe(true);
  expect(managed(fakeProvider, OVERRIDES)).not.toHaveProperty('agentText');
});
```

The `beforeEach` in `SpeechOutputSection.test.tsx` also resets `agentText: true` beside `keepReplayAudio`.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/components/Settings/sections/SpeechOutputSection.test.tsx src/lib/provider/managed.test.ts`
Expected: FAIL. Six rows are drawn, and no `agentText` exists on the twin.

- [ ] **Step 3: Add the capability, the row and the 60 strings**

- [ ] **Step 4: Run the tests, the catalogs and the types**

Run: `npx vitest run src/components/Settings src/lib/provider src/locales src/providers/soniox && npx tsc --noEmit`
Expected: PASS. `locales.consistency.test.ts` finds both keys in all 30 catalogs.

- [ ] **Step 5: Commit**

```bash
git add src/lib/provider/types.ts src/lib/provider/managed.ts src/providers/soniox/provider.ts src/components/Settings/sections/SpeechOutputSection.tsx src/components/Settings/sections/SpeechOutputSection.test.tsx src/lib/provider/managed.test.ts src/locales/*/translation.json
git commit -m "feat(speech): the agent text switch in the Speech section, in 30 locales" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The measurement checklist the pull request quotes

**Files:**
- Create: `docs/superpowers/notes/2026-11-05-agent-text-measurement.md`

**Interfaces:** none. The pull request description quotes this file and fills in its Result column.

- [ ] **Step 1: Write the file with exactly this content**

```markdown
# Soniox agent text: measurement before merge

Spec §8 (`docs/superpowers/specs/2026-11-05-agent-text-input-design.md`). The phase 1 pull request copies this list and fills in each result. CI runs none of it.

Rig: Linux with PipeWire; a virtual speaker whose output passes a room impulse response and a delay into a virtual microphone; the app run against it with recorded speakers whose script differs from the translations; a Soniox API key of the team's own.

| # | Run | Result |
|---|---|---|
| 1 | A temporary key minted the way the backend does accepts `enable_agent_text_input` | |
| 2 | Face-to-face and split Both, echo cancellation on and off, agent text on and off: lines from the app's own voice, and lines translated back | |
| 2a | The flag on with no text sent, against the flag off: recognition of the same script | |
| 3 | Talk-over: recognition errors on turns started during playback | |
| 4 | A deliberate verbatim repeat of a translation just played | |
| 5 | Cost: the same script with and without agent text, from Soniox's usage records | |

Merge bar:
- [ ] With echo cancellation off, agent text removes at least 80% of the lines from the app's own voice, face-to-face and split Both.
- [ ] Talk-over recognition with agent text is no worse than without it, beyond run-to-run noise.
- [ ] Run 2a shows no change. If it does, the narrow flag rule (§4.3) replaces the broad one before merge.
- [ ] Run 1 accepted. If refused, managed sessions leave the flag off (§4.6) before merge.
- [ ] The repeat result (run 4) is recorded here, whatever it is.

Sending at play time instead of at enqueue (§5) is not part of this delivery.
```

- [ ] **Step 2: Verify it**

Run: `grep -cE '^\| (1|2|2a|3|4|5) \|' docs/superpowers/notes/2026-11-05-agent-text-measurement.md && grep -c '^- \[ \]' docs/superpowers/notes/2026-11-05-agent-text-measurement.md`
Expected: `6`, then `5`.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/notes/2026-11-05-agent-text-measurement.md
git commit -m "docs(soniox): agent text measurement checklist for the pull request" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
