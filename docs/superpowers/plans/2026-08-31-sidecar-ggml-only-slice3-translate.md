# Slice 3 — Translation on the Native Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve translation through `sk_translate_*` on `libsokuji_native` (llama.cpp in-process), stream tokens to the renderer, and delete the llama-server child-process stack, CTranslate2/Opus-MT, and their 13 catalog rows.

**Architecture:** `sk_translate.cpp` wraps llama.cpp's C API (model+context per handle, greedy sampler chain, per-token `sk_text_cb` with cancel-on-false, `llama_chat_apply_template` for chat, raw prompt for `sk_translate_complete`; thinking-mode kill via a caller-supplied assistant prefill). The sidecar's four translate backends collapse into one `native_translate` backend with three prompt-strategy classes selected by a new `PlanConfig.prompt_family`; generation runs in the executor and streams id-less `translate_partial` pushes; the renderer updates the assistant bubble per token. `llama_runtime.py` (binary download/spawn), `ct2_opus.py`, the Opus rows, and the ctranslate2 dependency are deleted.

**Tech Stack:** C++17 over `llama.h` (pin v0.3.0, vendored at `native/build/cpu/_deps/llama-src`), ctypes binding, Python sidecar (pytest), TypeScript renderer (vitest).

**Spec:** `docs/superpowers/specs/2026-08-30-sidecar-ggml-only-design.md` §4.3 (translate ABI block), §5.3 (backends), §9.1 (CTest), rollout row 3. Amendment A1 conventions (wire schema bidirectionality) apply. The spec's ABI note "final names may gain arguments during implementation, not lose these" covers the added `sk_gen_options.assistant_prefill` and `sk_translate_options.n_ctx`.

## Global Constraints

- English only in code, comments, tests, commit messages.
- TDD: tests first where the plan says so; run red before implementing.
- The worktree guard rejects heredocs, multi-env-prefix commands, and complex pipelines: use Write/Edit tools for file changes; keep Bash commands plain; when a command needs several env vars, write a small runner script under `/home/jiangzhuo/.claude/jobs/387091ff/tmp/` and `bash` it.
- Branch: `refactor/sidecar-ggml-only-slice3` in the worktree `/home/jiangzhuo/Desktop/kizunaai/sokuji/.claude/worktrees/sidecar-ggml-only`. Never push.
- Sidecar tests: `PYTHONPATH=$PWD/sidecar /home/jiangzhuo/Desktop/kizunaai/sokuji/sidecar/.venv/bin/python -m pytest <paths> -q` from the worktree root. Full-suite baseline failures: 3× pyopenjtalk, 1× bundles-workflow — not yours.
- Native package tests import from source via pytest `pythonpath` + `SOKUJI_NATIVE_DIR=$PWD/native/build/cpu/stage`.
- The dev venv's installed wheel stays at 0.3.0 until Task 5 rebuilds it — sidecar unit tests for the new backend therefore FAKE the native module (monkeypatch `sokuji_sidecar.native.module`), exactly as `test_asr_backend.py` does.
- Wire contract: `wire_schema.json` ↔ `ServerMsg` are pinned bidirectionally — `translate_partial` must land on BOTH sides in the SAME task (Task 4).
- `sk_*` ABI conventions from slice 2 hold: opaque handles, `sk_status` returns, thread-local `sk_last_error`, `sk::set_error`/`sk::require_init`/`sk::threads()` helpers from `native/src/sk_internal.h`, per-handle mutex, status-mapping table style of `native/src/sk_asr.cpp` (read it first — it is the template for `sk_translate.cpp`).
- Commit at the end of every task (conventional commits).

## Contract introduced by this plan (all tasks)

C ABI (added to `native/include/sokuji_native.h`):

```c
/* ---- Translation (llama.cpp) ----
 * One loaded GGUF chat model per handle. Requests are stateless: each call clears the
 * KV memory, evaluates the prompt, and greedily decodes up to max_tokens, invoking
 * sk_text_cb once per decoded token piece (UTF-8, may split multibyte chars across
 * pieces — concatenate before display). The callback returning false cancels the
 * request (SK_ERR_CANCELLED). Calls on one handle are serialised internally.
 * sk_translate_chat renders the messages through the GGUF's own chat template
 * (llama_chat_apply_template, add_assistant=true) and then appends
 * gen->assistant_prefill verbatim when non-NULL — the mechanism for forcing an empty
 * think block on Qwen3-family models. A GGUF whose template the legacy formatter does
 * not know yields SK_ERR_INVALID_ARGUMENT with a "chat template not supported" message;
 * callers fall back to sk_translate_complete with a self-rendered prompt. */
typedef struct sk_translate sk_translate;
typedef struct sk_translate_options { int32_t n_ctx; /* 0 = 4096 */ } sk_translate_options;
typedef struct sk_message { const char *role; const char *content; } sk_message;
typedef struct sk_gen_options {
    int32_t max_tokens;            /* <= 0 = 512 */
    const char *assistant_prefill; /* NULL = none */
} sk_gen_options;
sk_status sk_translate_load(const char *gguf_path, const sk_device *device,
                            const sk_translate_options *opts, sk_translate **out);
sk_status sk_translate_chat(sk_translate *, const sk_message *msgs, int32_t n_msgs,
                            const sk_gen_options *, sk_text_cb on_token, void *user);
sk_status sk_translate_complete(sk_translate *, const char *prompt,
                                const sk_gen_options *, sk_text_cb on_token, void *user);
void      sk_translate_unload(sk_translate *);
```

Python binding: `sokuji_native.translate_load(path, device=None, n_ctx=0) -> Translator`; `Translator.chat(messages, max_tokens=512, assistant_prefill=None, on_token=None) -> str`; `.complete(prompt, max_tokens=512, on_token=None) -> str`; `.unload()`. `messages` is a list of `{"role": str, "content": str}`; `on_token(piece) -> bool|None` streams pieces, returning `False` cancels (raises `NativeError` with `SK_ERR_CANCELLED`).

Sidecar: backend NAME `native_translate` (registered once); `PlanConfig` gains `prompt_family: str = ""` (`"qwen" | "hunyuan" | "gemma"`); `TranslateModel` gains `prompt_family`; backend `translate(text, system_prompt, src, tgt, wrap, on_partial=None)` where `on_partial(accumulated_text)` fires per token.

Wire: new id-less push `{"type": "translate_partial", "text": "<accumulated>"}` between a `translate` request and its `translate_result`. At most one translate request is in flight per connection (the renderer's job queue guarantees it) — partials carry no correlation id.

---

### Task 1: `sk_translate` C surface + CTest

**Files:**
- Create: `native/src/sk_translate.cpp`, `native/tests/test_translate.cpp`
- Modify: `native/include/sokuji_native.h`, `native/CMakeLists.txt` (target_sources + VERSION 0.3.0→0.4.0), `native/tests/CMakeLists.txt`, `.github/workflows/native-build.yml` (model cache + env var), `native/README.md`
- Read first: `native/src/sk_asr.cpp` (the structural template: handle struct, mutex, status mapping, `sk::` helpers), `native/src/sk_internal.h`

**Interfaces:**
- Consumes: `sk::require_init()`, `sk::set_error()`, `sk::threads()`, `sk::log_line()` from `sk_internal.h`; the `sk_device` handle (its `ggml_backend_dev_t` lives where `sk_asr.cpp` reads it — mirror that code exactly).
- Produces: the four C functions above, exported via the existing `sk_*` wildcard in `sokuji_native.map`/`.exports` (verify with `nm` in Step 4).

**Implementation notes (binding facts, verified against the vendored `llama.h`):**
- `llama_backend_init()` once per process (static flag under the load mutex); `llama_model_load_from_file(path, params)` with `params = llama_model_default_params()` then: CPU device → `params.n_gpu_layers = 0` and leave `params.devices = NULL`; GPU device → a static-lifetime 2-entry array `{dev, NULL}` in the handle, `params.devices = that`, `params.n_gpu_layers = -1`.
- Context: `llama_context_default_params()`; `n_ctx = opts&&opts->n_ctx>0 ? opts->n_ctx : 4096`; `n_batch = 512`; `n_threads = n_threads_batch = sk::threads()`.
- Per request (both entry points funnel into one `generate(handle, prompt_text, gen, cb, user)`):
  1. `llama_memory_clear(llama_get_memory(ctx), true)` — stateless requests.
  2. Tokenize with `llama_tokenize(vocab, text, len, buf, cap, /*add_special=*/true, /*parse_special=*/true)` (negative return = needed size; resize and retry).
  3. Feed the prompt in `n_batch`-sized chunks via `llama_batch_get_one(tokens + off, chunk)` + `llama_decode`.
  4. Greedy loop: sampler chain built once per handle (`llama_sampler_chain_init(llama_sampler_chain_default_params())` + `llama_sampler_chain_add(chain, llama_sampler_init_greedy())`), `llama_sampler_reset(chain)` per request; each step `tok = llama_sampler_sample(chain, ctx, -1)`; stop on `llama_vocab_is_eog(vocab, tok)` or token budget (`max_tokens<=0 ? 512 : max_tokens`); piece via `llama_token_to_piece(vocab, tok, buf, len, 0, /*special=*/false)`; `cb(piece, user)` returning false → `SK_ERR_CANCELLED` (set error text "cancelled") and stop BEFORE decoding the next token; then `llama_decode(ctx, llama_batch_get_one(&tok, 1))`.
  5. Map llama failures to sk statuses in the same table style as `sk_asr.cpp` (load failure → SK_ERR_BACKEND with `llama` context; OOM text preserved).
- `sk_translate_chat`: fetch the template with `llama_model_chat_template(model, NULL)`; NULL template or `llama_chat_apply_template(...) < 0` → `SK_ERR_INVALID_ARGUMENT`, message `"chat template not supported by the legacy formatter; render the prompt and use sk_translate_complete"`. Apply with `add_ass=true`; buffer sized `2 * total content bytes + 1024`, retry-on-larger per the header docs. Append `assistant_prefill` when set.
- Handle struct: `{ llama_model*, llama_context*, llama_sampler* chain, std::mutex, std::vector<ggml_backend_dev_t> devs }`. `sk_translate_unload`: free sampler (chain owns greedy), `llama_free`, `llama_model_free`.

- [ ] **Step 1: Write the failing CTest**

`native/tests/test_translate.cpp` (model via env `SK_TEST_TRANSLATE_GGUF`, skip exit 77 when absent — mirror `test_asr.cpp`'s skip and init boilerplate, including `GGML_BACKEND_PATH`):

```cpp
// sk_translate smoke: chat with prefill suppresses thinking, streaming cancels, complete() works.
#include "sokuji_native.h"
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>

static bool collect(const char *piece, void *user) {
    if (piece) static_cast<std::string *>(user)->append(piece);
    return true;
}
struct CancelCtl { int seen = 0; };
static bool cancel_after_3(const char *piece, void *user) {
    auto *c = static_cast<CancelCtl *>(user);
    if (piece) c->seen++;
    return c->seen < 3;
}

int main(int argc, char **argv) {
    const char *gguf = std::getenv("SK_TEST_TRANSLATE_GGUF");
    if (!gguf || !*gguf) { std::fprintf(stderr, "SK_TEST_TRANSLATE_GGUF not set — skip\n"); return 77; }
    // ... sk_init boilerplate exactly as in test_asr.cpp (module dir from argv[1]) ...

    sk_translate *t = nullptr;
    sk_translate_options topt{}; topt.n_ctx = 2048;
    if (sk_translate_load(gguf, nullptr /* default cpu device as test_asr does */, &topt, &t) != SK_OK) {
        std::fprintf(stderr, "load failed: %s\n", sk_last_error()); return 1;
    }
    sk_message msgs[2] = {
        {"system", "You are a translator. Translate the user's text from English to French. Output only the translation."},
        {"user", "Good morning."},
    };
    sk_gen_options gen{}; gen.max_tokens = 64; gen.assistant_prefill = "<think>\n\n</think>\n\n";
    std::string out;
    if (sk_translate_chat(t, msgs, 2, &gen, collect, &out) != SK_OK) {
        std::fprintf(stderr, "chat failed: %s\n", sk_last_error()); return 1;
    }
    std::fprintf(stderr, "chat: %s\n", out.c_str());
    if (out.empty()) return 1;
    if (out.find("<think>") != std::string::npos) { std::fprintf(stderr, "thinking leaked\n"); return 1; }

    CancelCtl ctl;
    sk_status st = sk_translate_chat(t, msgs, 2, &gen, cancel_after_3, &ctl);
    if (st != SK_ERR_CANCELLED) { std::fprintf(stderr, "expected SK_ERR_CANCELLED, got %d\n", st); return 1; }
    if (ctl.seen != 3) { std::fprintf(stderr, "decoded past the cancel: %d\n", ctl.seen); return 1; }

    std::string out2;
    sk_gen_options gen2{}; gen2.max_tokens = 16;
    if (sk_translate_complete(t, "The capital of France is", &gen2, collect, &out2) != SK_OK) {
        std::fprintf(stderr, "complete failed: %s\n", sk_last_error()); return 1;
    }
    std::fprintf(stderr, "complete: %s\n", out2.c_str());
    if (out2.empty()) return 1;

    sk_translate_unload(t);
    std::puts("test_translate ok");
    return 0;
}
```

Register in `native/tests/CMakeLists.txt` following `test_asr`'s block verbatim (SKIP_RETURN_CODE 77, GGML_BACKEND_PATH env). Model for local + CI runs: read `sidecar/sokuji_sidecar/catalog.py`'s `_gguf_artifact` usage on the `qwen3-0.6b` row to derive the exact `org/repo/file` for its default quant, cache it at `~/.cache/sokuji-native-tests/`, and add the same `curl` line + `SK_TEST_TRANSLATE_GGUF` env to `.github/workflows/native-build.yml`'s existing model-cache step (extend the cache key).

- [ ] **Step 2: Header + build wiring; run to see the test fail to LINK, then implement**

Add the contract block to `sokuji_native.h`; add `src/sk_translate.cpp` to `target_sources`; bump `project(sokuji_native VERSION 0.4.0)`; update the `test_common.cpp` version literal (0.3.0→0.4.0 — the established precedent). Implement `sk_translate.cpp` per the notes above.

- [ ] **Step 3: Build and run**

```bash
cmake -S native -B native/build/cpu -DSOKUJI_GPU=none
cmake --build native/build/cpu -j
cmake --install native/build/cpu --prefix native/build/cpu/stage --component sokuji
```
Then a runner script with `SK_TEST_TRANSLATE_GGUF` (+ the two ASR ggufs) running `ctest --test-dir native/build/cpu --output-on-failure`.
Expected: all tests pass, `test_translate` prints a French-ish chat line with no `<think>`.

- [ ] **Step 4: Symbol + docs**

`nm -D --defined-only native/build/cpu/stage/libsokuji_native.so | grep sk_translate` → exactly the four entry points. `native/README.md`: add a "## Translation (slice 3)" section (entry points, statelessness, prefill mechanism, template fallback, CTest model line) and update the layout list.

- [ ] **Step 5: Commit**

`git add -A native .github && git commit -m "feat(native): sk_translate over llama.cpp — greedy chat/complete, token streaming, cancel (0.4.0)"`

---

### Task 2: Python binding — `Translator`

**Files:**
- Modify: `native/python/sokuji_native/_ffi.py`, `native/python/sokuji_native/__init__.py`, `native/python/tests/test_sokuji_native.py`

**Interfaces:**
- Consumes: Task 1's C surface; the binding file's existing patterns (`TEXT_CB` trampoline, `_raise`, keepalive rules, `AsrModel` shape).
- Produces: `translate_load`, `Translator` (contract block above), `__all__` additions.

- [ ] **Step 1: Failing tests**

Append to `native/python/tests/test_sokuji_native.py` (gate like the ASR tests: `TRANSLATE_GGUF = os.environ.get("SK_TEST_TRANSLATE_GGUF")`, `needs_translate = pytest.mark.skipif(not (HAVE_TREE and TRANSLATE_GGUF), reason="needs a built tree and SK_TEST_TRANSLATE_GGUF")`):

```python
@needs_translate
def test_translate_chat_streams_and_suppresses_thinking():
    sokuji_native.init()
    t = sokuji_native.translate_load(TRANSLATE_GGUF, n_ctx=2048)
    pieces = []
    out = t.chat([{"role": "system", "content": "Translate the user's text from English to French. Output only the translation."},
                  {"role": "user", "content": "Good morning."}],
                 max_tokens=64, assistant_prefill="<think>\n\n</think>\n\n",
                 on_token=lambda p: pieces.append(p))
    assert out and "".join(pieces) == out
    assert "<think>" not in out
    t.unload()


@needs_translate
def test_translate_cancel_via_on_token():
    sokuji_native.init()
    t = sokuji_native.translate_load(TRANSLATE_GGUF, n_ctx=2048)
    seen = []
    def stop_after_two(p):
        seen.append(p)
        return len(seen) < 2
    with pytest.raises(sokuji_native.NativeError):
        t.chat([{"role": "user", "content": "Count from one to fifty in words."}],
               max_tokens=256, on_token=stop_after_two)
    assert len(seen) == 2
    # the handle survives a cancelled request
    out = t.complete("The capital of France is", max_tokens=8)
    assert out
    t.unload()


@needs_translate
def test_translate_unload_idempotent_and_del_safe():
    sokuji_native.init()
    t = sokuji_native.translate_load(TRANSLATE_GGUF)
    t.unload()
    t.unload()
```

- [ ] **Step 2: Run red, implement, run green**

`_ffi.py`: `sk_translate_options`/`sk_message`/`sk_gen_options` Structures + the four argtype/restype registrations (mirror the ASR block). `__init__.py`: `Translator` class following `AsrModel`'s conventions — `chat()` builds a `(sk_message * n)` array (encode strings, keep the encoded bytes alive for the call), a `TEXT_CB` trampoline that appends pieces and honors `on_token`'s return (`None` → continue, exactly like `AsrModel.run`'s on_poll comment style — note that an exception inside the callback is swallowed by ctypes into `False` → surfaces as cancelled), `assistant_prefill` encoded or `None`, `unload()` idempotent, `__del__` guarded. Run via the Task 1 runner script pattern (`SOKUJI_NATIVE_DIR` stage + model env). Expected: new tests pass, old ones stay green.

- [ ] **Step 3: Commit**

`git add -A native/python && git commit -m "feat(native/python): Translator binding — chat/complete, token stream, cancel"`

---

### Task 3: Sidecar — `native_translate` backend; delete the llama-server and Opus stacks

**Files:**
- Create: `sidecar/sokuji_sidecar/translate_backend.py`
- Delete: `sidecar/sokuji_sidecar/translate_backends.py`, `sidecar/sokuji_sidecar/llama_runtime.py`, `sidecar/sokuji_sidecar/ct2_opus.py`, `sidecar/tests/test_llama_runtime.py`, `sidecar/tests/test_llama_server_proc.py`, `sidecar/tests/test_ct2_opus.py`
- Modify: `sidecar/sokuji_sidecar/{catalog.py,planner.py,accel.py,native_models.py,translate_engine.py,backends.py,requirements.txt}`, `sidecar/tests/{test_translate_backends.py→test_translate_backend.py,test_translate_engine.py,test_catalog.py,test_native_models.py,test_accel.py,test_planner.py,test_torch_free_gate.py,test_characterization.py}` (the last three: whatever the runs surface)
- Read first: `sidecar/sokuji_sidecar/asr_backend.py` (the load/registry/gguf-resolution pattern to mirror)

**Interfaces:**
- Consumes: `sokuji_native.translate_load` via `sokuji_sidecar.native.module()` (faked in unit tests).
- Produces: backend NAME `native_translate` with `translate(text, system_prompt, src, tgt, wrap, on_partial=None) -> (text, n_tokens)`; `PlanConfig.prompt_family`; catalog rows with `backend="native_translate"`, `prompt_family=<family>`, tiers `("gpu-metal", "gpu-vulkan", "cpu")` (gpu-cuda rows die now — post-A1 no probe ever reports cuda, they were unreachable).

**Design:**
- `translate_backend.py` structure:
  - module docstring + the preserved helpers moved over verbatim: `_default_prompt`, `_clean_output`, `_TRANSCRIPT_TAG`, `_hunyuan_prompt`, `_GEMMA_LANG_CODE`, `_gemma_code`, and Gemma's `_render_prompt` text (unchanged).
  - Three small strategy classes (NOT registered backends): each exposes `build(text, system_prompt, src, tgt, wrap, config) -> ("chat", messages, assistant_prefill) | ("complete", prompt, None)`:
    - `QwenStrategy`: system+user messages exactly as today (`/no_think` appended to the system prompt when `config.append_no_think`); `assistant_prefill = "<think>\n\n</think>\n\n" if config.disable_thinking else None` — the native replacement for llama-server's `chat_template_kwargs.enable_thinking=false` (the legacy template formatter has no jinja kwargs; an empty think block prefill is the same kill-switch at token level).
    - `HunyuanStrategy`: single user message as today; no prefill.
    - `GemmaStrategy`: `("complete", self._render_prompt(...), None)` — bypasses the chat template exactly as the `--no-jinja` + `/completion` path did, same rendered prompt.
  - `STRATEGIES = {"qwen": QwenStrategy(), "hunyuan": HunyuanStrategy(), "gemma": GemmaStrategy()}`.
  - `@register_backend class NativeTranslateBackend`: `NAME = "native_translate"`, `MAX_TOKENS = 512` (Gemma path passes 256 via the strategy? NO — keep it simple: `GemmaStrategy` carries `max_tokens = 256` as a class attr, the others 512; the backend reads it off the chosen strategy).
    - `load(model_ref, device, compute_type, config=None)`: resolve the GGUF like `asr_backend` does (`catalog.split_artifact` + `hf_hub_download(repo, fname, local_files_only=True)`; a plain existing dir/file path passes through); `kind = {"cuda": "vulkan"}.get(device, device)` is NOT done — pass `device` straight to `native.device_for(device)` and let unknown kinds raise `BackendLoadError` (the resolver's fallback contract); CPU when `device == "cpu"`. Store `self._config = config or PlanConfig()` and `self._strategy = STRATEGIES.get(self._config.prompt_family or "qwen")` (unknown family → qwen shape is the safest default; note it in a comment).
    - `translate(text, system_prompt, src, tgt, wrap, on_partial=None)`: build via strategy; count pieces and accumulate; `on_token` closure appends piece, `n[0] += 1`, calls `on_partial(_clean_output(acc))` when given (clean per partial so `<think>`/tags never flash in the UI), returns True; call `self._t.chat(messages, max_tokens=..., assistant_prefill=...)` or `self._t.complete(prompt, ...)`; wrap `sokuji_native` errors into `BackendLoadError`? NO — a generation failure is not a load failure: let it raise; the engine's caller path surfaces it (mirrors today's `_send` raising). Return `(_clean_output(full), n[0])`.
    - Template fallback contingency: catch the specific `NativeError` whose message contains `"chat template not supported"` and, for the qwen/hunyuan strategies, re-issue via a minimal self-rendered chatml prompt (`<|im_start|>role\ncontent<|im_end|>\n...<|im_start|>assistant\n` + prefill). Write it as `_chatml_fallback(messages, prefill)` with a one-line comment that Task 5's live run decides whether it ever fires.
    - `unload()` / `is_loaded` mirror `asr_backend`.
- `planner.py`: `PlanConfig` gains `prompt_family: str = ""`; `_plan_config` reads it via getattr; `_is_llamacpp` → rename `_is_gguf_llm`, test `model.deployments[0].backend == "native_translate"` (update the module docstring list and the `startswith("llamacpp")` platform special-case at ~line 109 to the new name; `_llamacpp_quant`/`_llamacpp_variant_row` keep their names but their docstrings say "GGUF LLM card").
- `catalog.py`: `_llm_translate_row` → `backend = "native_translate"`, tiers `("gpu-metal", "gpu-vulkan", "cpu")`, pass `prompt_family=family` into `TranslateModel`; `TranslateModel` gains `prompt_family: str = ""`; DELETE `_opus_row`, `_opus_repo`, `_opus_disp` and the 13 `_opus_row(...)` entries.
- `accel.py`: `_installed` — replace the four translate entries with `"native_translate": "sokuji_native"`; `resolve_translate` drops the `llama_runtime.set_reserved_bytes` block (keep passing `reserved_bytes` into the planner — it still sizes quant selection).
- `native_models.py`: delete `_needs_llama_binary`, the llama-binary branches in `model_status`/`download`/`delete_model` docs, `_LLAMA_FLAVOR_EST_BYTES`, `OPUS_FILES` and the opus branch of `download_specs`, and every `from . import llama_runtime`.
- `translate_engine.py`: `translate()` gains `on_partial=None` passthrough; `_h_translate` moves generation off the event loop and streams:

```python
async def _h_translate(state, msg, _b, conn=None):
    text = msg.get("text", "")
    loop = asyncio.get_running_loop()
    on_partial = None
    if conn is not None:
        def on_partial(acc):
            # called from the executor thread: hop back to the loop for the send
            asyncio.run_coroutine_threadsafe(
                conn.send({"type": "translate_partial", "text": acc}), loop)
    translated, ms = await loop.run_in_executor(
        None, lambda: state["translate_engine"].translate(
            text, msg.get("systemPrompt", ""), bool(msg.get("wrapTranscript", False)),
            on_partial=on_partial))
    return {"type": "translate_result", "id": msg.get("id"),
            "sourceText": text, "translatedText": translated, "inferenceTimeMs": ms}, None
```
(add `import asyncio` at module top; note in a comment this also stops long generations from stalling the ASR connection — the same defect class the spec fixes for TTS in slice 4). `wire_schema.json` does NOT change in this task (Task 4 adds `translate_partial` together with the TS side) — so in THIS task `on_partial` sends would violate strict mode in tests: therefore Task 3's engine tests drive `on_partial` directly at the engine level and do NOT exercise `_h_translate`'s partial path end-to-end (one test asserts `_h_translate` still returns the right final reply with `conn=None`). Task 4 adds the handler-level test.
- `requirements.txt`: delete the ctranslate2 line + its comment ("Opus-MT translation runtime"). `test_torch_free_gate.py`: add `"ctranslate2"` to BANNED and update its exemption comment (the D3 adoption is over — slice 3 removed the runtime).
- `backends.py`: append `from . import translate_backend  # noqa: E402,F401` beside the asr line (production self-registration — `translate_engine` currently imports `translate_backends`; update that import to the new module name instead, whichever spot keeps a single registration path; prefer the `backends.py` bottom-import pattern and delete `translate_engine`'s import).

- [ ] **Step 1: Rewrite the backend tests (red first)**

Create `sidecar/tests/test_translate_backend.py` (delete `test_translate_backends.py`): keep `test_default_prompt_mentions_langs`, the two `_clean_output` tests verbatim; replace the server-era tests with a fake-native harness:

```python
class _FakeTranslator:
    def __init__(self, log):
        self.log = log
    def chat(self, messages, max_tokens=512, assistant_prefill=None, on_token=None):
        self.log.append(("chat", messages, max_tokens, assistant_prefill))
        for p in ("Bon", "jour", "."):
            if on_token is not None:
                on_token(p)
        return "Bonjour."
    def complete(self, prompt, max_tokens=512, on_token=None):
        self.log.append(("complete", prompt, max_tokens))
        if on_token is not None:
            on_token("Oui.")
        return "Oui."
    def unload(self):
        self.log.append(("unload",))


@pytest.fixture
def native_env(monkeypatch, tmp_path):
    from sokuji_sidecar import native
    log = []
    gguf = tmp_path / "w.gguf"
    gguf.write_bytes(b"GGUF")
    mod = types.SimpleNamespace(translate_load=lambda path, device=None, n_ctx=0:
                                (log.append(("load", path)) or _FakeTranslator(log)))
    monkeypatch.setattr(native, "module", lambda: mod)
    monkeypatch.setattr(native, "device_for", lambda kind: None if kind in ("cpu", "vulkan", "metal")
                        else (_ for _ in ()).throw(backends.BackendLoadError(f"no {kind} device")))
    return str(gguf), log
```

then per family (write each out in full):
- qwen plain: `load(gguf, "cpu", "q8_0", config=PlanConfig(prompt_family="qwen"))`, translate with wrap → chat messages: system contains "You are a translator", no "/no_think"; user == `<transcript>hello</transcript>`; `assistant_prefill is None`; returns `("Bonjour.", 3)`.
- qwen3 (`disable_thinking=True, append_no_think=True`): "/no_think" in system AND `assistant_prefill == "<think>\n\n</think>\n\n"`.
- qwen3.5 (`disable_thinking=True` only): no "/no_think", prefill set.
- hunyuan: single user message, "into English" + transcript tags in it, no prefill.
- gemma: `("complete", prompt, 256)` logged; `<start_of_turn>user` and `(en)`/`(ja)` in the prompt; the falsy-src regression test kept against `GemmaStrategy()._render_prompt`.
- streaming: `on_partial` collects `["Bon", "Bonjour", "Bonjour."]`-shaped cumulative CLEANED text (exact expected list: `["Bon", "Bonjour", "Bonjour."]`).
- device fallback: `load(..., "cuda", ...)` raises `BackendLoadError` (device_for contract).
- unknown template fallback: fake `chat` raising `native.module()`-style error with "chat template not supported" → backend retries via `_chatml_fallback`, log shows a `complete` call whose prompt contains `<|im_start|>user`.
- registry: `backends.make_backend("native_translate")` works; `make_backend("llamacpp_qwen")` now raises.

- [ ] **Step 2: Run red**

`PYTHONPATH=$PWD/sidecar .../python -m pytest sidecar/tests/test_translate_backend.py -q` → import errors/failures.

- [ ] **Step 3: Implement everything in the Files list; delete the dead modules/tests**

- [ ] **Step 4: Update the neighbor tests and run the full suite**

- `test_translate_engine.py`: FakeTranslate/resolved fixtures switch `"llamacpp_qwen"` → `"native_translate"`; add an engine-level streaming test (fake backend that calls `on_partial` twice; assert the engine passes it through) and a `_h_translate` final-reply test with `conn=None`. The reserve/ledger tests are unaffected.
- `test_catalog.py`: `test_opus_rows_cpu_only` and opus `split_artifact` assertion deleted; `test_llm_translate_rows_shape`/`test_all_translate_backends_installed_names`/tier assertions follow the rename and the 3-tier tuple; translate row count is now 9 wherever asserted.
- `test_native_models.py`: opus download-spec tests deleted; the two llama-binary monkeypatch blocks (~lines 301-320, 406-420) drop their `rt.binary_path` lines.
- `test_accel.py`: `_installed` frozensets in fixtures use `native_translate`; `_catalog_reply`'s set likewise.
- `test_planner.py` + `test_characterization.py` + `test_platform_filter.py`: run and follow the failures (renames only — no behavioral drift beyond the cuda-tier removal; characterization snapshots re-record by name substitution, the slice-2 precedent).
Full suite: `PYTHONPATH=$PWD/sidecar .../python -m pytest sidecar/tests -q` → green minus the 4 baseline failures.

- [ ] **Step 5: Commit**

`git add -A sidecar && git commit -m "feat(sidecar): native_translate over sk_translate; delete llama-server + Opus/CTranslate2 stacks"`

---

### Task 4: Wire + renderer — `translate_partial` streaming end to end

**Files:**
- Modify: `sidecar/sokuji_sidecar/wire_schema.json`, `sidecar/tests/test_wire.py` (count assertion 18→19), `sidecar/tests/test_translate_engine.py` (handler-level partial test), `src/lib/local-inference/native/nativeProtocol.ts`, `src/lib/local-inference/native/NativeTranslateClient.ts` (+ its test), `src/services/clients/LocalNativeClient.ts` (+ its test)

**Interfaces:**
- Consumes: Task 3's `_h_translate` (already sends `translate_partial` when a conn is present).
- Produces: schema entry `"translate_partial": {"required": ["text"], "optional": []}`; TS `TranslatePartialMsg { type: 'translate_partial'; text: string; }` in `ServerMsg`; `NativeTranslateClient.onPartial: ((text: string) => void) | null` (routed from the id-less push); LocalNativeClient live-updating assistant bubble.

**Renderer design (LocalNativeClient.runJob):** keep item creation lazy — on the FIRST partial, create the assistant item (`status: 'in_progress'`, `formatted.transcript = partialText`), push+emit it; on later partials update `item.formatted.transcript` and `this.emit(item, { transcript: text })`; when `translate.translate()` resolves, reuse the streamed item if one exists (update transcript to the final text) or create it as today (no partial ever arrived — e.g. a fake in tests), then proceed with the existing TTS flow unchanged. On translate rejection with a streamed item already emitted: set `item.status = 'completed'` with the last partial text and still return (comment: a half-streamed bubble beats a vanishing one) — and keep today's error surfacing. Wire `this.translate.onPartial` once in `connect()` next to `onError`, guarded by a `currentTranslateItem` field that `runJob` sets/clears (the queue serialises jobs, so one field suffices).

- [ ] **Step 1: Tests red** — `NativeTranslateClient.test.ts`: emitting `{ type: 'translate_partial', text: 'Bon' }` fires `onPartial('Bon')`; `LocalNativeClient.test.ts`: drive a fake translate whose `translate()` emits two partials (via the client's `onPartial`) before resolving; assert two `conversation.updated` emissions with growing transcripts and a final completed item whose transcript is the resolved text; `test_wire.py` example list gains `wire.validate_outbound({"type": "translate_partial", "text": "hi"})`; `test_translate_engine.py` handler test: a Fake conn captures sends; fake engine calls `on_partial("Bon")`; assert the push `{"type": "translate_partial", "text": "Bon"}` arrived before the reply (drive `_h_translate` with `asyncio.run`).
- [ ] **Step 2: Implement both sides** (schema+TS in this one task — the consistency test is bidirectional).
- [ ] **Step 3: Run** — `npx vitest run src/lib/local-inference/native src/services/clients/LocalNativeClient.test.ts` (consistency test included) and `PYTHONPATH=$PWD/sidecar .../python -m pytest sidecar/tests/test_wire.py sidecar/tests/test_translate_engine.py -q`; `npx tsc --noEmit` → no new errors in touched files.
- [ ] **Step 4: Commit** — `git add -A src sidecar && git commit -m "feat(protocol): translate_partial token streaming to the renderer"`

---

### Task 5: Sweep, wheel, live gates

**Files:**
- Modify: `src/lib/local-inference/native/nativeCatalog.ts` (+ test fixtures that name llamacpp/opus backends: `nativeCatalog.test.ts`, `NativeModelManagementSection.test.tsx`, `nativeModelStore.test.ts`, `NativeTranslateClient.test.ts` — whatever the runs surface), plus anything the sweep finds

**Steps:**

- [ ] **Step 1: Renderer sweep** — `nativeCatalog.ts`: the three `llamacpp_*: 'llama.cpp'` map entries collapse to `native_translate: 'llama.cpp'`; the `startsWith('llamacpp_')` echo branch goes. `grep -rn "llamacpp\|ct2_opus\|opus-mt" src/` → every remaining hit updated or justified (locale strings naming Opus models, if any, are removed with their rows). Targeted vitest on the touched files.
- [ ] **Step 2: Repo sweep** — `grep -rn "llama_runtime\|llama-server\|llamacpp\|ct2_opus\|ctranslate2\|OPUS_FILES" sidecar src electron .github --include="*.py" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.yml" --include="*.txt"` → zero code hits (historical docs/specs excluded).
- [ ] **Step 3: Rebuild the wheel and reinstall**

```bash
bash native/ci/build.sh none manylinux_2_39_aarch64
/home/jiangzhuo/Desktop/kizunaai/sokuji/sidecar/.venv/bin/pip install --force-reinstall native/python/dist/sokuji_native-0.4.0-py3-none-manylinux_2_39_aarch64.whl
```
(build.sh needs `PYTHON=/home/jiangzhuo/Desktop/kizunaai/sokuji/sidecar/.venv/bin/python` on this PEP-668 box — use a runner script.) Then the full sidecar suite again.

- [ ] **Step 4: Live gate — one sentence per prompt family (spec rollout row 3)**

Rewrite `test_real_llm_translates` (in `test_translate_engine.py`) to the native era: parametrize over `("qwen3-0.6b", "hy-mt2-1.8b", "translategemma-4b")`, `SOKUJI_RUN_TRANSLATE_MODEL=1`-gated, engine.init(model_id=..., source_lang="Spanish", target_lang="English") + translate("Hola, ¿cómo estás?") → non-empty, no "<think>". Run it on this machine (runner script; models download on first run — qwen ≈ 0.6 GB, hy ≈ 1 GB, gemma ≈ 2.5 GB; Vulkan lane wheel not required — CPU is fine for one sentence each, `device="auto"` takes whatever the 0.4.0 CPU wheel offers). THIS is where the Hunyuan/Qwen template question gets its live answer — if the legacy formatter rejects either template and the `_chatml_fallback` path fires (or output is garbage), STOP and report the exact behavior to the controller before hand-tuning prompts.
Also re-run: native ctest (now 4 tests incl. translate), native python tests, targeted vitest, `npx tsc --noEmit` baseline (534), and the ASR offline loopback (`SOKUJI_RUN_ASR_MODEL=1 -k real_engine`) to prove slice-2 surfaces survived.

- [ ] **Step 5: Docs + commit**

`native/README.md` already updated in Task 1; check `CLAUDE.md`'s native-runtime bullet needs no change (it names all three engines generically). Commit: `git add -A && git commit -m "chore(slice3): renderer sweep, 0.4.0 wheel, live translate gates"`
