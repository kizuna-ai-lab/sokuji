# Native Wire `type:'result'` Collision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the two `type: 'result'` messages colliding in the Local Native wire contract, rename the translate reply to match the codebase's `<request>_result` convention, and pin both sides against silent drift with a cross-boundary consistency test.

**Architecture:** The renderer's `ServerMsg` union (`src/lib/local-inference/native/nativeProtocol.ts`) is the TypeScript model of what the Python sidecar sends over the localhost WebSocket. Two distinct interfaces currently both declare `type: 'result'` — `ResultMsg` (TTS one-shot generate reply) and `AsrResultMsg` (ASR push). A discriminated union with a duplicate discriminant does not discriminate: `Extract<ServerMsg, { type: 'result' }>` resolves to `ResultMsg | AsrResultMsg`, so both clients cast their way out and the TTS client produces two real `tsc` errors. We rename the TTS reply to `tts_generate_result` and the translate reply from `translation` to `translate_result`, then add a test that parses both the TS union and the Python source and diffs the two type-name sets.

**Tech Stack:** TypeScript, Vitest 4 (jsdom), Python 3 + pytest, WebSocket JSON-RPC.

## Global Constraints

These bind every task. Read them before writing any code.

1. **The two Local providers are peers — never unify them.** `src/lib/local-inference/workers/*.worker.ts` (translation.worker.ts, voxtral-webgpu.worker.ts) and `src/lib/local-inference/engine/TranslationEngine.test.ts` belong to the **LOCAL_INFERENCE (WASM)** provider. They have their own, entirely separate worker protocol that *also* uses `type: 'result'`. **They are out of scope. Do not touch them.** A global find-and-replace on `type: 'result'` would corrupt the WASM lane.
2. **`'translation'` and `'result'` are overloaded words in this repo.** `getManifestByType('translation')` (`src/stores/modelStore.ts`) is a **ModelType**; `LineKind = 'source' | 'translation'` (`src/components/Subtitle/SubtitleStream.tsx`) is a **UI enum**; `conversationFilter.ts` uses `mode === 'translation'`. None of these are the wire. **Only files under `src/lib/local-inference/native/` and `sidecar/sokuji_sidecar/` are in scope on the TS/Python sides respectively.**
3. **ASR keeps `type: 'result'`.** `asr_engine.py:165,346,387` and every `"result"` in `sidecar/tests/test_asr_engine.py` (18 occurrences) stay exactly as they are. `AsrResultMsg` keeps `type: 'result'`. `src/lib/local-inference/native/NativeAsrClient.test.ts:46` stays unchanged and is a **regression net** — it must remain green.
4. **`pocket_engine.py` keeps `type: 'result'`.** `pocket_engine.py:59` and `sidecar/tests/test_pocket_engine.py:43` are an unreachable orphan (tracked separately as review candidate C8). Out of scope — do not rename, do not delete.
5. **`tsc` is NOT a gate.** This repo builds with Vite/esbuild; the correctness gate is Vitest. The branch base has **162** `tsc --noEmit` errors, all pre-existing. The only `tsc` claim this plan makes is that the **2** errors at `NativeTtsClient.ts(152)` disappear, taking the count to **160**. **Do not fix unrelated pre-existing `tsc` errors.** If you observe a count other than the one a task predicts, print the errors and report it — do not "fix" your way to the number.
6. **Exact new wire names**, used verbatim on both sides: TTS one-shot reply = `tts_generate_result` (interface `TtsGenerateResultMsg`). Translate reply = `translate_result` (interface `TranslateResultMsg`).
7. **Comments and code in English.** Conventional-commit messages.
8. **Do not run `npm install`.** This worktree's `node_modules` is already installed.
   Running `npm install` here (Linux) silently deletes the `win-core-audio` optional
   dependency entry from `package-lock.json` — a Windows-only dep. If you see
   `package-lock.json` show up as modified, you ran it; revert with
   `git checkout package-lock.json`. `package-lock.json` must not appear in any commit
   on this branch.

### Commands

```bash
# Sidecar tests (from the repo root). The worktree has no venv of its own;
# this is the main checkout's interpreter, which works because pytest imports
# the sidecar package from the CWD.
cd sidecar && /home/jiangzhuo/Desktop/kizunaai/sokuji-react/sidecar/.venv/bin/python -m pytest tests/ -q

# TypeScript tests (from the repo root). `npm test` is watch-mode — do not use it.
npx vitest run
npx vitest run src/lib/local-inference/native/   # native lane only

# tsc error count (diagnostic only, never a gate)
npx tsc --noEmit 2>&1 | grep -c 'error TS'
```

### Baseline at the branch point

| Suite | Baseline |
|---|---|
| sidecar pytest | **769 passed, 15 skipped, 0 failed** |
| TS vitest (full) | **1233 passed, 0 failed** |
| `tsc --noEmit` errors | **162** |

---

### Task 1: Rename the TTS one-shot reply `result` → `tts_generate_result`

The collision fix. A new consistency test asserts every `ServerMsg` member has a
**unique** discriminant — it fails on today's duplicate, and the rename makes it pass.

**Files:**
- Create: `src/lib/local-inference/native/nativeProtocol.consistency.test.ts`
- Modify: `src/lib/local-inference/native/nativeProtocol.ts:47` (interface), `:62` (union)
- Modify: `src/lib/local-inference/native/NativeTtsClient.ts:150`
- Modify: `src/lib/local-inference/native/NativeAsrClient.ts:22-27` (stale comment + cast cleanup)
- Modify: `src/lib/local-inference/native/NativeTtsClient.test.ts:24`
- Modify: `src/lib/local-inference/native/SidecarConnection.test.ts:214-215`
- Modify: `sidecar/sokuji_sidecar/tts_engine.py:217`
- Modify: `sidecar/tests/test_tts_engine.py:168`

**Interfaces:**
- Produces: `function extractServerMsgDiscriminants(): [string, string][]`, module-local
  to `nativeProtocol.consistency.test.ts` — returns `[interfaceName, discriminant]` for
  every `ServerMsg` union member, in union order. Task 2 reuses it **from inside the same
  file**; nothing imports it, so it must not be exported.
- Produces: wire name `tts_generate_result`; TS interface `TtsGenerateResultMsg`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/local-inference/native/nativeProtocol.consistency.test.ts`:

```ts
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

const PROTOCOL_FILE = join(__dirname, 'nativeProtocol.ts');

/** Anti-vacuity floor. Every assertion below is a subset/uniqueness check, and
 *  those pass trivially on an empty set — so a parse that silently yields almost
 *  nothing must throw rather than report "all good". The union has 18 members today. */
const MIN_SERVER_MSG_MEMBERS = 15;

/** `[interfaceName, discriminant]` for every member of the ServerMsg union.
 *  Throws — loudly — if the union, a member's declaration, or a member's
 *  discriminant can't be found, rather than returning a partial set. */
function extractServerMsgDiscriminants(): [string, string][] {
  const source = readFileSync(PROTOCOL_FILE, 'utf-8');

  const union = source.match(/export type ServerMsg = ([^;]+);/);
  if (!union) throw new Error('ServerMsg union declaration not found in nativeProtocol.ts');
  const members = union[1].split('|').map(s => s.trim()).filter(Boolean);
  if (members.length < MIN_SERVER_MSG_MEMBERS) {
    throw new Error(`ServerMsg union parsed to only ${members.length} members ` +
      `(expected >= ${MIN_SERVER_MSG_MEMBERS}) — the extractor is probably broken`);
  }

  return members.map((name): [string, string] => {
    const start = source.indexOf(`export interface ${name} {`);
    if (start === -1) throw new Error(`ServerMsg member ${name}: no "export interface ${name} {" found`);
    // Declarations are consecutive top-level exports, so the next `\nexport `
    // bounds this one's body.
    const next = source.indexOf('\nexport ', start + 1);
    const body = next === -1 ? source.slice(start) : source.slice(start, next);
    const discriminant = body.match(/\btype: '([a-z_]+)'/);
    if (!discriminant) throw new Error(`ServerMsg member ${name} has no "type: '...'" discriminant`);
    return [name, discriminant[1]];
  });
}

describe('nativeProtocol ServerMsg discriminants', () => {
  it('every member has a unique type discriminant', () => {
    // A discriminated union with a duplicate discriminant does not discriminate:
    // `Extract<ServerMsg, { type: X }>` widens back to a union and every consumer
    // is forced to cast its way out.
    const byDiscriminant = new Map<string, string[]>();
    for (const [name, type] of extractServerMsgDiscriminants()) {
      byDiscriminant.set(type, [...(byDiscriminant.get(type) ?? []), name]);
    }
    const collisions = [...byDiscriminant.entries()].filter(([, names]) => names.length > 1);
    expect(collisions).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/local-inference/native/nativeProtocol.consistency.test.ts`

Expected: **FAIL**, with the collision named. This exact output was verified against
the branch base before this plan was written:
```
AssertionError: expected [ [ 'result', [ 'ResultMsg', …(1) ] ] ] to deeply equal []

- Expected
+ Received

- []
+ [
+   [
+     "result",
+     [
+       "ResultMsg",
+       "AsrResultMsg",
+     ],
+   ],
+ ]
```
If it passes, stop and report — the extractor is not seeing the real file. The
extractor was verified to parse **18** union members here; if it throws the
`MIN_SERVER_MSG_MEMBERS` error instead, the union regex is not matching and the file
was mistyped.

- [ ] **Step 3: Rename the interface and the union member**

In `src/lib/local-inference/native/nativeProtocol.ts`, replace line 47:

```ts
export interface ResultMsg { type: 'result'; id: number; sampleRate: number; generationTimeMs: number; samples: number; }
```

with:

```ts
export interface TtsGenerateResultMsg { type: 'tts_generate_result'; id: number; sampleRate: number; generationTimeMs: number; samples: number; }
```

and on line 62, change the union member `ResultMsg` to `TtsGenerateResultMsg`. The
full line becomes:

```ts
export type ServerMsg = ReadyMsg | OkMsg | TtsGenerateResultMsg | TranslationMsg | SpeechStartMsg | AsrPartialMsg | AsrResultMsg | ModelStatusResultMsg | ModelDeleteResultMsg | ModelProgressMsg | ModelDownloadDoneMsg | ErrorMsg | HardwareInfoResultMsg | ModelsCatalogResultMsg | ListVariantsResultMsg | TtsChunkMsg | TtsDoneMsg | ListTtsVoicesResultMsg;
```

- [ ] **Step 4: Run the consistency test to verify it passes**

Run: `npx vitest run src/lib/local-inference/native/nativeProtocol.consistency.test.ts`
Expected: **PASS** (1 test).

- [ ] **Step 5: Point the TTS client at the new name**

In `src/lib/local-inference/native/NativeTtsClient.ts`, replace line 150:

```ts
    const r = msg as Extract<ServerMsg, { type: 'result' }>;
```

with:

```ts
    const r = msg as Extract<ServerMsg, { type: 'tts_generate_result' }>;
```

- [ ] **Step 6: Drop the ASR client's now-unnecessary cast**

`Extract<ServerMsg, { type: 'result' }>` now resolves to exactly `AsrResultMsg`, so
plain discriminant narrowing gives all four fields their real types — the
intersection and the `as string` / `as number` escapes are dead weight. The comment
above it explains a collision that no longer exists; the surviving fact is that ASR
results are pushes, not replies.

In `src/lib/local-inference/native/NativeAsrClient.ts`, replace lines 22-27:

```ts
    // ASR results are pushed without an id; TTS results carry an id and are matched
    // as request replies on the (separate) TTS connection — they never reach here.
    if (msg.type === 'result') {
      const r = msg as Extract<ServerMsg, { type: 'result' }> & { text?: string; startSample?: number; durationMs?: number; recognitionTimeMs?: number };
      this.onResult?.({ text: r.text as string, startSample: r.startSample, durationMs: r.durationMs as number, recognitionTimeMs: r.recognitionTimeMs as number });
      return;
    }
```

with:

```ts
    // ASR results are pushed without an id — they are not replies to a request.
    if (msg.type === 'result') {
      this.onResult?.({ text: msg.text, startSample: msg.startSample, durationMs: msg.durationMs, recognitionTimeMs: msg.recognitionTimeMs });
      return;
    }
```

- [ ] **Step 7: Update the two TS tests that speak the old name**

In `src/lib/local-inference/native/NativeTtsClient.test.ts`, line 24:

```ts
    conn.emit({ type: 'result', id: genSent.id, sampleRate: 24000, generationTimeMs: 7, samples: 3 });
```

becomes:

```ts
    conn.emit({ type: 'tts_generate_result', id: genSent.id, sampleRate: 24000, generationTimeMs: 7, samples: 3 });
```

In `src/lib/local-inference/native/SidecarConnection.test.ts`, lines 214-215:

```ts
    ws.reply({ type: 'result', id: 4242, sampleRate: 24000, generationTimeMs: 5, samples: 0 });
    await expect(p).resolves.toMatchObject({ type: 'result' });
```

become:

```ts
    ws.reply({ type: 'tts_generate_result', id: 4242, sampleRate: 24000, generationTimeMs: 5, samples: 0 });
    await expect(p).resolves.toMatchObject({ type: 'tts_generate_result' });
```

Do **not** touch `NativeAsrClient.test.ts:46` — its `type: 'result'` is the ASR push
(Global Constraint 3) and its staying green proves the rename didn't move ASR.

- [ ] **Step 8: Rename the sidecar's emit**

In `sidecar/sokuji_sidecar/tts_engine.py`, replace line 217:

```python
    reply = {"type": "result", "id": mid, "sampleRate": eng.sample_rate,
```

with:

```python
    reply = {"type": "tts_generate_result", "id": mid, "sampleRate": eng.sample_rate,
```

- [ ] **Step 9: Update the sidecar test**

In `sidecar/tests/test_tts_engine.py`, replace line 168:

```python
    assert reply["type"] == "result" and reply["id"] == "g2"
```

with:

```python
    assert reply["type"] == "tts_generate_result" and reply["id"] == "g2"
```

- [ ] **Step 10: Run both suites**

```bash
npx vitest run src/lib/local-inference/native/
cd sidecar && /home/jiangzhuo/Desktop/kizunaai/sokuji-react/sidecar/.venv/bin/python -m pytest tests/test_tts_engine.py tests/test_asr_engine.py -q
```

Expected: native TS lane all pass; sidecar `test_tts_engine.py` + `test_asr_engine.py` all pass.

- [ ] **Step 11: Confirm the two collision `tsc` errors are gone**

Run: `npx tsc --noEmit 2>&1 | grep -c 'error TS'`
Expected: **160** (was 162; the two `NativeTtsClient.ts(152)` TS2339 errors are gone).

Confirm no error remains in a file this branch touches:
```bash
npx tsc --noEmit 2>&1 | grep -E 'NativeTtsClient|NativeTranslateClient|NativeAsrClient|nativeProtocol'
```
Expected: no output.

Do **not** grep for `local-inference/native` — that lane has **7** pre-existing errors
(in `nativeCatalog.test.ts` and `nativeVoiceStorage.ts`, both untouched by this branch)
which are not yours to fix. Per Global Constraint 5, leave the other 160 alone.

- [ ] **Step 12: Commit**

```bash
git add src/lib/local-inference/native/ sidecar/sokuji_sidecar/tts_engine.py sidecar/tests/test_tts_engine.py
git commit -m "refactor(native): rename TTS one-shot reply result -> tts_generate_result

Two ServerMsg members both declared type:'result' — the TTS generate reply and
the ASR push — so Extract<ServerMsg, {type:'result'}> widened back to a union and
both clients cast their way out, producing two real tsc errors in NativeTtsClient.
Renaming the TTS reply makes the union discriminate again: the ASR client drops
its cast entirely and reads narrowed fields directly.

A new consistency test parses the union out of nativeProtocol.ts and fails on any
duplicate discriminant, so the collision cannot come back."
```

---

### Task 2: Pin the TS union against the sidecar's wire

Task 1's test proves the union is internally consistent. It says nothing about
whether the union matches what the sidecar actually sends — a rename applied to one
side only would sail through. These two nets close that, and must exist **before**
Task 3 renames another message.

**Files:**
- Modify: `src/lib/local-inference/native/nativeProtocol.consistency.test.ts`

**Interfaces:**
- Consumes: `extractServerMsgDiscriminants()` from Task 1.
- Produces: nothing later tasks import; Task 3 relies on these tests being live.

- [ ] **Step 1: Add the sidecar scanner and the two subset tests**

In `src/lib/local-inference/native/nativeProtocol.consistency.test.ts`, change the
import line at the top from:

```ts
import { readFileSync } from 'fs';
```

to:

```ts
import { readFileSync, readdirSync } from 'fs';
```

Then, directly below the `const PROTOCOL_FILE = ...` line, add:

```ts
// native/ -> local-inference/ -> lib/ -> src/ -> repo root
const SIDECAR_DIR = join(__dirname, '..', '..', '..', '..', 'sidecar', 'sokuji_sidecar');

/** Anti-vacuity floor for the sidecar scan (35 .py files today). */
const MIN_SIDECAR_PY_FILES = 5;

/** Types the sidecar sends that ServerMsg deliberately does not model.
 *  `pong` is the reply to a `ping` health check (server.py). No renderer code
 *  sends `ping` — the affordance is exercised only by the sidecar's own tests
 *  (test_server_envelope.py) — so the renderer's inbox has no reason to carry
 *  it. This asymmetry is by design, not drift. */
const SIDECAR_ONLY = new Set(['pong']);
```

Then, below `extractServerMsgDiscriminants()`, add:

```ts
function pyFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    // moss_tts/ and qwen3_tts/ are subpackages; a non-recursive scan would miss
    // anything they send and turn this net into a false alarm.
    if (entry.isDirectory()) out.push(...pyFilesUnder(full));
    else if (entry.name.endsWith('.py')) out.push(full);
  }
  return out;
}

/** Every `type` name the sidecar constructs in an outbound message. */
function extractSidecarTypeLiterals(): Set<string> {
  const files = pyFilesUnder(SIDECAR_DIR);
  if (files.length < MIN_SIDECAR_PY_FILES) {
    throw new Error(`only ${files.length} .py files found under ${SIDECAR_DIR} ` +
      `(expected >= ${MIN_SIDECAR_PY_FILES}) — the scan is probably pointed at the wrong place`);
  }
  const types = new Set<string>();
  for (const file of files) {
    // Dict-literal construction only. A comparison (`msg["type"] == "x"`) has no
    // colon after "type" and is skipped — that is what keeps this an *outbound* set.
    for (const m of readFileSync(file, 'utf-8').matchAll(/"type":\s*"([a-z_]+)"/g)) types.add(m[1]);
  }
  return types;
}
```

Finally, append a second `describe` block at the end of the file:

```ts
// The renderer's ServerMsg union is a hand-written model of what a separate
// codebase, in another language, sends over the socket. Nothing but this test
// connects the two: rename one side and the other keeps compiling.
describe('nativeProtocol ServerMsg stays consistent with the sidecar wire', () => {
  it('every ServerMsg type is one the sidecar actually sends', () => {
    const sidecar = extractSidecarTypeLiterals();
    const orphans = extractServerMsgDiscriminants()
      .filter(([, type]) => !sidecar.has(type))
      .map(([name, type]) => `${name} ('${type}')`);
    expect(orphans).toEqual([]);
  });

  it('every type the sidecar sends is modelled by ServerMsg, except the ping health-check', () => {
    const modelled = new Set(extractServerMsgDiscriminants().map(([, type]) => type));
    const unmodelled = [...extractSidecarTypeLiterals()]
      .filter(type => !modelled.has(type) && !SIDECAR_ONLY.has(type))
      .sort();
    expect(unmodelled).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the file to verify all three tests pass**

Run: `npx vitest run src/lib/local-inference/native/nativeProtocol.consistency.test.ts`
Expected: **PASS** (3 tests).

Both scanners were verified against the branch base before this plan was written:
the walker finds **35** `.py` files, the sidecar scan yields **18** type names, and
both set differences are already empty (`ts \ py = []`, `py \ (ts ∪ {pong}) = []`).
If `extractSidecarTypeLiterals` throws the `MIN_SIDECAR_PY_FILES` error, `SIDECAR_DIR`
resolved wrong — count the `..` segments.

These two are green on arrival — they describe a property that already holds. That
makes them unproven until mutated. Steps 3 and 4 prove each one is live.

- [ ] **Step 3: Mutation-verify the first net (`ts ⊆ py`)**

This is the exact half-migration the net exists to catch. Temporarily revert Task 1's
sidecar rename — in `sidecar/sokuji_sidecar/tts_engine.py:217`, change
`"tts_generate_result"` back to `"result"` — then run:

`npx vitest run src/lib/local-inference/native/nativeProtocol.consistency.test.ts`

Expected: **FAIL** on "every ServerMsg type is one the sidecar actually sends", with
```
AssertionError: expected [ "TtsGenerateResultMsg ('tts_generate_result')" ] to deeply equal []
```
**Restore the file** (`git checkout sidecar/sokuji_sidecar/tts_engine.py`) and re-run
to confirm green again. If the test did not fail, the net is dead — stop and report.

- [ ] **Step 4: Mutation-verify the second net (`py ⊆ ts ∪ {pong}`)**

Temporarily remove `'pong'` from `SIDECAR_ONLY` (making it `new Set([])`) and run the
file. Expected: **FAIL** on "every type the sidecar sends is modelled by ServerMsg,
except the ping health-check", with `expected [ 'pong' ] to deeply equal []`. This
proves both that the net is live and that the allowlist is load-bearing rather than
decorative. **Restore `'pong'`** and re-run to confirm green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/local-inference/native/nativeProtocol.consistency.test.ts
git commit -m "test(native): pin ServerMsg against the sidecar's wire type names

The union is a hand-written model of what a separate Python codebase sends; a
rename applied to one side only kept both sides compiling and both suites green.
These two nets diff the TS union's discriminants against every type literal the
sidecar constructs, in both directions, with pong allowlisted (it answers a ping
health-check no renderer code sends). Both are mutation-verified."
```

---

### Task 3: Rename the translate reply `translation` → `translate_result`

Every other request-specific RPC reply in this wire is named `<request>_result`
(`model_status_result`, `hardware_info_result`, `list_variants_result`,
`models_catalog_result`, `model_delete_result`, `list_tts_voices_result`). `translation`
is the last one that isn't. Task 2's nets now make a one-sided rename impossible.

**Files:**
- Modify: `src/lib/local-inference/native/nativeProtocol.ts:49` (interface), `:62` (union)
- Modify: `src/lib/local-inference/native/NativeTranslateClient.ts:37`
- Modify: `src/lib/local-inference/native/NativeTranslateClient.test.ts:25`
- Modify: `src/lib/local-inference/native/SidecarConnection.test.ts:60,90,155`
- Modify: `sidecar/sokuji_sidecar/translate_engine.py:92`
- Modify: `sidecar/tests/test_translate_engine.py:38`

**Interfaces:**
- Consumes: the union edited in Task 1 (member `TtsGenerateResultMsg` already renamed).
- Produces: wire name `translate_result`; TS interface `TranslateResultMsg`.

- [ ] **Step 1: Rename the interface and the union member**

In `src/lib/local-inference/native/nativeProtocol.ts`, replace line 49:

```ts
export interface TranslationMsg { type: 'translation'; id: number; sourceText: string; translatedText: string; inferenceTimeMs: number; }
```

with:

```ts
export interface TranslateResultMsg { type: 'translate_result'; id: number; sourceText: string; translatedText: string; inferenceTimeMs: number; }
```

and on line 62, change the union member `TranslationMsg` to `TranslateResultMsg`. The
full line becomes:

```ts
export type ServerMsg = ReadyMsg | OkMsg | TtsGenerateResultMsg | TranslateResultMsg | SpeechStartMsg | AsrPartialMsg | AsrResultMsg | ModelStatusResultMsg | ModelDeleteResultMsg | ModelProgressMsg | ModelDownloadDoneMsg | ErrorMsg | HardwareInfoResultMsg | ModelsCatalogResultMsg | ListVariantsResultMsg | TtsChunkMsg | TtsDoneMsg | ListTtsVoicesResultMsg;
```

- [ ] **Step 2: Run the consistency test to verify the TS-only rename fails**

Run: `npx vitest run src/lib/local-inference/native/nativeProtocol.consistency.test.ts`

Expected: **FAIL** on "every ServerMsg type is one the sidecar actually sends", with
```
AssertionError: expected [ "TranslateResultMsg ('translate_result')" ] to deeply equal []
```
This is Task 2's net doing its job: the sidecar still says `translation`. If it
passes, the net is broken — stop and report.

- [ ] **Step 3: Point the translate client at the new name**

In `src/lib/local-inference/native/NativeTranslateClient.ts`, replace line 37:

```ts
    const msg = await this.conn.request({ type: 'translate', text, systemPrompt, wrapTranscript }) as Extract<ServerMsg, { type: 'translation' }>;
```

with:

```ts
    const msg = await this.conn.request({ type: 'translate', text, systemPrompt, wrapTranscript }) as Extract<ServerMsg, { type: 'translate_result' }>;
```

- [ ] **Step 4: Rename the sidecar's emit**

In `sidecar/sokuji_sidecar/translate_engine.py`, replace lines 92-93:

```python
    return {"type": "translation", "id": msg.get("id"),
            "sourceText": text, "translatedText": translated, "inferenceTimeMs": ms}, None
```

with:

```python
    return {"type": "translate_result", "id": msg.get("id"),
            "sourceText": text, "translatedText": translated, "inferenceTimeMs": ms}, None
```

- [ ] **Step 5: Run the consistency test to verify it passes**

Run: `npx vitest run src/lib/local-inference/native/nativeProtocol.consistency.test.ts`
Expected: **PASS** (3 tests) — both sides now agree.

- [ ] **Step 6: Update the four TS tests that speak the old name**

In `src/lib/local-inference/native/NativeTranslateClient.test.ts`, line 25:

```ts
    conn.emit({ type: 'translation', id: sent.id, sourceText: 'hello', translatedText: 'こんにちは', inferenceTimeMs: 12 });
```

becomes:

```ts
    conn.emit({ type: 'translate_result', id: sent.id, sourceText: 'hello', translatedText: 'こんにちは', inferenceTimeMs: 12 });
```

In `src/lib/local-inference/native/SidecarConnection.test.ts`, line 60:

```ts
    ws.reply({ type: 'translation', id: sent.id, sourceText: 'hi', translatedText: 'こんにちは', inferenceTimeMs: 3 });
```

becomes:

```ts
    ws.reply({ type: 'translate_result', id: sent.id, sourceText: 'hi', translatedText: 'こんにちは', inferenceTimeMs: 3 });
```

line 90:

```ts
    ws.reply({ type: 'translation', id, translatedText: 'late' });
```

becomes:

```ts
    ws.reply({ type: 'translate_result', id, translatedText: 'late' });
```

line 155:

```ts
    b.reply({ type: 'translation', id, translatedText: 'ok' });
```

becomes:

```ts
    b.reply({ type: 'translate_result', id, translatedText: 'ok' });
```

- [ ] **Step 7: Update the sidecar test**

In `sidecar/tests/test_translate_engine.py`, replace lines 38-39:

```python
    assert reply == {"type": "translation", "id": 2,
                     "sourceText": "hola", "translatedText": "<hola>", "inferenceTimeMs": 8}
```

with:

```python
    assert reply == {"type": "translate_result", "id": 2,
                     "sourceText": "hola", "translatedText": "<hola>", "inferenceTimeMs": 8}
```

- [ ] **Step 8: Run both suites**

```bash
npx vitest run src/lib/local-inference/native/
cd sidecar && /home/jiangzhuo/Desktop/kizunaai/sokuji-react/sidecar/.venv/bin/python -m pytest tests/test_translate_engine.py -q
```

Expected: native TS lane all pass; `test_translate_engine.py` all pass.

- [ ] **Step 9: Commit**

```bash
git add src/lib/local-inference/native/ sidecar/sokuji_sidecar/translate_engine.py sidecar/tests/test_translate_engine.py
git commit -m "refactor(native): rename translate reply translation -> translate_result

Every other request-specific reply in this wire is named <request>_result
(model_status_result, hardware_info_result, list_variants_result, ...). The
translate reply was the last one naming its payload instead of its request."
```

---

### Task 4: Bump `sidecarVersion` and verify the whole branch

`electron/native-host-manager.js:35-43` matches the bundled sidecar's version against
`package.json`'s `sidecarVersion` **strictly** — it refuses to start on a mismatch
rather than silently running an untested app × sidecar combination. Tasks 1 and 3
changed the wire, so a 0.1.5 sidecar can no longer serve this app: the pin must move.
The matching bundles are published by the `sidecar-bundles.yml` workflow, which fires
on a `sidecar-v*` tag and verifies the tag equals this field.

**Files:**
- Modify: `package.json:5`

**Interfaces:**
- Consumes: the wire renames from Tasks 1 and 3.

- [ ] **Step 1: Bump the pin**

In `package.json`, replace line 5:

```json
  "sidecarVersion": "0.1.5",
```

with:

```json
  "sidecarVersion": "0.1.6",
```

- [ ] **Step 2: Verify the sidecar suite**

Run: `cd sidecar && /home/jiangzhuo/Desktop/kizunaai/sokuji-react/sidecar/.venv/bin/python -m pytest tests/ -q`
Expected: **769 passed, 15 skipped, 0 failed** — unchanged from the baseline. No
sidecar tests were added or removed; three assertions changed in place.

- [ ] **Step 3: Verify the full TS suite**

Run: `npx vitest run`
Expected: **0 failed**, and **1236 passed** — the baseline's 1233 plus the three tests
in `nativeProtocol.consistency.test.ts`. The binding invariant is *0 failed and the
count grew by exactly the three tests added*; if the total differs for another reason,
report the discrepancy rather than adjusting anything to hit the number.

- [ ] **Step 4: Verify the tsc count**

Run: `npx tsc --noEmit 2>&1 | grep -c 'error TS'`
Expected: **160** (baseline 162, minus the two collision errors).

Run: `npx tsc --noEmit 2>&1 | grep -E 'NativeTtsClient|NativeTranslateClient|NativeAsrClient|nativeProtocol'`
Expected: no output.

Do **not** grep for `local-inference/native` — that lane has **7** pre-existing errors
(`nativeCatalog.test.ts`, `nativeVoiceStorage.ts`), untouched by this branch and not
yours to fix.

- [ ] **Step 5: Verify no stray old names survive in the native lane**

```bash
grep -rn "'translation'\|TranslationMsg\|ResultMsg" src/lib/local-inference/native/ \
  | grep -vE 'AsrResultMsg|ModelStatusResultMsg|ModelDeleteResultMsg|HardwareInfoResultMsg|ModelsCatalogResultMsg|ListVariantsResultMsg|ListTtsVoicesResultMsg|TtsGenerateResultMsg|TranslateResultMsg'
grep -rn '"type": "translation"' sidecar/
```

Expected: no output from either. (`type: 'result'` **does** legitimately survive in
`NativeAsrClient.ts`, `NativeAsrClient.test.ts`, `nativeProtocol.ts:52`,
`asr_engine.py`, `pocket_engine.py` and their tests — Global Constraints 3 and 4.)

- [ ] **Step 6: Commit**

```bash
git add package.json
git commit -m "chore(native): bump sidecarVersion to 0.1.6 for the wire rename

NativeHostManager matches the bundled sidecar's version against this field
strictly, so a 0.1.5 bundle — which still answers tts_generate with type:'result'
and translate with type:'translation' — must not be paired with this app."
```

---

## Post-merge (human)

The bundles for 0.1.6 do not exist until someone pushes the tag. After this branch
merges, push `sidecar-v0.1.6` to trigger `.github/workflows/sidecar-bundles.yml`,
which verifies the tag against `package.json`'s `sidecarVersion` and publishes the
four SKU prerelease bundles. Until that tag lands, the Local Native provider has no
downloadable sidecar matching this app.
