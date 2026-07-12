# Native ASR: Qwen3-ASR-1.7B (native transformers) Design

## Context

Adds **Qwen3-ASR-1.7B** as a GPU ASR model in the LOCAL_NATIVE sidecar, for SOTA accuracy (esp. CJK + context biasing). Chosen from the `speech-llm-asr-backends` research.

**This design supersedes the earlier qwen-asr-package approach** (`docs/superpowers/plans/2026-06-23-native-asr-qwen3.md`). A deep runtime investigation (see memory `project_qwen3_asr_runtime_decision`) ruled out the `qwen-asr` pip package (hard-pins `transformers==4.57.6`, which breaks Granite; its 5.x community port has degraded accuracy) and the heavyweight vLLM/isolation paths. The chosen path is **native HuggingFace transformers** support via PR #43838, which adds the `qwen3_asr` model to transformers mainline.

**Validated on 2026-06-23** (reversible main-venv spike against the PR branch, transformers 5.13.0.dev0): native `Qwen3ASRForConditionalGeneration` + `AutoProcessor` (checkpoint `bezzam/Qwen3-ASR-1.7B`) runs on the RTX 4070 at **bf16, RTF ~0.04 (~25× realtime), ~5 GB VRAM**, correct zh/en/ja; and **Granite still loads/runs on the same transformers** (so upgrading transformers will not break Granite). Both coexist in one venv — no isolation.

PR #43838 is not yet merged (community author, HF audio maintainers reviewing, all COMMENTED; est. merge ~3–8 weeks → ships in transformers ~5.13.x). So we build in **two phases**.

## Strategy: build plumbing now (self-gated), flip on at release

- **Phase 1 (now, transformers 5.12.1):** build the whole increment — backend class, catalog row, download mapping, renderer row — but **self-gated off** by a runtime feature check, so it never shows a broken model. All testable now (mocked backend tests). No interim sherpa path.
- **Phase 2 (when transformers ~5.13.x ships with qwen3_asr, a separate small increment):** upgrade the sidecar transformers, re-validate Granite + the full suite, un-skip the real GPU smoke, finalize the output quirks against the released API, mark recommended. The gate then lights the model up automatically.

## Locked decisions

- **Native transformers path** (`Qwen3ASRForConditionalGeneration`), checkpoint **`bezzam/Qwen3-ASR-1.7B`** (HF-format conversion; revisit to an official `Qwen/...-hf` if one lands by Phase 2). GPU-only, bf16.
- **Self-gating:** the `qwen3asr` deployment is reported *available* only when `importlib.util.find_spec("transformers.models.qwen3_asr")` is truthy. On transformers 5.12.1 → unavailable → the renderer hides it (no broken/greyed card). On 5.13.x → available.
- `recommended=False` in Phase 1 (it can't run yet); flip to `True` in Phase 2.
- Language: explicit source language when set (mapped), else auto-detect.

## Components

### 1. `Qwen3AsrBackend` — `sidecar/sokuji_sidecar/backends.py`

New backend mirroring the Granite `TransformersBackend`, using the native classes + the three validated quirks. `NAME = "qwen3asr"`, GPU-only.

```python
_QWEN_PROMPT = "Transcribe the audio."
# Strip the model's structured prefix, e.g. "language Chinese<asr_text>...".
def _strip_qwen_prefix(text):
    return text.split("<asr_text>", 1)[1].strip() if "<asr_text>" in text else text.strip()

@register_backend
class Qwen3AsrBackend:
    NAME = "qwen3asr"
    def load(self, model_ref, device, compute_type):
        if device == "cpu":
            raise BackendLoadError("qwen3asr is GPU-only")
        try:
            import torch
            from transformers import Qwen3ASRForConditionalGeneration, AutoProcessor
            self._dtype = torch.bfloat16 if compute_type in ("bfloat16","auto") else torch.float16
            self._proc = AutoProcessor.from_pretrained(model_ref)
            self._model = Qwen3ASRForConditionalGeneration.from_pretrained(
                model_ref, dtype=self._dtype, device_map=device).eval()
            self._device = device
        except Exception as e:
            raise BackendLoadError(str(e))
    def transcribe(self, samples, language):
        import torch
        conv = [{"role":"user","content":[{"type":"audio"},{"type":"text","text":_QWEN_PROMPT}]}]
        text = self._proc.apply_chat_template(conv, tokenize=False, add_generation_prompt=True)
        inp = self._proc(text=text, audio=samples, sampling_rate=TARGET_RATE, return_tensors="pt").to(self._device)
        if "input_features" in inp:                       # quirk: features come out float32
            inp["input_features"] = inp["input_features"].to(self._dtype)
        with torch.inference_mode():
            out = self._model.generate(**inp, max_new_tokens=256, do_sample=False)
        decoded = self._proc.batch_decode(out[:, inp["input_ids"].shape[-1]:], skip_special_tokens=True)[0]
        return AsrResult(_strip_qwen_prefix(decoded), language)
    def unload(self):
        self._model = None; self._proc = None
        try: import torch; torch.cuda.empty_cache()
        except Exception: pass
```

Quirks (all validated in the spike): (a) cast `input_features` to the model dtype before `generate`; (b) strip the `language <X><asr_text>` prefix; (c) zh defaults to Traditional — acceptable for Phase 1; Phase 2 may steer via the prompt/context.

### 2. Availability gate — `sidecar/sokuji_sidecar/accel.py`

Where tier availability is computed, a `gpu-cuda` deployment whose backend is `qwen3asr` additionally requires the runtime feature:

```python
import importlib.util
def _qwen3asr_runtime_ok():
    return importlib.util.find_spec("transformers.models.qwen3_asr") is not None
```

Fold this into the per-deployment availability check so a `qwen3asr` deployment is unavailable when the module is absent (transformers 5.12.1) and available when present (5.13.x). This is what makes Phase 1 safe to ship.

### 3. Catalog row — `sidecar/sokuji_sidecar/catalog.py`

```python
AsrModel("qwen3-asr-1.7b", "Qwen3-ASR 1.7B",
         ("zh","en","ja","ko","yue","ar","de","es","fr","it","pt","ru","th","vi","hi","id"),
         (Deployment("qwen3asr", "gpu-cuda", "bfloat16", "bezzam/Qwen3-ASR-1.7B", 1.0),),
         recommended=False, sort_order=7),   # recommended flips True in Phase 2
```

Add `"qwen3asr"` to `test_catalog.py`'s allowed-backend set + a frozen-language fixture.

### 4. Download mapping — `sidecar/sokuji_sidecar/native_models.py`

Explicit branch before the bare-id fallthrough (the Granite silent-`ready` lesson):

```python
if model_id == "qwen3-asr-1.7b":
    return {"repos": ["bezzam/Qwen3-ASR-1.7B"], "urls": []}
```

### 5. Renderer — `src/lib/local-inference/native/nativeCatalog.ts` + the management section

Add the `NATIVE_ASR` row `{ id:'qwen3-asr-1.7b', label:'Qwen3-ASR 1.7B', languages:[…16…], sortOrder:7 }` (languages verbatim == the sidecar tuple). The renderer already hides/greys a model whose sidecar catalog reports no available tier (`hardwareGated`) — so the self-gate (Component 2) hides it until transformers supports it. Confirm the gated row does not appear as a usable card on 5.12.1.

## Testing

- **pytest (mocked, runs on 5.12.1):** `Qwen3AsrBackend` GPU-only hard-fail (device=cpu → BackendLoadError); load+transcribe with `transformers.Qwen3ASRForConditionalGeneration`/`AutoProcessor` mocked (assert the prefix-strip + the bf16 `input_features` cast + the decoded text); `_strip_qwen_prefix` unit; the availability gate (`qwen3asr` deployment unavailable when `qwen3_asr` module absent — monkeypatch `find_spec`); catalog row + frozen languages; `download_specs("qwen3-asr-1.7b") == bezzam/Qwen3-ASR-1.7B`.
- **renderer vitest:** the row + languages-match; the gated card is hidden when the sidecar reports no tier.
- **build:** `npm run build`.
- **DEFERRED to Phase 2 (real, gated `SOKUJI_RUN_GPU` + transformers 5.13.x):** download `bezzam/Qwen3-ASR-1.7B`, load on cuda bf16, transcribe + RTF, assert accuracy; plus re-run the full sidecar suite on 5.13.x and the Granite GPU smoke.

## Global constraints

- vitest / pytest gates (not tsc). GPU-only deployment. English-only comments. Conventional Commits. No push/PR without consent.
- Phase-1 backend must `BackendLoadError` (not crash) when `qwen3_asr` is absent; the availability gate keeps the model hidden so users never hit it.
- Renderer languages array == sidecar tuple verbatim.
- Reuse the Granite `TransformersBackend` pattern (lazy import, `BackendLoadError`, `@register_backend`).

## Phase 2 release trigger

PR #43838 merges → transformers ~5.13.x release. **Monitor weekly:** `gh pr view 43838 --repo huggingface/transformers --json merged,state`. On release: bump the sidecar transformers, re-validate Granite + suite, un-skip the GPU smoke, set `recommended=True`, finalize quirks.

## Non-goals / deferred

- sherpa-onnx / llama.cpp / vLLM runtimes (the native path won; sherpa-0.6B-CPU is documented in memory as a fallback only if the PR stalls past launch).
- Context-bias / hotword UI.
- The transformers upgrade itself (Phase 2).

## Risks

- **[MED] PR #43838 API may shift before merge** — the Phase-1 backend is written against the current branch; Phase 2 finalizes it against the release. Low blast radius (one class).
- **[MED] transformers 5.13.x ⇄ Granite** — validated on 5.13.0.dev0 today; re-confirm on the actual release in Phase 2.
- **[LOW] zh Traditional-script default** — steer via prompt/context in Phase 2 if needed.
- **[LOW] checkpoint** — `bezzam/Qwen3-ASR-1.7B` is a contributor conversion; swap to an official `-hf` repo if one ships by Phase 2.
