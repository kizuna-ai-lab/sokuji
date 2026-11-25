# Local Native Engine in TypeScript Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the Python sidecar (`sidecar/sokuji_sidecar/`, ~7,200 lines) to a TypeScript engine under `electron/engine/` that serves the same WebSocket protocol, message for message, on top of the Node addon from plan 1.

**Architecture:** One engine process: a `ws` server on `127.0.0.1:0`, the same per-connection rules as `server.py`, and one module per Python module, ported line for line. Every native call is a promise on the addon's per-handle worker threads, so the JS thread never blocks. Behaviour is pinned by golden vectors exported from the Python code before it is deleted, and by a recorded session against the real Python engine.

**Tech Stack:** TypeScript (strict), Node 24 / Electron 44's Node, `ws` 8, vitest (node environment), the plan 1 addon (`native/node/index.d.ts`), Python 3.12 only for the one-off golden export.

**Spec:** `docs/superpowers/specs/2026-11-23-sidecar-without-python-design.md` (§6.1–§6.8, §7). Consumes plan 1's JS API (`native/node/index.d.ts`); plan 3 (`2026-11-23-engine-switch.md`) launches this engine.

## Global Constraints

- The protocol on `main` is frozen: message types, field names, binary frame formats and send order as in `sidecar/sokuji_sidecar/wire_schema.json` and the handlers. No message is added, removed or renamed.
- Binary frames: ASR audio in = raw Int16 LE at the client's `sampleRate`; voice clip in = raw Float32 LE; TTS audio out = raw Int16 LE, 24 kHz mono, sent immediately before its `tts_chunk` / `tts_generate_result` JSON.
- WebSocket: bind `127.0.0.1:0`, `maxPayload` 64 MiB, serial dispatch per connection, binary-then-JSON send order, `on_close` cleanups run after an in-flight handler returns.
- Reject upgrade requests whose `Origin` header is present and not in the allow-list passed to `startEngine` (spec §6.8).
- Same env vars as today: `SOKUJI_NATIVE_THREADS`, `SOKUJI_WIRE_STRICT`, `SOKUJI_BENCH_DIR`, `HF_HOME` / `HF_HUB_CACHE`, `HF_ENDPOINT`; `GGML_*` still feed the generation hash.
- Model cache: the Hugging Face layout under `HF_HOME` (default set by main: `userData/hf-cache`), unchanged.
- Bench cache: a new file `accel-bench.v2.json` in the same directory, keyed by `sha256(JSON.stringify(fingerprint facts)).slice(0, 12)`; the old Python file is ignored.
- One engine per stage, shared by all connections, as today.
- Every engine test file starts with `// @vitest-environment node`.
- The engine never imports from `src/` (renderer code) and the renderer never imports from `electron/engine/`, except the shared `wire_schema.json`.
- The Python sidecar stays in the tree and keeps working throughout this plan; plan 3 deletes it.
- Pushing a branch or opening a PR on `kizuna-ai-lab/sokuji` needs the maintainer's go-ahead first, naming the repo and branch.

## Review Focus

1. **A client disconnects mid-job** (window closed during a translation, a TTS stream, a download). Expected: the job is cancelled through its `AbortSignal`, its model stays or is freed exactly as `server.py`'s cleanups do, and no send is attempted on the closed socket. Pinned in Task 9 (`cancels the translation when the client disconnects`) and Task 10 (`stops streaming when the owner disconnects`).
2. **Two connections drive the same stage** (the model-management socket and a session socket; two windows). Expected: `cancel` affects only the caller's job (fixes Python's `_workers[-1]`); `tts_generate` from a non-owner gets the `not_owner` error. Pinned in Task 9 and Task 10.
3. **A download is interrupted and restarted** (network drop, app quit). Expected: the next `model_download` resumes from the `.incomplete` size with a Range request and the finished blob's sha256 matches. Pinned in Task 7.
4. **Malformed or hostile input**: an unknown `type`, a JSON frame that is not an object, a binary frame with no handler, a 65 MiB frame, a GGUF file that is truncated. Expected: an `error` message (or a closed socket for the oversize frame), never a crashed engine. Pinned in Task 2 and Task 3.
5. **The native addon fails to load** (old glibc, missing file). Expected: `startEngine` rejects with the loader's message, and nothing else starts. Pinned in Task 2 (`rejects when the addon cannot load`).

---

## File Structure

| Path | Responsibility | Ported from |
|---|---|---|
| `electron/engine/tsconfig.json` | Strict TS, `types: ["node"]`, includes `electron/engine/**` and `native/node/index.d.ts` | — |
| `electron/engine/main.ts` | `startEngine(opts)`; utilityProcess entry glue is plan 3's | `__main__.py` |
| `electron/engine/native.ts` | Loads the addon with `process.dlopen`, `init` once, device helpers; `setNativeForTests()` | `native.py` |
| `electron/engine/wire.ts`, `electron/engine/wire_schema.json` | Outbound validator (strict under `SOKUJI_WIRE_STRICT=1`) | `wire.py` |
| `electron/engine/server.ts`, `electron/engine/conn.ts` | `ws` server, `Conn`, dispatch, Origin check | `server.py` |
| `electron/engine/backends.ts` | Backend registry, `BackendLoadError`, `AsrResult` | `backends.py` |
| `electron/engine/ggufHeader.ts` | GGUF v2/v3 header reader | `gguf_header.py` |
| `electron/engine/catalog/{types,asr,translate,tts,index}.ts` | Cards and helpers | `catalog.py` |
| `electron/engine/planner.ts` | Plans, tiers, quant pickers | `planner.py` |
| `electron/engine/accel/{machine,probe,opCoverage,bench,ledger,loader,handlers}.ts` | Probe, coverage, bench cache, memory ledger, load with fallback, `hardware_info` / `models_catalog` / `list_variants` | `accel.py` |
| `electron/engine/models/{hfCache,download,specs,status,remove,handlers}.ts` | HF cache layout, downloader, status, delete, the four model handlers | `native_models.py` |
| `electron/engine/asr/{dsp,backend,engine,handlers}.ts` | ASR | `asr_backend.py`, `asr_engine.py` |
| `electron/engine/translate/{strategies,backend,engine,handlers}.ts` | Translation | `translate_backend.py`, `translate_engine.py` |
| `electron/engine/tts/{dsp,staging,backend,engine,voices,handlers}.ts` | TTS | `tts_backend.py`, `tts_engine.py`, `tts_voices.py` |
| `electron/engine/test/fakeNative.ts` | A fake implementing `native/node/index.d.ts` for unit tests | `sidecar/tests/_fixtures.py`, `conftest.py` |
| `electron/engine/test/golden/*.json` | Golden vectors from Task 1 | — |
| `electron/engine/**/*.test.ts` | Ported tests | `sidecar/tests/test_*.py` |
| `sidecar/tools/export_goldens.py`, `sidecar/tools/record_session.py` | One-off exporters (deleted with the sidecar in plan 3) | — |

**Porting rule for every task.** Each TS module is a line-for-line port of its Python module: same functions (camelCase names), same branches, same constants, same error strings (the renderer and the tests match on some of them). Each ported test file ports every test of its Python file, one `it` per `def test_*`, same assertions. Where Python and TS must differ (threads → promises, numpy → typed arrays, `huggingface_hub` → `models/`), the task says so.

**Starting point.** This plan's branch starts from plan 1's Task 1 commit, so `native/node/index.d.ts` exists. Nothing else from plan 1 is needed until Task 11.

---

### Task 1: Golden export from the Python sidecar

**Files:**
- Create: `sidecar/tools/export_goldens.py`, `sidecar/tools/record_session.py`, `sidecar/tests/test_export_goldens.py`
- Create (generated, committed): `electron/engine/test/golden/{catalog,characterization,planner,gguf,prompts,dsp_asr,dsp_tts,specs}.json`, and `session.json` (Step 6)

**Interfaces:**
- Produces: golden files, each `{ "generator": "export_goldens.py", "sidecar_commit": "<sha>", "cases": [...] }`:
  - `catalog.json`: every ASR, translate and TTS card as `dataclasses.asdict`, plus `voice_capability(card)` and `license_dict(card)` per TTS card, and `split_artifact` on every deployment artifact.
  - `characterization.json`: for every Machine fixture in `sidecar/tests/test_characterization.py` × every catalog card × overrides `auto, cpu, gpu-vulkan, gpu-metal`: the outputs of `resolve` / `resolve_translate` / `resolve_tts` (plans as dicts, or `{"error": "NoUsablePlan", "message": ...}`), and of `_tc_pick_quant`, `select_variant`, `_llamacpp_variant_row` with the fixtures' memory budgets and pins `None` plus each card's first two quants. Downloaded quants pinned to none and bench pinned to `{}`, as that file does.
  - `planner.json`: the table-driven cases of `sidecar/tests/test_planner.py`, input and output.
  - `gguf.json`: headers parsed from the synthetic files `test_gguf_header.py` writes (bytes as base64, result or error string).
  - `prompts.json`: for each strategy (`QwenStrategy`, `HunyuanStrategy`, `GemmaStrategy`) × texts `["Hello.", "こんにちは。", ""]` × system prompts `["", "Be formal."]` × pairs `(en,ja), (ja,en), (zh,fr)` × `wrap` `[true,false]`: `build(...)` output; `_clean_output` on the cases in `test_translate_backend.py`; `_chatml_fallback` on two message lists.
  - `dsp_asr.json`: `_downsample_int16_to_f32_16k` on a fixed 1 kHz Int16 tone at source rates 16000, 22050, 24000, 44100, 48000 (input and output as arrays).
  - `dsp_tts.json`: `_to_int16_24k_mono` on fixed mono and stereo float tones at 16000, 22050, 24000, 44100, 48000 (soxr output; Task 10 compares by SNR, not bytes).
  - `specs.json`: `download_specs(card_id)` and the offline `model_size(card_id)` for every card.

- [ ] **Step 1: Write the failing test** `sidecar/tests/test_export_goldens.py`: runs `export_goldens.py --out <tmp>` twice and asserts both runs write the same eight files byte for byte, `catalog.json` has 67 ASR, 11 translate and 14 TTS cards, and `characterization.json` has at least one `NoUsablePlan` case.
- [ ] **Step 2: Run and see it fail.** `cd sidecar && python -m pytest tests/test_export_goldens.py -q` → FAIL (script missing).
- [ ] **Step 3: Implement `export_goldens.py`**, importing the sidecar modules and the fixtures from `tests/test_characterization.py` (no copies of the Machine definitions); sorted keys, two-space indent.
- [ ] **Step 4: Run and see it pass**, then generate the committed files: `python sidecar/tools/export_goldens.py --out electron/engine/test/golden`.
- [ ] **Step 5: Commit** `git commit -m "test(engine): golden vectors exported from the Python sidecar"`
- [ ] **Step 6: Record the session (manual, on the linux-arm64 machine with the cached models).** `record_session.py` starts `python -m sokuji_sidecar` from a scratch venv holding the native-v1.2.0 wheel (Walter's runtime notes, step 1), with a scratch `HF_HOME` hard-linked from the cache (`cp -al`), connects four sockets like the renderer's clients, and records every frame in both directions (JSON verbatim; binary as length + sha256 + first 64 bytes base64) for: `hardware_info`, `models_catalog` for each kind, `model_status` for the three cards below, `asr_init` (`canary-180m-flash`, `en`, `sampleRate` 24000, device `cpu`) then the JFK clip resampled to 24 kHz in 100 ms frames with `vad_mark` start/end, `translate_init` (`qwen2.5-0.5b`, en→ja, cpu) then `translate` of the transcript, `tts_init` (`supertonic-3`, cpu) then `tts_generate` of "Good morning, everyone.", then closing each socket. Write `electron/engine/test/golden/session.json` and commit it: `git commit -m "test(engine): recorded Python session"`.

### Task 2: Engine scaffold: native loader, wire validator, server

**Files:**
- Create: `electron/engine/tsconfig.json`, `main.ts`, `native.ts`, `wire.ts`, `wire_schema.json` (copied from the sidecar), `conn.ts`, `server.ts`, `backends.ts`, `test/fakeNative.ts`, `test/wsClient.ts`
- Test: `electron/engine/native.test.ts`, `wire.test.ts`, `server.test.ts`, `schemaCopy.test.ts`
- Modify: `package.json` (`"typecheck:engine": "tsc -p electron/engine --noEmit"`, and add it to the existing typecheck script)

**Interfaces:**
- Consumes: `native/node/index.d.ts`.
- Produces:
  - `startEngine(opts: { nativeDir: string; allowedOrigins: string[]; log: (level: 'debug'|'info'|'warn'|'error', msg: string) => void; native?: NativeModule }): Promise<{ port: number; close(): Promise<void> }>` in `main.ts`.
  - `native.ts`: `type NativeModule = typeof import('../../native/node/index')`; `loadNative(dir: string): NativeModule` (`process.dlopen` of `dir/sokuji_native_node.node`, then the addon's `contract(dir)` ABI check; any failure throws with the loader's message); `module(): NativeModule` (initialised once with `SOKUJI_NATIVE_THREADS`); `devices()`, `deviceFor(kind)` (throws `BackendLoadError("no <kind> device in this process")`), `deviceProfiles()`, `deviceSupportsOps(...)`; `setNativeForTests(m: NativeModule | null)`.
  - `conn.ts`: `class Conn { ctx: Map<string, unknown>; onClose(cb: () => void | Promise<void>): void; send(obj?: object, binary?: Uint8Array): Promise<void>; waitClosed(): Promise<void>; readonly closed: boolean }`.
  - `server.ts`: `type Handler = (state: EngineState, msg: any, binaryIn: Uint8Array | null, conn: Conn) => Promise<object | null>`; `register(type: string, h: Handler)`; `handleMessage(state, raw, binaryIn, conn)`; `serve(state, opts): Promise<{ port, close }>`.
  - `backends.ts`: `BackendLoadError`, `AsrResult`, `registerBackend`, `makeBackend(name)`.
  - `wire.ts`: `checkOutbound(obj): void` (strict throws `WireContractError`, else warns once per type).
  - `test/fakeNative.ts`: `makeFakeNative(opts?): NativeModule & { calls: string[] }` — configurable devices, profiles, op coverage, and scripted ASR / translate / TTS results, mirroring the fakes in `sidecar/tests/_fixtures.py` and `conftest.py`.

- [ ] **Step 1: Write the failing tests.** Port `test_server_conn.py` (11), `test_server_envelope.py` (2), `test_wire.py` (8) and `test_native.py` (3) into the four files. Add:

```ts
it('rejects a browser Origin that is not allowed', async () => {
  const eng = await startEngine({ nativeDir: '', allowedOrigins: ['http://localhost:5173'], log: () => {}, native: makeFakeNative() });
  await expect(openWs(eng.port, { origin: 'https://evil.example' })).rejects.toThrow(/403/);
  await expect(openWs(eng.port, { origin: 'http://localhost:5173' })).resolves.toBeTruthy();
});
it('closes the socket on a frame over 64 MiB', async () => { /* send 65 MiB binary; expect close code 1009 */ });
it('answers a non-object JSON frame with an error', async () => { /* send '[1,2]'; expect {type:"error"} */ });
it('rejects when the addon cannot load', async () => {
  await expect(startEngine({ nativeDir: '/nonexistent', allowedOrigins: [], log: () => {} })).rejects.toThrow(/contract\.json|sokuji_native_node/);
});
// schemaCopy.test.ts — while the sidecar exists:
it('engine schema equals the sidecar schema', () => {
  expect(read('electron/engine/wire_schema.json')).toBe(read('sidecar/sokuji_sidecar/wire_schema.json'));
});
```

- [ ] **Step 2: Run and see them fail.** `npx vitest run electron/engine` → FAIL.
- [ ] **Step 3: Implement.** `Conn.send` sends the binary frame first, then the validated JSON. Dispatch is serial per connection (a promise chain). `ctx.on_binary` and `pending_binary` behave as in `server.py`. Handler exceptions become `{ type: 'error', id, message }`. `ping` → `pong`.
- [ ] **Step 4: Run and see them pass**, plus `npm run typecheck:engine`.
- [ ] **Step 5: Commit** `git commit -m "feat(engine): TS engine scaffold — native loader, wire validator, ws server"`

### Task 3: GGUF header

**Files:** Create `electron/engine/ggufHeader.ts`; Test `electron/engine/ggufHeader.test.ts`

**Interfaces:**
- Produces: `readHeader(path: string): Promise<GgufHeader>` with `GgufHeader { architecture: string; tensorDtypes: Set<string>; tensorCount: number }`; `class GgufError extends Error`. Reads only the header with `fs.promises.open` + positioned reads.

- [ ] **Step 1: Write the failing test.** Port `test_gguf_header.py` (4, including its synthetic GGUF writer as a test helper) and add `it('matches every gguf.json golden case')` (results equal; error cases throw `GgufError` with the same message) and `it('rejects a file cut off mid-KV')`.
- [ ] **Step 2: Run, fail. Step 3: Implement. Step 4: Run, pass.**
- [ ] **Step 5: Commit** `git commit -m "feat(engine): GGUF header reader"`

### Task 4: Catalog

**Files:** Create `electron/engine/catalog/{types,asr,translate,tts,index}.ts`; Test `electron/engine/catalog/catalog.test.ts`

**Interfaces:**
- Produces: `Deployment`, `AsrModel`, `TranslateModel`, `TtsModel`, `License` types (fields as the dataclasses, camelCase); `asrModels()`, `asrModel(id)`, `translateModels()`, `translateModel(id)`, `ttsModels()`, `ttsModel(id)`, `resolveTtsCard(id)`, `splitArtifact(a): [repo: string, file: string | null]`, `voiceCapability(card)`, `licenseDict(card)`, and the constants `RUNG_FALLBACK_DTYPES`, `WEIGHT_CAPABLE_DTYPES`, `VOICE_REQUIRED_FAMILIES`, `TTS_TIER_OVERRIDES`.

- [ ] **Step 1: Write the failing test.** Port `test_catalog.py` (68) and `test_platform_filter.py` (8). Add `it('every card equals catalog.json')`: each card serialised with the same key mapping (`snake_case` ↔ `camelCase` converter in the test) deep-equals its golden, and so do `voiceCapability`, `licenseDict` and `splitArtifact`.
- [ ] **Step 2: Run, fail. Step 3: Implement** (the row builders `_tc_row`, `_llm_translate_row`, `_tts_gguf_row` port as functions; the tables port as data). **Step 4: Run, pass.**
- [ ] **Step 5: Commit** `git commit -m "feat(engine): model catalog"`

### Task 5: Planner

**Files:** Create `electron/engine/planner.ts`, `electron/engine/accel/machine.ts`; Test `electron/engine/planner.test.ts`, `electron/engine/characterization.test.ts`

**Interfaces:**
- Consumes: Task 4's catalog.
- Produces: in `accel/machine.ts`: `Machine`, `DeviceProfile`, `OpCoverage` types (fields as `accel.py`'s dataclasses). In `planner.ts`: `TIER_RANK`, `PlanConfig`, `Plan`, `class NoUsablePlan extends Error`, `resolveDeployments(model, machine, override, opts)`, `resolve(modelId, override, { machine, platform, ... })`, `resolveTranslate(...)`, `resolveTts(...)`, `selectVariant(...)`, `tcPickQuant(...)`, `llamacppVariantRow(...)`, `applyBench(plans, bench)` — parameters exactly as the Python keyword arguments.

- [ ] **Step 1: Write the failing tests.** Port `test_planner.py` (82). `characterization.test.ts`: one `it` per `characterization.json` case, deep-equal.
- [ ] **Step 2: Run, fail. Step 3: Implement. Step 4: Run, pass** (every golden case).
- [ ] **Step 5: Commit** `git commit -m "feat(engine): planner"`

### Task 6: Accel: probe, op coverage, bench cache, ledger, loader, handlers

**Files:** Create `electron/engine/accel/{probe,opCoverage,bench,ledger,loader,handlers}.ts`; Test `electron/engine/accel/*.test.ts`

**Interfaces:**
- Consumes: `native.ts`, `planner.ts`, `catalog`, `ggufHeader.ts`, `models/hfCache.ts`'s `cachedFilePath` (Task 7; until then a local stub returning `null`).
- Produces: `probe(force?: boolean): Machine` (cached; `generation` = sha256 over the same facts `compute_generation` hashes, first 12 hex chars); `weightDtypes(model, computeType)`; `computeOpCoverage(...)`, `opCoverageFor(...)`, `cachedOpCoverage(...)`; `benchLoad()`, `benchSave(...)` on `accel-bench.v2.json` (last 3 generations kept, temp file + rename); `ledgerReset/Claim/Release/Other/EffectiveReserve`; `loadWithFallback(plans, load)` and `loadMeasured(...)`; `measureRtf`, `measureTps`, `measureRtfTts`; the handlers `hardware_info`, `models_catalog`, `list_variants` registered on the server.

- [ ] **Step 1: Write the failing tests.** Port `test_accel.py` (103), with these replacements: blake2s / `repr` fingerprints → the new sha256 key (assert stability across two `probe(true)` calls and change when a `GGML_*` var changes); `psutil` RSS → `process.memoryUsage().rss`; `asyncio.to_thread` → promises. Add `it('hardware_info_result passes the strict wire check')`.
- [ ] **Step 2: Run, fail. Step 3: Implement. Step 4: Run, pass.**
- [ ] **Step 5: Commit** `git commit -m "feat(engine): device probe, op coverage, bench cache, loader"`

### Task 7: Model cache and downloads

**Files:** Create `electron/engine/models/{hfCache,download,specs,status,remove,handlers}.ts`; Test `electron/engine/models/*.test.ts`, `electron/engine/test/fakeHub.ts`

**Interfaces:**
- Produces:
  - `hfCache.ts`: `hubCacheDir(): string` (`HF_HUB_CACHE` or `HF_HOME/hub` or `~/.cache/huggingface/hub`); `repoFolder(repo)` (`models--org--name`); `cachedFilePath(repo, file, revision = 'main'): string | null`; `scanRepo(repo)`; `writeSnapshotLink(repo, commit, file, blobName)` (relative symlink `../../blobs/<etag>`, copy when `symlink` fails with `EPERM`); `writeRef(repo, 'main', commit)`.
  - `download.ts`: `downloadFile(repo, file, opts: { endpoint?: string; signal?: AbortSignal; onBytes?: (n: number) => void }): Promise<string>` — resolves `{endpoint}/{repo}/resolve/main/{file}` (redirects followed), reads `x-repo-commit`, `x-linked-etag` / `etag`, `x-linked-size`; writes `blobs/<etag>.incomplete`, resuming with `Range: bytes=<size>-` when it exists; verifies sha256 against the LFS etag when it is 64 hex chars; renames; links the snapshot; returns the snapshot path.
  - `specs.ts`: `downloadSpecs(cardId, repo?)`, `modelSize(cardId)`; `status.ts`: `modelStatus(cardId, repo?)`; `remove.ts`: `deleteModel(cardId, repo?)` (including the TTS staging prune); `handlers.ts`: `model_status`, `model_download`, `model_cancel`, `model_delete` — progress messages from `onBytes` (byte mode when the size is known, capped at total − 1 until the final message), `model_download_done{status: 'ready' | 'cancelled'}`, `error{model, message}`.
  - `test/fakeHub.ts`: a `node:http` server that serves a fake repo with HF's headers, can drop the connection after N bytes, and honours `Range`.

- [ ] **Step 1: Write the failing tests.** Port `test_native_models.py` (62) against a temp `HF_HOME`. Add:

```ts
it('resumes an interrupted download with a Range request', async () => {
  hub.dropAfter(1_000_000);                       // first attempt dies at 1 MB
  await expect(downloadFile(repo, file, { endpoint: hub.url })).rejects.toThrow();
  hub.dropAfter(null);
  const p = await downloadFile(repo, file, { endpoint: hub.url });
  expect(hub.lastRange).toBe('bytes=1000000-');
  expect(sha256(fs.readFileSync(p))).toBe(hub.sha256(file));
});
it('rejects a blob whose sha256 does not match and keeps no finished blob', async () => { /* hub serves corrupted bytes */ });
it('writes the huggingface_hub layout', async () => { /* refs/main = commit; snapshots/<commit>/<file> -> ../../blobs/<etag> */ });
it('cancels between chunks', async () => { /* abort after first onBytes; .incomplete remains for resume */ });
it('honours HF_ENDPOINT', async () => { /* env set to hub.url; no endpoint option */ });
it('agrees with the Python engine on a real cache', async () => {
  // skipped unless SOKUJI_GOLDEN_HF_CACHE is set: for every card, modelStatus() equals the status
  // export_goldens.py recorded against that same cache (run Task 1's exporter with --hf-cache to produce it)
});
```

- [ ] **Step 2: Run, fail. Step 3: Implement. Step 4: Run, pass.**
- [ ] **Step 5: Commit** `git commit -m "feat(engine): HF cache, resumable verified downloads, model handlers"`

### Task 8: ASR

**Files:** Create `electron/engine/asr/{dsp,backend,engine,handlers}.ts`; Test `electron/engine/asr/*.test.ts`

**Interfaces:**
- Consumes: `native.ts`, `accel/loader.ts`, `planner.resolve`, `models/hfCache.cachedFilePath`.
- Produces: `downsampleInt16ToF32_16k(bytes: Uint8Array, srcRate = 24000): Float32Array`; `NativeAsrBackend` / `NativeAsrStreamBackend` (registered as `native_asr` / `native_asr_stream`) with `load`, `transcribe(samples, language): Promise<AsrResult>`, `openStream(language)`, `unload`; `AsrEngine` with the Python engine's methods as async methods; handlers `asr_init`, `asr_flush`, `vad_mark`, and the binary audio path via `conn.ctx.on_binary`.

- [ ] **Step 1: Write the failing tests.** Port `test_asr_engine.py` (49) and `test_asr_backend.py` (20). Add `it('matches dsp_asr.json')` (exact Float32 equality per case), `it('feeds while a transcription is running')` (the fake's `run` resolves after 200 ms; frames sent meanwhile are accepted and handled in order), and `it('cuts at the vad_mark between the frames it arrived between')` (PCM frames and `vad_mark` start/end interleaved on one socket: the segment holds exactly the frames that arrived between the two marks — the shared turn-detection design forwards marks in order and relies on arrival-order cutting; no `sample` field).
- [ ] **Step 2: Run, fail. Step 3: Implement.** Offline transcription and streaming `feed` are awaited native promises; the engine's own state machine (pre-roll 0.7 s, 30 s cap, 20 s run-on cap, the > 3 s backpressure switch from always-stream to per-utterance) ports unchanged. **Step 4: Run, pass.**
- [ ] **Step 5: Commit** `git commit -m "feat(engine): ASR backend, engine and handlers"`

### Task 9: Translation

**Files:** Create `electron/engine/translate/{strategies,backend,engine,handlers}.ts`; Test `electron/engine/translate/*.test.ts`

**Interfaces:**
- Produces: `QwenStrategy`, `HunyuanStrategy`, `GemmaStrategy` with `build(text, systemPrompt, src, tgt, wrap, config)`; `cleanOutput(text)`, `chatmlFallback(messages, prefill)`, `GEMMA_LANG_NAME`; `NativeTranslateBackend` (`native_translate`) with `load`, `translate(text, systemPrompt, src, tgt, opts: { wrap: boolean; signal: AbortSignal; onPartial?: (text: string) => void }): Promise<string>`, `unload()`; `TranslateEngine` (generation token); handlers `translate_init`, `translate`. Each `translate` call owns an `AbortController`; the connection's `onClose` aborts that connection's controllers only.

- [ ] **Step 1: Write the failing tests.** Port `test_translate_backend.py` (28) and `test_translate_engine.py` (22). Add:

```ts
it('matches prompts.json', () => { /* every strategy/build case, cleanOutput and chatmlFallback case */ });
it('cancels the translation when the client disconnects', async () => { /* close the socket mid-generation: the fake sees its signal aborted; no send after close */ });
it('cancel from one connection leaves another connection's translation running', async () => {});
it('assembles a character split across token pieces', async () => { /* fake onToken yields [0xE3,0x81] then [0x82] → "あ" */ });
```

- [ ] **Step 2: Run, fail. Step 3: Implement. Step 4: Run, pass.**
- [ ] **Step 5: Commit** `git commit -m "feat(engine): translation backend, engine and handlers"`

### Task 10: TTS

**Files:** Create `electron/engine/tts/{dsp,staging,backend,engine,voices,handlers}.ts`; Test `electron/engine/tts/*.test.ts`

**Interfaces:**
- Produces: `toInt16_24kMono(pcm: Float32Array, channels: number, srcRate: number): Uint8Array` (downmix, `native.resample`, clip, Int16 LE); `stageForNative(repo, rev, relPath, source): Promise<string>` (hard link into `<HF_HUB_CACHE>/sokuji-tts-staging/<repo-->__<rev>/<rel>`, atomic copy on `EXDEV` or any link error); `NativeTtsBackend` (`native_tts`) with `load`, `generate(text, speed, signal)`, `generateStream(text, speed, signal, onChunk)`, `setVoice`, `setBuiltinVoice`, `setLanguage`, `listBuiltinVoices`, `unload`; `TtsEngine` (owner connection, `nextGeneration()`); `listBuiltinVoices(modelId?, engine?)`; handlers `tts_init`, `set_voice`, `tts_generate`, `tts_cancel`, `list_tts_voices`.

- [ ] **Step 1: Write the failing tests.** Port `test_tts_backend.py` (66), `test_tts_engine.py` (51) and `test_tts_voices.py` (12). Add:

```ts
it('resamples like soxr within 60 dB SNR', () => { /* every dsp_tts.json case: same length ±1 sample, SNR > 60 dB against the soxr output */ });
it('stops streaming when the owner disconnects', async () => {});
it('one-shot generation can be cancelled', async () => { /* tts_cancel during generate: signal aborted, no tts_generate_result sent */ });
```

- [ ] **Step 2: Run, fail. Step 3: Implement. Step 4: Run, pass.**
- [ ] **Step 5: Commit** `git commit -m "feat(engine): TTS backend, engine, voices and handlers"`

### Task 11: The recorded session against the real addon

**Files:** Test `electron/engine/session.test.ts`

**Interfaces:**
- Consumes: plan 1's addon (built locally or from a `native-v1.2.x` archive), `session.json`.

- [ ] **Step 1: Write the test** (skipped unless `SOKUJI_NATIVE_DIR` and `SOKUJI_SESSION_HF_HOME` are set): start the engine on the real addon, replay the client side of `session.json`, and compare the engine's frames:
  - same message types in the same order, same field names, strict wire check on;
  - transcript and translation text identical;
  - TTS: same `sampleRate`, total samples within 5 %, RMS above 0.01;
  - `ready.rtf` and `ready.tokensPerSec` within 10 % of the recorded values (repeat the run up to three times; take the best).
- [ ] **Step 2: Run it on the linux-arm64 machine.** `SOKUJI_NATIVE_DIR=<archive dir> SOKUJI_SESSION_HF_HOME=<scratch> npx vitest run electron/engine/session.test.ts` → PASS. Record the run (machine, native version, numbers) in the commit message.
- [ ] **Step 3: Commit** `git commit -m "test(engine): replay the recorded Python session on the TS engine"`
