# Soniox Slice 1 — Split Default and Both-Language Hints — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Both mode defaults to split sessions, and every one-way Soniox leg hints both of the pair's languages.

**Architecture:** One settings default (`SONIOX_DEFAULTS`) and one config frame (`SonioxSession.sttConfig()` in the Soniox adapter). The hint list is computed once for one-way and shared sessions alike; nothing outside `src/providers/soniox/` changes. Managed Soniox inherits both through the same adapter and settings.

**Tech Stack:** TypeScript, Vitest, the Soniox real-time STT WebSocket config frame.

**Spec:** `docs/superpowers/specs/2026-10-08-soniox-speaker-labels-face-to-face-design.md` — "Slice 1", decisions D1 and D2.

## Global Constraints

- English for code, comments, commit messages; conventional commits; each commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- TDD: the failing test first, watch it fail, then the code.
- No one-time migration code: a stored `bothModeSharedSession` boolean is kept, anything else falls to the default.
- Comment density matches the surrounding code.
- Hints: `[source, target]`, source first; an `AUTO` source sends none; one entry when both map to the same wire code (spec D2).
- Push and PR (kizuna-ai-lab/sokuji) only on the owner's word at the time, naming the repository and branch.

## Review Focus

1. A user who once chose shared keeps shared after the default flips (stored `true` survives `migrateSonioxSettings`) — test added to Task 2, Step 1.
2. An `AUTO` source sends no `language_hints` at all, not `[target]` — existing test kept green in Task 2.
3. A pair whose two languages map to one wire code sends a single hint, not a duplicate — test added to Task 2, Step 1.
4. Filipino goes out as `tl` in both positions of the hint list — existing test's expectation updated in Task 2, Step 1.
5. The shared two_way frame is unchanged (both hints, diarization) — existing `adapter.both.test.ts` shared test kept green in Task 2.

---

### Task 1: Both defaults to split — DONE

Committed as `e10f025c1` (`feat(soniox): default Both mode to split sessions`) on branch `worktree-soniox-both-split-default`:

- [x] `src/providers/soniox/settings.ts:47`: `bothModeSharedSession: false`.
- [x] `src/providers/soniox/settings.test.ts`: the defaults test says "split Both" and expects `false`; a wrong-typed stored value falls to `false`.
- [x] `src/providers/soniox/lease.test.ts`: the four shared-Both cases pass `settings: { bothModeSharedSession: true }` instead of leaning on the default.
- [x] Full suite green at the time (642 files, 7796 tests).

---

### Task 2: One-way legs hint both languages

**Files:**
- Modify: `src/providers/soniox/adapter.ts:256-275` (`sttConfig()`)
- Test: `src/providers/soniox/adapter.test.ts:107-127`, `:629-638`
- Test: `src/providers/soniox/adapter.both.test.ts:86-87`
- Test: `src/providers/soniox/settings.test.ts:38-57`

**Interfaces:**
- Consumes: `sonioxWire.toWire(code: string): string` (`src/providers/soniox/languages.ts:74`), `AUTO` (already imported in `adapter.ts`).
- Produces: no new export. The STT config frame's `language_hints` for a one-way leg becomes `[source, target]` (wire codes, deduplicated), absent for an `AUTO` source.

- [ ] **Step 1: Write the failing tests**

In `src/providers/soniox/adapter.test.ts`, replace the test at lines 107-122:

```ts
  it("sends the leg's direction: one_way to the target, both languages as hints (the source first), the context and the knobs; no diarization, no client reference", async () => {
    const { stt } = await live({ settings: { vocabularyTerms: 'Sokuji', endpointMaxDelayMs: 3000 } });
    const config = stt().sentJson<Json>()[0];
    expect(config).toMatchObject({
      api_key: 'test-key',
      model: 'stt-rt-v5',
      audio_format: 'pcm_s16le',
      sample_rate: 24000,
      translation: { type: 'one_way', target_language: 'ja' },
      language_hints: ['en', 'ja'],
      context: { terms: ['Sokuji'] },
      max_endpoint_delay_ms: 3000,
    });
    expect(config).not.toHaveProperty('enable_speaker_diarization');
    expect(config).not.toHaveProperty('client_reference_id');
  });
```

Directly after the existing `'sends no hint for an auto source'` test (ends at line 127), add:

```ts
  it('sends one hint when both languages go out as the same wire code', async () => {
    const { stt } = await live({ context: { ...AUTO_CTX, direction: { source: 'en', target: 'en' } } });
    expect(stt().sentJson<Json>()[0]).toMatchObject({ language_hints: ['en'] });
  });
```

At line 632, change the expectation to both wire codes:

```ts
    expect(stt().sentJson<Json>()[0]).toMatchObject({ translation: { type: 'one_way', target_language: 'tl' }, language_hints: ['en', 'tl'] });
```

In `src/providers/soniox/adapter.both.test.ts`, lines 86-87 become:

```ts
    expect(spk).toMatchObject({ api_key: 'k-spk', translation: { type: 'one_way', target_language: 'ja' }, language_hints: ['en', 'ja'] });
    expect(par).toMatchObject({ api_key: 'k-par', translation: { type: 'one_way', target_language: 'en' }, language_hints: ['ja', 'en'] });
```

In `src/providers/soniox/settings.test.ts`, inside `describe('migrateSonioxSettings', …)`, add after the existing test:

```ts
  it('keeps a stored shared choice: only an unset or wrong-typed value takes the split default', () => {
    expect(migrateSonioxSettings({ ...SONIOX_DEFAULTS, bothModeSharedSession: true }).bothModeSharedSession).toBe(true);
    expect(migrateSonioxSettings({}).bothModeSharedSession).toBe(false);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/providers/soniox/adapter.test.ts src/providers/soniox/adapter.both.test.ts src/providers/soniox/settings.test.ts`
Expected: FAIL — the one-way frame still carries `language_hints: ['en']` (and `['ja']`, `['en']` for Filipino); the new settings test passes already (it pins existing behaviour, Review Focus 1).

- [ ] **Step 3: Write the implementation**

In `src/providers/soniox/adapter.ts`, `sttConfig()` (lines 256-275), replace the body's hint and diarization lines:

```ts
  /** The STT config frame: a pure function of the request, so a resume sends it byte for byte again. */
  private sttConfig(): SonioxSttConfig {
    const { context, config, credentials } = this.o.primary;
    const { source, target } = context.direction;
    // Both languages bias recognition, the source first; an auto source hints nothing, since the target alone would pull an unknown speaker toward the other side.
    const hints = source === AUTO ? [] : [...new Set([sonioxWire.toWire(source), sonioxWire.toWire(target)])];
    return {
      apiKey: credentials.stt,
      region: credentials.region,
      model: config.stt.model,
      sampleRate: SAMPLE_RATE,
      translation: this.o.shared ? { type: 'two_way', language_a: sonioxWire.toWire(source), language_b: sonioxWire.toWire(target) } : { type: 'one_way', target_language: sonioxWire.toWire(target) },
      // D20 keeps an auto source out of Both: the gate refuses the participant leg.
      ...(hints.length ? { languageHints: hints } : {}),
      ...(this.o.shared ? { enableSpeakerDiarization: true } : {}),
      ...(config.stt.context ? { context: config.stt.context } : {}),
      endpointSensitivity: config.stt.endpointSensitivity,
      endpointLatencyAdjustmentLevel: config.stt.endpointLatencyAdjustmentLevel,
      endpointMaxDelayMs: config.stt.endpointMaxDelayMs,
      ...(credentials.clientReferenceId ? { clientReferenceId: credentials.clientReferenceId } : {}),
    };
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/providers/soniox/adapter.test.ts src/providers/soniox/adapter.both.test.ts src/providers/soniox/settings.test.ts`
Expected: PASS, including the unchanged `'sends no hint for an auto source'` and the shared `'both hints, diarization'` test (Review Focus 2 and 5).

- [ ] **Step 5: Run the Soniox and session suites**

Run: `npx vitest run src/providers src/lib/session`
Expected: PASS. A failure here names another test that pinned `language_hints: [source]`; update its expectation to `[source, target]` the same way, never the implementation.

- [ ] **Step 6: Commit**

```bash
git add src/providers/soniox/adapter.ts src/providers/soniox/adapter.test.ts src/providers/soniox/adapter.both.test.ts src/providers/soniox/settings.test.ts
git commit -F - <<'EOF'
feat(soniox): hint both of the pair's languages on one-way legs

A one-way leg sends language_hints [source, target], the source first,
deduplicated after the wire mapping; an auto source still sends none.
The shared two_way frame is unchanged.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: Verify the slice and hand it over

**Files:** none changed.

- [ ] **Step 1: Run the whole suite**

Run: `npx vitest run`
Expected: every file passes (the baseline was 642 files, 7796 tests, plus Task 2's two new tests).

- [ ] **Step 2: Type-check the touched files**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "src/providers/soniox/(adapter|settings)" || echo "no errors in touched files"`
Expected: `no errors in touched files` (the project-wide `tsc` run has pre-existing errors in unrelated files; none may come from this slice).

- [ ] **Step 3: Ask the owner before pushing**

Report the two commits (`e10f025c1` and Task 2's) and ask: push branch `worktree-soniox-both-split-default` to kizuna-ai-lab/sokuji and open a PR into `main`? Nothing leaves the machine without that answer. The sokuji-backend cost-calculator wording (`dashboard.wallet.pricing.calcSplitHint`) is not touched here; slice 3's backend PR carries it.
