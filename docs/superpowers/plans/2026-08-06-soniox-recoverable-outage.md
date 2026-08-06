# Soniox Recoverable Outage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a Soniox session dies for a reason the user did not cause, show a localized "the connection was interrupted — tap Start in a moment to continue" notice instead of the server's raw English error frame (or, for a bare network drop, nothing at all).

**Architecture:** Every change lives inside `src/services/clients/SonioxClient.ts` and goes out through the seam every client in this repo already uses — the client pushes a `role: 'system', type: 'error'` `ConversationItem` onto its own `conversationItems` and fires `onConversationUpdated`. MainPanel renders those generically. The existing 403 duration-cutoff notice is moved onto the same seam, which deletes the codebase's only provider-specific `onClose` field (`sonioxDurationCutoff`) and its MainPanel branch. `sokuji-backend` needs no change.

**Tech Stack:** TypeScript, React 19, Vitest (`npm run test`), i18next (30 catalogs under `src/locales/*/translation.json`).

**Spec:** `docs/superpowers/specs/2026-08-06-soniox-recoverable-outage-design.md`

## Amendments after review

The task steps below are kept as they were executed. Three things changed
afterwards, in review; the spec describes the shipped design, this plan does
not:

1. **`sawSttErrorFrame` was renamed `sttOutcomeAnnounced`** and its meaning
   widened from "an error frame arrived" to "the user has already been told
   why this stream is ending". Every step below that names the old field means
   the new one.
2. **Graceful endings must set that flag too.** `handleBudgetExhausted`
   announces the balance message and then calls `stt.end()`; without the flag
   the resulting close reported an outage on top of it and — because teardown
   replaces the list with `getConversationItems()` — the outage was the only
   message left. Any future path that ends the stream deliberately must either
   announce an outcome or bump `generation`.
3. **`handleSttClose` returns immediately on a stale `gen`**, before touching
   any state, rather than only skipping the notice. A stale close used to
   clear `isConnectedState` and call `onClose` on whatever session was live by
   then.

Tasks 1-5 predate all three. Read the spec for the design as shipped.

## Global Constraints

- All code comments and identifiers in English. Follow this repo's comment style: say *why*, not *what*.
- Never break the no-interruption rule: `createResponse`/`cancelResponse` stay no-ops, `onConversationInterrupted` is never fired.
- `MainPanel.tsx` gains **no** new logic in this plan. It only loses the `sonioxDurationCutoff` block (Task 5). All decisions live in `SonioxClient` because `MainPanel.tsx` has no test file.
- `onError` keeps firing for recoverable outages — it is what produces the `api_error` analytics event. Do not suppress it.
- The English source string is exactly: `The connection was interrupted — tap Start in a moment to continue.` The dash is an em dash (U+2014), and "in a moment" is deliberate (the lease takes 2–5 s to release; see the spec's Known limitations). Do not reword it.
- Assert i18n-derived text with a case-insensitive regex, never exact string equality — the house convention in this test file (`SonioxClient.test.ts:172`, `:812`). Exact equality on a sentence containing an em dash is a needless trap.
- Only `en` is bundled into i18next at init (`src/locales/index.ts:47`), so `i18n.t(...)` in tests always resolves to English.
- Run the full suite with `npm run test -- --run` before each commit; a single file with `npm run test -- --run src/services/clients/SonioxClient.test.ts`.
- Do **not** gate on `tsc` — this repo has roughly 113 pre-existing type errors. The build is Vite/esbuild and the correctness gate is vitest.
- Conventional commit messages. Do not push and do not open a PR — the user approves those separately.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/services/clients/SonioxClient.ts` | All outage classification and notice emission | Modify (Tasks 1, 2, 3, 5) |
| `src/services/clients/SonioxClient.test.ts` | BYOK behaviour | Modify (Tasks 1, 2, 3, 5) |
| `src/services/clients/SonioxClient.managed.test.ts` | Managed-twin behaviour | Modify (Tasks 1, 2, 5) |
| `src/components/MainPanel/MainPanel.tsx` | Renders whatever the client holds | Modify (Task 5, deletion only) |
| `src/locales/*/translation.json` (30 files) | UI copy | Modify (Task 4) |

---

### Task 1: Recoverable-outage classification for error frames

Splits STT error frames into two buckets. `503` / `408` / `socket_error` become a localized, actionable notice; everything else keeps today's `[Soniox <code>] <message>` raw path. Introduces the single emission point (`emitSystemNotice`) that Tasks 2, 3 and 5 reuse.

**Files:**
- Modify: `src/services/clients/SonioxClient.ts`
- Test: `src/services/clients/SonioxClient.test.ts`, `src/services/clients/SonioxClient.managed.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `private emitSystemNotice(text: string): void` — builds the system item, pushes it onto `this.conversationItems`, fires `onConversationUpdated`.
  - `private surfaceRecoverableOutage(code: string, message: string): void` — localized notice + `session.connection_lost` debug event + `onError` carrying the localized text.
  - module-level `const RECOVERABLE_STT_CODES: ReadonlySet<string>`.
  - test-file constants `OUTAGE` and `SEGMENT_ENDED` (regexes), used by Tasks 2, 3 and 5.

- [ ] **Step 1: Add the shared test matchers**

In `src/services/clients/SonioxClient.test.ts`, immediately after the `BASE_CONFIG` declaration, add:

```ts
// i18n-derived copy is matched loosely (house convention, see the TTS-degraded
// assertions below) — the point is which SENTENCE the user gets, not its exact
// punctuation.
const OUTAGE = /the connection was interrupted/i;
const SEGMENT_ENDED = /this segment has ended/i;
```

Add the identical two lines after `BASE_CONFIG` in `src/services/clients/SonioxClient.managed.test.ts`.

- [ ] **Step 2: Write the failing tests**

Append to the end of `src/services/clients/SonioxClient.managed.test.ts`:

```ts
describe('SonioxClient managed recoverable outages', () => {
  it('a managed 503 shows a localized notice, not the raw wire text', async () => {
    mockFetchOnce(200, speechToSpeechResponse());
    const client = managedClient();
    const errors: any[] = [];
    client.setEventHandlers({ onError: (e) => errors.push(e) });
    await client.connect({ ...BASE_CONFIG, textOnly: false });
    const stt = sttInstances.at(-1)!;

    stt.handlers.onError?.('503', 'service unavailable');

    const items = client.getConversationItems();
    expect(items).toHaveLength(1);
    expect(items[0].role).toBe('system');
    expect(items[0].type).toBe('error');
    expect(items[0].formatted?.text).toMatch(OUTAGE);
    expect(items[0].formatted?.text).not.toMatch(/^\[Soniox/);
    // onError still fires (api_error analytics) and carries the same words.
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe('503');
    expect(errors[0].message).toMatch(OUTAGE);
  });

  it('keeps the raw server text in the debug timeline', async () => {
    mockFetchOnce(200, speechToSpeechResponse());
    const client = managedClient();
    const events: any[] = [];
    client.setEventHandlers({ onRealtimeEvent: (e: any) => events.push(e.event) });
    await client.connect({ ...BASE_CONFIG, textOnly: false });
    const stt = sttInstances.at(-1)!;

    stt.handlers.onError?.('503', 'service unavailable');

    const lost = events.find((e) => e.type === 'session.connection_lost');
    expect(lost).toBeDefined();
    expect(lost.data).toMatchObject({ code: '503', message: 'service unavailable' });
  });
});
```

Append to the end of `src/services/clients/SonioxClient.test.ts`:

```ts
describe('SonioxClient recoverable outages (BYOK)', () => {
  it('408 (no audio for ~20s) reads as a recoverable outage', async () => {
    const { client } = await connectedClient();
    const stt = sttInstances.at(-1)!;

    stt.handlers.onError?.('408', 'Request timeout');

    expect(client.getConversationItems().at(-1)!.formatted?.text).toMatch(OUTAGE);
  });

  it('socket_error reads as a recoverable outage', async () => {
    const { client } = await connectedClient();
    const stt = sttInstances.at(-1)!;

    stt.handlers.onError?.('socket_error', 'Error: network down');

    expect(client.getConversationItems().at(-1)!.formatted?.text).toMatch(OUTAGE);
  });

  it('an error the user can act on keeps the raw wire text', async () => {
    const { client } = await connectedClient();
    const stt = sttInstances.at(-1)!;

    stt.handlers.onError?.('401', 'invalid api key');

    expect(client.getConversationItems().at(-1)!.formatted?.text)
      .toBe('[Soniox 401] invalid api key');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm run test -- --run src/services/clients/SonioxClient.managed.test.ts src/services/clients/SonioxClient.test.ts`
Expected: the four new outage tests FAIL — the item text is still `[Soniox 503] service unavailable` and no `session.connection_lost` event exists. The `401` test PASSES already (that path is unchanged) and is the regression guard for Step 5.

- [ ] **Step 4: Add the classification constant**

In `src/services/clients/SonioxClient.ts`, after the `AUTH_PROBE_URL` constant near the top of the file, add:

```ts
/**
 * STT failures the user did not cause and cannot fix from the settings — the
 * only useful response is to start again:
 *  - 503: service unavailable. Transient by definition.
 *  - 408: request timeout, i.e. no audio reached Soniox for ~20 s. Reachable
 *    in a live session when input stops (a long mute), so it is a dead
 *    session, not a misconfiguration.
 *  - socket_error: SonioxSttStream's own code for a transport-level failure.
 * Everything else (400/401/429/…) stays on surfaceSttError's raw path, where
 * the server's own words ARE the actionable part and replacing them with a
 * generic sentence would hide the fix.
 */
const RECOVERABLE_STT_CODES: ReadonlySet<string> = new Set(['503', '408', 'socket_error']);
```

- [ ] **Step 5: Extract the emission point and add the outage path**

In `src/services/clients/SonioxClient.ts`, replace the whole `surfaceSttError` method with these three methods:

```ts
  /**
   * Push a system notice into the conversation.
   *
   * This is the seam every client in this repo uses to reach the UI:
   * MainPanel renders `type: 'error'` items generically and
   * `conversationFilter` shows system items unconditionally, so no
   * provider-specific plumbing is needed. Load-bearing detail: only items the
   * CLIENT holds survive teardown, because MainPanel's disconnect path calls
   * setItems(client.getConversationItems()) — an item minted by the UI is
   * wiped by that call moments after it appears.
   */
  private emitSystemNotice(text: string): void {
    const item: ConversationItem = {
      id: this.generateItemId('error'),
      role: 'system',
      type: 'error',
      status: 'completed',
      formatted: { text },
      content: [{ type: 'text', text }],
    };
    this.conversationItems.push(item);
    this.eventHandlers.onConversationUpdated?.({ item });
  }

  /**
   * Generic STT error surfacing: a system-role error ConversationItem plus
   * onError. Shared by handleSttError's fallthrough (an error that is neither
   * the managed-403 cutoff, nor a resumable 503, nor a recoverable outage).
   */
  private surfaceSttError(code: string, message: string): void {
    console.error(`[SonioxClient] STT error ${code}: ${message}`);
    this.emitSystemNotice(`[Soniox ${code}] ${message}`);
    this.eventHandlers.onError?.({ code, message });
  }

  /**
   * A failure the user can only answer by starting again. Say that in their
   * language; keep the server's own words for the debug timeline, where they
   * are diagnostic rather than noise.
   *
   * onError still fires — it is what produces the `api_error` analytics
   * event, so suppressing it would silently lose outage telemetry. The extra
   * bubble MainPanel appends from onError is transient: the teardown that
   * follows replaces the list with getConversationItems(), leaving exactly
   * the one item emitted here.
   */
  private surfaceRecoverableOutage(code: string, message: string): void {
    console.warn(`[SonioxClient] STT connection lost (${code}): ${message}`);
    this.emitRealtime('client', 'session.connection_lost', { provider: 'soniox', code, message });
    const text = i18n.t(
      'mainPanel.sonioxConnectionLost',
      'The connection was interrupted — tap Start in a moment to continue.'
    );
    this.emitSystemNotice(text);
    this.eventHandlers.onError?.({ code, message: text });
  }
```

- [ ] **Step 6: Route recoverable codes in `handleSttError`**

In `src/services/clients/SonioxClient.ts`, in `handleSttError`, replace the final line `this.surfaceSttError(code, message);` with:

```ts
    // Ordered last of the three special cases on purpose: the managed-403
    // cutoff and the BYOK-503 resume ladder above both claim codes that would
    // otherwise match here, and both must keep winning.
    if (RECOVERABLE_STT_CODES.has(code)) {
      this.surfaceRecoverableOutage(code, message);
      return;
    }
    this.surfaceSttError(code, message);
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm run test -- --run src/services/clients/SonioxClient.managed.test.ts src/services/clients/SonioxClient.test.ts`
Expected: PASS, whole files.

Note the pre-existing test `after 3 failed reconnect attempts (0/1000/3000ms gaps), surfaces the ORIGINAL 503 message and closes the session` stays green here on purpose: a BYOK 503 is claimed by the resume branch ABOVE the new one, and the exhausted ladder still ends in `surfaceSttError` until Task 3 changes it. If that test fails now, the new branch was inserted above the resume branch instead of below it.

- [ ] **Step 7b: Run the full suite**

Run: `npm run test -- --run`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/services/clients/SonioxClient.ts src/services/clients/SonioxClient.test.ts src/services/clients/SonioxClient.managed.test.ts
git commit -m "feat(soniox): show a recoverable-outage notice instead of raw wire errors"
```

---

### Task 2: Notice for a close with no error frame

A plain network drop can close the socket without any error frame. Today that is completely silent. This is the one genuinely new code path, guarded so a clean Stop stays silent.

**Files:**
- Modify: `src/services/clients/SonioxClient.ts`
- Test: `src/services/clients/SonioxClient.test.ts`, `src/services/clients/SonioxClient.managed.test.ts`

**Interfaces:**
- Consumes: `surfaceRecoverableOutage(code, message)` and the `OUTAGE` regex from Task 1.
- Produces:
  - `private sawSttErrorFrame: boolean` — per-stream flag, cleared in `wireSttHandlers` and `reset()`.
  - `private handleSttClose(event: { code?: number; reason?: string }, gen: number): void` — the second parameter is new; `wireSttHandlers` captures `this.generation` at wire time and passes it. Task 5 edits this method's cutoff branch but not its signature.

- [ ] **Step 1: Write the failing tests**

Append these four tests **inside** the `describe('SonioxClient recoverable outages (BYOK)', …)` block created in Task 1:

```ts
  it('a close with no preceding error frame is reported as a lost connection', async () => {
    const { client } = await connectedClient();
    const stt = sttInstances.at(-1)!;
    const closeEvents: any[] = [];
    client.setEventHandlers({ onClose: (e) => closeEvents.push(e) });

    stt.handlers.onClose?.({ code: 1006, reason: '' });

    expect(client.getConversationItems().at(-1)!.formatted?.text).toMatch(OUTAGE);
    // The close still reaches MainPanel so the session tears down as before.
    expect(closeEvents).toHaveLength(1);
  });

  it('a close that FOLLOWS an error frame does not add a second notice', async () => {
    const { client } = await connectedClient();
    const stt = sttInstances.at(-1)!;

    stt.handlers.onError?.('401', 'invalid api key');
    stt.handlers.onClose?.({ code: 1006, reason: '' });

    expect(client.getConversationItems()).toHaveLength(1);
    expect(client.getConversationItems()[0].formatted?.text).toBe('[Soniox 401] invalid api key');
  });

  it('the late close that follows a user-initiated Stop stays silent', async () => {
    const { client } = await connectedClient();
    const stt = sttInstances.at(-1)!;

    await client.disconnect();
    // A real browser fires onclose asynchronously, AFTER disconnect() already
    // called ws.close() and returned.
    stt.handlers.onClose?.({ code: 1000, reason: '' });

    expect(client.getConversationItems()).toHaveLength(0);
  });

  it('a stale close from a previous session does not notify the new one', async () => {
    const { client } = await connectedClient();
    const stt0 = sttInstances.at(-1)!;

    await client.connect({ ...BASE_CONFIG, textOnly: false }); // second session
    stt0.handlers.onClose?.({ code: 1006, reason: 'late' });   // old socket dies late

    expect(client.getConversationItems()).toHaveLength(0);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- --run src/services/clients/SonioxClient.test.ts`
Expected: `a close with no preceding error frame…` FAILS (no item is produced — `.at(-1)` on an empty array throws). The other three PASS today; they are the regression guards for Step 3 and must stay green.

- [ ] **Step 3: Add the per-stream flag and the generation capture**

In `src/services/clients/SonioxClient.ts`, add this instance field immediately after the `pendingSttResume503` declaration:

```ts
  // True once ANY error frame has been seen on the CURRENT stream. Read by
  // handleSttClose's fall-through to tell "the socket died with no warning"
  // (say so) from "we already told the user why" (stay quiet). Set at the top
  // of handleSttError, BEFORE its early returns, so the cutoff and resume
  // paths count as having spoken too — a 503 whose close never arrives must
  // not let a later close file a second, contradictory report. Cleared per
  // stream in wireSttHandlers, and by reset().
  private sawSttErrorFrame = false;
```

Replace `wireSttHandlers` with:

```ts
  private wireSttHandlers(stream: SonioxSttStream): void {
    // Captured at wire time. Both connect() and disconnect() bump
    // `generation`, so comparing it inside onClose is what distinguishes a
    // live socket dying from the close event a browser fires asynchronously
    // for a socket disconnect() already closed. Without this, a clean Stop
    // would end with a "connection interrupted" notice.
    const gen = this.generation;
    this.sawSttErrorFrame = false;
    stream.setHandlers({
      onMessage: (message) => this.handleSttMessage(message),
      onError: (code, message) => this.handleSttError(code, message),
      onClose: (event) => this.handleSttClose(event, gen),
      // The meter's own clock, not a second timer — see onTick's docstring
      // on SonioxSttStreamHandlers. A no-op while costMeter is null (BYOK).
      onTick: () => this.costMeter?.tick(Date.now()),
    });
  }
```

Add `this.sawSttErrorFrame = false;` to `reset()`, immediately after `this.pendingSttResume503 = null;`.

Add this as the **first statement** of `handleSttError`, above the managed-403 branch:

```ts
    this.sawSttErrorFrame = true;
```

- [ ] **Step 4: Emit the notice from the fall-through close**

In `src/services/clients/SonioxClient.ts`, change the signature of `handleSttClose` to:

```ts
  private handleSttClose(event: { code?: number; reason?: string }, gen: number): void {
```

and replace its final two statements (`this.emitRealtime('client', 'session.closed', { provider: 'soniox', ...event });` and `this.eventHandlers.onClose?.(event);`) with:

```ts
    // A close with nothing said before it is the shape of a network drop (or
    // a server going away): the user has been told nothing at all, and this
    // was the last silent failure left. Guarded on `gen` so the close that
    // trails a user-initiated Stop — disconnect() bumps generation before it
    // closes the socket — never reports an outage that did not happen.
    if (!this.sawSttErrorFrame && gen === this.generation) {
      this.surfaceRecoverableOutage(
        String(event.code ?? 'socket_closed'),
        event.reason || 'The Soniox connection closed unexpectedly'
      );
    }
    this.emitRealtime('client', 'session.closed', { provider: 'soniox', ...event });
    this.eventHandlers.onClose?.(event);
```

- [ ] **Step 5: Update the managed test that asserted silence on a bare close**

In `src/services/clients/SonioxClient.managed.test.ts`, replace the whole test named `a normal close with no preceding 403 is not tagged — no auto-reconnect signal either way` with:

```ts
  it('a close with no preceding 403 reports a lost connection, not a cutoff', async () => {
    mockFetchOnce(200, speechToSpeechResponse());
    const client = managedClient();
    const closeEvents: any[] = [];
    client.setEventHandlers({ onClose: (e) => closeEvents.push(e) });
    await client.connect({ ...BASE_CONFIG, textOnly: false });
    const stt = sttInstances.at(-1)!;

    stt.handlers.onClose?.({ code: 1000, reason: '' });

    expect(closeEvents).toHaveLength(1);
    expect(closeEvents[0].sonioxDurationCutoff).toBeUndefined();
    expect(client.getConversationItems().at(-1)!.formatted?.text).toMatch(OUTAGE);
  });
```

- [ ] **Step 6: Run the affected files**

Run: `npm run test -- --run && npm run test -- --run src/services/clients/SonioxClient.test.ts src/services/clients/SonioxClient.managed.test.ts`
Expected: PASS. If `C1: a 503 with no close, followed by disconnect(), does not let a later close start a zombie resume` fails, the `sawSttErrorFrame` assignment is in the wrong place — it must be the FIRST statement of `handleSttError`, before the 403 and 503 branches return.

- [ ] **Step 7: Commit**

```bash
git add src/services/clients/SonioxClient.ts src/services/clients/SonioxClient.test.ts src/services/clients/SonioxClient.managed.test.ts
git commit -m "feat(soniox): report a bare socket close instead of ending the session silently"
```

---

### Task 3: BYOK exhausted resume ladder uses the same ending

After three failed reconnects the BYOK story is identical to a managed 503 — "the service was unavailable and never came back" — so it should read identically. This also fixes the one pre-existing test Task 1 knowingly broke.

**Files:**
- Modify: `src/services/clients/SonioxClient.ts`
- Test: `src/services/clients/SonioxClient.test.ts` (update the existing exhausted-ladder test; add no new one)

**Interfaces:**
- Consumes: `surfaceRecoverableOutage(code, message)` and `OUTAGE` from Task 1.
- Produces: nothing new.

- [ ] **Step 1: Update the existing exhausted-ladder test**

In `src/services/clients/SonioxClient.test.ts`, in the test named `after 3 failed reconnect attempts (0/1000/3000ms gaps), surfaces the ORIGINAL 503 message and closes the session` (inside `describe('SonioxClient STT 503 auto-resume: all attempts fail', …)`), rename it to:

```ts
  it('after 3 failed reconnect attempts (0/1000/3000ms gaps), ends with the outage notice and keeps the ORIGINAL 503 message in the debug timeline', async () => {
```

and replace these two lines:

```ts
    // The ORIGINAL 503 message — not whatever the 3rd attempt's rejection said.
    expect(errors[0].message).toBe('capacity exceeded');
```

with:

```ts
    // The user gets the same sentence a managed outage produces — by this
    // point the two stories are the same one.
    expect(errors[0].message).toMatch(OUTAGE);
    expect(updates.at(-1)!.item.formatted?.text).toMatch(OUTAGE);
    // The ORIGINAL 503 message — not whatever the 3rd attempt's rejection
    // said — is preserved where it is diagnostic rather than noise.
    const lost = realtimeEvents.find((e) => e.event.type === 'session.connection_lost');
    expect(lost!.event.data).toMatchObject({ code: '503', message: 'capacity exceeded' });
```

Leave every other assertion in that test untouched — `sttInstances` length 4, `errors` length 1, `errors[0].code === '503'`, the `session.stt_resume_failed` milestone, the `{ code: 1006, reason: 'stt resume failed' }` close, and `isConnected() === false` all still hold.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- --run src/services/clients/SonioxClient.test.ts`
Expected: FAIL — `errors[0].message` is still `'capacity exceeded'` and no `session.connection_lost` event exists.

- [ ] **Step 3: Swap the tail of `resumeSttStream`**

In `src/services/clients/SonioxClient.ts`, in `resumeSttStream`, replace `this.surfaceSttError('503', originalMessage);` with:

```ts
    this.surfaceRecoverableOutage('503', originalMessage);
```

and rewrite the comment block directly above it so it no longer promises the generic error path:

```ts
    // All attempts exhausted: from here the story is the one a managed 503
    // already tells — the service was unavailable and never came back — so it
    // reads the same, then closes the session so MainPanel tears it down
    // exactly like any other fatal client close. Emit the realtime milestone
    // BEFORE the notice/onClose — the generic close branch in handleSttClose
    // always emits one (session.closed); this path bypasses that branch
    // entirely, so without this the debug timeline would show the 503 and the
    // resume attempts but nothing marking the session as actually over.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- --run src/services/clients/SonioxClient.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `npm run test -- --run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/clients/SonioxClient.ts src/services/clients/SonioxClient.test.ts
git commit -m "feat(soniox): give an exhausted BYOK resume ladder the same ending as a managed outage"
```

---

### Task 4: Add `mainPanel.sonioxConnectionLost` to all 30 locale catalogs

The code already works via `i18n.t`'s inline fallback; this makes it real in every language. `locales.consistency.test.ts` compares every catalog against `en` and fails on any key `en` has and a catalog lacks, so all 30 must land together.

**Files:**
- Modify: `src/locales/{ar,bn,de,en,es,fa,fi,fil,fr,he,hi,id,it,ja,ko,ms,nl,pl,pt_BR,pt_PT,ru,sv,ta,te,th,tr,uk,vi,zh_CN,zh_TW}/translation.json`
- Test: `src/locales/locales.consistency.test.ts` (existing — no edit)

**Interfaces:**
- Consumes: the key name `mainPanel.sonioxConnectionLost` used by `surfaceRecoverableOutage` (Task 1).
- Produces: nothing consumed by later tasks.

In every catalog the new key goes **immediately after** `"sonioxSegmentEnded"`, which is currently the last key of the `mainPanel` object — so add a trailing comma to the `sonioxSegmentEnded` line and put the new key on the next line. Each translation below reuses that locale's own word for the Start button, taken verbatim from its existing `sonioxSegmentEnded` string.

- [ ] **Step 1: Add the key to `en`, then run the consistency test to see it fail**

`src/locales/en/translation.json`:

```json
    "sonioxSegmentEnded": "This segment has ended — tap Start to continue.",
    "sonioxConnectionLost": "The connection was interrupted — tap Start in a moment to continue."
```

Run: `npm run test -- --run src/locales/locales.consistency.test.ts`
Expected: FAIL — 29 catalogs are missing `mainPanel.sonioxConnectionLost`.

- [ ] **Step 2: Add the key to the remaining 29 catalogs**

```
ar     "sonioxConnectionLost": "انقطع الاتصال — اضغط على \"ابدأ\" بعد قليل للمتابعة."
bn     "sonioxConnectionLost": "সংযোগ বিচ্ছিন্ন হয়েছে — কিছুক্ষণ পর চালিয়ে যেতে Start-এ ট্যাপ করুন।"
de     "sonioxConnectionLost": "Die Verbindung wurde unterbrochen — tippen Sie gleich auf Start, um fortzufahren."
es     "sonioxConnectionLost": "Se interrumpió la conexión — toca Iniciar en un momento para continuar."
fa     "sonioxConnectionLost": "اتصال قطع شد — لحظه‌ای بعد برای ادامه روی شروع ضربه بزنید."
fi     "sonioxConnectionLost": "Yhteys katkesi — jatka napauttamalla Aloita hetken kuluttua."
fil    "sonioxConnectionLost": "Naputol ang koneksyon — pindutin ang Start maya-maya para magpatuloy."
fr     "sonioxConnectionLost": "La connexion a été interrompue — appuyez sur Démarrer dans un instant pour continuer."
he     "sonioxConnectionLost": "החיבור נותק — הקישו על התחל בעוד רגע כדי להמשיך."
hi     "sonioxConnectionLost": "कनेक्शन बाधित हो गया — कुछ ही क्षण में जारी रखने के लिए स्टार्ट पर टैप करें।"
id     "sonioxConnectionLost": "Koneksi terputus — ketuk Mulai sebentar lagi untuk melanjutkan."
it     "sonioxConnectionLost": "La connessione è stata interrotta — tocca Avvia tra un momento per continuare."
ja     "sonioxConnectionLost": "接続が中断されました——少ししてから「開始」をタップして続けてください。"
ko     "sonioxConnectionLost": "연결이 끊어졌습니다 — 잠시 후 계속하려면 시작을 탭하세요."
ms     "sonioxConnectionLost": "Sambungan terputus — ketik Mula sebentar lagi untuk meneruskan."
nl     "sonioxConnectionLost": "De verbinding is verbroken — tik zo op Start om door te gaan."
pl     "sonioxConnectionLost": "Połączenie zostało przerwane — za chwilę dotknij Start, aby kontynuować."
pt_BR  "sonioxConnectionLost": "A conexão foi interrompida — toque em Iniciar daqui a pouco para continuar."
pt_PT  "sonioxConnectionLost": "A ligação foi interrompida — toque em Iniciar dentro de momentos para continuar."
ru     "sonioxConnectionLost": "Соединение прервано — через мгновение нажмите «Старт», чтобы продолжить."
sv     "sonioxConnectionLost": "Anslutningen avbröts — tryck på Start om en stund för att fortsätta."
ta     "sonioxConnectionLost": "இணைப்பு துண்டிக்கப்பட்டது — சிறிது நேரத்தில் தொடர தொடங்கு என்பதைத் தட்டவும்."
te     "sonioxConnectionLost": "కనెక్షన్ తెగిపోయింది — కొద్దిసేపటి తర్వాత కొనసాగించడానికి ప్రారంభించు నొక్కండి."
th     "sonioxConnectionLost": "การเชื่อมต่อถูกขัดจังหวะ — แตะเริ่มอีกสักครู่เพื่อดำเนินการต่อ"
tr     "sonioxConnectionLost": "Bağlantı kesildi — devam etmek için birazdan Başlat'a dokunun."
uk     "sonioxConnectionLost": "З'єднання перервано — за мить торкніться «Старт», щоб продовжити."
vi     "sonioxConnectionLost": "Kết nối đã bị gián đoạn — hãy nhấn Bắt đầu sau giây lát để tiếp tục."
zh_CN  "sonioxConnectionLost": "连接已中断——请稍候点击“开始”以继续。"
zh_TW  "sonioxConnectionLost": "連線已中斷——請稍候點一下「開始」以繼續。"
```

- [ ] **Step 3: Run the consistency test to verify it passes**

Run: `npm run test -- --run src/locales/locales.consistency.test.ts`
Expected: PASS.

- [ ] **Step 4: Verify every catalog is well-formed and carries the key**

Run:

```bash
node -e "const fs=require('fs'); let n=0; for (const d of fs.readdirSync('src/locales')) { if (d.includes('.')) continue; const t=require('./src/locales/'+d+'/translation.json'); if (!t.mainPanel.sonioxConnectionLost) throw new Error('missing in '+d); n++; } console.log(n+' catalogs OK');"
```

Expected: `30 catalogs OK`

- [ ] **Step 5: Run the full suite**

Run: `npm run test -- --run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/locales
git commit -m "chore(i18n): add the Soniox connection-lost notice to all locales"
```

---

### Task 5: Fold the 403 duration cutoff onto the same seam

Deletes `sonioxDurationCutoff` — the codebase's only provider-specific `onClose` field — and the MainPanel branch that consumes it, by having the client emit the "segment ended" item itself. User-visible behaviour is unchanged: same words, same single notice, still no auto-reconnect.

**Files:**
- Modify: `src/services/clients/SonioxClient.ts`
- Modify: `src/components/MainPanel/MainPanel.tsx:1311-1333`
- Test: `src/services/clients/SonioxClient.managed.test.ts`, `src/services/clients/SonioxClient.test.ts`

**Interfaces:**
- Consumes: `emitSystemNotice(text)` from Task 1; `SEGMENT_ENDED` and `OUTAGE` from Task 1 Step 1.
- Produces: `onClose` events no longer carry `sonioxDurationCutoff`. No client emits a provider-specific close field after this task.

- [ ] **Step 1: Rewrite the tests that assert the tag**

In `src/services/clients/SonioxClient.managed.test.ts`, replace the whole test named `tags the close that follows with sonioxDurationCutoff` with:

```ts
  it('emits the segment-ended notice itself on the close that follows', async () => {
    mockFetchOnce(200, speechToSpeechResponse());
    const client = managedClient();
    const closeEvents: any[] = [];
    client.setEventHandlers({ onClose: (e) => closeEvents.push(e) });
    await client.connect({ ...BASE_CONFIG, textOnly: false });
    const stt = sttInstances.at(-1)!;

    stt.handlers.onError?.('403', 'session duration exceeded');
    stt.handlers.onClose?.({ code: 1000, reason: '' });

    expect(closeEvents).toHaveLength(1);
    expect(closeEvents[0].code).toBe(1000);
    // No provider-specific field on the close: the notice is a normal item,
    // so it survives MainPanel's setItems(getConversationItems()) teardown.
    expect(closeEvents[0].sonioxDurationCutoff).toBeUndefined();
    const items = client.getConversationItems();
    expect(items).toHaveLength(1);
    expect(items[0].role).toBe('system');
    expect(items[0].formatted?.text).toMatch(SEGMENT_ENDED);
  });
```

In the same file, replace the whole test named `the pending-cutoff flag does not leak into an unrelated close from a later session` with:

```ts
  it('the pending-cutoff flag does not leak into an unrelated close from a later session', async () => {
    mockFetchOnce(200, speechToSpeechResponse());
    const client = managedClient();
    await client.connect({ ...BASE_CONFIG, textOnly: false });
    sttInstances.at(-1)!.handlers.onError?.('403', 'session duration exceeded');

    // A fresh connect() calls reset() before anything else, which must clear
    // the flag set by the previous session's 403.
    await client.connect({ ...BASE_CONFIG, textOnly: false });
    const stt = sttInstances.at(-1)!;
    stt.handlers.onClose?.({ code: 1000, reason: '' });

    // A lost connection, not a second "segment ended".
    const text = client.getConversationItems().at(-1)!.formatted?.text;
    expect(text).toMatch(OUTAGE);
    expect(text).not.toMatch(SEGMENT_ENDED);
  });
```

In `src/services/clients/SonioxClient.test.ts`, in the test named `managed-403 duration cutoff is unaffected by the 503 resume path (cutoff still wins, never resumes)`, replace this line:

```ts
    expect(closeEvents[0].sonioxDurationCutoff).toBe(true);
```

with:

```ts
    expect(closeEvents[0].sonioxDurationCutoff).toBeUndefined();
    expect(client.getConversationItems().at(-1)!.formatted?.text).toMatch(SEGMENT_ENDED);
```

In the same file, in the test named `I1: managed mode + 503 takes the generic error path — no resume attempted`, delete this now-meaningless line:

```ts
    expect(closeEvents[0].sonioxDurationCutoff).toBeUndefined(); // a normal close, not misread as a cutoff
```

And in `src/services/clients/SonioxClient.managed.test.ts`, in the test `a close with no preceding 403 reports a lost connection, not a cutoff` (rewritten in Task 2 Step 5), delete its now-vacuous line — the field no longer exists anywhere, so asserting it is undefined proves nothing, and Step 4's grep must come back empty:

```ts
    expect(closeEvents[0].sonioxDurationCutoff).toBeUndefined();
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- --run src/services/clients/SonioxClient.managed.test.ts src/services/clients/SonioxClient.test.ts`
Expected: FAIL — the cutoff still tags the close and emits no item.

- [ ] **Step 3: Emit the cutoff notice from the client**

In `src/services/clients/SonioxClient.ts`, in `handleSttClose`, replace the whole `pendingDurationCutoff` branch (comment included) with:

```ts
    // Managed sessions: Soniox drops the session at its granted duration by
    // sending a 403 error frame (caught by handleSttError, which sets this
    // flag and suppresses the generic error bubble) immediately followed by
    // this close. Say so as a normal system notice — the same seam every
    // client uses — rather than a provider-specific field on the close event
    // that only MainPanel could read. Per explicit product decision this does
    // NOT auto-reconnect: a silent reconnect would restart billing without
    // the user knowing, so the user must tap Start for a new segment.
    if (this.pendingDurationCutoff) {
      this.pendingDurationCutoff = false;
      this.emitRealtime('client', 'session.duration_cutoff', { provider: 'soniox', ...event });
      this.emitSystemNotice(
        i18n.t('mainPanel.sonioxSegmentEnded', 'This segment has ended — tap Start to continue.')
      );
      this.eventHandlers.onClose?.(event);
      return;
    }
```

- [ ] **Step 4: Delete the MainPanel branch**

In `src/components/MainPanel/MainPanel.tsx`, delete the entire block from the comment line `// Managed Soniox: SonioxClient tags this close with sonioxDurationCutoff` through the closing `}` of `if (event?.sonioxDurationCutoff) { … }` (lines 1311–1333). Nothing replaces it — the teardown above it already runs `setItems(client.getConversationItems())`, which now includes the notice. Leave the `disconnectConversationRef.current?.()` call and everything before it untouched.

Verify nothing else references the field:

Run: `grep -rn "sonioxDurationCutoff" src/ extension/`
Expected: no output.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test -- --run src/services/clients/SonioxClient.managed.test.ts src/services/clients/SonioxClient.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full suite and the build**

Run: `npm run test -- --run && npm run build`
Expected: both PASS.

- [ ] **Step 7: Commit**

```bash
git add src/services/clients/SonioxClient.ts src/components/MainPanel/MainPanel.tsx src/services/clients/SonioxClient.test.ts src/services/clients/SonioxClient.managed.test.ts
git commit -m "refactor(soniox): emit the segment-ended notice through the shared client seam"
```

---

## Manual smoke (after Task 5)

Not automatable — `MainPanel.tsx` has no test file and the notice depends on real teardown ordering.

- [ ] Start a managed (KizunaAI Soniox) session, speak once to confirm translation, then kill the network (disable Wi-Fi, or `nmcli networking off`).
- [ ] Confirm the conversation ends with exactly ONE bubble reading "The connection was interrupted — tap Start in a moment to continue." — no `[Soniox …]` bubble, no duplicate left behind.
- [ ] Confirm LogsPanel shows `session.connection_lost` carrying the wire code and the server's own message.
- [ ] Restore the network, wait a few seconds, tap Start — the session starts. (If it returns "Another session is already active", retry once; that 409 window is a known limitation recorded in the spec.)
- [ ] Switch the UI language to 日本語 and repeat once to confirm the notice is localized.
- [ ] Run a BYOK Soniox session to a natural end with Stop — confirm NO outage notice appears on a clean stop.
