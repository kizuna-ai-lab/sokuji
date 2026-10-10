# Soniox Slice 3 — Face-to-Face and Managed Participant Speech Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Both mode gains "the other side is beside me": two people at one microphone, one shared two_way Soniox socket attributed by speaker label and language, each person hearing the translation into their own language in one ear — on own-key Soniox and on Kizuna AI's managed Soniox, whose backend mints the participant's speech key (`par_tts`).

**Architecture:** Part A (kizuna-ai-lab/sokuji-backend) lets the session-key request ask for the participant's speech: the role expansion adds `par_tts`, a lease counts every TTS stream it owns against the org ceiling, the admin view and the public pricing name the new stream, and the docs-site calculator gains the face-to-face scenarios and the split default. Part B (kizuna-ai-lab/sokuji) adds one predicate, `faceToFaceFromStores()`, that the run shape, the capture, the routing and every surface read: face-to-face is ordinary Both with a silent participant source, a forced shared socket, forced participant speech (unless Text Only), a side tracker that votes by language instead of energy, a route table whose two translation edges are panned to opposite ears, and a "leg speaks only into its own target" rule that holds in every mode.

**Tech Stack:** Client: TypeScript (strict), React 18, Zustand, Vitest 4 + jsdom + @testing-library/react, Web Audio (`StereoPannerNode`), i18next (30 catalogs). Backend: Cloudflare Workers + Hono, D1 (SQLite), Vitest (Node ≥ 22 for `node:sqlite`), the docs site under `web/` (13 docs locales).

**Spec:** `docs/superpowers/specs/2026-10-08-soniox-speaker-labels-face-to-face-design.md` — "Slice 3 — Face-to-face", decisions D8–D12 and D14; the roadmap's "Managed participant speech — turning it on" (`docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md:2319-2345`). Canvas mockups: https://claude.ai/artifact/M7MNE6XyrpnnunWwr6H5W6 (boards 1, 2, 4).

**Depends on:** slices 1 and 2 merged to main. Slice 2's people numbering (`src/lib/view/people.ts`, `people(entries)`) and the segment `person` field exist; face-to-face strips `person` in the adapter (Task B5), so no surface labels it. Line numbers below are main at `e10f025c1` (slice 1's first commit); slices 1–2 move some of them — every edit names an anchor string to find it by.

## Global Constraints

- English in code, comments, commit messages, PR text; Chinese only in chat with the owner.
- Conventional commits; every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- TDD on every task: the failing test is written and run before the code.
- Client tests: `npx vitest run <path>`; before the PR, `npx vitest run` (whole suite) and `npx tsc --noEmit -p tsconfig.json` with no error in a touched file (the tree carries ~95 pre-existing errors in unrelated files — compare by file, not by count).
- Backend tests: Node ≥ 22 (`node:sqlite`; `nvm use` per `.nvmrc`), `npx vitest run <path>`, `npx tsc --noEmit` before the PR.
- **Outward acts need the owner's explicit word at the time, naming the target:** opening and merging the Part A PR on `kizuna-ai-lab/sokuji-backend` (`main` deploys production and applies D1 migrations — `.github/workflows/deploy.yml`), and opening the Part B PR on `kizuna-ai-lab/sokuji`. An approved plan is not that word.
- Order: Part A is merged and deployed before Task B15 (the flag flip) is merged. B1–B14 may land first: until B15, managed face-to-face speaks only the speaker's half.
- No one-time migration code (owner's rule): an unknown stored value falls to its default.
- Diagnostics: adapters never call `report()` or `console.*`; stores and components follow `src/lib/diagnostics/report.ts` (CLAUDE.md "Error Handling").
- The participant-speech switch stays hidden (`PARTICIPANT_SPEECH_SHOWN = false`); face-to-face forces participant speech by itself.
- Copy: the mode is "Face-to-face"; every new key lands in all 30 catalogs, `{{placeholders}}` verbatim (`src/locales/locales.consistency.test.ts`); the docs site's keys land in all 13 docs locales (`web/src/locales/docs/keyParity.test.ts`).
- Comment density follows the surrounding code.

## Review Focus

1. **Face-to-face stored, provider switched to one without it** (OpenAI, Gemini, Local Inference) in Both mode → the run is ordinary Both: system audio is captured, the meeting route is on, nothing is panned. Pinned in Task B2 (`faceToFaceFromStores` is false) and Task B3 (`appCapture` opens system audio).
2. **Face-to-face with Text Only on** → neither leg speaks, no TTS key is requested, the floor prices one STT stream. Pinned in Task B2 (`participantSpeechFromStores` false, `leaseRequest` roles `['mix_stt']`).
3. **Swap pressed during a run** → both ears flip at once without restarting. Pinned in Task B7 (`routesFor` with `swap`, and the graph replacing an edge whose pan changed).
4. **A code-switched line** (the speaker says a sentence in the other person's language) → its translation is in the speaker's own language: not spoken, in face-to-face and in shared meeting Both alike; the row shows the "not played" mark. Pinned in Task B6 (adapter) and Task B11 (row tag).
5. **The web build in face-to-face** → Start is not refused for "no participant source", and the silent source opens. Pinned in Task B2 (`gate`) and Task B3 (`appCapture` on `'web'`).

---

# Part A — sokuji-backend (`kizuna-ai-lab/sokuji-backend`)

Work in a hand-made worktree (EnterWorktree cannot reach this sibling repo):

```bash
cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend
git fetch origin
git worktree add ../sokuji-backend-par-tts -b feat/participant-speech-par-tts origin/main
cd ../sokuji-backend-par-tts
npm ci
```

All Part A paths are relative to that worktree.

### Task A1: `participantSpeech` in the session shape and the role expansion

**Files:**
- Modify: `src/config/soniox.ts` (`SONIOX_STREAM_ROLES` docstring ~195-208, `SonioxSessionShape` ~338-344, `expandStreamRoles` ~372-412, `normalizeSessionShape` ~577-623)
- Test: `src/config/soniox.test.ts` (`ALL_SHAPES` ~21-30, the `expandStreamRoles` describe ~32-130, the `normalizeSessionShape` describe ~171-223)

**Interfaces:**
- Produces: `SonioxSessionShape.participantSpeech?: boolean` (absent = false); `normalizeSessionShape(body)` reads `body.participantSpeech` (absent → field omitted; `true` → `participantSpeech: true` on `participant` and `both`; any non-boolean → `null`); `expandStreamRoles(shape)` appends `"par_tts"` when `shape.participantSpeech` and the shape has a participant or mixed stream. The client's `requestedRoles` (`src/providers/soniox/leaseRequest.ts:68-74`) already expects exactly this order.

- [ ] **Step 1: Write the failing tests**

Replace `ALL_SHAPES` and the two "never" tests, and add the new rows, in `src/config/soniox.test.ts`:

```ts
/** EVERY input the expansion can ever be handed: 3 modes x textOnly x bothSplit
 *  x participantSpeech. Enumerated rather than sampled, because "total and
 *  closed" is the property under test — a spot check cannot tell a thirteenth
 *  reachable role set from a twelfth. */
const ALL_SHAPES: SonioxSessionShape[] = (["speaker", "participant", "both"] as const).flatMap(
    (mode) => [true, false].flatMap(
        (textOnly) => [true, false].flatMap(
            (bothSplit) => [false, true].map((participantSpeech) => ({ mode, textOnly, bothSplit, participantSpeech }))
        )
    )
);
```

```ts
    it("reaches exactly the twelve rows of the matrix and nothing else", () => {
        const reachable = new Set(ALL_SHAPES.map((s) => expandStreamRoles(s).join(",")));
        expect([...reachable].sort()).toEqual([
            "mix_stt",
            "mix_stt,mix_tts",
            "mix_stt,mix_tts,par_tts",
            "mix_stt,par_tts",
            "par_stt",
            "par_stt,par_tts",
            "spk_stt",
            "spk_stt,par_stt",
            "spk_stt,par_stt,par_tts",
            "spk_stt,spk_tts",
            "spk_stt,spk_tts,par_stt",
            "spk_stt,spk_tts,par_stt,par_tts",
        ]);
    });
```

```ts
    it("adds par_tts after the rest when the participant speaks, and only where there is a participant", () => {
        expect(expandStreamRoles({ mode: "participant", textOnly: true, bothSplit: false, participantSpeech: true })).toEqual(["par_stt", "par_tts"]);
        expect(expandStreamRoles({ mode: "both", textOnly: false, bothSplit: true, participantSpeech: true })).toEqual(["spk_stt", "spk_tts", "par_stt", "par_tts"]);
        expect(expandStreamRoles({ mode: "both", textOnly: true, bothSplit: true, participantSpeech: true })).toEqual(["spk_stt", "par_stt", "par_tts"]);
        expect(expandStreamRoles({ mode: "both", textOnly: false, bothSplit: false, participantSpeech: true })).toEqual(["mix_stt", "mix_tts", "par_tts"]);
        expect(expandStreamRoles({ mode: "both", textOnly: true, bothSplit: false, participantSpeech: true })).toEqual(["mix_stt", "par_tts"]);
        // A speaker-only session has no participant to voice.
        expect(expandStreamRoles({ mode: "speaker", textOnly: false, bothSplit: false, participantSpeech: true })).toEqual(["spk_stt", "spk_tts"]);
    });

    it("returns par_tts exactly when the participant speaks in a shape that has a participant", () => {
        for (const s of ALL_SHAPES) {
            const wants = s.participantSpeech === true && s.mode !== "speaker";
            expect(expandStreamRoles(s).includes("par_tts")).toBe(wants);
        }
    });

    it("never returns more than one TTS stream per side: one of spk_tts/mix_tts, and par_tts", () => {
        // Still the structural property A2 demands: no request can mint two
        // reusable TTS keys for the SAME audio. The participant's voice is a
        // second side, not a second key for the first.
        for (const s of ALL_SHAPES) {
            const roles = expandStreamRoles(s);
            expect(roles.filter((r) => r === "spk_tts" || r === "mix_tts").length).toBeLessThanOrEqual(1);
            expect(roles.filter((r) => r === "par_tts").length).toBeLessThanOrEqual(1);
        }
    });
```

Delete the old tests `"reaches exactly the seven rows of the matrix and nothing else"`, `"never returns par_tts: the participant channel has no synthesis in v1"` and `"never returns more than ONE tts stream, so no request can mint two reusable TTS keys"`.

Add to the `normalizeSessionShape` describe:

```ts
    it("carries the participant's speech on participant and both, and only when it is true", () => {
        expect(normalizeSessionShape({ mode: "participant", participantSpeech: true }))
            .toEqual({ mode: "participant", textOnly: true, bothSplit: false, participantSpeech: true });
        expect(normalizeSessionShape({ mode: "both", textOnly: false, bothSplit: false, participantSpeech: true }))
            .toEqual({ mode: "both", textOnly: false, bothSplit: false, participantSpeech: true });
        // false and absent are the same request: today's body, byte for byte.
        expect(normalizeSessionShape({ mode: "both", textOnly: false, bothSplit: true, participantSpeech: false }))
            .toEqual({ mode: "both", textOnly: false, bothSplit: true });
        // A speaker-only or legacy body has no participant: the field is dropped, not refused.
        expect(normalizeSessionShape({ mode: "speaker", textOnly: false, participantSpeech: true }))
            .toEqual({ mode: "speaker", textOnly: false, bothSplit: false });
        expect(normalizeSessionShape({ mode: "speech_to_speech", participantSpeech: true }))
            .toEqual({ mode: "speaker", textOnly: false, bothSplit: false });
    });

    it("rejects a participantSpeech that is not a boolean", () => {
        expect(normalizeSessionShape({ mode: "participant", participantSpeech: "true" })).toBeNull();
        expect(normalizeSessionShape({ mode: "both", textOnly: true, bothSplit: false, participantSpeech: 1 })).toBeNull();
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/config/soniox.test.ts`
Expected: FAIL — the twelve-row set lists seven rows; `participantSpeech` is not a known property of `SonioxSessionShape` (type error in vitest's esbuild is ignored, so the assertions fail on `par_tts` missing and on `normalizeSessionShape` dropping the field).

- [ ] **Step 3: Implement**

In `src/config/soniox.ts`, replace the last paragraph of the `SONIOX_STREAM_ROLES` docstring (`par_tts is unreachable in v1 …`) with:

```ts
 * `par_tts` voices the participant's side, and only when the request says
 * the participant speaks (`SonioxSessionShape.participantSpeech`): the
 * second TTS stream the vocabulary kept room for, a change of policy and not
 * of wire format, as intended.
```

Add the field to `SonioxSessionShape`:

```ts
export interface SonioxSessionShape {
    mode: SonioxAudioMode;
    textOnly: boolean;
    bothSplit: boolean;
    /** The participant's side is voiced too (`par_tts`). Absent means false:
     *  every body sent before it existed asks for exactly what it always did. */
    participantSpeech?: boolean;
}
```

Replace the `participant` and `both` cases of `expandStreamRoles`:

```ts
        case "participant":
            // textOnly is IGNORED here, not defaulted: it is the SPEAKER's
            // speech, and there is no speaker. The participant's own voice is
            // `participantSpeech`. bothSplit is meaningless outside `both`.
            return shape.participantSpeech ? ["par_stt", "par_tts"] : ["par_stt"];
        case "both": {
            // Appended last, after every existing role: the mint order fixes the
            // primary leg (`primaryRole` takes the first STT role), and a voiced
            // participant must not move it.
            const participantTts: SonioxStreamRole[] = shape.participantSpeech ? ["par_tts"] : [];
            if (shape.bothSplit) {
                // Two independent Soniox sessions; attribution is physical.
                return shape.textOnly
                    ? ["spk_stt", "par_stt", ...participantTts]
                    : ["spk_stt", "spk_tts", "par_stt", ...participantTts];
            }
            // Shared: PcmMixer mixes mic + system audio into ONE stream, so the
            // role is `mix_*`. Calling it `spk_*` would be a lie about which
            // audio source feeds it. The participant's voice still gets its own
            // key: one key per stream (see SONIOX_STREAM_ROLES).
            return shape.textOnly
                ? ["mix_stt", ...participantTts]
                : ["mix_stt", "mix_tts", ...participantTts];
        }
```

In `normalizeSessionShape`, read the field once after the legacy branch and use it on the two rows that have a participant:

```ts
    // VOCABULARY 2 — new clients. `mode` is the AUDIO shape.
    // The participant's voice: absent and false are the same request; anything
    // else that is not a boolean is a client bug and fails loudly.
    const participantSpeech = b.participantSpeech;
    if (participantSpeech !== undefined && typeof participantSpeech !== "boolean") return null;
    const voiced = participantSpeech === true ? { participantSpeech: true } : {};
    if (mode === "participant") {
        // textOnly is structurally ignored here, so it is not required either.
        return { mode: "participant", textOnly: true, bothSplit: false, ...voiced };
    }
```

and in the `both` row:

```ts
        return { mode: "both", textOnly: b.textOnly, bothSplit: b.bothSplit, ...voiced };
```

(The `speaker` and `voice_preview` rows are unchanged: they never carry the field.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/config/soniox.test.ts src/services/soniox-token-pricing.test.ts src/routes`
Expected: PASS for `soniox.test.ts`. `soniox-token-pricing.test.ts` still passes (its shapes carry no `participantSpeech`). Route tests pass (no route reads the field yet beyond `normalizeSessionShape`).

- [ ] **Step 5: Commit**

```bash
git add src/config/soniox.ts src/config/soniox.test.ts
git commit -m "feat(soniox): mint par_tts when the participant speaks

The session-key body's optional participantSpeech adds a par_tts key
to participant-only, split Both and shared Both sessions, after every
existing role so the primary leg does not move. Absent or false asks
for exactly today's key set.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task A2: A lease counts every TTS stream it owns

**Files:**
- Modify: `src/services/session-lease.ts` (`AcquireParams.usesTts` doc ~57, `sttStreamCount` doc ~66-90, `acquire` ~395-560, the INSERT bind ~612-618)
- Modify: `src/db/session.schema.ts` (`usesTts` doc ~35)
- Test: `src/services/session-lease.sqlite.test.ts` (the describe that defines `fillTts` and `previewLease`, ~690-760)

**Interfaces:**
- Consumes: Task A1's role sets (a lease may now own two TTS roles: `mix_tts` + `par_tts`, or `spk_tts` + `par_tts`).
- Produces: `acquire` derives the lease's TTS stream count from `sttRoles` (its TTS members) when given, else `usesTts ? 1 : 0`; it writes that count to `uses_tts` and refuses `tts_full` when `counts.tts + count > MAX_TTS_CONCURRENT`. `usesTts` stays a boolean parameter and must agree with the roles (throws otherwise, like the STT cross-check). No schema change: `uses_tts` is already an integer and `countActive` already SUMs it.

- [ ] **Step 1: Write the failing tests**

Add inside the describe that holds `fillTts` in `src/services/session-lease.sqlite.test.ts`:

```ts
    /** A face-to-face session: one mixed transcription and two synthesis streams, the speaker's and the participant's. */
    const faceToFace = (accountId: string) => ({
        accountId, leaseId: "L1", provider: "soniox",
        sku: "soniox:speech_to_speech", region: "us" as const, usesTts: true,
        sttRoles: ["mix_stt", "mix_tts", "par_tts"] as const,
        maxDurationS: 900, budgetMicroUsd: 250_000,
    });

    it("counts a lease with two synthesis streams twice toward the TTS ceiling", async () => {
        const r = await svc.acquire({ ...faceToFace("f2f-acct"), now: 1000 });
        expect(r.ok).toBe(true);
        expect(readRow(sqlite, "f2f-acct").uses_tts).toBe(2);
        expect(await svc.countActive(1000)).toEqual({ stt: 1, tts: 2 });
    });

    it("refuses a two-voice session one slot below the TTS ceiling, and still admits a one-voice one", async () => {
        await fillTts(MAX_TTS_CONCURRENT - 1, 1000);
        const twoVoices = await svc.acquire({ ...faceToFace("f2f-acct"), now: 1000 });
        expect(twoVoices.ok).toBe(false);
        if (!twoVoices.ok) expect(twoVoices.reason).toBe("tts_full");
        const oneVoice = await svc.acquire({
            accountId: "one-voice", leaseId: "L1", provider: "soniox",
            sku: "soniox:speech_to_speech", usesTts: true,
            maxDurationS: 900, budgetMicroUsd: 250_000, now: 1000,
        });
        expect(oneVoice.ok).toBe(true);
    });

    it("throws when usesTts disagrees with the TTS roles it was handed", async () => {
        await expect(svc.acquire({ ...faceToFace("f2f-acct"), usesTts: false, now: 1000 }))
            .rejects.toThrow(/usesTts/);
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/services/session-lease.sqlite.test.ts`
Expected: FAIL — `uses_tts` is 1, `countActive` reports `tts: 1`, the two-voice session is admitted, and no throw.

- [ ] **Step 3: Implement**

In `acquire`, next to the existing STT derivation (after the `if (p.sttRoles !== undefined) { … }` block that computes `issuedSttMask` and `rolesSttCount`), derive the TTS count:

```ts
        // HOW MANY synthesis streams this lease owns. A session voices at most
        // one per side (`expandStreamRoles`), so this is 0, 1 or 2 — 2 when the
        // participant speaks beside the speaker (`par_tts` with `spk_tts` or
        // `mix_tts`). Derived from the roles when given, the same one place the
        // STT count comes from; `usesTts` is checked against it, not trusted.
        const rolesTtsCount = p.sttRoles?.filter((role) => roleKind(role) === "tts").length;
        if (rolesTtsCount !== undefined && p.usesTts !== rolesTtsCount > 0) {
            throw new Error(
                `acquire: usesTts=${p.usesTts} disagrees with sttRoles ` +
                `${p.sttRoles!.join(",")} (${rolesTtsCount} synthesis streams)`
            );
        }
        const ttsStreamCount = rolesTtsCount ?? (p.usesTts ? 1 : 0);
```

Add `roleKind` to the `../config/soniox` import at the top of the file. Replace the invariant check and the TTS ceiling:

```ts
        if (sttStreamCount + ttsStreamCount < 1) {
```

(keep its body), and:

```ts
        if (ttsStreamCount > 0 && counts.tts + ttsStreamCount > MAX_TTS_CONCURRENT) {
            return { ok: false, reason: "tts_full" };
        }
```

Rewrite the comment above the invariant's `usesTts` line (`// \`usesTts\` is a 0/1 WEIGHT, not a count: …`) to:

```ts
        // A lease owns its synthesis streams the way it owns its transcriptions:
        // one per side, each counted once against the TTS ceiling however many
        // successive sockets it backs.
```

In the INSERT bind, replace `p.usesTts ? 1 : 0,` with `ttsStreamCount,`.

Update the two docs that called it a 0/1 weight. `AcquireParams.sttStreamCount`'s paragraph "This is NOT a TTS count: …" becomes:

```ts
     * This is NOT the TTS count: `acquire` derives that from the TTS roles in
     * `sttRoles` (or, without roles, from `usesTts`) and writes it to
     * `uses_tts`, one per voiced side.
```

and in `src/db/session.schema.ts`:

```ts
        /** How many Soniox TTS streams this lease owns — 0, 1, or 2 when the participant is voiced too (`par_tts`).
         *  Summed against MAX_TTS_CONCURRENT; the column name predates the count. */
        usesTts: integer("uses_tts").notNull().default(0),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/services/session-lease.sqlite.test.ts src/services/session-lease.test.ts src/routes`
Expected: PASS. (`session-lease.test.ts`'s fake D1 binds by position; the value at the `uses_tts` position is still 1 for every existing one-voice fixture.)

- [ ] **Step 5: Commit**

```bash
git add src/services/session-lease.ts src/db/session.schema.ts src/services/session-lease.sqlite.test.ts
git commit -m "feat(soniox): count every TTS stream a lease owns

A face-to-face session voices both sides, so its lease holds two of
Soniox's TTS slots. uses_tts now stores the count derived from the
role set, and acquire refuses tts_full when the count would overflow.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task A3: The admin sessions view names `par_tts`

**Files:**
- Modify: `src/admin/api/sessions-data.ts` (`leaseStreams` ~257-282)
- Test: `src/admin/api/sessions-data.test.ts` (the describe `"getRecentSessions: lease stream roles"` ~245-288)

**Interfaces:**
- Consumes: Task A2's `uses_tts` count.
- Produces: `leaseStreams` lists the speaker-side TTS stream as today and adds `par_tts` when the count says the participant is voiced.

- [ ] **Step 1: Write the failing tests**

Add to `"getRecentSessions: lease stream roles"`:

```ts
    it("a face-to-face session is mix_stt, mix_tts and par_tts", async () => {
        expect(await streams({ issued_stt_mask: 4, stt_started_mask: 4, uses_tts: 2 })).toEqual([
            { role: "par_tts", connected: true },
            { role: "mix_stt", connected: true },
            { role: "mix_tts", connected: true },
        ]);
    });

    it("a split Both session with a voiced participant lists both voices", async () => {
        expect(await streams({ issued_stt_mask: 3, stt_started_mask: 3, uses_tts: 2 })).toEqual([
            { role: "spk_stt", connected: true },
            { role: "spk_tts", connected: true },
            { role: "par_stt", connected: true },
            { role: "par_tts", connected: true },
        ]);
    });

    it("a participant-only session with a voice is par_stt plus par_tts", async () => {
        expect(await streams({ issued_stt_mask: 2, stt_started_mask: 2, uses_tts: 1 })).toEqual([
            { role: "par_stt", connected: true },
            { role: "par_tts", connected: true },
        ]);
    });
```

(The order follows `sortStreams`: vocabulary order is `spk_stt, spk_tts, par_stt, par_tts, mix_stt, mix_tts`.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/admin/api/sessions-data.test.ts`
Expected: FAIL — `uses_tts: 2` matches neither branch (`=== 1`), and a participant-only voice is not listed.

- [ ] **Step 3: Implement**

Replace the TTS part of `leaseStreams` and extend its docstring's last sentence:

```ts
    if (r.sku === "soniox:voice_preview") {
        streams.push({ role: "preview_tts", connected: true });
    } else {
        // `uses_tts` counts the voiced sides (at most two). The speaker side
        // voices first: a session with no speaker-side stream (participant
        // only) can only be voicing its participant.
        const voices = Number(r.uses_tts) || 0;
        const speakerSide = (issued & (STT_ROLE_BIT.spk_stt | STT_ROLE_BIT.mix_stt)) !== 0;
        if (voices >= 1 && speakerSide) {
            if (issued & STT_ROLE_BIT.spk_stt) streams.push({ role: "spk_tts", connected: true });
            if (issued & STT_ROLE_BIT.mix_stt) streams.push({ role: "mix_tts", connected: true });
        }
        if (voices >= 2 || (voices >= 1 && !speakerSide)) streams.push({ role: "par_tts", connected: true });
    }
```

Docstring addition after "…a voice preview is one `preview_tts` with no transcription at all.":

```ts
 * `uses_tts` counts the voiced sides: two means the participant speaks
 * too (`par_tts`). One with a speaker-side transcription reads as the
 * speaker's voice — a text-only speaker beside a voiced participant would
 * read the same, and the shipping client never asks for that shape.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/admin/api/sessions-data.test.ts`
Expected: PASS (the existing five cases unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/admin/api/sessions-data.ts src/admin/api/sessions-data.test.ts
git commit -m "feat(admin): list par_tts among a session's streams

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task A4: Pricing publishes the face-to-face shape

**Files:**
- Modify: `src/services/soniox-token-pricing.ts` (`PRICED_SHAPE_IDS` ~169-177, `SHAPE_DEFS` ~187-195, `TTS_SOURCE_OF` ~203-208, the `classifyRole` docstring ~210-231, `ShapePricing` ~248-255, `shapePricing` ~257-269)
- Modify: `src/routes/pricing.ts` (`PublishedShape` ~54-58, the `shapes` map ~101-105)
- Modify: `web/src/pages/dashboard/wallet/pricing-calc.ts` (`PublishedShape` ~34-38, `generatedSpeechFraction` and its docstring ~52-86)
- Test: `src/services/soniox-token-pricing.test.ts` (~97-160), `web/src/pages/dashboard/wallet/pricing-calc.test.ts` (`tokenCountsPerHour` describe ~37-80)

**Interfaces:**
- Consumes: Task A1 (`par_tts` reachable with `participantSpeech: true`).
- Produces: priced shape `"both-shared-face-to-face"` = `{ mode: "both", textOnly: false, bothSplit: false, participantSpeech: true }`; `ShapePricing.ttsSources: SttLeg[]` (every voiced side, mint order) beside the existing `ttsSource` (the speaker-side voice, or `null`); the published shape carries both; the web calculator synthesises the whole speaking time when both sides are voiced.

- [ ] **Step 1: Write the failing tests**

In `src/services/soniox-token-pricing.test.ts`, replace `"never attributes synthesis to the participant leg"`, `"no longer carries the derived hourly coefficients"`, `"prices all seven reachable shapes and nothing else"` and the `par_tts` throw test:

```ts
    it("attributes synthesis to the participant only in the face-to-face shape", () => {
        for (const id of PRICED_SHAPE_IDS) {
            expect(shapePricing(id).ttsSources.includes("participant")).toBe(id === "both-shared-face-to-face");
        }
        expect(shapePricing("both-shared-face-to-face").ttsSources).toEqual(["mixed", "participant"]);
        expect(shapePricing("both-shared-face-to-face").ttsSource).toBe("mixed");
    });
```

```ts
    it("carries the allowance, the legs and both views of synthesis, nothing derived", () => {
        expect(Object.keys(shapePricing("speaker-spoken")).sort()).toEqual([
            "allowanceUsdPerHour", "id", "sttLegs", "ttsSource", "ttsSources",
        ]);
    });
```

```ts
describe("coverage of the mode matrix", () => {
    it("prices the seven matrix rows the app reaches plus face-to-face, and nothing else", () => {
        expect(allShapePricing()).toHaveLength(8);
        expect(new Set(PRICED_SHAPE_IDS).size).toBe(8);
    });
});
```

```ts
    it("classifies the participant's voice", () => {
        expect(classifyRole("par_tts")).toEqual({ kind: "tts", source: "participant" });
    });
```

In `web/src/pages/dashboard/wallet/pricing-calc.test.ts`, add to `tokenCountsPerHour`:

```ts
  it('synthesises the whole speaking time when both sides are voiced (face-to-face)', () => {
    const f2f: PublishedShape = { id: 'both-shared-face-to-face', sttLegs: ['mixed'], ttsSource: 'mixed', ttsSources: ['mixed', 'participant'] };
    const c = tokenCountsPerHour(f2f, CONV, 0.6);
    expect(c.ttsInputText).toBe(9_000);
    expect(c.ttsOutputAudio).toBe(18_000);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/services/soniox-token-pricing.test.ts web/src/pages/dashboard/wallet/pricing-calc.test.ts`
Expected: FAIL — no `ttsSources`, seven shapes, `classifyRole("par_tts")` throws, and the calculator halves the synthesis.

- [ ] **Step 3: Implement**

`src/services/soniox-token-pricing.ts`:

```ts
export const PRICED_SHAPE_IDS = [
    "speaker-subtitles",
    "speaker-spoken",
    "participant-subtitles",
    "both-split-subtitles",
    "both-split-spoken",
    "both-shared-subtitles",
    "both-shared-spoken",
    "both-shared-face-to-face",
] as const;
```

```ts
    "both-shared-spoken": { mode: "both", textOnly: false, bothSplit: false },
    // Two people at one microphone: one mixed stream, both sides voiced.
    "both-shared-face-to-face": { mode: "both", textOnly: false, bothSplit: false, participantSpeech: true },
```

```ts
const TTS_SOURCE_OF: Partial<Record<SonioxStreamRole, SttLeg>> = {
    spk_tts: "speaker",
    mix_tts: "mixed",
    par_tts: "participant",
};
```

Shorten the `classifyRole` docstring's "WHY THIS MATTERS" paragraph to the rule that still holds:

```ts
 * WHY THIS MATTERS. `STT_LEG_OF` and `TTS_SOURCE_OF` are `Partial`, so a
 * role added to the vocabulary later maps to neither until someone decides
 * what it prices. Skipping it silently would publish a free synthesis row;
 * throwing names the role the moment it becomes reachable.
```

```ts
export interface ShapePricing {
    id: PricedShapeId;
    sttLegs: SttLeg[];
    /** The speaker-side voice (`spk_tts` / `mix_tts`), or null. */
    ttsSource: TtsSource;
    /** Every voiced side, in mint order: the speaker side's, then the participant's. */
    ttsSources: SttLeg[];
    /** Kept for the anti-drift pin in this module's test. Never published:
     *  it shipped once on a public endpoint, rendered nowhere. */
    allowanceUsdPerHour: number;
}

export function shapePricing(id: PricedShapeId): ShapePricing {
    const roles = expandStreamRoles(SHAPE_DEFS[id]);

    const sttLegs: SttLeg[] = [];
    const ttsSources: SttLeg[] = [];
    for (const role of roles) {
        const classified = classifyRole(role);
        if (classified.kind === "stt") sttLegs.push(classified.leg);
        else ttsSources.push(classified.source);
    }
    const ttsSource: TtsSource = ttsSources.find((s) => s !== "participant") ?? null;

    return { id, sttLegs, ttsSource, ttsSources, allowanceUsdPerHour: conservativeRateUsdPerHour(roles) };
}
```

`src/routes/pricing.ts`:

```ts
export interface PublishedShape {
    id: string;
    sttLegs: SttLeg[];
    ttsSource: TtsSource;
    ttsSources: SttLeg[];
}
```

```ts
                shapes: allShapePricing().map(({ id, sttLegs, ttsSource, ttsSources }) => ({
                    id,
                    sttLegs,
                    ttsSource,
                    ttsSources,
                })),
```

`web/src/pages/dashboard/wallet/pricing-calc.ts`:

```ts
export interface PublishedShape {
  id: string;
  sttLegs: SttLeg[];
  ttsSource: SttLeg | null;
  /** Every voiced side. Optional only so a hand-built test shape may omit it; the endpoint always sends it. */
  ttsSources?: SttLeg[];
}
```

Replace the body of `generatedSpeechFraction` (keep its docstring, and append the paragraph below to it):

```ts
function generatedSpeechFraction(shape: PublishedShape, frequency: number): number {
  const voiced = shape.ttsSources ?? (shape.ttsSource ? [shape.ttsSource] : []);
  if (voiced.length === 0) return 0;
  // Both sides voiced (face-to-face): every utterance is read to the other person.
  if (voiced.length > 1) return frequency;
  // A mixed stream is only ever minted for Both mode, so it always means two
  // sides — see `expandStreamRoles` in the worker's `config/soniox.ts`.
  const twoSided = shape.ttsSource === 'mixed' || shape.sttLegs.length > 1;
  return twoSided ? frequency / 2 : frequency;
}
```

Docstring paragraph to append:

```ts
 * FACE-TO-FACE IS THE EXCEPTION: two people at one microphone each hear the
 * other's words read in their own language, so the participant's side is
 * voiced too (`ttsSources` holds two sides) and the whole speaking time is
 * synthesised.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/services/soniox-token-pricing.test.ts src/routes web/src/pages/dashboard/wallet`
Expected: `soniox-token-pricing` and `pricing-calc` PASS. `pricing-contract.test.ts` FAILS on the missing `dashboard.wallet.pricing.shape.both-shared-face-to-face` label, and `pricing-scenarios.test.ts` FAILS on a published shape no scenario reaches — both are Task A5's.

- [ ] **Step 5: Commit** (with A5, which makes the two web suites green; do not commit a red web suite on its own)

### Task A5: The docs-site calculator: face-to-face scenarios and the split default

**Files:**
- Modify: `web/src/pages/dashboard/wallet/pricing-scenarios.ts` (header ~1-25, `CalculatorScenarioId` ~27-32, `CalculatorScenario.shapeId` doc ~36-42, `CALCULATOR_SCENARIOS` ~49-55)
- Modify: `web/src/pages/dashboard/wallet/CostCalculatorCard.tsx` (`useState(false)` ~76)
- Modify: `web/src/locales/docs/{ar,de,en,es,fr,it,ja,ko,pt,ru,uk,zh}.ts` (the `dashboard.wallet.pricing.*` block — `en.ts` ~894-941)
- Test: `web/src/pages/dashboard/wallet/pricing-scenarios.test.ts`

**Interfaces:**
- Consumes: Task A4's `"both-shared-face-to-face"` shape.
- Produces: scenarios `'face-to-face-voice'` (shape `both-shared-face-to-face`) and `'face-to-face-text'` (shape `both-shared-subtitles`), neither with a stream choice (face-to-face is always one shared stream); the calculator's checkbox ("Each side is captured on its own stream") checked by default, matching the app's new split default.

- [ ] **Step 1: Write the failing tests**

In `pricing-scenarios.test.ts`, make the coverage test tolerate two scenarios sharing a shape, and pin the new rows and the default:

```ts
  it('offers exactly the shapes the endpoint publishes, no more and no fewer', () => {
    const reachable = [...new Set(CALCULATOR_SCENARIOS.flatMap((s) =>
      s.splitShapeId ? [s.shapeId, s.splitShapeId] : [s.shapeId]
    ))].sort();
    expect(reachable).toEqual(published);
  });
```

```ts
  it('prices face-to-face on one shared stream, both sides voiced, with no stream choice', () => {
    expect(shapeIdFor(byId('face-to-face-voice'), true)).toBe('both-shared-face-to-face');
    expect(shapeIdFor(byId('face-to-face-text'), true)).toBe('both-shared-subtitles');
    expect(hasStreamChoice(byId('face-to-face-voice'))).toBe(false);
  });
```

Replace `'defaults to the shared stream the app itself defaults to'` with:

```ts
  it('names the split shape for a checked box — the app now defaults to split, and so does the card', () => {
    expect(shapeIdFor(byId('two-way-voice'), true)).toBe('both-split-spoken');
    expect(shapeIdFor(byId('two-way-text'), true)).toBe('both-split-subtitles');
  });
```

and add a card-level pin in the same file:

```ts
describe('the calculator card', () => {
  it('opens with the split box checked', async () => {
    const source = await import('node:fs').then((fs) => fs.readFileSync(new URL('./CostCalculatorCard.tsx', import.meta.url), 'utf8'));
    expect(source).toMatch(/const \[split, setSplit\] = useState\(true\)/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run web/src/pages/dashboard/wallet/pricing-scenarios.test.ts web/src/pages/dashboard/wallet/pricing-contract.test.ts`
Expected: FAIL — no face-to-face scenarios, `both-shared-face-to-face` unreachable, `useState(false)`, missing locale keys.

- [ ] **Step 3: Implement**

`pricing-scenarios.ts` — the union, the rows, and the docs that named the shared default:

```ts
export type CalculatorScenarioId =
  | 'understand-others'
  | 'be-heard'
  | 'subtitle-myself'
  | 'two-way-voice'
  | 'two-way-text'
  | 'face-to-face-voice'
  | 'face-to-face-text';
```

```ts
export const CALCULATOR_SCENARIOS: readonly CalculatorScenario[] = [
  { id: 'understand-others', shapeId: 'participant-subtitles', splitShapeId: null },
  { id: 'be-heard', shapeId: 'speaker-spoken', splitShapeId: null },
  { id: 'subtitle-myself', shapeId: 'speaker-subtitles', splitShapeId: null },
  { id: 'two-way-voice', shapeId: 'both-shared-spoken', splitShapeId: 'both-split-spoken' },
  { id: 'two-way-text', shapeId: 'both-shared-subtitles', splitShapeId: 'both-split-subtitles' },
  // Face-to-face is always one shared stream (two people, one microphone): no choice to offer.
  { id: 'face-to-face-voice', shapeId: 'both-shared-face-to-face', splitShapeId: null },
  { id: 'face-to-face-text', shapeId: 'both-shared-subtitles', splitShapeId: null },
];
```

In the header comment, replace "The five things a person sets Sokuji up to do" with "The seven things a person sets Sokuji up to do", "these five ids" with "these seven ids", and "the five" with "the seven"; in `shapeId`'s doc replace the sentence about `sonioxUsesSharedBothSession … ?? true` with:

```ts
   * The shape this scenario runs with the box unchecked: for a two-way one,
   * the shared stream. The app defaults to split (`bothModeSharedSession:
   * false`), and the card opens with the box checked to match.
```

`CostCalculatorCard.tsx`: `const [split, setSplit] = useState(true);` with the comment

```ts
  // Checked: the app runs Both on a stream per side unless the user shared it.
```

Locales — in `web/src/locales/docs/en.ts`, change one value and add six keys beside their siblings:

```ts
  'dashboard.wallet.pricing.calcSplitHint': 'Leave this on unless you turned the shared session on in Sokuji. Only your own speech is ever spoken aloud either way, so the second stream costs its connection and nothing more.',
  'dashboard.wallet.pricing.scenario.face-to-face-voice.title': 'Face-to-face conversation',
  'dashboard.wallet.pricing.scenario.face-to-face-voice.desc': 'Two people at one computer, each speaking their own language; each wears one earbud and hears only the translation into their language.',
  'dashboard.wallet.pricing.scenario.face-to-face-text.title': 'Face-to-face conversation, subtitles only',
  'dashboard.wallet.pricing.scenario.face-to-face-text.desc': 'Both read the same screen, or the other person opens the LAN caption page on their phone.',
  'dashboard.wallet.pricing.shape.both-shared-face-to-face': 'Both · Other side beside me · Text Only off',
```

Then the same six keys in the other twelve docs locales, translated. Rules: keep "Sokuji" and "LAN"; match the tone of the same file's `dashboard.wallet.pricing.scenario.two-way-*` strings; the titles must match the app's wizard titles for the same scenarios in that language (Task B14 writes those — translate both from the same English); `zh` uses Simplified Chinese.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run web/src src/services/soniox-token-pricing.test.ts`
Expected: PASS, including `keyParity.test.ts` (13 locales, same keys), `placeholderParity.test.ts` and `pricing-contract.test.ts`.

- [ ] **Step 5: Commit (A4 and A5 together)**

```bash
git add src/services/soniox-token-pricing.ts src/services/soniox-token-pricing.test.ts src/routes/pricing.ts web/src/pages/dashboard/wallet web/src/locales/docs
git commit -m "feat(pricing): price face-to-face and default the calculator to split

The pricing endpoint publishes an eighth shape, shared Both with the
participant voiced, and every shape's voiced sides. The calculator
gains the two face-to-face scenarios, synthesises the whole speaking
time when both sides are voiced, and opens with the split box checked
to match the app's new default.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task A6: Verify, then the PR and the deploy (owner's word)

**Files:** none.

- [ ] **Step 1: Whole suite and types**

Run: `npx tsc --noEmit && npm run test`
Expected: no type error; every test passes.

- [ ] **Step 2: Ask the owner before any outward act**

Say: "Ready to push `feat/participant-speech-par-tts` and open a PR on `kizuna-ai-lab/sokuji-backend` into `main`. Merging deploys production and applies D1 migrations (none in this PR). May I push and open it?" Wait for the word. Then, after their review, ask separately before merging.

- [ ] **Step 3: After the deploy, check the public pricing**

Run: `curl -s https://sokuji.kizuna.ai/api/pricing | node -e "const r=JSON.parse(require('fs').readFileSync(0,'utf8')); const s=r.providers[0].shapes; console.log(s.length, s.find(x=>x.id==='both-shared-face-to-face'))"`
Expected: `8 { id: 'both-shared-face-to-face', sttLegs: [ 'mixed' ], ttsSource: 'mixed', ttsSources: [ 'mixed', 'participant' ] }`

The session-key path with `participantSpeech: true` is checked live by the owner in Task B16.

---

# Part B — the client (`kizuna-ai-lab/sokuji`)

Work on a branch off main after slices 1–2 have merged (for example `feat/soniox-face-to-face` in a worktree under `.claude/worktrees/`).

### Task B1: The face-to-face settings and the provider capability

**Files:**
- Modify: `src/stores/audioStore.ts` (`STORAGE_KEYS` ~18-39, state fields ~95-100, defaults ~166-170, actions interface ~124-128, actions ~268-345, the restore block after `savedAudioMode` ~419-431, selector hooks ~581-600)
- Modify: `src/stores/routingStore.ts` (whole file)
- Modify: `src/lib/provider/types.ts` (after `participantSpeech?: boolean;` ~366)
- Modify: `src/lib/provider/managed.ts` (the returned object ~46-70)
- Modify: `src/providers/soniox/provider.ts` (`sonioxProvider` ~20-60)
- Test: `src/stores/audioStore.test.ts`, `src/stores/routingStore.test.ts` (create if absent), `src/providers/soniox/provider.test.ts`, `src/providers/soniox/kizuna.test.ts`

**Interfaces:**
- Produces:
  - `type OtherSide = 'meeting' | 'beside'` exported from `audioStore.ts`; state `otherSide: OtherSide` (default `'meeting'`), action `setOtherSide(side: OtherSide): void` persisted under `'audio.otherSide'`, restored in `refreshDevices` (an unknown stored value falls to `'meeting'`); hooks `useOtherSide()`, `useSetOtherSide()`.
  - `routingStore`: `faceToFaceSwap: boolean` (default `false` — left ear is mine), `setFaceToFaceSwap(on: boolean): void` persisted under `'settings.routing.faceToFaceSwap'`, loaded in `load()`.
  - Provider definition: `faceToFace?: boolean`; `managed()` carries the base's; Soniox declares `faceToFace: true` (Kizuna Soniox inherits it).

- [ ] **Step 1: Write the failing tests**

`src/stores/audioStore.test.ts` — append:

```ts
describe('the other side (face-to-face)', () => {
  const KEY = 'audio.otherSide';

  it('defaults to a meeting, persists a choice, and restores it', async () => {
    useAudioStore.setState({ otherSide: 'meeting' });
    expect(useAudioStore.getState().otherSide).toBe('meeting');
    useAudioStore.getState().setOtherSide('beside');
    expect(useAudioStore.getState().otherSide).toBe('beside');
    expect(await ServiceFactory.getSettingsService().getSetting<string>(KEY, '')).toBe('beside');

    useAudioStore.setState({ otherSide: 'meeting' });
    await useAudioStore.getState().refreshDevices();
    expect(useAudioStore.getState().otherSide).toBe('beside');
  });

  it('reads an unknown stored value as a meeting', async () => {
    await ServiceFactory.getSettingsService().setSetting(KEY, 'hallway');
    useAudioStore.setState({ otherSide: 'beside' });
    await useAudioStore.getState().refreshDevices();
    expect(useAudioStore.getState().otherSide).toBe('meeting');
  });
});
```

`src/stores/routingStore.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { ServiceFactory } from '../services/ServiceFactory';
import { useRoutingStore } from './routingStore';

describe('routingStore — face-to-face ears', () => {
  beforeEach(() => useRoutingStore.setState({ faceToFaceSwap: false }));

  it('keeps my ear on the left by default and persists a swap', async () => {
    expect(useRoutingStore.getState().faceToFaceSwap).toBe(false);
    useRoutingStore.getState().setFaceToFaceSwap(true);
    expect(useRoutingStore.getState().faceToFaceSwap).toBe(true);
    expect(await ServiceFactory.getSettingsService().getSetting('settings.routing.faceToFaceSwap', false)).toBe(true);
  });

  it('loads a saved swap, and a non-boolean as no swap', async () => {
    await ServiceFactory.getSettingsService().setSetting('settings.routing.faceToFaceSwap', true);
    await useRoutingStore.getState().load();
    expect(useRoutingStore.getState().faceToFaceSwap).toBe(true);
    await ServiceFactory.getSettingsService().setSetting('settings.routing.faceToFaceSwap', 'yes');
    await useRoutingStore.getState().load();
    expect(useRoutingStore.getState().faceToFaceSwap).toBe(false);
  });
});
```

`src/providers/soniox/provider.test.ts` — append inside its top describe:

```ts
  it('offers face-to-face (a shared two_way socket with diarization)', () => {
    expect(sonioxProvider.faceToFace).toBe(true);
  });
```

`src/providers/soniox/kizuna.test.ts` — in `"is Kizuna AI's Soniox: managed, …"`, add `faceToFace: true,` to the `toMatchObject` literal.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/stores/audioStore.test.ts src/stores/routingStore.test.ts src/providers/soniox/provider.test.ts src/providers/soniox/kizuna.test.ts`
Expected: FAIL — `setOtherSide`, `setFaceToFaceSwap` are not functions; `faceToFace` is undefined.

- [ ] **Step 3: Implement**

`src/stores/audioStore.ts`:

```ts
export type AudioMode = 'speaker' | 'participant' | 'both';
/** Where Both's other side is: on the far end of a meeting (system audio), or beside me on my microphone (face-to-face). */
export type OtherSide = 'meeting' | 'beside';
```

`STORAGE_KEYS`: add `OTHER_SIDE: 'audio.otherSide',` after `MODE`. State interface, after `mode: AudioMode;`:

```ts
  /** Both mode's other side; read only where the provider offers face-to-face. */
  otherSide: OtherSide;
```

Actions interface, after `setMode`:

```ts
  setOtherSide: (side: OtherSide) => void;
```

Defaults, after `mode: 'speaker' as AudioMode,`:

```ts
    otherSide: 'meeting' as OtherSide,
```

Action, after `setMode`'s implementation:

```ts
    setOtherSide: (side) => {
      set({ otherSide: side });
      void persistSetting(STORAGE_KEYS.OTHER_SIDE, side);
    },
```

Restore, directly after the `savedAudioMode` `if/else` block in `refreshDevices`:

```ts
        const savedOtherSide = await settingsService.getSetting<string | null>(STORAGE_KEYS.OTHER_SIDE, null);
        set({ otherSide: savedOtherSide === 'beside' ? 'beside' : 'meeting' });
```

Hooks, beside the other selector hooks:

```ts
export const useOtherSide = () => useAudioStore((state) => state.otherSide);
export const useSetOtherSide = () => useAudioStore((state) => state.setOtherSide);
```

`src/stores/routingStore.ts` — extend the header comment ("…and the participant-TTS opt-in (off).") with " Face-to-face's ear swap lives here too: it is routing." and:

```ts
const FACE_TO_FACE_SWAP = 'settings.routing.faceToFaceSwap';
```

```ts
interface RoutingStore {
  meeting: boolean;
  participantSpeech: boolean;
  /** Face-to-face: my translation in the right ear and theirs in the left, instead of the reverse. */
  faceToFaceSwap: boolean;
  load(): Promise<void>;
  setMeeting(on: boolean): void;
  setParticipantSpeech(on: boolean): void;
  setFaceToFaceSwap(on: boolean): void;
}

export const useRoutingStore = create<RoutingStore>()((set) => ({
  meeting: true,
  participantSpeech: false,
  faceToFaceSwap: false,
  async load() {
    const settings = ServiceFactory.getSettingsService();
    const [meeting, participantSpeech, faceToFaceSwap] = await Promise.all([
      settings.getSetting(MEETING, true),
      PARTICIPANT_SPEECH_SHOWN ? settings.getSetting(PARTICIPANT_SPEECH, false) : false,
      settings.getSetting(FACE_TO_FACE_SWAP, false),
    ]);
    set({
      meeting: typeof meeting === 'boolean' ? meeting : true,
      participantSpeech: typeof participantSpeech === 'boolean' ? participantSpeech : false,
      faceToFaceSwap: faceToFaceSwap === true,
    });
  },
  setMeeting(on) {
    set({ meeting: on });
    void persistSetting(MEETING, on);
  },
  setParticipantSpeech(on) {
    set({ participantSpeech: on });
    void persistSetting(PARTICIPANT_SPEECH, on);
  },
  setFaceToFaceSwap(on) {
    set({ faceToFaceSwap: on });
    void persistSetting(FACE_TO_FACE_SWAP, on);
  },
}));
```

`src/lib/provider/types.ts`, after `participantSpeech?: boolean;`:

```ts
  /**
   * Whether Both may run face-to-face (spec 2026-10-08, slice 3): two people
   * at one microphone, attributed by speaker label and language on one
   * shared socket. Absent: the Both popover never offers "beside me", and a
   * stored choice is ignored.
   */
  faceToFace?: boolean;
```

`src/lib/provider/managed.ts`, after the `participantSpeech` spread in the returned object:

```ts
    ...(base.faceToFace ? { faceToFace: base.faceToFace } : {}),
```

`src/providers/soniox/provider.ts`, after `speech: 'optional',`:

```ts
  faceToFace: true,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/stores src/providers/soniox src/lib/provider src/providers/registry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/stores/audioStore.ts src/stores/audioStore.test.ts src/stores/routingStore.ts src/stores/routingStore.test.ts src/lib/provider/types.ts src/lib/provider/managed.ts src/providers/soniox/provider.ts src/providers/soniox/provider.test.ts src/providers/soniox/kizuna.test.ts
git commit -m "feat(face-to-face): store the other side and the ear swap; Soniox offers it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task B2: The run shape knows face-to-face

**Files:**
- Modify: `src/lib/session/types.ts` (`RunShape` ~24-45, `BalanceShape` ~64)
- Modify: `src/lib/provider/types.ts` (`SharedSettings` ~129-138)
- Modify: `src/lib/session/shared.ts` (`buildSharedSettings` ~12-22)
- Modify: `src/lib/session/appShape.ts` (`participantSpeechFromStores` ~45-47, `speechInputsFromStores` ~61-63, `watchSpeechFromStores` ~66-71, `readShapeFromStores` ~73-98, `liveGate` ~111-125)
- Modify: `src/lib/session/shape.ts` (`GateInput` ~67, `balanceRefusal` ~85-92, `gate`'s web refusal ~123)
- Modify: `src/providers/soniox/leaseRequest.ts` (`leaseRequest` ~44-58)
- Test: `src/lib/session/appShape.test.ts`, `src/lib/session/shape.test.ts`, `src/providers/soniox/leaseRequest.test.ts`

**Interfaces:**
- Consumes: B1 (`otherSide`, `faceToFace` capability).
- Produces:
  - `faceToFaceFromStores(): boolean` in `appShape.ts` — the selected provider declares `faceToFace`, the audio mode is `'both'`, `otherSide` is `'beside'`. The one predicate every later task reads.
  - `RunShape.faceToFace?: boolean`; `BalanceShape` picks it too (optional).
  - `SharedSettings.faceToFace?: boolean`; `buildSharedSettings(participant, pauses, segmentation, faceToFace = false)`.
  - In face-to-face, `participantSpeechFromStores(p)` is `p.participantSpeech !== false && !textOnly`, and `speechInputsFromStores().participantSpeech` is `!textOnly`.
  - `gate()` does not refuse the participant leg on `'web'` when `shape.faceToFace`.
  - `leaseRequest(shape, s, participantSpeech)`: `bothSplit` is false whenever `shape.faceToFace`.

- [ ] **Step 1: Write the failing tests**

`src/lib/session/appShape.test.ts` — add `faceToFaceFromStores` to the file's `./appShape` import, then append (the file resets the stores in its `beforeEach`; `faceToFaceFromStores` reads the selected provider through `selectedFromStores`, which needs its entry loaded):

```ts
describe('face-to-face from the stores', () => {
  const pick = (selected: string) => useProviderStore.setState({
    selected,
    entries: { [selected]: { settings: {}, credentials: {}, pair: { source: 'ja', target: 'en' } } },
  });
  beforeEach(() => useAudioStore.setState({ otherSide: 'meeting' }));

  it('is on only for Both, beside me, under a provider that offers it', () => {
    pick('soniox');
    useAudioStore.setState({ mode: 'both', otherSide: 'beside' });
    expect(faceToFaceFromStores()).toBe(true);
    useAudioStore.setState({ mode: 'speaker' });
    expect(faceToFaceFromStores()).toBe(false);
    useAudioStore.setState({ mode: 'both', otherSide: 'meeting' });
    expect(faceToFaceFromStores()).toBe(false);
  });

  it('is off under a provider that does not offer it, whatever is stored (Review Focus 1)', () => {
    pick('openai');
    useAudioStore.setState({ mode: 'both', otherSide: 'beside' });
    expect(faceToFaceFromStores()).toBe(false);
  });

  it('voices the participant unless Text Only is on (Review Focus 2)', () => {
    pick('soniox');
    useAudioStore.setState({ mode: 'both', otherSide: 'beside' });
    useRoutingStore.setState({ participantSpeech: false });
    useSettingsStore.setState({ textOnly: false });
    expect(participantSpeechFromStores({})).toBe(true);
    expect(speechInputsFromStores().participantSpeech).toBe(true);
    useSettingsStore.setState({ textOnly: true });
    expect(participantSpeechFromStores({})).toBe(false);
    // A provider whose participant never speaks stays silent here too.
    useSettingsStore.setState({ textOnly: false });
    expect(participantSpeechFromStores({ participantSpeech: false })).toBe(false);
  });
});
```

`src/lib/session/shape.test.ts` — append beside the existing web refusal test:

```ts
  it('lets face-to-face open the participant leg on the web: its source is silent (Review Focus 5)', () => {
    expect(gate(shape({ legs: ['speaker', 'participant'], faceToFace: true }), 'web')).toBeNull();
    expect(gate(shape({ legs: ['speaker', 'participant'], faceToFace: false }), 'web')).toMatchObject({ code: 'participant_source_unavailable' });
  });
```

`src/providers/soniox/leaseRequest.test.ts` — append:

```ts
describe('leaseRequest — face-to-face', () => {
  const split = { region: 'us' as const, bothModeSharedSession: false };

  it('is always one shared stream, whatever the setting says', () => {
    const r = leaseRequest({ legs: ['speaker', 'participant'], textOnly: false, participantSpeech: true, faceToFace: true }, split, true);
    expect(r.bothSplit).toBe(false);
    expect(requestedRoles(r)).toEqual(['mix_stt', 'mix_tts', 'par_tts']);
  });

  it('asks for no voice at all with Text Only on (Review Focus 2)', () => {
    const r = leaseRequest({ legs: ['speaker', 'participant'], textOnly: true, participantSpeech: false, faceToFace: true }, split, true);
    expect(requestedRoles(r)).toEqual(['mix_stt']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/session/appShape.test.ts src/lib/session/shape.test.ts src/providers/soniox/leaseRequest.test.ts`
Expected: FAIL — `faceToFaceFromStores` is not exported; the web gate refuses; `bothSplit` follows the setting.

- [ ] **Step 3: Implement**

`src/lib/session/types.ts` — in `RunShape`, after `participantSpeech: boolean;`:

```ts
  /** Both with the other side beside me, under a provider that offers it (spec 2026-10-08, slice 3). Absent: false. */
  faceToFace?: boolean;
```

and:

```ts
export type BalanceShape = Pick<RunShape, 'legs' | 'textOnly' | 'participantSpeech'> & Partial<Pick<RunShape, 'faceToFace'>>;
```

`src/lib/provider/types.ts` — in `SharedSettings`, after `segmentation`:

```ts
  /** Face-to-face: a builder that can run it forces its shared socket. Absent: false. */
  faceToFace?: boolean;
```

`src/lib/session/shared.ts`:

```ts
export function buildSharedSettings(
  participant: LanguagePair | null,
  pauses: SharedSettings['pauses'],
  segmentation: SharedSettings['segmentation'],
  faceToFace = false,
): Omit<SharedSettings, 'models'> {
  return {
    pauses,
    segmentation,
    reversed: (direction) => participant !== null && direction.source === participant.source && direction.target === participant.target,
    ...(faceToFace ? { faceToFace: true } : {}),
  };
}
```

`src/lib/session/appShape.ts` — add after `selectedFromStores`:

```ts
/**
 * Face-to-face (spec 2026-10-08, slice 3): Both, the other side beside me,
 * under a provider that offers it. The one predicate the run's shape, the
 * capture, the routing and every surface read, so they never disagree; a
 * stored "beside me" under a provider without it is ordinary Both.
 */
export function faceToFaceFromStores(): boolean {
  const selected = selectedFromStores();
  const { mode, otherSide } = useAudioStore.getState();
  return selected?.provider.faceToFace === true && mode === 'both' && otherSide === 'beside';
}
```

Replace `participantSpeechFromStores` and `speechInputsFromStores`:

```ts
export function participantSpeechFromStores(provider: Pick<AnyProvider, 'participantSpeech'>): boolean {
  if (provider.participantSpeech === false) return false;
  // Face-to-face voices the other person whenever anything is voiced: their
  // translation is what I hear. The hidden switch has no say there.
  return faceToFaceFromStores() ? !useSettingsStore.getState().textOnly : participantSpeechSwitchFromStores();
}
```

```ts
export function speechInputsFromStores(): SpeechInputs {
  const { textOnly } = useSettingsStore.getState();
  return { textOnly, participantSpeech: faceToFaceFromStores() ? !textOnly : participantSpeechSwitchFromStores() };
}
```

In `watchSpeechFromStores`, add a fourth listener — a provider change can turn face-to-face on or off — guarded so the store's own `setSpeech` write does not re-enter:

```ts
  const offs = [
    useSettingsStore.subscribe(apply),
    useRoutingStore.subscribe(apply),
    useAudioStore.subscribe(apply),
    useProviderStore.subscribe((state, prev) => { if (state.selected !== prev.selected) apply(); }),
  ];
```

In `readShapeFromStores`, compute once and pass it to both places:

```ts
  const st = useSettingsStore.getState();
  const faceToFace = faceToFaceFromStores();
  return {
    provider,
    settings: entry.settings,
    credentials: entry.credentials,
    pair: entry.pair,
    legs: legsFor(useAudioStore.getState().mode),
    turnMode: useTurnModeStore.getState().turnMode,
    textOnly: st.textOnly,
    participantSpeech: participantSpeechFromStores(provider),
    faceToFace,
    keepReplayAudio: st.keepReplayAudio,
    shared: buildSharedSettings(
      reversedPair(provider, entry.settings, entry.pair),
      { sourceSeconds: st.segmentationSourcePause, translationSeconds: st.segmentationTranslationPause },
      { mode: st.segmentationMode, sentencesPerRow: st.sentenceSegmentationChunkSentences },
      faceToFace,
    ),
    auth,
    account: useAccountStore.getState().account,
  };
```

In `liveGate`'s `gate({ … })` literal, after `participantSpeech: …,` add `faceToFace: faceToFaceFromStores(),`.

`src/lib/session/shape.ts`:

```ts
export type GateInput = Pick<RunShape, 'provider' | 'settings' | 'pair' | 'legs' | 'turnMode'> & Partial<Pick<RunShape, 'textOnly' | 'participantSpeech' | 'faceToFace' | 'account'>>;
```

`balanceRefusal`'s parameter type gains `'faceToFace'` in its `Pick`, and its floor call becomes:

```ts
  const floor = floorFor({ legs: input.legs, textOnly: input.textOnly ?? false, participantSpeech: input.participantSpeech ?? false, faceToFace: input.faceToFace ?? false }, input.settings);
```

`gate`'s web refusal:

```ts
    // Face-to-face's participant hears through my microphone: its source is silent, and the web can open it.
    if (platform === 'web' && !shape.faceToFace) {
```

`src/providers/soniox/leaseRequest.ts`:

```ts
export function leaseRequest(
  shape: Pick<RunShape, 'legs' | 'textOnly' | 'participantSpeech' | 'faceToFace'>,
  s: Pick<SonioxSettings, 'region' | 'bothModeSharedSession'>,
  participantSpeech: boolean,
): LeaseRequest {
  const both = shape.legs.length === 2;
  return {
    mode: both ? 'both' : shape.legs[0] === 'participant' ? 'participant' : 'speaker',
    textOnly: !shape.legs.includes('speaker') || shape.textOnly,
    // Must agree with the adapter's `config.sharedBoth` (`startBoth`): both read the settings the run built from,
    // and face-to-face is always one shared stream (`buildSoniox`).
    bothSplit: both && !shape.faceToFace && !s.bothModeSharedSession,
    region: asSonioxRegion(s.region),
    ...(participantSpeech ? { participantSpeaks: shape.legs.includes('participant') && shape.participantSpeech } : {}),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/session src/providers/soniox src/components/TitleBar`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/session src/lib/provider/types.ts src/providers/soniox/leaseRequest.ts src/providers/soniox/leaseRequest.test.ts
git commit -m "feat(face-to-face): one predicate for the run shape, its speech and its gate

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task B3: A silent participant source

**Files:**
- Create: `src/lib/audio/capture/silent.ts`
- Modify: `src/lib/audio/appCapture.ts` (`AppCaptureOptions` ~78-81, `open` ~88-93)
- Modify: `src/app/session.ts` (`createAppCapture(…, { meterGate … })` ~192-197)
- Test: `src/lib/audio/capture/silent.test.ts` (create), `src/lib/audio/appCapture.test.ts`

**Interfaces:**
- Consumes: B2's `faceToFaceFromStores()`.
- Produces: `silentSource(): Source` — never emits pcm, never ends on its own, `stop()` resolves; `AppCaptureOptions.participantBeside?(): boolean` — true opens the silent source for the participant leg on every platform.

- [ ] **Step 1: Write the failing tests**

`src/lib/audio/capture/silent.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { silentSource } from './silent';

describe('silentSource', () => {
  it('never delivers audio, never ends on its own, and stops at once', async () => {
    const source = silentSource();
    const pcm = vi.fn();
    const ended = vi.fn();
    const off = source.onPcm(pcm);
    source.onEnded(ended);
    source.onDegraded(vi.fn());
    await source.stop();
    off();
    expect(pcm).not.toHaveBeenCalled();
    expect(ended).not.toHaveBeenCalled();
  });
});
```

`src/lib/audio/appCapture.test.ts` — append to `describe('createAppCapture', …)`:

```ts
  it('opens a silent source for a participant beside me, on every platform, and no capture (Review Focus 5)', async () => {
    for (const platform of ['electron', 'extension', 'web'] as const) {
      opened.calls.length = 0;
      const source = await createAppCapture(fakePlayback(), platform, { participantBeside: () => true }).openSource('participant', live());
      expect(opened.calls).toEqual([]);
      const pcm = vi.fn();
      source.onPcm(pcm);
      expect(pcm).not.toHaveBeenCalled();
      await source.stop();
    }
  });

  it('captures as usual when the participant is not beside me (Review Focus 1)', async () => {
    opened.sources.push(createFakeSource(clock));
    opened.calls.length = 0;
    await createAppCapture(fakePlayback(), 'electron', { participantBeside: () => false }).openSource('participant', live());
    expect(opened.calls).toEqual(['system']);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/audio/capture/silent.test.ts src/lib/audio/appCapture.test.ts`
Expected: FAIL — `./silent` does not exist; the web build refuses the participant source.

- [ ] **Step 3: Implement**

`src/lib/audio/capture/silent.ts`:

```ts
import type { Source } from '../../session/source';

/**
 * Face-to-face's participant source (spec 2026-10-08, slice 3): the other
 * person speaks into my microphone, so their leg captures nothing of its own.
 * The shared socket hears both through the speaker's source.
 */
export function silentSource(): Source {
  return {
    onPcm: () => () => {},
    onEnded: () => () => {},
    onDegraded: () => () => {},
    stop: () => Promise.resolve(),
  };
}
```

`src/lib/audio/appCapture.ts`:

```ts
export interface AppCaptureOptions {
  /** Checked per chunk: false, and the leg's meter reads flat. Absent: every chunk moves it. */
  meterGate?(leg: LegName): boolean;
  /** Read at open: the participant is beside me (face-to-face) and captures nothing. Absent: never. */
  participantBeside?(): boolean;
}
```

and in `createAppCapture`, destructure it and short-circuit `open`:

```ts
  const { meterGate, participantBeside } = options;
```

```ts
  const open = (leg: LegName, signal: AbortSignal): Promise<Source> => {
    if (leg === 'speaker') return openMic(micSettings(), signal);
    if (participantBeside?.()) return Promise.resolve(silentSource());
    if (platform === 'electron') return openSystemAudio(systemAudioSettings(), signal);
    if (platform === 'extension') return openTab(tabSettings(), signal);
    return Promise.reject(new Error('This build has no participant source.'));
  };
```

with `import { silentSource } from './capture/silent';`.

`src/app/session.ts` — in the `createAppCapture(app.playback, getEnvironment(), { … })` options:

```ts
          participantBeside: faceToFaceFromStores,
```

and import `faceToFaceFromStores` from `'../lib/session/appShape'` (the file already imports from there; add it to that import).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/audio src/app`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/audio/capture/silent.ts src/lib/audio/capture/silent.test.ts src/lib/audio/appCapture.ts src/lib/audio/appCapture.test.ts src/app/session.ts
git commit -m "feat(face-to-face): a silent participant source

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task B4: Soniox builds face-to-face, and the participant's own voice

**Files:**
- Modify: `src/providers/soniox/settings.ts` (`SonioxSettings` ~17-40, `SONIOX_DEFAULTS` ~42-55, `migrateSonioxSettings` ~61-80; add `participantVoiceFor`)
- Modify: `src/lib/soniox/ttsCatalog.ts` (beside `SONIOX_DEFAULT_VOICE` ~60)
- Modify: `src/providers/soniox/config.ts` (`SonioxConfig` ~23-36, `buildSoniox`'s return ~145-157)
- Modify: `src/providers/soniox/adapter.ts` (`coreLeg` ~89-96)
- Test: `src/providers/soniox/settings.test.ts`, `src/providers/soniox/config.test.ts`, `src/providers/soniox/adapter.both.test.ts`

**Interfaces:**
- Consumes: B2's `SharedSettings.faceToFace`.
- Produces:
  - `SonioxSettings.participantVoice: string`, default `SONIOX_PARTICIPANT_DEFAULT_VOICE` = `'Grace'`; migrate keeps a stored built-in voice id, anything else falls to the default.
  - `participantVoiceFor(s, speakerVoice): string` — the stored choice, or the other default when it equals the speaker's voice (`'Grace'` ↔ `'Adrian'`).
  - `SonioxConfig.tts.participantVoice: string`; `SonioxConfig.faceToFace?: true`; `sharedBoth` is true whenever `shared.faceToFace`.
  - `coreLeg('participant', …)` speaks in `tts.participantVoice`.

- [ ] **Step 1: Write the failing tests**

`src/providers/soniox/settings.test.ts` — in the `SONIOX_DEFAULTS` literal add `participantVoice: 'Grace',`; append:

```ts
describe('the participant voice', () => {
  it('keeps a stored built-in voice and drops anything else to Grace', () => {
    expect(migrateSonioxSettings({ ...SONIOX_DEFAULTS, participantVoice: 'Kenji' }).participantVoice).toBe('Kenji');
    expect(migrateSonioxSettings({ ...SONIOX_DEFAULTS, participantVoice: 'a1b2-clone-uuid' }).participantVoice).toBe('Grace');
    expect(migrateSonioxSettings({ ...SONIOX_DEFAULTS, participantVoice: 7 }).participantVoice).toBe('Grace');
  });

  it("never matches the speaker's voice by default", () => {
    expect(participantVoiceFor({ participantVoice: 'Grace' }, 'Adrian')).toBe('Grace');
    expect(participantVoiceFor({ participantVoice: 'Grace' }, 'Grace')).toBe('Adrian');
    expect(participantVoiceFor({ participantVoice: 'Adrian' }, 'Adrian')).toBe('Grace');
    expect(participantVoiceFor({ participantVoice: 'Kenji' }, 'Grace')).toBe('Kenji');
  });
});
```

(import `participantVoiceFor` from `./settings`.)

`src/providers/soniox/config.test.ts` — replace the tts test and the sharedBoth describe:

```ts
describe('buildSoniox — tts', () => {
  it("speaks only when the context speaks: the region's voice, the participant's own, the speed clamped", () => {
    expect(build({}, { ...AUTO_CTX, speech: false }).tts).toBeUndefined();
    expect(build({ region: 'jp', voiceJp: 'Clone-UUID' }).tts).toEqual({ voice: 'Clone-UUID', participantVoice: 'Grace', speed: 1 });
    expect(build({ region: 'eu', voiceEu: '' }).tts?.voice).toBe('Adrian');
    expect(build({ voice: 'Grace' }).tts?.participantVoice).toBe('Adrian');
  });
});

describe('buildSoniox — sharedBoth', () => {
  it('carries the shared-Both choice', () => {
    expect(build({ bothModeSharedSession: false }).sharedBoth).toBe(false);
    expect(build().faceToFace).toBeUndefined();
  });

  it('is always shared in face-to-face, and says so', () => {
    const c = buildSoniox(AUTO_CTX, { ...SONIOX_DEFAULTS, bothModeSharedSession: false }, { ...SHARED, faceToFace: true });
    expect(c.sharedBoth).toBe(true);
    expect(c.faceToFace).toBe(true);
  });
});
```

`src/providers/soniox/adapter.both.test.ts` — extend `both()` with a `faceToFace` option and add a test to `describe('Soniox startBoth: shared', …)`:

```ts
function both(o: { sharedBoth?: boolean; participantSpeaks?: boolean; abortFirst?: boolean; faceToFace?: boolean } = {}) {
```

```ts
  const shared = o.faceToFace ? { ...SHARED, faceToFace: true } : SHARED;
  const request = (leg: LegName, credentials: SonioxCredentials): StartRequest<SonioxConfig, SonioxCredentials> =>
    ({ context: contexts[leg], config: buildSoniox(contexts[leg], s, shared), credentials, clock, signal: controller.signal });
```

```ts
  it("shared: the participant speaks in its own voice, never the speaker's", async () => {
    const h = await live({ participantSpeaks: true });
    h.sttSockets()[0].receive(msg({ ...orig('Ohayō.'), language: 'ja' }, tr('Good morning.', 'en', 'ja'), END));
    const [, participantTts] = h.ttsSockets();
    expect(participantTts.sentJson<Json>()).toContainEqual(expect.objectContaining({ voice: 'Grace', language: 'en' }));
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/providers/soniox/settings.test.ts src/providers/soniox/config.test.ts src/providers/soniox/adapter.both.test.ts`
Expected: FAIL — no `participantVoice`, `participantVoiceFor` missing, `faceToFace` not built, the participant speaks as Adrian.

- [ ] **Step 3: Implement**

`src/lib/soniox/ttsCatalog.ts`, after `SONIOX_DEFAULT_VOICE`:

```ts
/** The participant's default voice (spec 2026-10-08, D12): built-in, and unlike the speaker's default. */
export const SONIOX_PARTICIPANT_DEFAULT_VOICE = 'Grace';
```

`src/providers/soniox/settings.ts` — import `SONIOX_PARTICIPANT_DEFAULT_VOICE, SONIOX_VOICES` with `SONIOX_DEFAULT_VOICE`; in `SonioxSettings`, after `voiceJp`:

```ts
  /** The voice that reads the other person's words to me: built-in only, one for every region (D12). */
  participantVoice: string;
```

In `SONIOX_DEFAULTS`, after `voiceJp`: `participantVoice: SONIOX_PARTICIPANT_DEFAULT_VOICE,`. In `migrateSonioxSettings`'s result, after `voiceJp: str('voiceJp'),`:

```ts
    // Built-in voices only: a clone id (or anything else) falls to the default, never into the participant's mouth.
    participantVoice: typeof stored.participantVoice === 'string' && SONIOX_VOICES.some((v) => v.value === stored.participantVoice)
      ? stored.participantVoice
      : SONIOX_DEFAULTS.participantVoice,
```

and add after `migrateSonioxSettings`:

```ts
/** The participant's voice for a run: the choice, unless it is the speaker's own — then the other default, so the two people never sound alike. */
export function participantVoiceFor(s: Pick<SonioxSettings, 'participantVoice'>, speakerVoice: string): string {
  const chosen = s.participantVoice || SONIOX_PARTICIPANT_DEFAULT_VOICE;
  if (chosen !== speakerVoice) return chosen;
  return chosen === SONIOX_PARTICIPANT_DEFAULT_VOICE ? SONIOX_DEFAULT_VOICE : SONIOX_PARTICIPANT_DEFAULT_VOICE;
}
```

`src/providers/soniox/config.ts`:

```ts
  /** Present when this leg speaks. The participant leg speaks in `participantVoice`. */
  tts?: { voice: string; participantVoice: string; speed: number };
  /** Both mode on one mixed socket (D23); read by `startBoth`. */
  sharedBoth: boolean;
  /** Face-to-face: two people at one microphone (slice 3). Absent: false. */
  faceToFace?: true;
```

and the end of `buildSoniox` (rename the unused `_shared` parameter to `shared`):

```ts
  const voice = s[sonioxVoiceField(asSonioxRegion(s.region))] || SONIOX_DEFAULT_VOICE;
  return {
    stt: {
      model: SONIOX_STT_MODEL,
      ...(Object.keys(wire).length > 0 ? { context: wire } : {}),
      endpointSensitivity: clampNumber(s.endpointSensitivity, -1, 1, 0),
      endpointLatencyAdjustmentLevel: Math.round(clampNumber(s.endpointLatencyAdjustmentLevel, 0, 3, 0)),
      endpointMaxDelayMs: Math.round(clampNumber(s.endpointMaxDelayMs, 500, 3000, 2000)),
    },
    ...(context.speech
      ? { tts: { voice, participantVoice: participantVoiceFor(s, voice), speed: clampNumber(s.ttsSpeed, 0.7, 1.3, 1.0) } }
      : {}),
    // Face-to-face is one microphone: there is nothing to split.
    sharedBoth: shared.faceToFace === true || s.bothModeSharedSession,
    ...(shared.faceToFace ? { faceToFace: true as const } : {}),
  };
```

(`participantVoiceFor` from `./settings`.)

`src/providers/soniox/adapter.ts`, `coreLeg`:

```ts
  const speech = tts && key
    ? new LegSpeech({ region: request.credentials.region, key, clientReferenceId: request.credentials.clientReferenceId, voice: name === 'participant' ? tts.participantVoice : tts.voice, speed: tts.speed, events, clock: request.clock, openSocket })
    : null;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/providers/soniox src/lib/soniox`
Expected: PASS. (`kizuna.test.ts`'s `settings.defaults` equals `SONIOX_DEFAULTS` by reference; `voiceClaim.test.ts` is untouched — the claim stays the speaker's.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/soniox/ttsCatalog.ts src/providers/soniox/settings.ts src/providers/soniox/settings.test.ts src/providers/soniox/config.ts src/providers/soniox/config.test.ts src/providers/soniox/adapter.ts src/providers/soniox/adapter.both.test.ts
git commit -m "feat(soniox): face-to-face forces the shared socket; the participant has its own voice

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task B5: Face-to-face attribution by language votes, and no person labels

**Files:**
- Modify: `src/providers/soniox/sideTracker.ts` (header ~1-17, `SideEvidence` ~21-24, options ~26-31, constructor ~51-56, `inferSide` ~69-86)
- Modify: `src/providers/soniox/adapter.ts` (`CoreOptions` ~98-106, the tracker construction ~121, `legFor` ~224-236, the segment sink ~139, `startBoth` ~507-515)
- Test: `src/providers/soniox/sideTracker.test.ts`, `src/providers/soniox/adapter.both.test.ts`

**Interfaces:**
- Consumes: B4's `config.faceToFace`.
- Produces:
  - `new SonioxSideTracker({ energy: false })`: no energy verdicts; `inferSide(speaker, startMs, endMs, witness?: UtteranceSide | null)` keeps a per-label tally of the language witness. A label answers `{ side, tier: 'label' }` once its leading side has `establishNet` (2) votes and strictly leads, judged on the votes cast BEFORE this call (the spike's 12/12 rule: a code-switched line cannot unseat its own label); otherwise `{ side: witness, tier: 'language' }`; then the witness is tallied. The energy-mode behaviour is unchanged (it ignores `witness`).
  - `CoreOptions.faceToFace?: true`: the core builds the tracker without energy, passes the language witness, and strips `person` from every segment payload it emits — face-to-face shows no person labels (each side is one person).

- [ ] **Step 1: Write the failing tests**

`src/providers/soniox/sideTracker.test.ts` — append:

```ts
describe('SonioxSideTracker — face-to-face (no energy, language votes)', () => {
  it('answers by the language witness until a label has two votes, then by the label', () => {
    const t = new SonioxSideTracker({ energy: false });
    t.recordFrame(0, 500); // ignored: one microphone carries both people
    expect(t.inferSide('1', 0, 100, 'speaker')).toEqual({ side: 'speaker', tier: 'language' });
    expect(t.inferSide('1', 0, 100, 'speaker')).toEqual({ side: 'speaker', tier: 'language' });
    // Established on two votes. A code-switched line: its language says participant, its label still says speaker.
    expect(t.inferSide('1', 0, 100, 'participant')).toEqual({ side: 'speaker', tier: 'label' });
    // One contrary vote does not unseat the label (2 to 1).
    expect(t.inferSide('1', 0, 100, 'participant')).toEqual({ side: 'speaker', tier: 'label' });
  });

  it('forgets every tally on reset (a new socket mints new labels)', () => {
    const t = new SonioxSideTracker({ energy: false });
    t.inferSide('1', 0, 100, 'speaker');
    t.inferSide('1', 0, 100, 'speaker');
    t.reset();
    expect(t.inferSide('1', 0, 100, 'participant')).toEqual({ side: 'participant', tier: 'language' });
  });

  it('returns null with no witness and no established label', () => {
    const t = new SonioxSideTracker({ energy: false });
    expect(t.inferSide('2', 0, 100, null)).toBeNull();
    expect(t.inferSide(undefined, 0, 100)).toBeNull();
  });

  it('ignores a witness in energy mode', () => {
    const t = new SonioxSideTracker();
    t.recordFrame(0, 500);
    expect(t.inferSide(undefined, 0, 100, 'speaker')).toEqual({ side: 'participant', tier: 'energy' });
  });
});
```

`src/providers/soniox/adapter.both.test.ts` — append a describe:

```ts
describe('Soniox startBoth: face-to-face', () => {
  it('attributes by label and language, not energy: a code-switched line stays with its speaker', async () => {
    const h = await live({ faceToFace: true });
    const stt = h.sttSockets()[0];
    // The participant's channel is silent in face-to-face; the speaker's carries both people.
    speak(h, 'speaker', 10);
    stt.receive(msg({ ...orig('Hello.'), language: 'en', speaker: '1' }, END));
    stt.receive(msg({ ...orig('Thanks.'), language: 'en', speaker: '1' }, END));
    stt.receive(msg({ ...orig('Konnichiwa.'), language: 'ja', speaker: '2' }, END));
    stt.receive(msg({ ...orig('Arigatō.'), language: 'ja', speaker: '2' }, END));
    // Speaker 1 now says a Japanese line: the label, established, keeps it on the speaker's leg.
    stt.receive(msg({ ...orig('Daijōbu.'), language: 'ja', speaker: '1' }, END));
    // One ref per utterance (no translation tokens here), numbered across the shared core.
    expect(opened(h, 'speaker')).toEqual([1, 2, 5]);
    expect(opened(h, 'participant')).toEqual([3, 4]);
  });

  it('emits no person label in face-to-face', async () => {
    const h = await live({ faceToFace: true });
    h.sttSockets()[0].receive(msg({ ...orig('Hello.'), language: 'en', speaker: '1' }, END));
    for (const e of [...h.of('speaker', 'segmentOpened'), ...h.of('speaker', 'segmentText')]) {
      expect(e.payload).not.toHaveProperty('person');
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/providers/soniox/sideTracker.test.ts src/providers/soniox/adapter.both.test.ts`
Expected: FAIL — the tracker has no `energy` option; with energy on, every face-to-face utterance goes to the speaker; `person` is present.

- [ ] **Step 3: Implement**

`src/providers/soniox/sideTracker.ts` — header, after the three tiers:

```ts
 *
 * Face-to-face (`energy: false`): both people are on channel A, so energy
 * says nothing. The caller's language witness is tallied per label instead;
 * a label answers once its leading side has `establishNet` votes and leads,
 * judged before this call's vote, so a code-switched line keeps its label.
```

```ts
export interface SideEvidence {
  side: UtteranceSide;
  tier: 'label' | 'energy' | 'language';
}

interface SideTrackerOptions {
  frameMs?: number;
  capacity?: number;
  energyRatio?: number;
  establishNet?: number;
  /** false: face-to-face — no energy verdicts; the caller's witness votes instead. */
  energy?: boolean;
}
```

Fields: add `private readonly energy: boolean;` (constructor: `this.energy = options.energy ?? true;`) and

```ts
  // Face-to-face only: per label, how many utterances' language named each side.
  private tallies = new Map<string, Record<UtteranceSide, number>>();
```

`inferSide` gains the witness and hands face-to-face to its own method; the energy path below its first line is unchanged:

```ts
  inferSide(
    speaker: string | undefined,
    startMs: number | undefined,
    endMs: number | undefined,
    witness: UtteranceSide | null = null,
  ): SideEvidence | null {
    if (!this.energy) return this.byLanguage(speaker, witness);
    const energySide = this.energyVerdict(startMs, endMs);
    if (speaker && energySide) {
      this.votes.set(speaker, (this.votes.get(speaker) ?? 0) + (energySide === 'speaker' ? 1 : -1));
    }
    if (speaker) {
      const net = this.votes.get(speaker) ?? 0;
      if (Math.abs(net) >= this.establishNet) {
        return { side: net > 0 ? 'speaker' : 'participant', tier: 'label' };
      }
    }
    if (energySide) return { side: energySide, tier: 'energy' };
    return null;
  }
```

```ts
  /** Face-to-face: the label's answer from the votes so far, then this utterance's vote. */
  private byLanguage(speaker: string | undefined, witness: UtteranceSide | null): SideEvidence | null {
    const tally = speaker ? this.tallies.get(speaker) ?? { speaker: 0, participant: 0 } : null;
    let answer: SideEvidence | null = null;
    if (tally) {
      const lead: UtteranceSide = tally.speaker >= tally.participant ? 'speaker' : 'participant';
      const trail = tally[lead === 'speaker' ? 'participant' : 'speaker'];
      if (tally[lead] >= this.establishNet && tally[lead] > trail) answer = { side: lead, tier: 'label' };
    }
    if (speaker && tally && witness) {
      tally[witness] += 1;
      this.tallies.set(speaker, tally);
    }
    return answer ?? (witness ? { side: witness, tier: 'language' } : null);
  }
```

and `reset()` also runs `this.tallies.clear();`.

`src/providers/soniox/adapter.ts` — `CoreOptions`, after `shared?: true;`:

```ts
  /** Face-to-face (slice 3): one microphone, so the tracker votes by language, and no person label leaves the core. */
  faceToFace?: true;
```

Tracker:

```ts
    this.tracker = o.shared ? new SonioxSideTracker({ energy: !o.faceToFace }) : null;
```

The segment sink in the `Utterances` options:

```ts
        segment: (leg, event) => { if (!this.ended) emitSegment(this.leg(leg).events, this.o.faceToFace ? withoutPerson(event) : event); },
```

and a module-level helper beside `emitSegment`:

```ts
/** Face-to-face's sides are its two people: a diarization label would only ever name a phantom (spec, slice 3). */
function withoutPerson(event: SegmentEvent): SegmentEvent {
  if (event.kind === 'segmentClosed' || !('person' in event.payload)) return event;
  const { person: _person, ...payload } = event.payload;
  return { ...event, payload } as SegmentEvent;
}
```

`legFor` — pass the witness:

```ts
  private legFor(token: SonioxToken): LegName {
    if (!this.tracker) return this.o.legs[0].name;
    const source = this.o.primary.context.direction.source;
    // The language, as a witness: face-to-face's tracker votes with it; the energy tracker ignores it.
    const language = token.translation_status === 'translation' ? token.source_language : token.language;
    const witness = !language ? null : language === sonioxWire.toWire(source) ? 'speaker' : 'participant';
    // An established speaker label, else the channels' energy (or, face-to-face, the language) over the token's window (`SonioxClient.ts:982-998`).
    const evidence = this.tracker.inferSide(token.speaker, token.start_ms, token.end_ms, witness);
    if (evidence) return evidence.side;
    // The language, which never votes in the energy tracker; the speaker's leg when nothing can tell.
    // Latched at this first token: the diarization design's accepted limitation
    // (docs/superpowers/specs/2026-07-30-soniox-diarization-attribution-design.md, "decided once per utterance").
    if (witness) return witness;
    return 'speaker';
  }
```

(The old code compared `token.language === source` without `toWire`; a source like `zh-Hans` never matched the wire's `zh`. `toWire` is the correct comparison — the existing shared tests use plain `en`/`ja`, for which both agree.)

`startBoth`, the shared core:

```ts
        openSocket,
        shared: true,
        ...(requests.speaker.config.faceToFace ? { faceToFace: true as const } : {}),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/providers/soniox src/lib/contract`
Expected: PASS, including the existing shared tests (energy mode unchanged) and the conformance suite.

- [ ] **Step 5: Commit**

```bash
git add src/providers/soniox/sideTracker.ts src/providers/soniox/sideTracker.test.ts src/providers/soniox/adapter.ts src/providers/soniox/adapter.both.test.ts
git commit -m "feat(soniox): face-to-face attributes by label and language, with no person labels

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task B6: A leg speaks only translations into its own target

**Files:**
- Modify: `src/providers/soniox/adapter.ts` (the `speak` sink ~140)
- Test: `src/providers/soniox/adapter.both.test.ts`

**Interfaces:**
- Produces: the core drops a `speak(leg, …, language)` whose language (wire) is the leg's source (wire), in every mode; `endSpeech` still runs so the leg's speech queue closes the utterance.

- [ ] **Step 1: Write the failing test**

Append to `describe('Soniox startBoth: shared', …)`:

```ts
  it("shared: a translation into the speaker's own language is not spoken (a code-switched line; Review Focus 4)", async () => {
    const h = await live();
    speak(h, 'speaker', 10);
    // The speaker's source is 'en'; they said a Japanese line, so Soniox translated it into English.
    h.sttSockets()[0].receive(msg({ ...orig('Daijōbu.'), language: 'ja' }, tr('It is fine.', 'en', 'ja'), END));
    expect(opened(h, 'speaker')).toEqual([1, 2]);
    const [speakerTts] = h.ttsSockets();
    expect(speakerTts.sentJson<Json>().some((m) => m.text === 'It is fine.')).toBe(false);
  });
```

Append to `describe('Soniox startBoth: face-to-face', …)`:

```ts
  it("face-to-face: the other person's code-switched line is not read back to them (Review Focus 4)", async () => {
    const h = await live({ faceToFace: true, participantSpeaks: true });
    const stt = h.sttSockets()[0];
    // Label '2' speaks Japanese (the participant's source): two lines establish it as the participant.
    stt.receive(msg({ ...orig('Konnichiwa.'), language: 'ja', speaker: '2' }, END));
    stt.receive(msg({ ...orig('Arigatō.'), language: 'ja', speaker: '2' }, END));
    // They now say an English line; Soniox translates it into Japanese — their own language.
    stt.receive(msg({ ...orig('Thank you.'), language: 'en', speaker: '2' }, tr('Dōmo arigatō.', 'ja', 'en'), END));
    expect(opened(h, 'participant')).toEqual([1, 2, 3, 4]);
    for (const tts of h.ttsSockets()) expect(tts.sentJson<Json>().some((m) => m.text === 'Dōmo arigatō.')).toBe(false);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/providers/soniox/adapter.both.test.ts`
Expected: FAIL — the speaker's TTS socket sends `It is fine.`.

- [ ] **Step 3: Implement**

The `speak` sink:

```ts
        speak: (leg, ref, text, span, language) => {
          if (this.ended) return;
          const core = this.leg(leg);
          // A leg speaks only into its own target: a translation into its source is the
          // speaker's own language (they code-switched), and nobody needs it read aloud.
          if (sonioxWire.toWire(language) === sonioxWire.toWire(core.context.direction.source)) return;
          core.speech?.speak(ref, text, span, sonioxWire.toWire(language));
        },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/providers/soniox`
Expected: PASS (one_way legs never receive a translation into their source, so their tests are unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/providers/soniox/adapter.ts src/providers/soniox/adapter.both.test.ts
git commit -m "fix(soniox): never speak a translation into the leg's own language

In shared Both a line said in the other language came back in mine
and was spoken into the meeting; face-to-face would read it into the
speaker's own ear. A leg now speaks only into its target.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task B7: Panned ears in the route table and the graph

**Files:**
- Modify: `src/lib/audio/routes.ts` (`Edge` ~16-20, `RoutingSettings` ~22-39, `routesFor` ~42-56)
- Modify: `src/lib/audio/graph.ts` (`edges` map and `applyRoute` ~243-266)
- Modify: `src/lib/audio/fakeWebAudio.ts` (add `FakeStereoPanner`, `createStereoPanner`)
- Modify: `src/lib/audio/appAudio.ts` (`readRouting` ~37-70, `createAppRouting` ~72-86)
- Test: `src/lib/audio/routes.test.ts`, `src/lib/audio/graph.test.ts`, `src/lib/audio/appAudio.test.ts`

**Interfaces:**
- Consumes: B1's `faceToFaceSwap`, B2's `faceToFaceFromStores()`.
- Produces:
  - `type Ear = 'left' | 'right'`; `earsFor(swap: boolean): Record<'speaker' | 'participant', Ear>` — default the participant's translation (into my language) goes left, the speaker's (into theirs) goes right.
  - `Edge.pan?: -1 | 1`; `RoutingSettings.ears?: { swap: boolean }` (present = face-to-face). With `ears`, `routesFor` returns replay and preview to real, speaker → real panned to the other person's ear, participant → real panned to mine (when `participantSpeech`), and nothing into the meeting, no monitor, no passthrough.
  - The graph keys an edge by `from>to>pan`: a changed pan replaces the edge; a pan puts a `StereoPannerNode` between the edge's gain and the bus.
  - `readRouting(audio, switches, platform, turnMode, faceToFace = false)`; `switches` gains `faceToFaceSwap`.

- [ ] **Step 1: Write the failing tests**

`src/lib/audio/routes.test.ts` — append:

```ts
describe('routesFor — face-to-face ears', () => {
  const F2F: RoutingSettings = { ...OFF, meeting: true, monitor: true, participantSpeech: true, passthrough: { on: true, ratio: 0.3 }, ears: { swap: false } };

  it('pans my translation to their ear and theirs to mine, and sends nothing into the meeting', () => {
    expect(routesFor(F2F, false)).toEqual([
      { from: 'replay', to: 'real', gain: 1 },
      { from: 'preview', to: 'real', gain: 1 },
      { from: 'speaker', to: 'real', gain: 1, pan: 1 },
      { from: 'participant', to: 'real', gain: 1, pan: -1 },
    ]);
  });

  it('mirrors both ears on a swap (Review Focus 3)', () => {
    const swapped = routesFor({ ...F2F, ears: { swap: true } }, false);
    expect(swapped).toContainEqual({ from: 'speaker', to: 'real', gain: 1, pan: -1 });
    expect(swapped).toContainEqual({ from: 'participant', to: 'real', gain: 1, pan: 1 });
  });

  it("drops the participant's edge when it does not speak (Text Only)", () => {
    expect(routesFor({ ...F2F, participantSpeech: false }, false).some((e) => e.from === 'participant')).toBe(false);
  });
});

describe('earsFor', () => {
  it('puts the participant (my language) left by default', () => {
    expect(earsFor(false)).toEqual({ speaker: 'right', participant: 'left' });
    expect(earsFor(true)).toEqual({ speaker: 'left', participant: 'right' });
  });
});
```

(import `earsFor` from `./routes`.)

`src/lib/audio/graph.test.ts` — append to `describe('createAudioGraph — routes', …)`:

```ts
  it('pans an edge through a stereo panner, and replaces it when the pan changes (Review Focus 3)', async () => {
    const { ctx, graph, real, destinationOf, clip } = await setup();
    graph.route([{ from: 'speaker', to: 'real', gain: 1, pan: 1 }]);
    const source = clip('speaker');
    expect(reaches(source, destinationOf(real))).toBe(true);
    expect(ctx.panners.map((p) => p.pan.value)).toEqual([1]);
    graph.route([{ from: 'speaker', to: 'real', gain: 1, pan: -1 }]);
    expect(reaches(source, destinationOf(real))).toBe(true);
    expect(ctx.panners.map((p) => p.pan.value)).toEqual([1, -1]);
    // The first panner is out of the path.
    expect(ctx.panners[0].outputs.size).toBe(0);
  });
```

`src/lib/audio/appAudio.test.ts` — the switches gain a field: change the fixture to `const SWITCHES = { meeting: true, participantSpeech: false, faceToFaceSwap: false };`, then append:

```ts
describe('readRouting — face-to-face', () => {
  it('asks for the ears, voices the participant whatever the system-capture rule says, and keeps the swap', () => {
    const r = readRouting({ ...AUDIO, mode: 'both' }, { meeting: true, participantSpeech: false, faceToFaceSwap: true }, 'electron', 'auto', true);
    expect(r.ears).toEqual({ swap: true });
    expect(r.participantSpeech).toBe(true);
  });

  it('asks for no ears outside face-to-face', () => {
    expect(readRouting(AUDIO, { meeting: true, participantSpeech: false, faceToFaceSwap: false }, 'electron', 'auto').ears).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/audio/routes.test.ts src/lib/audio/graph.test.ts src/lib/audio/appAudio.test.ts`
Expected: FAIL — no `earsFor`, no `ears`, no panner.

- [ ] **Step 3: Implement**

`src/lib/audio/routes.ts`:

```ts
export interface Edge {
  from: Feed;
  to: Bus;
  gain: number;
  /** Face-to-face's ears: -1 the left channel, 1 the right. Absent: centred. */
  pan?: -1 | 1;
}

/** One ear of the real device's two (face-to-face). */
export type Ear = 'left' | 'right';

/** The ear each leg's translation plays in: the participant's (into my language) is mine, left unless swapped. */
export function earsFor(swap: boolean): Record<'speaker' | 'participant', Ear> {
  return swap ? { speaker: 'left', participant: 'right' } : { speaker: 'right', participant: 'left' };
}
```

`RoutingSettings`, after `sinks`:

```ts
  /** Face-to-face (slice 3): both translations on the real device, one per ear; no meeting. Absent: not face-to-face. */
  ears?: { swap: boolean };
```

`routesFor`, after the two fixed edges:

```ts
  if (s.ears) {
    // Two people at one computer: no meeting, no monitor of my own voice, no passthrough —
    // each translation goes to the ear of the person whose language it is in.
    const ears = earsFor(s.ears.swap);
    const pan = (ear: Ear): -1 | 1 => (ear === 'left' ? -1 : 1);
    edges.push({ from: 'speaker', to: 'real', gain: 1, pan: pan(ears.speaker) });
    if (s.participantSpeech) edges.push({ from: 'participant', to: 'real', gain: 1, pan: pan(ears.participant) });
    return edges;
  }
```

`src/lib/audio/graph.ts`:

```ts
  const edges = new Map<string, { from: Feed; node: GainNode; panner?: StereoPannerNode }>();
```

```ts
  const applyRoute = (next: readonly Edge[]) => {
    const { ctx, feeds, buses } = current;
    const wanted = new Map<string, Edge>();
    // The pan is part of the key: a swapped ear is a new edge, not a retuned one.
    for (const edge of next) if (buses[edge.to]) wanted.set(`${edge.from}>${edge.to}>${edge.pan ?? 0}`, edge);
    for (const [id, edge] of edges) {
      if (wanted.has(id)) continue;
      feeds[edge.from].disconnect(edge.node);
      edge.node.disconnect();
      edge.panner?.disconnect();
      edges.delete(id);
    }
    for (const [id, edge] of wanted) {
      const existing = edges.get(id);
      if (existing) {
        existing.node.gain.setValueAtTime(edge.gain, ctx.currentTime);
        continue;
      }
      const node = gainOn(ctx, edge.gain);
      feeds[edge.from].connect(node);
      let panner: StereoPannerNode | undefined;
      if (edge.pan !== undefined) {
        panner = ctx.createStereoPanner();
        panner.pan.value = edge.pan;
        node.connect(panner);
        panner.connect(buses[edge.to]!);
      } else {
        node.connect(buses[edge.to]!);
      }
      edges.set(id, { from: edge.from, node, ...(panner ? { panner } : {}) });
    }
  };
```

`src/lib/audio/fakeWebAudio.ts`, after `FakeGain`:

```ts
export class FakeStereoPanner extends FakeNode {
  readonly pan = {
    value: 0,
    setValueAtTime(value: number): void {
      this.value = value;
    },
  };
}
```

and in `FakeAudioContext`, a `readonly panners: FakeStereoPanner[] = [];` field beside the other recorded node lists, plus:

```ts
  createStereoPanner(): FakeStereoPanner {
    const panner = new FakeStereoPanner();
    this.panners.push(panner);
    return panner;
  }
```

`src/lib/audio/appAudio.ts`:

```ts
export function readRouting(
  audio: Pick<AudioState, 'mode' | 'isMonitorMuted' | 'isRealVoicePassthroughEnabled' | 'realVoicePassthroughVolume' | 'selectedMonitorDevice' | 'audioMonitorDevices' | 'selectedParticipantSource'>,
  switches: { meeting: boolean; participantSpeech: boolean; faceToFaceSwap: boolean },
  platform: Platform,
  turnMode: TurnMode,
  faceToFace = false,
): RoutingSettings {
  return {
    meeting: switches.meeting,
    // Today's rule: the monitor is heard only in speaker mode, so a
    // whole-system participant capture never hears it.
    monitor: audio.mode === 'speaker' && !audio.isMonitorMuted,
    // Other's translation on the real device is recaptured by a whole-system
    // participant capture and translated again as Other — the replay gate's
    // reason (plan 1e-3b-2 ruling 7, completed: `participantSpeechHeard` is
    // the one predicate this, the switch, the run's shape and the replay
    // slot all share). An application capture that falls back to the whole
    // system mid-run is not seen here: a follow-up. Face-to-face captures
    // nothing system-wide, so its participant is voiced whenever its leg
    // speaks (the run's shape decides that).
    participantSpeech: faceToFace || (switches.participantSpeech && participantSpeechHeard(platform, audio.selectedParticipantSource?.deviceId)),
    // 1e-3 ruling 4, today's rule (`isPassthroughActive`): under push-to-translate
    // the original voice is on at full level whenever the key is not held (the
    // route closes while held), whatever the passthrough toggle says. Under
    // push-to-talk it follows the toggle but only while the key is held: 0.41.1
    // ran the recorder only during a hold, and the owner kept that (2026-10-02).
    passthrough: turnMode === 'push-to-translate'
      ? { on: true, ratio: 1, gate: 'idle' }
      : turnMode === 'push-to-talk'
        ? { on: audio.isRealVoicePassthroughEnabled, ratio: audio.realVoicePassthroughVolume, gate: 'held' }
        : { on: audio.isRealVoicePassthroughEnabled, ratio: audio.realVoicePassthroughVolume },
    sinks: {
      real: audio.selectedMonitorDevice?.deviceId,
      virtual: platform === 'electron' ? findVirtualSpeaker(audio.audioMonitorDevices) : undefined,
    },
    ...(faceToFace ? { ears: { swap: switches.faceToFaceSwap } } : {}),
  };
}
```

`createAppRouting`:

```ts
    get: () => readRouting(useAudioStore.getState(), useRoutingStore.getState(), platform, useTurnModeStore.getState().turnMode, faceToFaceFromStores()),
    subscribe(listener) {
      const offAudio = useAudioStore.subscribe(() => listener());
      const offSwitches = useRoutingStore.subscribe(() => listener());
      const offTurnMode = useTurnModeStore.subscribe(() => listener());
      // The provider decides whether "beside me" is face-to-face.
      const offProvider = useProviderStore.subscribe((s, prev) => { if (s.selected !== prev.selected) listener(); });
      return () => {
        offAudio();
        offSwitches();
        offTurnMode();
        offProvider();
      };
    },
```

(imports: `faceToFaceFromStores` from `'../session/appShape'`, `useProviderStore` from `'../../stores/providerStore'`.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/audio`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/audio/routes.ts src/lib/audio/routes.test.ts src/lib/audio/graph.ts src/lib/audio/graph.test.ts src/lib/audio/fakeWebAudio.ts src/lib/audio/appAudio.ts src/lib/audio/appAudio.test.ts
git commit -m "feat(face-to-face): each translation in the ear of the person who reads it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task B8: A preview that plays in one ear

**Files:**
- Modify: `src/lib/audio/graph.ts` (`playOnce` in the interface ~62 and its implementation ~466-476)
- Modify: `src/lib/audio/playback.ts` (`PreviewClip` ~37-40, `preview` ~178-194)
- Modify: `src/lib/audio/appAudio.ts` (`AppAudio.testTone` ~34, its implementation ~151-163)
- Test: `src/lib/audio/graph.test.ts`, `src/lib/audio/playback.test.ts`

**Interfaces:**
- Produces: `PreviewClip.pan?: -1 | 1`; `graph.playOnce(audio, sampleRate, pan?)`; `appAudio.testTone(signal?, pan?)` — the ears block's per-ear preview.

- [ ] **Step 1: Write the failing tests**

`src/lib/audio/graph.test.ts`:

```ts
  it('plays a one-shot through a panner when asked for one ear, and drops it at the end', async () => {
    const { ctx, graph } = await setup();
    const shot = graph.playOnce(new Float32Array(240), 24_000, -1);
    expect(ctx.panners.map((p) => p.pan.value)).toEqual([-1]);
    shot.stop();
    await shot.ended;
    expect(ctx.panners[0].outputs.size).toBe(0);
  });
```

`src/lib/audio/playback.test.ts` — `fakeGraph()`'s `playOnce` records the pan (`playOnce(audio, sampleRate, pan) { … const shot = { audio, sampleRate, pan, stopped: false, end }; … }`, and `pan?: -1 | 1` in the `shots` element type), then beside its preview tests:

```ts
  it("hands a clip's pan to the graph", () => {
    const { graph, shots } = fakeGraph();
    const playback = createPlayback(graph, routing().source);
    void playback.preview({ audio: new Float32Array(10), sampleRate: 24_000, pan: 1 });
    expect(shots[0].pan).toBe(1);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/audio/graph.test.ts src/lib/audio/playback.test.ts`
Expected: FAIL — no panner; `playOnce` called with two arguments.

- [ ] **Step 3: Implement**

`graph.ts` interface: `playOnce(audio: Float32Array, sampleRate: number, pan?: -1 | 1): OneShot;` Implementation:

```ts
    playOnce(audio, sampleRate, pan) {
      if (audio.length === 0) return { ended: Promise.resolve(), stop: () => {} };
      const { ctx, feeds } = current;
      const buffer = ctx.createBuffer(1, audio.length, sampleRate);
      buffer.getChannelData(0).set(audio);
      let resolve!: () => void;
      const ended = new Promise<void>((r) => { resolve = r; });
      // One ear (the face-to-face preview): a panner of its own, gone with the clip.
      let into: AudioNode = feeds.preview;
      let panner: StereoPannerNode | undefined;
      if (pan !== undefined) {
        panner = ctx.createStereoPanner();
        panner.pan.value = pan;
        panner.connect(feeds.preview);
        into = panner;
      }
      const stop = start(ctx, buffer, into, ctx.currentTime, () => {
        panner?.disconnect();
        resolve();
      });
      return { ended, stop };
    },
```

`playback.ts`:

```ts
export interface PreviewClip {
  audio: Float32Array;
  sampleRate: number;
  /** One ear only (face-to-face's per-ear preview). */
  pan?: -1 | 1;
}
```

and in `preview`: `shot = graph.playOnce(clip.audio, clip.sampleRate, clip.pan);`

`appAudio.ts`:

```ts
  testTone(signal?: AbortSignal, pan?: -1 | 1): Promise<void>;
```

```ts
    async testTone(signal, pan) {
      // Not on `context`: a rebuild (#246) may have closed it before the first
      // decode, and browsers have differed on decoding on a closed context. An
      // offline context of the same rate decodes to the same samples and is
      // never closed.
      tone ??= loadTestTone(new OfflineAudioContext(1, 1, SAMPLE_RATE)).catch((error: unknown) => {
        tone = null;
        throw error;
      });
      const clip = await tone;
      if (signal?.aborted) return;
      await playback.preview(pan === undefined ? clip : { ...clip, pan });
    },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/audio`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/audio/graph.ts src/lib/audio/graph.test.ts src/lib/audio/playback.ts src/lib/audio/playback.test.ts src/lib/audio/appAudio.ts
git commit -m "feat(face-to-face): preview the test tone in one ear

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task B9: The Both popover: the other side, headphones and the ears

**Files:**
- Create: `src/components/MainPanel/useFaceToFace.ts`
- Modify: `src/components/MainPanel/ModeDevicePopover.tsx` (imports ~1-26, `ChannelRowSpec.onMuteToggle` ~49, rows ~125-206, render ~243-305)
- Modify: `src/components/MainPanel/ModeDevicePopover.scss`
- Test: `src/components/MainPanel/useFaceToFace.test.ts` (create), `src/components/MainPanel/ModeDevicePopover.test.tsx`

**Interfaces:**
- Consumes: B1 (`useOtherSide`, `useSetOtherSide`, `faceToFaceSwap`), B8 (`testTone(signal, pan)`).
- Produces: `useFaceToFace(): { offered: boolean; active: boolean; swap: boolean; me: string | null; other: string | null }` — `offered`: the selected provider declares `faceToFace`; `active`: offered, mode both, other side beside; `me`/`other`: the selected entry's pair (source, target) or null. Used by B10–B12.

- [ ] **Step 1: Write the failing tests**

`src/components/MainPanel/useFaceToFace.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import useAudioStore from '../../stores/audioStore';
import { useProviderStore } from '../../stores/providerStore';
import { useRoutingStore } from '../../stores/routingStore';
import { useFaceToFace } from './useFaceToFace';

describe('useFaceToFace', () => {
  const pick = (selected: string) => useProviderStore.setState({
    selected,
    entries: { [selected]: { settings: {}, credentials: {}, pair: { source: 'ja', target: 'en' } } },
  });
  beforeEach(() => {
    useAudioStore.setState({ mode: 'both', otherSide: 'beside' });
    useRoutingStore.setState({ faceToFaceSwap: false });
  });

  it('is offered and active under Soniox in Both, beside me, with my language and theirs', () => {
    pick('soniox');
    const { result } = renderHook(() => useFaceToFace());
    expect(result.current).toEqual({ offered: true, active: true, swap: false, me: 'ja', other: 'en' });
  });

  it('is neither under a provider without it (Review Focus 1)', () => {
    pick('openai');
    const { result } = renderHook(() => useFaceToFace());
    expect(result.current).toMatchObject({ offered: false, active: false });
  });
});
```

`src/components/MainPanel/ModeDevicePopover.test.tsx` — extend the `audioStore` mock with:

```ts
  useOtherSide: () => store.otherSide,
  useSetOtherSide: () => store.setOtherSide,
```

(add `otherSide: 'meeting' as 'meeting' | 'beside', setOtherSide: vi.fn(),` to `store`, reset in `beforeEach`), mock the hook and the audio:

```ts
const f2f = { offered: true, active: false, swap: false, me: 'ja', other: 'en' };
vi.mock('./useFaceToFace', () => ({ useFaceToFace: () => f2f }));
const routing = { setFaceToFaceSwap: vi.fn() };
vi.mock('../../stores/routingStore', () => ({ useRoutingStore: (pick: (s: unknown) => unknown) => pick({ faceToFaceSwap: f2f.swap, setFaceToFaceSwap: routing.setFaceToFaceSwap }) }));
const tone = vi.fn(async () => {});
vi.mock('../../lib/audio/appAudio', () => ({ getAppAudio: async () => ({ testTone: tone }) }));
vi.mock('../../lib/language/useLanguageLabel', () => ({ useLanguageLabel: () => (code: string) => code.toUpperCase() }));
```

and append:

```ts
describe('ModeDevicePopover — Both, the other side', () => {
  const mountBoth = () => {
    const anchor = document.createElement('div');
    document.body.appendChild(anchor);
    return render(<ModeDevicePopover mode="both" open={true} anchorEl={anchor} onClose={vi.fn()} />);
  };

  it('offers "In a meeting" and "Beside me" and stores the choice', () => {
    mountBoth();
    fireEvent.click(screen.getByRole('radio', { name: /Beside me/ }));
    expect(store.setOtherSide).toHaveBeenCalledWith('beside');
  });

  it('hides the choice under a provider without face-to-face', () => {
    f2f.offered = false;
    mountBoth();
    expect(screen.queryByRole('radio', { name: /Beside me/ })).toBeNull();
    f2f.offered = true;
  });

  it('beside me: no system-audio row, a headphones row, the two ears with previews and the swap', async () => {
    f2f.active = true;
    store.otherSide = 'beside';
    mountBoth();
    expect(screen.queryByText("Other's audio")).toBeNull();
    expect(screen.getByText('Headphones')).toBeInTheDocument();
    expect(screen.getByText('Left ear')).toBeInTheDocument();
    expect(screen.getByText('Right ear')).toBeInTheDocument();
    // The left ear's preview plays the tone panned left.
    fireEvent.click(screen.getAllByRole('button', { name: /Preview the/ })[0]);
    await vi.waitFor(() => expect(tone).toHaveBeenCalledWith(undefined, -1));
    fireEvent.click(screen.getByRole('button', { name: /Swap left and right/ }));
    expect(routing.setFaceToFaceSwap).toHaveBeenCalledWith(true);
    f2f.active = false;
    store.otherSide = 'meeting';
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/MainPanel/useFaceToFace.test.ts src/components/MainPanel/ModeDevicePopover.test.tsx`
Expected: FAIL — no hook; no radios, headphones row or ears.

- [ ] **Step 3: Implement**

`src/components/MainPanel/useFaceToFace.ts`:

```ts
import { presentProviders } from '../../providers/registry';
import useAudioStore from '../../stores/audioStore';
import { useProviderStore } from '../../stores/providerStore';
import { useRoutingStore } from '../../stores/routingStore';

export interface FaceToFaceView {
  /** The selected provider can run face-to-face: the Both popover offers "beside me". */
  offered: boolean;
  /** Face-to-face is on: Both, beside me, under a provider that offers it (`faceToFaceFromStores`'s rule, live). */
  active: boolean;
  /** My translation goes right, theirs left. */
  swap: boolean;
  /** My language and theirs: the selected entry's pair. */
  me: string | null;
  other: string | null;
}

/** `faceToFaceFromStores`'s rule as a hook: the same provider fallback and the same loaded-entry requirement as `selectedFromStores`. */
export function useFaceToFace(): FaceToFaceView {
  const selected = useProviderStore((s) => s.selected);
  const entries = useProviderStore((s) => s.entries);
  const mode = useAudioStore((s) => s.mode);
  const otherSide = useAudioStore((s) => s.otherSide);
  const swap = useRoutingStore((s) => s.faceToFaceSwap);
  const providers = presentProviders();
  const provider = providers.find((p) => p.id === selected) ?? providers[0];
  const pair = provider ? entries[provider.id]?.pair ?? null : null;
  const offered = provider?.faceToFace === true && pair !== null;
  return {
    offered,
    active: offered && mode === 'both' && otherSide === 'beside',
    swap,
    me: pair?.source ?? null,
    other: pair?.target ?? null,
  };
}
```

`ModeDevicePopover.tsx`:
- imports: `Headphones, ArrowLeftRight, Play` from `lucide-react`; `useOtherSide, useSetOtherSide` from the audio store; `useRoutingStore` from `'../../stores/routingStore'`; `useFaceToFace` from `'./useFaceToFace'`; `getAppAudio` from `'../../lib/audio/appAudio'`; `earsFor` from `'../../lib/audio/routes'`; `useLanguageLabel` from `'../../lib/language/useLanguageLabel'`.
- `ChannelRowSpec.onMuteToggle?: () => void;` (doc: "Absent: the row has no power switch — face-to-face's headphones play whenever a translation is spoken."), and render the mute button only when `row.onMuteToggle` is set (`{row.onMuteToggle && (<button …>)}`).
- In the component body:

```ts
  const f2f = useFaceToFace();
  const otherSide = useOtherSide();
  const setOtherSide = useSetOtherSide();
  const setSwap = useRoutingStore((s) => s.setFaceToFaceSwap);
  const label = useLanguageLabel();
  const beside = mode === 'both' && f2f.active;
```

- In `rows`, show the monitor row as headphones in face-to-face and hide the participant row there:

```ts
    const showMonitor = mode === 'speaker' || beside;
    const showParticipant = mode === 'participant' || (mode === 'both' && !beside);
```

```ts
    if (showMonitor) {
      list.push(beside
        ? {
          key: 'monitor',
          icon: Headphones,
          label: t('popover.headphones', 'Headphones'),
          devices: filteredMonitorDevices,
          selectedDevice: selectedMonitorDevice,
          isMuted: false,
          onSelectDevice: (d) => selectMonitorDevice(d),
          isMissing: false,
        }
        : {
          key: 'monitor',
          icon: Volume2,
          label: t('modePicker.deviceSpeakerMonitor', 'Speaker monitor'),
          devices: filteredMonitorDevices,
          selectedDevice: selectedMonitorDevice,
          isMuted: isMonitorMuted,
          onMuteToggle: () => setMonitorMuted(!isMonitorMuted),
          onSelectDevice: (d) => { selectMonitorDevice(d); setMonitorMuted(false); },
          isMissing: false, // monitor is optional
        });
    }
```

(add `beside` to the `useMemo` dependency list.)
- In the render, between the rows and the divider:

```tsx
        {mode === 'both' && f2f.offered && (
          <div className="mode-device-popover__other-side" role="radiogroup" aria-label={t('popover.otherSide', 'Other side')}>
            {(['meeting', 'beside'] as const).map((side) => (
              <label key={side} className={`mode-device-popover__side${otherSide === side ? ' mode-device-popover__side--active' : ''}`}>
                <input type="radio" name="other-side" checked={otherSide === side} onChange={() => setOtherSide(side)} />
                <span className="mode-device-popover__side-title">
                  {side === 'meeting' ? t('popover.otherSideMeeting', 'In a meeting') : t('popover.otherSideBeside', 'Beside me')}
                </span>
                <span className="mode-device-popover__side-hint">
                  {side === 'meeting' ? t('popover.otherSideMeetingHint', 'Captures the system audio or an app') : t('popover.otherSideBesideHint', 'Two people at one microphone')}
                </span>
              </label>
            ))}
          </div>
        )}

        {beside && f2f.me && f2f.other && (
          <div className="mode-device-popover__ears">
            <div className="mode-device-popover__ears-title">{t('faceToFace.earsTitle', 'Left and right · each person hears the translation into their own language')}</div>
            {(['left', 'right'] as const).map((ear) => {
              const ears = earsFor(f2f.swap);
              const mine = ears.participant === ear;
              const pan = ear === 'left' ? -1 : 1;
              const earName = ear === 'left' ? t('faceToFace.leftEar', 'Left ear') : t('faceToFace.rightEar', 'Right ear');
              return (
                <div key={ear} className={`mode-device-popover__ear mode-device-popover__ear--${mine ? 'me' : 'other'}`}>
                  <span className="mode-device-popover__ear-letter">{ear === 'left' ? t('faceToFace.earLeft', 'L') : t('faceToFace.earRight', 'R')}</span>
                  <span className="mode-device-popover__ear-name">{earName}</span>
                  <span className="mode-device-popover__ear-who">
                    {mine
                      ? t('faceToFace.meListens', 'Me ({{language}})', { language: label(f2f.me!) })
                      : t('faceToFace.otherListens', 'Other person ({{language}})', { language: label(f2f.other!) })}
                  </span>
                  <button
                    type="button"
                    className="mode-device-popover__ear-preview"
                    aria-label={t('faceToFace.previewEar', 'Preview the {{ear}}', { ear: earName.toLowerCase() })}
                    onClick={() => { void getAppAudio().then((app) => app.testTone(undefined, pan)); }}
                  >
                    <Play size={12} />
                  </button>
                </div>
              );
            })}
            <div className="mode-device-popover__ears-actions">
              <button type="button" className="mode-device-popover__swap" onClick={() => setSwap(!f2f.swap)}>
                <ArrowLeftRight size={14} />
                {t('faceToFace.swap', 'Swap left and right')}
              </button>
              <span className="mode-device-popover__ears-hint">{t('faceToFace.speakersHint', 'One earbud each works best. On speakers, the microphone picks up the translation and translates it again.')}</span>
            </div>
          </div>
        )}
```

`ModeDevicePopover.scss` — styles following the popover's existing palette (board 1): `&__other-side` a two-column grid with a 1px `#444` frame and 7px radius; `&__side--active` `background: tk.$color-primary-fill; color: tk.$color-on-primary`; `&__ears` `border-top: 1px solid #3a3a3a; background: #242424; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px`; `&__ear` a row with a 1px `#3a3a3a` frame, 8px radius, the letter in a circle bordered by `tk.$color-speaker` for `--me` and `tk.$color-participant` for `--other`; `&__ears-hint` `color: #f59e0b; font-size: 11px`. (The file already `@use`s the tokens as `tk`; if it does not, add `@use '../../styles/tokens' as tk;`.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/MainPanel`
Expected: PASS (the existing participant-row tests mount `mode="participant"`, unaffected).

- [ ] **Step 5: Commit**

```bash
git add src/components/MainPanel/useFaceToFace.ts src/components/MainPanel/useFaceToFace.test.ts src/components/MainPanel/ModeDevicePopover.tsx src/components/MainPanel/ModeDevicePopover.scss src/components/MainPanel/ModeDevicePopover.test.tsx
git commit -m "feat(face-to-face): the Both popover offers \"beside me\" and the two ears

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task B10: The mode picker's tag and the footer's ears legend

**Files:**
- Modify: `src/components/MainPanel/ModePicker.tsx` (props ~8-13, the segment button ~83-100), `ModePicker.scss`
- Modify: `src/components/MainPanel/panel/PanelFooter.tsx` (`PanelFooterProps` ~12-35, both `<ModePicker … />` ~89-94 and ~160-165)
- Modify: `src/components/MainPanel/MainPanel.tsx` (`<PanelFooter … />` ~280-290)
- Test: `src/components/MainPanel/ModePicker.test.tsx`, `src/components/MainPanel/panel/PanelFooter.test.tsx`

**Interfaces:**
- Consumes: B9's `useFaceToFace()`.
- Produces: `ModePickerProps.faceToFace?: boolean` (a tag on Both); `PanelFooterProps.ears?: { leftLang: string; rightLang: string; leftIsMe: boolean } | null`.

- [ ] **Step 1: Write the failing tests**

`ModePicker.test.tsx`:

```ts
  it('tags Both as face-to-face when it runs so', () => {
    render(<ModePicker mode="both" locked={false} missingDeviceForMode={null} onSegmentClick={() => {}} faceToFace />);
    expect(screen.getByRole('button', { name: /Both|双向/ }).querySelector('.mode-picker__tag')?.textContent).toMatch(/Face-to-face|modePicker\.faceToFaceTag/);
  });
```

`PanelFooter.test.tsx`:

```ts
describe('PanelFooter — the ears legend', () => {
  it.each(SITES)('%s: names each ear and its listener in face-to-face, and nothing otherwise', (site) => {
    const { container, rerender } = render(<PanelFooter {...baseProps(site, { mode: 'both', ears: { leftLang: 'ja', rightLang: 'en', leftIsMe: true } })} />);
    const legend = container.querySelector('.ears-legend');
    expect(legend?.textContent).toContain('faceToFace.legendMe');
    expect(legend?.textContent).toContain('faceToFace.legendOther');
    rerender(<PanelFooter {...baseProps(site, { mode: 'both', ears: null })} />);
    expect(container.querySelector('.ears-legend')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/MainPanel/ModePicker.test.tsx src/components/MainPanel/panel/PanelFooter.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

`ModePicker.tsx` — props:

```ts
  /** Both runs face-to-face: the segment carries a tag. */
  faceToFace?: boolean;
```

destructure `faceToFace` and, inside the button after the label span:

```tsx
            {seg === 'both' && faceToFace && <span className="mode-picker__tag">{t('modePicker.faceToFaceTag', 'Face-to-face')}</span>}
```

`ModePicker.scss`: `.mode-picker__tag { margin-left: 4px; padding: 1px 5px; border-radius: 4px; background: rgba(255, 255, 255, 0.18); font-size: 10px; }`.

`PanelFooter.tsx` — the prop:

```ts
  /** Face-to-face's ears (slice 3): which language plays in each, and whether the left is mine. Absent or null: not face-to-face. */
  ears?: { leftLang: string; rightLang: string; leftIsMe: boolean } | null;
```

destructure `ears`; pass `faceToFace={!!ears}` to both `<ModePicker>`s; and after each `<ModePicker … />` render:

```tsx
        {ears && (
          <span className="ears-legend">
            <span className={`ears-legend__ear ears-legend__ear--${ears.leftIsMe ? 'me' : 'other'}`}>
              <b>{t('faceToFace.earLeft', 'L')}</b>
              {ears.leftIsMe
                ? t('faceToFace.legendMe', '{{language}} · me', { language: label(ears.leftLang) })
                : t('faceToFace.legendOther', '{{language}} · other person', { language: label(ears.leftLang) })}
            </span>
            <span className={`ears-legend__ear ears-legend__ear--${ears.leftIsMe ? 'other' : 'me'}`}>
              <b>{t('faceToFace.earRight', 'R')}</b>
              {ears.leftIsMe
                ? t('faceToFace.legendOther', '{{language}} · other person', { language: label(ears.rightLang) })
                : t('faceToFace.legendMe', '{{language}} · me', { language: label(ears.rightLang) })}
            </span>
          </span>
        )}
```

Styles in the footer's stylesheet (`MainPanel.scss`, beside `.control-footer`): `.ears-legend { display: inline-flex; gap: 10px; font-size: 12px; color: #9aa0a6; }`, `.ears-legend__ear b { display: inline-flex; width: 16px; height: 16px; border-radius: 50%; border: 1.5px solid; align-items: center; justify-content: center; font-size: 9px; margin-right: 4px; }`, `--me b { border-color: tk.$color-speaker; color: tk.$color-speaker }`, `--other b { border-color: tk.$color-participant; color: tk.$color-participant }`.

`MainPanel.tsx` — compute and pass:

```ts
  const f2f = useFaceToFace();
  const ears = f2f.active && f2f.me && f2f.other
    ? { leftLang: f2f.swap ? f2f.other : f2f.me, rightLang: f2f.swap ? f2f.me : f2f.other, leftIsMe: !f2f.swap }
    : null;
```

and `ears={ears}` on `<PanelFooter>`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/MainPanel`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/MainPanel/ModePicker.tsx src/components/MainPanel/ModePicker.scss src/components/MainPanel/ModePicker.test.tsx src/components/MainPanel/panel/PanelFooter.tsx src/components/MainPanel/panel/PanelFooter.test.tsx src/components/MainPanel/MainPanel.tsx src/components/MainPanel/MainPanel.scss
git commit -m "feat(face-to-face): tag Both and show the ears in the footer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task B11: Ear tags and the "not played" mark on the conversation's translations

**Files:**
- Modify: `src/components/Conversation/ConversationList.tsx` (`ConversationListProps` ~14-35, the `RowBubble` call ~78-90, `RowBubbleProps` and `RowBubble` ~117-215)
- Modify: `src/components/MainPanel/ConversationRow.scss`
- Modify: `src/components/MainPanel/MainPanel.tsx` (`<ConversationList … />` ~315-328)
- Test: `src/components/Conversation/ConversationList.test.tsx`

**Interfaces:**
- Consumes: B7's `earsFor`, B9's `useFaceToFace()`.
- Produces: `ConversationListProps.ears?: Record<'speaker' | 'participant', Ear> | null`. On the row that ends a translation segment: an ear tag (`.ear-tag.ear-tag--left|right`, coloured by the listener: a speaker-leg translation is heard by the other person, a participant-leg one by me); when the translation's language is the leg's source (primary subtag compared), an icon-only `.ear-tag--muted` whose `title` says why (D14).

- [ ] **Step 1: Write the failing tests**

```ts
describe('ConversationList — face-to-face ears', () => {
  const ears = { speaker: 'right', participant: 'left' } as const;

  it("tags a spoken translation with the ear it played in, coloured by who heard it", () => {
    const { container } = render(<ConversationList {...props({ ears })} />);
    const tag = container.querySelector('.ear-tag');
    expect(tag?.classList.contains('ear-tag--right')).toBe(true);
    expect(tag?.classList.contains('listener-participant')).toBe(true);
  });

  it("marks a translation into the leg's own language as not played, the reason on hover (Review Focus 4)", () => {
    const own = rowItem({ row: row({ language: 'en' }) }); // the speaker leg's source is 'en'
    const { container } = render(<ConversationList {...props({ ears, items: [own] })} />);
    const tag = container.querySelector('.ear-tag--muted');
    expect(tag).not.toBeNull();
    expect(tag?.textContent).toBe('');
    expect(tag?.getAttribute('title')).toMatch(/Not played/);
  });

  it('draws no ear tag outside face-to-face, and none on a source row', () => {
    const { container, rerender } = render(<ConversationList {...props()} />);
    expect(container.querySelector('.ear-tag')).toBeNull();
    rerender(<ConversationList {...props({ ears, items: [rowItem({ row: row({ side: 'source' }) })] })} />);
    expect(container.querySelector('.ear-tag')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/Conversation/ConversationList.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

`ConversationListProps`:

```ts
  /** Face-to-face (slice 3): the ear each leg's translation plays in. Absent or null: no ear tags. */
  ears?: Readonly<Record<LegName, Ear>> | null;
```

(`import type { Ear } from '../../lib/audio/routes';`). In the list, compute per row and pass to `RowBubble`:

```ts
              const ear = ears && !compact && item.row.side === 'translation' && item.endsSegment
                ? earTagOf(item, ears)
                : null;
```

```tsx
                  ear={ear}
```

Module-level helper:

```ts
/** The primary subtag: `zh-Hans` and Soniox's `zh` are one language here. */
const base = (code: string) => code.split('-')[0].toLowerCase();

/** A translation's ear, or 'muted' when it is in its leg's own source language — a code-switched line nobody hears read. */
function earTagOf(item: RowItem, ears: Readonly<Record<LegName, Ear>>): Ear | 'muted' {
  const language = item.row.language || item.languages.target;
  return base(language) === base(item.languages.source) ? 'muted' : ears[item.leg];
}
```

`RowBubbleProps`: `ear: Ear | 'muted' | null;`. In `RowBubble`, before the replay slot:

```tsx
        {ear === 'muted' && (
          <span
            className="ear-tag ear-tag--muted"
            role="img"
            aria-label={t('faceToFace.notPlayed', "Not played: this translation is in {{language}}, the speaker's own language, so it is read to no one.", { language: lang.toUpperCase() })}
            title={t('faceToFace.notPlayed', "Not played: this translation is in {{language}}, the speaker's own language, so it is read to no one.", { language: lang.toUpperCase() })}
          >
            <VolumeX size={10} aria-hidden="true" />
          </span>
        )}
        {(ear === 'left' || ear === 'right') && (
          <span
            className={`ear-tag ear-tag--${ear} listener-${leg === 'speaker' ? 'participant' : 'speaker'}`}
            title={ear === 'left' ? t('faceToFace.playedLeft', 'Played in the left ear') : t('faceToFace.playedRight', 'Played in the right ear')}
          >
            {ear === 'left' ? t('faceToFace.earLeft', 'L') : t('faceToFace.earRight', 'R')}
          </span>
        )}
```

(`VolumeX` from `lucide-react`; `ear` added to `RowBubble`'s destructured props — its `memo` compares props shallowly, and `ear` is a string, so rows do not re-render needlessly.)

`ConversationRow.scss`, beside `.row-play-btn`:

```scss
.ear-tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  margin-left: 4px;
  border-radius: 9px;
  font-size: 10px;
  font-weight: 700;

  &.listener-speaker {
    border: 1.5px solid tk.$color-speaker;
    color: tk.$color-speaker;
  }
  &.listener-participant {
    border: 1.5px solid tk.$color-participant;
    color: tk.$color-participant;
  }
  &--muted {
    border: 1px dashed #777;
    color: #b0b5ba;
    background: #262626;
  }
}
```

`MainPanel.tsx` — on `<ConversationList>`:

```tsx
            ears={f2f.active ? earsFor(f2f.swap) : null}
```

(`f2f` is B10's `useFaceToFace()` value; `earsFor` from `'../../lib/audio/routes'`.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/Conversation src/components/MainPanel`
Expected: PASS (`ConversationList.memo.test.tsx` included).

- [ ] **Step 5: Commit**

```bash
git add src/components/Conversation/ConversationList.tsx src/components/Conversation/ConversationList.test.tsx src/components/MainPanel/ConversationRow.scss src/components/MainPanel/MainPanel.tsx
git commit -m "feat(face-to-face): ear tags and the not-played mark on translations

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task B12: Soniox settings: the participant's voice, and the shared session locked in face-to-face

**Files:**
- Modify: `src/lib/provider/types.ts` (`SettingsProps` ~146-166)
- Modify: `src/components/providers/ProviderOwnSettings.tsx` (~15-38)
- Modify: `src/providers/soniox/SonioxSettings.tsx` (the view's parameters ~30-34, after `<SonioxVoiceField … />` ~63, the shared-session section ~104-128)
- Test: `src/providers/soniox/SonioxSettings.test.tsx`

**Interfaces:**
- Consumes: B4's `participantVoice`, B9's `useFaceToFace()`.
- Produces: `SettingsProps.participantSpeaks?: boolean` and `SettingsProps.faceToFace?: boolean`, set by `ProviderOwnSettings` (`participantSpeaks` from the provider store's speech inputs, `faceToFace` from `useFaceToFace().active`).

- [ ] **Step 1: Write the failing tests**

Append to `SonioxSettings.test.tsx` (its `props()` helper builds the view's props; `BYOK` is the own-key view):

```ts
  it("shows the other party's voice only when the participant speaks, built-in voices only", () => {
    const update = vi.fn();
    const { rerender } = render(<BYOK {...props({ update })} />);
    expect(screen.queryByLabelText("Other party's voice")).toBeNull();
    rerender(<BYOK {...props({ update, participantSpeaks: true })} />);
    const select = screen.getByLabelText("Other party's voice") as HTMLSelectElement;
    expect(select.value).toBe('Grace');
    expect([...select.options].map((o) => o.value)).toContain('Kenji');
    fireEvent.change(select, { target: { value: 'Kenji' } });
    expect(update).toHaveBeenCalledWith({ participantVoice: 'Kenji' });
  });

  it('locks the shared-session pills in face-to-face and says why', () => {
    render(<BYOK {...props({ faceToFace: true, legs: ['speaker', 'participant'] })} />);
    expect(screen.getByRole('button', { name: 'Enabled' })).toBeDisabled();
    expect(screen.getByText(/Face-to-face always uses one shared session/)).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/providers/soniox/SonioxSettings.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

`SettingsProps`, after `legs`:

```ts
  /** The participant leg would speak (face-to-face, or its switch). Set by `ProviderOwnSettings` for `Settings`: Soniox shows the participant's voice. */
  participantSpeaks?: boolean;
  /** A start would run face-to-face. Set by `ProviderOwnSettings` for `Settings`: Soniox locks its shared-session choice. */
  faceToFace?: boolean;
```

`ProviderOwnSettings.tsx`:

```ts
  const participantSpeaks = useProviderStore((s) => s.speech.participantSpeech);
  const faceToFace = useFaceToFace().active;
```

```tsx
  return <Settings {...ownProps(selection, selection.entry, disabled)} account={account} legs={legs} participantSpeaks={participantSpeaks} faceToFace={faceToFace} preview={appVoicePreview} />;
```

(`useFaceToFace` from `'../MainPanel/useFaceToFace'`.)

`SonioxSettings.tsx` — destructure `participantSpeaks, faceToFace`; after `<SonioxVoiceField … />`:

```tsx
        {participantSpeaks && (
          <div className="settings-section" id="soniox-participant-voice-section">
            <h2>
              {t('settings.sonioxParticipantVoice', "Other party's voice")}
              <Tooltip content={t('settings.sonioxParticipantVoiceTooltip', "The voice that reads the other person's words to you, in your language. Built-in voices only.")} position="top">{helpIcon}</Tooltip>
            </h2>
            <div className="setting-item">
              <select
                id="soniox-participant-voice-select"
                className="select-dropdown"
                aria-label={t('settings.sonioxParticipantVoice', "Other party's voice")}
                value={settings.participantVoice}
                disabled={disabled}
                onChange={(e) => update({ participantVoice: e.target.value })}
              >
                {SONIOX_VOICES.map((v) => <option key={v.value} value={v.value}>{v.name}</option>)}
              </select>
            </div>
          </div>
        )}
```

(`SONIOX_VOICES` from `'../../lib/soniox/ttsCatalog'`.) In the shared-session section, both pills' `disabled={disabled || !inBoth || faceToFace}`, and after the `turn-detection-options` div:

```tsx
          {faceToFace && (
            <div className="setting-item">
              <div className="setting-description">
                {t('settings.sonioxSharedSessionFaceToFace', 'Face-to-face always uses one shared session: both people speak into the same microphone.')}
              </div>
            </div>
          )}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/providers/soniox src/components/providers`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/provider/types.ts src/components/providers/ProviderOwnSettings.tsx src/providers/soniox/SonioxSettings.tsx src/providers/soniox/SonioxSettings.test.tsx
git commit -m "feat(soniox): choose the other party's voice; face-to-face locks the shared session

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task B13: The setup wizard's face-to-face scenarios

**Files:**
- Modify: `src/lib/setup/types.ts` (`ScenarioId` ~16-21)
- Modify: `src/lib/setup/scenarios.ts` (header ~1-12, `ScenarioPreset` ~17-21, `SCENARIOS` ~23-29, `ProviderFit` ~46-48, `providerFitForScenario` ~58-69)
- Modify: `src/components/SetupWizard/providerPaths.ts` (`providerFits` ~47-50, `ownKeyOptions` ~53-58, `managedOption` ~61-66; add `offlineFit`)
- Modify: `src/components/SetupWizard/applySetup.ts` (`ApplySetupDeps` ~15-29, `applySetupDraft` ~38-41) and its caller that builds the deps (`grep -rn "applySetupDraft(" src --include=*.tsx`)
- Modify: `src/components/SetupWizard/steps/StepScenario.tsx` (`TITLES`/`DESCS` ~11-24, the sets line ~54-56)
- Modify: `src/components/SetupWizard/steps/StepProviderPath.tsx` (`reasonOf` ~40-42, `unfit` ~59)
- Test: `src/lib/setup/scenarios.test.ts`, `src/components/SetupWizard/applySetup.test.ts`, `src/components/SetupWizard/providerPaths.test.ts`

**Interfaces:**
- Produces: `ScenarioId` gains `'face-to-face-voice' | 'face-to-face-text'`; `ScenarioPreset.otherSide?: 'beside'`; `ProviderFit` reason `'cannot-face-to-face'`; `providerFitForScenario(textOnlyCapability, scenario, faceToFace = false)`; `ApplySetupDeps.setOtherSide(side: 'meeting' | 'beside'): void` — every scenario writes it (`'beside'` for face-to-face, `'meeting'` otherwise); `offlineFit(scenario): ProviderFit`.

- [ ] **Step 1: Write the failing tests**

`src/lib/setup/scenarios.test.ts`:

```ts
describe('face-to-face scenarios', () => {
  it('are Both beside me, with and without voice', () => {
    expect(getScenario('face-to-face-voice')).toEqual({ id: 'face-to-face-voice', mode: 'both', textOnly: false, otherSide: 'beside' });
    expect(getScenario('face-to-face-text')).toEqual({ id: 'face-to-face-text', mode: 'both', textOnly: true, otherSide: 'beside' });
  });

  it('fit only a provider that offers face-to-face', () => {
    expect(providerFitForScenario('optional', getScenario('face-to-face-voice'), false)).toEqual({ ok: false, reason: 'cannot-face-to-face' });
    expect(providerFitForScenario('optional', getScenario('face-to-face-voice'), true)).toEqual({ ok: true });
    expect(providerFitForScenario('optional', getScenario('two-way-voice'), false)).toEqual({ ok: true });
  });
});
```

`src/components/SetupWizard/applySetup.test.ts` — in the `deps()` fixture add `setOtherSide: vi.fn(),` after `setMode: vi.fn(),`, and append to its describe:

```ts
  it('writes the other side: beside me for face-to-face, a meeting for every other scenario', async () => {
    const d = deps();
    await applySetupDraft(draft({ scenario: 'face-to-face-voice' }), d);
    expect(d.setMode).toHaveBeenCalledWith('both');
    expect(d.setOtherSide).toHaveBeenCalledWith('beside');
    const again = deps();
    await applySetupDraft(draft({ scenario: 'two-way-voice' }), again);
    expect(again.setOtherSide).toHaveBeenCalledWith('meeting');
  });
```

`src/components/SetupWizard/providerPaths.test.ts`:

```ts
  it('greys the offline path for face-to-face: the in-app engine cannot attribute two people', () => {
    expect(offlineFit('face-to-face-voice')).toEqual({ ok: false, reason: 'cannot-face-to-face' });
    expect(offlineFit('two-way-voice')).toEqual({ ok: true });
  });

  it('fits Soniox to face-to-face and greys an own-key provider without it', () => {
    const options = ownKeyOptions('face-to-face-voice');
    expect(options.find((o) => o.id === Provider.SONIOX)?.fit).toEqual({ ok: true });
    expect(options.find((o) => o.id === Provider.OPENAI)?.fit).toEqual({ ok: false, reason: 'cannot-face-to-face' });
  });
```

(import `Provider` from `'../../types/Provider'` and `offlineFit` from `'./providerPaths'` if the file does not already.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/setup src/components/SetupWizard`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/lib/setup/types.ts`:

```ts
export type ScenarioId =
  | 'understand-others'
  | 'be-heard'
  | 'subtitle-myself'
  | 'two-way-voice'
  | 'two-way-text'
  | 'face-to-face-voice'
  | 'face-to-face-text';
```

`src/lib/setup/scenarios.ts` — header: replace "The five first-run scenarios" with "The seven first-run scenarios", and replace the paragraph "The participant leg never speaks … so `participant` has no voice variant." with:

```ts
// The participant leg speaks only face-to-face (slice 3), where the
// other person's translation is what I hear; so `participant` alone has no
// voice variant.
```

```ts
export interface ScenarioPreset {
  id: ScenarioId;
  mode: ScenarioMode;
  textOnly: boolean;
  /** Both with the other side beside me (face-to-face). Absent: a meeting. */
  otherSide?: 'beside';
}

export const SCENARIOS: readonly ScenarioPreset[] = [
  { id: 'understand-others', mode: 'participant', textOnly: true },
  { id: 'be-heard', mode: 'speaker', textOnly: false },
  { id: 'subtitle-myself', mode: 'speaker', textOnly: true },
  { id: 'two-way-voice', mode: 'both', textOnly: false },
  { id: 'two-way-text', mode: 'both', textOnly: true },
  { id: 'face-to-face-voice', mode: 'both', textOnly: false, otherSide: 'beside' },
  { id: 'face-to-face-text', mode: 'both', textOnly: true, otherSide: 'beside' },
];
```

```ts
export type ProviderFit =
  | { ok: true }
  | { ok: false; reason: 'cannot-speak' | 'cannot-be-text-only' | 'cannot-face-to-face' };
```

```ts
export function providerFitForScenario(
  textOnlyCapability: 'always' | 'optional' | 'never',
  scenario: ScenarioPreset,
  faceToFace = false,
): ProviderFit {
  if (scenario.otherSide === 'beside' && !faceToFace) {
    return { ok: false, reason: 'cannot-face-to-face' };
  }
  …the two existing checks…
}
```

(and extend its docstring: "…and, for a face-to-face scenario, on its `faceToFace` capability.")

`providerPaths.ts` — pass the capability everywhere a fit is judged:

```ts
export function providerFits(provider: ProviderType, scenario: ScenarioId): boolean {
  const p = wizardProvider(provider);
  return p !== undefined && providerFitForScenario(textOnlyCapabilityOf(p), getScenario(scenario), p.faceToFace === true).ok;
}
```

and `p.faceToFace === true` as the third argument in `ownKeyOptions` and `managedOption`. Add:

```ts
/** The offline path's fit: its engine (`offlineOptions`) offers no face-to-face. */
export function offlineFit(scenario: ScenarioId): ProviderFit {
  const p = wizardProvider(offlineOptions()[0]);
  return p ? providerFitForScenario(textOnlyCapabilityOf(p), getScenario(scenario), p.faceToFace === true) : { ok: true };
}
```

`applySetup.ts`:

```ts
  setMode: (m: 'speaker' | 'participant' | 'both') => void;
  /** Both's other side: every scenario says, so a re-run never leaves a stale "beside me". */
  setOtherSide: (side: 'meeting' | 'beside') => void;
```

```ts
  deps.setMode(preset.mode);
  deps.setOtherSide(preset.otherSide ?? 'meeting');
  deps.setTextOnly(preset.textOnly);
```

and in `src/components/SetupWizard/useApplySetup.ts`, beside `setMode: useAudioStore.getState().setMode,`:

```ts
      setOtherSide: useAudioStore.getState().setOtherSide,
```

(`useApplySetup.test.ts` stubs the stores; if it asserts the exact deps object, add `setOtherSide` there too.)

`StepScenario.tsx`:

```ts
  'face-to-face-voice': 'Face-to-face conversation',
  'face-to-face-text': 'Face-to-face conversation, subtitles only',
```

```ts
  'face-to-face-voice': 'Two people at one computer, each speaking their own language; each wears one earbud and hears only the translation into their language.',
  'face-to-face-text': 'Both read the same screen, or the other person opens the LAN caption page on their phone.',
```

and the sets line:

```tsx
            <span className="setup-card__sets">
              {s.otherSide === 'beside'
                ? t('setup.scenarios.setsBeside', 'Sets: {{mode}} mode, other side beside me · {{output}}', { mode: modeLabel(s.mode), output: outputLabel(s.textOnly) })
                : t('setup.scenarios.sets', 'Sets: {{mode}} mode · {{output}}', { mode: modeLabel(s.mode), output: outputLabel(s.textOnly) })}
            </span>
```

`StepProviderPath.tsx`:

```ts
  const reasonOf = (reason: 'cannot-speak' | 'cannot-be-text-only' | 'cannot-face-to-face') => reason === 'cannot-speak'
    ? t('setup.fit.cannotSpeak', 'This provider cannot produce spoken translation.')
    : reason === 'cannot-face-to-face'
      ? t('setup.fit.cannotFaceToFace', 'This provider cannot translate two people at one microphone.')
      : t('setup.fit.cannotBeTextOnly', 'This provider always speaks; it cannot run subtitles-only.');
```

```ts
  const offline = offlineFit(scenario);
```

```ts
          const unfit = path === 'managed' && !managedFit.ok ? managedFit : path === 'offline' && !offline.ok ? offline : null;
```

(import `offlineFit`.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/setup src/components/SetupWizard`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/setup src/components/SetupWizard
git commit -m "feat(setup): face-to-face scenarios, offered only by providers that run it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task B14: The words, in all 30 catalogs

**Files:**
- Modify: `src/locales/en/translation.json`, then `src/locales/*/translation.json` (29 more)

**Interfaces:**
- Consumes: every key B9–B13 ask for.

- [ ] **Step 1: Add the English keys**

Add to `src/locales/en/translation.json` (nested where each prefix already lives; create the `faceToFace` object at the top level):

```json
"modePicker": { "faceToFaceTag": "Face-to-face" },
"popover": {
  "otherSide": "Other side",
  "otherSideMeeting": "In a meeting",
  "otherSideMeetingHint": "Captures the system audio or an app",
  "otherSideBeside": "Beside me",
  "otherSideBesideHint": "Two people at one microphone",
  "headphones": "Headphones"
},
"faceToFace": {
  "earsTitle": "Left and right · each person hears the translation into their own language",
  "leftEar": "Left ear",
  "rightEar": "Right ear",
  "earLeft": "L",
  "earRight": "R",
  "meListens": "Me ({{language}})",
  "otherListens": "Other person ({{language}})",
  "previewEar": "Preview the {{ear}}",
  "swap": "Swap left and right",
  "speakersHint": "One earbud each works best. On speakers, the microphone picks up the translation and translates it again.",
  "playedLeft": "Played in the left ear",
  "playedRight": "Played in the right ear",
  "notPlayed": "Not played: this translation is in {{language}}, the speaker's own language, so it is read to no one.",
  "legendMe": "{{language}} · me",
  "legendOther": "{{language}} · other person"
},
"settings": {
  "sonioxParticipantVoice": "Other party's voice",
  "sonioxParticipantVoiceTooltip": "The voice that reads the other person's words to you, in your language. Built-in voices only.",
  "sonioxSharedSessionFaceToFace": "Face-to-face always uses one shared session: both people speak into the same microphone."
},
"setup": {
  "scenarios": {
    "face-to-face-voice": {
      "title": "Face-to-face conversation",
      "desc": "Two people at one computer, each speaking their own language; each wears one earbud and hears only the translation into their language."
    },
    "face-to-face-text": {
      "title": "Face-to-face conversation, subtitles only",
      "desc": "Both read the same screen, or the other person opens the LAN caption page on their phone."
    },
    "setsBeside": "Sets: {{mode}} mode, other side beside me · {{output}}"
  },
  "fit": { "cannotFaceToFace": "This provider cannot translate two people at one microphone." }
}
```

(These are additions inside the existing objects, not replacements: keep every key already there.)

Run: `node scripts/sync-locale-keys.mjs`
Expected: it reports the new keys filled into the 29 other catalogs with the English placeholder.

- [ ] **Step 2: Translate the other 29 catalogs**

For each catalog, replace the English placeholders of the keys above with natural translations. Rules: keep every `{{placeholder}}` exactly; keep "LAN"; `earLeft`/`earRight` are the one-letter abbreviations of left/right that locale uses on audio gear (keep `L`/`R` where that is the convention, as in Japanese and Chinese); "Face-to-face" follows the canvas board 4 for `zh_CN` ("面对面对话", "面对面对话，只要字幕", tag "面对面") and the matching natural term elsewhere; the `setup.scenarios.face-to-face-*` titles must equal the docs site's `dashboard.wallet.pricing.scenario.face-to-face-*.title` in the same language (Task A5); `zh_TW` uses Traditional Chinese with Taiwan wording; follow the tone of the same catalog's `modePicker.*` and `setup.scenarios.*` strings.

- [ ] **Step 3: Verify**

Run: `npx vitest run src/locales`
Expected: PASS (same keys, same placeholders, no empty strings).

Run: `node -e "for (const id of ['ja','ko','de','zh_TW']) { const v=require('./src/locales/'+id+'/translation.json'); console.log(id, v.faceToFace.swap, '|', v.setup.scenarios['face-to-face-voice'].title) }"`
Expected: four lines of translated text, none equal to the English.

- [ ] **Step 4: Commit**

```bash
git add src/locales
git commit -m "i18n(face-to-face): the popover, ears, wizard and settings strings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task B15: Managed participant speech on

**Prerequisite:** Part A is merged on `kizuna-ai-lab/sokuji-backend` and deployed (Task A6 Step 3 passed).

**Files:**
- Modify: `src/providers/soniox/kizuna.ts` (`KIZUNA_PARTICIPANT_SPEECH` ~21 and its comment ~13-20)
- Modify: `src/providers/soniox/leaseRequest.ts` (`PARTICIPANT_SPEECH_FIELD`'s doc ~18-24)
- Test: `src/providers/soniox/kizuna.test.ts` (~33, ~60-66), `src/providers/soniox/kizunaBudget.test.ts` (~64-76), `src/providers/soniox/leaseRequest.test.ts`

**Interfaces:**
- Consumes: the backend's `participantSpeech` body field and `par_tts` role (Task A1), its floor arithmetic (unchanged per-kind rates, so `par_tts` prices at the TTS rate).
- Produces: Kizuna Soniox's `participantSpeech: true`; every managed session-key body carries `participantSpeech` (false unless the participant speaks).

- [ ] **Step 1: Write the failing tests**

`kizuna.test.ts` — in `"is Kizuna AI's Soniox: …"` change `participantSpeech: false,` to `participantSpeech: true,`; replace the last two lines of `"adds the voice claim, the lease and the floor"`:

```ts
    // The flag is on: a voiced participant adds par_tts to split Both's floor.
    expect(session.minimumBalance!({ legs: ['speaker', 'participant'], textOnly: false, participantSpeech: true }, { ...SONIOX_DEFAULTS, bothModeSharedSession: false })).toBe(83_334);
    expect(KIZUNA_PARTICIPANT_SPEECH).toBe(true);
```

`kizunaBudget.test.ts` — rename the third test and its comment to state parity with the backend:

```ts
  it("prices the participant's speech stream as the backend does (par_tts at the TTS rate)", () => {
    // sokuji-backend `sonioxStartFloorMicroUsd` sums per-kind conservative rates:
    // par_tts is a `tts` role, so these are its floors (Part A, Task A1).
```

(keep the five expectations: 41_667, 65_000, 83_334, 60_000, 60_000.)

`leaseRequest.test.ts` — append:

```ts
  it('sends the field the backend reads, by that name', () => {
    expect(PARTICIPANT_SPEECH_FIELD).toBe('participantSpeech');
    expect(requestBody({ mode: 'both', textOnly: false, bothSplit: false, region: 'us', participantSpeaks: true })).toEqual({
      mode: 'both', textOnly: false, bothSplit: false, region: 'us', participantSpeech: true,
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/providers/soniox/kizuna.test.ts src/providers/soniox/kizunaBudget.test.ts src/providers/soniox/leaseRequest.test.ts`
Expected: FAIL — the flag is false.

- [ ] **Step 3: Implement**

`kizuna.ts`:

```ts
/**
 * Managed participant speech (ruling 2): on since sokuji-backend mints
 * `par_tts` (spec 2026-10-08, slice 3). The participant's speech key in
 * every mode, priced at the TTS rate; face-to-face is what voices it, the
 * participant-speech switch staying hidden.
 */
export const KIZUNA_PARTICIPANT_SPEECH = true;
```

`leaseRequest.ts` — `PARTICIPANT_SPEECH_FIELD`'s doc:

```ts
/**
 * The body field asking for the participant's speech stream: sokuji-backend
 * reads it by this name (`normalizeSessionShape`, slice 3).
 */
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/providers src/lib/session src/components/TitleBar`
Expected: PASS. Only `kizuna.test.ts` imports the flag; `lease.test.ts` and `kizunaParticipantSpeech.test.tsx` pass the flag explicitly or build their own flag-on twin, so they are unaffected.

- [ ] **Step 5: Commit**

```bash
git add src/providers/soniox
git commit -m "feat(kizuna): turn managed participant speech on

sokuji-backend now mints par_tts for a voiced participant, so the
managed twin voices face-to-face's other person like own-key Soniox.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task B16: Verify, the PR (owner's word), and the owner's live checks

**Files:** none.

- [ ] **Step 1: Whole suite and types**

Run: `npx vitest run && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "src/(stores|lib|providers|components|app)/" | grep -vE "environment.ts|splitSentences.ts"`
Expected: every test passes; the grep prints nothing from a file this plan touched.

- [ ] **Step 2: Ask before the PR**

Say: "Ready to push `feat/soniox-face-to-face` and open a PR on `kizuna-ai-lab/sokuji` into `main`. Part A is deployed. May I push and open it?" Wait for the word.

- [ ] **Step 3: The owner's live checks (owner-run; each bills the owner's own Soniox account or Kizuna balance — name the count before running)**

1. Own-key Soniox, Both, "Beside me", voice on, earphones: two people alternate Japanese and English for two minutes. Each hears only the other's words, in their own language, in their own ear; rows sit on the right side; ear tags L/R match what was heard.
2. Same, one person says a sentence in the other's language: its translation is not read; the row shows the muted mark and its tooltip.
3. Swap left and right during the run: both ears flip at once; the footer legend and the tags follow.
4. Text Only on: nothing is spoken; the Logs' `session.opened` lists no speaking leg.
5. Switch the provider to OpenAI in Both with "Beside me" stored: the popover hides the choice and the run captures system audio as before.
6. Kizuna AI, Both, "Beside me", voice on: the Logs' `session.lease_acquired` lists `mix_stt, mix_tts, par_tts`; the Start floor and the account dot count the extra stream; the admin sessions page shows three streams.
7. Kizuna AI, split Both with the participant voiced is not reachable from the UI (the switch is hidden) — nothing to check.
8. The web build (`npm run dev` in a browser): face-to-face starts without a participant-source refusal.
9. The setup wizard: the two face-to-face cards look like the others; picking one greys the offline path and every own-key provider but Soniox with the reason.
10. The docs site after Part A's deploy: the calculator opens split, offers the two face-to-face scenarios, and the rate card shows the face-to-face row.
