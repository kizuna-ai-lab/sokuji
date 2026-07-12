# Native Python Sidecar — Phase 2a (Translation backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a native **translation** stage to the Python sidecar — an LLM translator hosted in-process, driven by the renderer over the existing WebSocket as request/response — proving the second per-stage backend reuses Phase 1's transport with no new protocol machinery.

**Architecture:** Extends the Phase 1 sidecar. A new `TranslateEngine` (lazy-loads `transformers`) is registered alongside the Pocket TTS engine under distinct WS message types (`translate_init` / `translate`). The renderer gets a `NativeTranslateClient` mirroring the `TranslationEngine` request/response surface, and the dev proto gains a translate panel. `NativeHostManager`, the WS server, and the IPC/preload whitelist from Phase 1 are reused unchanged.

**Tech Stack:** Python 3.11 (3.10 acceptable for dev) + `transformers` + `torch` (CPU) + `huggingface_hub` (sidecar); TypeScript + native `WebSocket` (renderer); pytest / vitest.

## Global Constraints

- **Electron-only**; reuse Phase 1's `isElectron()`/`window.electron` gating.
- **Translation contract** matches `TranslationEngine`: `translate(text, systemPrompt, wrapTranscript) → { sourceText, translatedText, inferenceTimeMs }` (see `src/lib/local-inference/engine/TranslationEngine.ts:12`). Request/response, id-correlated — no binary frames.
- **First target model: an LLM translator** (these carry ~all usage per PostHog — translategemma-4b/qwen3-0.6b/hy-mt15 dominate; the opus-mt pairs are marginal). Default model id `Qwen/Qwen2.5-0.5B-Instruct`-class via chat-template translate prompt; the engine is model-id-parameterised. **opus-mt (onnxruntime seq2seq, torch-free) is a deferred follow-up**, not this plan.
- **Runtime libraries**: translation LLMs run via `transformers` (PyTorch CPU), per the spec's per-stage table. Import `transformers`/`torch` **lazily inside `TranslateEngine.init()`** so the module imports (and fake-engine unit tests run) without the heavy deps installed.
- **Model hosting**: `huggingface_hub` native cache; `HF_HOME` already set by `NativeHostManager` (Phase 1).
- **WS message namespacing**: translation uses `translate_init` / `translate` (no collision with Pocket's `init` / `set_voice` / `generate`). Both engines share one `state`, keyed `state["engine"]` (Pocket) and `state["translate_engine"]`.
- **tsc not clean repo-wide** — gate on vitest/pytest, not tsc.

---

## File Structure

- Create: `sidecar/sokuji_sidecar/translate_engine.py` — LLM translator + WS handlers.
- Modify: `sidecar/sokuji_sidecar/__main__.py` — register the translate engine alongside Pocket.
- Create: `sidecar/tests/test_translate_engine.py` — fake-engine WS tests + model-gated real test.
- Create: `src/lib/local-inference/native/NativeTranslateClient.ts` — renderer WS client.
- Modify: `src/lib/local-inference/native/nativeProtocol.ts` — add translation message types.
- Create: `src/lib/local-inference/native/NativeTranslateClient.test.ts` — vitest.
- Modify: `src/components/dev/NativeTtsProto.tsx` — add a translate panel exercising the client.

---

## Task 1: Sidecar translate engine + WS handlers

**Files:**
- Create: `sidecar/sokuji_sidecar/translate_engine.py`
- Modify: `sidecar/sokuji_sidecar/__main__.py`
- Test: `sidecar/tests/test_translate_engine.py`

**Interfaces:**
- Consumes: nothing from Phase 1 except `server.handle_message` dispatch + `state["handlers"]` convention.
- Produces: WS — `{"type":"translate_init","id","model"?,"sourceLang","targetLang"}` → `{"type":"ready","id","loadTimeMs"}`; `{"type":"translate","id","text","systemPrompt"?,"wrapTranscript"?}` → `{"type":"translation","id","sourceText","translatedText","inferenceTimeMs"}`. Python: `class TranslateEngine` with `init(model_id, source_lang, target_lang) -> int`, `translate(text, system_prompt="", wrap_transcript=False) -> tuple[str,int]`, and `register(state)`.

- [ ] **Step 1: Write the failing test** `sidecar/tests/test_translate_engine.py` (fake engine — no torch needed):

```python
import asyncio, json
from sokuji_sidecar import server, translate_engine


class FakeTranslate:
    def init(self, model_id=None, source_lang="", target_lang=""):
        self.langs = (source_lang, target_lang)
        return 21

    def translate(self, text, system_prompt="", wrap_transcript=False):
        return f"<{text}>", 8


def make_state():
    st = {"translate_engine": FakeTranslate(), "handlers": {}}
    translate_engine.register(st)
    return st


def test_translate_init():
    st = make_state()
    reply, _ = asyncio.run(server.handle_message(
        st, json.dumps({"type": "translate_init", "id": 1, "sourceLang": "ja", "targetLang": "en"})))
    assert reply == {"type": "ready", "id": 1, "loadTimeMs": 21}
    assert st["translate_engine"].langs == ("ja", "en")


def test_translate_returns_translation():
    st = make_state()
    reply, binary = asyncio.run(server.handle_message(
        st, json.dumps({"type": "translate", "id": 2, "text": "hola"})))
    assert binary is None
    assert reply == {"type": "translation", "id": 2,
                     "sourceText": "hola", "translatedText": "<hola>", "inferenceTimeMs": 8}
```

- [ ] **Step 2: Run it, expect failure.** Run: `cd sidecar && .venv/bin/python -m pytest tests/test_translate_engine.py -q`. Expected: FAIL (`translate_engine` missing).

- [ ] **Step 3: Implement `translate_engine.py`** (transformers imported lazily inside `init`):

```python
import time


class TranslateEngine:
    def __init__(self):
        self._tok = None
        self._model = None
        self._src = ""
        self._tgt = ""

    def init(self, model_id=None, source_lang="", target_lang=""):
        import os
        from transformers import AutoModelForCausalLM, AutoTokenizer  # lazy: torch pulled here
        t0 = time.time()
        mid = model_id or os.environ.get("SOKUJI_TRANSLATE_MODEL", "Qwen/Qwen2.5-0.5B-Instruct")
        self._tok = AutoTokenizer.from_pretrained(mid)
        self._model = AutoModelForCausalLM.from_pretrained(mid, torch_dtype="auto")
        self._src, self._tgt = source_lang, target_lang
        return int((time.time() - t0) * 1000)

    def translate(self, text, system_prompt="", wrap_transcript=False):
        t0 = time.time()
        sys_prompt = system_prompt or (
            f"Translate the following text from {self._src} to {self._tgt}. "
            "Output only the translation, no explanations.")
        messages = [{"role": "system", "content": sys_prompt},
                    {"role": "user", "content": text}]
        prompt = self._tok.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        inputs = self._tok(prompt, return_tensors="pt")
        out = self._model.generate(**inputs, max_new_tokens=512, do_sample=False)
        gen = out[0][inputs["input_ids"].shape[1]:]
        translated = self._tok.decode(gen, skip_special_tokens=True).strip()
        return translated, int((time.time() - t0) * 1000)


async def _h_translate_init(state, msg, _b):
    ms = state["translate_engine"].init(
        msg.get("model"), msg.get("sourceLang", ""), msg.get("targetLang", ""))
    return {"type": "ready", "id": msg.get("id"), "loadTimeMs": ms}, None


async def _h_translate(state, msg, _b):
    text = msg.get("text", "")
    translated, ms = state["translate_engine"].translate(
        text, msg.get("systemPrompt", ""), bool(msg.get("wrapTranscript", False)))
    return {"type": "translation", "id": msg.get("id"),
            "sourceText": text, "translatedText": translated, "inferenceTimeMs": ms}, None


def register(state: dict):
    state.setdefault("handlers", {}).update(
        {"translate_init": _h_translate_init, "translate": _h_translate})
```

- [ ] **Step 4: Register both engines in `__main__.py`** — replace `_run`:

```python
async def _run():
    from .pocket_engine import PocketEngine, register as register_pocket
    from .translate_engine import TranslateEngine, register as register_translate
    state = {"engine": PocketEngine(), "translate_engine": TranslateEngine()}
    register_pocket(state)
    register_translate(state)
    port, server = await serve(state)
    print(json.dumps({"port": port}), flush=True)
    await server.wait_closed()
```

- [ ] **Step 5: Run tests, expect pass.** Run: `cd sidecar && .venv/bin/python -m pytest tests/test_translate_engine.py -q`. Expected: 2 passed.

- [ ] **Step 6: Add a model-gated real test** appended to `tests/test_translate_engine.py`:

```python
import os, pytest

@pytest.mark.skipif(not os.environ.get("SOKUJI_RUN_TRANSLATE_MODEL"),
                    reason="set SOKUJI_RUN_TRANSLATE_MODEL=1 (downloads ~1GB + needs torch)")
def test_real_llm_translates():
    eng = translate_engine.TranslateEngine()
    eng.init(source_lang="Spanish", target_lang="English")
    out, ms = eng.translate("Hola, ¿cómo estás?")
    assert isinstance(out, str) and len(out) > 0 and ms >= 0
```

- [ ] **Step 7: (optional, env-permitting) run the real test.** Run: `cd sidecar && .venv/bin/pip install transformers torch --index-url https://download.pytorch.org/whl/cpu && SOKUJI_RUN_TRANSLATE_MODEL=1 .venv/bin/python -m pytest tests/test_translate_engine.py -q`. Expected: the model-gated test passes (English output). Skip if the env can't fetch torch/model.

- [ ] **Step 8: Commit.**

```bash
git add sidecar/sokuji_sidecar/translate_engine.py sidecar/sokuji_sidecar/__main__.py sidecar/tests/test_translate_engine.py
git commit -m "feat(sidecar): native LLM translation engine + WS translate handlers"
```

---

## Task 2: Renderer NativeTranslateClient

**Files:**
- Create: `src/lib/local-inference/native/NativeTranslateClient.ts`
- Modify: `src/lib/local-inference/native/nativeProtocol.ts`
- Test: `src/lib/local-inference/native/NativeTranslateClient.test.ts`

**Interfaces:**
- Consumes: `window.electron.invoke('native-host:start')` → `{ok, port}`; the `translate_init`/`translate` WS contract; `TranslationResult` from `../engine/TranslationEngine`.
- Produces: `class NativeTranslateClient` with `onStatus`/`onError`, `async init(sourceLang, targetLang, modelId?) : Promise<{ loadTimeMs }>`, `async translate(text, systemPrompt?, wrapTranscript?) : Promise<TranslationResult>`, `dispose()`.

- [ ] **Step 1: Write the failing test** `src/lib/local-inference/native/NativeTranslateClient.test.ts`:

```typescript
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NativeTranslateClient } from './NativeTranslateClient';

class FakeWS {
  static last: FakeWS;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: any }) => void) | null = null;
  onerror: (() => void) | null = null;
  binaryType = 'arraybuffer';
  constructor(public url: string) { FakeWS.last = this; setTimeout(() => this.onopen?.(), 0); }
  send(d: any) {
    const msg = JSON.parse(d);
    if (msg.type === 'translate_init') queueMicrotask(() =>
      this.onmessage?.({ data: JSON.stringify({ type: 'ready', id: msg.id, loadTimeMs: 3 }) }));
    if (msg.type === 'translate') queueMicrotask(() =>
      this.onmessage?.({ data: JSON.stringify({
        type: 'translation', id: msg.id, sourceText: msg.text,
        translatedText: msg.text.toUpperCase(), inferenceTimeMs: 4 }) }));
  }
  close() {}
}

beforeEach(() => {
  (globalThis as any).WebSocket = FakeWS as any;
  (globalThis as any).window = { electron: { invoke: vi.fn().mockResolvedValue({ ok: true, port: 9 }) } };
});

describe('NativeTranslateClient', () => {
  it('inits with langs and translates', async () => {
    const c = new NativeTranslateClient();
    const r = await c.init('es', 'en');
    expect(r).toEqual({ loadTimeMs: 3 });
    const res = await c.translate('hola');
    expect(res).toEqual({ sourceText: 'hola', translatedText: 'HOLA', inferenceTimeMs: 4 });
  });
});
```

- [ ] **Step 2: Run it, expect failure.** Run: `npx vitest run src/lib/local-inference/native/NativeTranslateClient.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 3: Extend `nativeProtocol.ts`** — append:

```typescript
export interface TranslationMsg { type: 'translation'; id: number; sourceText: string; translatedText: string; inferenceTimeMs: number; }
```

and add `| TranslationMsg` to the `ServerMsg` union.

- [ ] **Step 4: Implement `NativeTranslateClient.ts`** (request/response over WS; shares the connect/send idiom with `NativeTtsClient`, no binary path):

```typescript
import type { TranslationResult } from '../engine/TranslationEngine';
import type { ServerMsg } from './nativeProtocol';

interface ElectronInvoke { invoke(channel: string, data?: unknown): Promise<any>; }
function electron(): ElectronInvoke {
  const e = (window as unknown as { electron?: ElectronInvoke }).electron;
  if (!e) throw new Error('window.electron is unavailable (not running in Electron)');
  return e;
}

export class NativeTranslateClient {
  onStatus: ((m: string) => void) | null = null;
  onError: ((e: string) => void) | null = null;
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, (m: ServerMsg) => void>();

  private async connect(): Promise<void> {
    if (this.ws) return;
    const r = await electron().invoke('native-host:start');
    if (!r?.ok) throw new Error(r?.error || 'failed to start native host');
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${r.port}`);
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => { this.ws = ws; resolve(); };
      ws.onerror = () => { this.onError?.('native host WS error'); reject(new Error('WS error')); };
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data) as ServerMsg;
        if (msg.type === 'error') { this.onError?.(msg.message); if (msg.id) this.pending.delete(msg.id); return; }
        const id = (msg as any).id as number;
        this.pending.get(id)?.(msg);
        this.pending.delete(id);
      };
    });
  }

  private send(payload: object): Promise<ServerMsg> {
    const id = this.nextId++;
    return new Promise((resolve) => { this.pending.set(id, resolve); this.ws!.send(JSON.stringify({ ...payload, id })); });
  }

  async init(sourceLang: string, targetLang: string, modelId?: string): Promise<{ loadTimeMs: number }> {
    await this.connect();
    this.onStatus?.('[native-translate] init…');
    const msg = await this.send({ type: 'translate_init', sourceLang, targetLang, model: modelId });
    return { loadTimeMs: (msg as Extract<ServerMsg, { type: 'ready' }>).loadTimeMs };
  }

  async translate(text: string, systemPrompt = '', wrapTranscript = false): Promise<TranslationResult> {
    const msg = await this.send({ type: 'translate', text, systemPrompt, wrapTranscript }) as Extract<ServerMsg, { type: 'translation' }>;
    return { sourceText: msg.sourceText, translatedText: msg.translatedText, inferenceTimeMs: msg.inferenceTimeMs };
  }

  dispose(): void { try { this.ws?.close(); } catch (_) {} this.ws = null; this.pending.clear(); }
}
```

- [ ] **Step 5: Run tests, expect pass.** Run: `npx vitest run src/lib/local-inference/native/NativeTranslateClient.test.ts`. Expected: 1 passed.

- [ ] **Step 6: Commit.**

```bash
git add src/lib/local-inference/native/NativeTranslateClient.ts src/lib/local-inference/native/nativeProtocol.ts src/lib/local-inference/native/NativeTranslateClient.test.ts
git commit -m "feat(renderer): NativeTranslateClient WS client + translation protocol"
```

---

## Task 3: Dev proto — translate panel

**Files:**
- Modify: `src/components/dev/NativeTtsProto.tsx`
- Test: manual (dev).

**Interfaces:**
- Consumes: `NativeTranslateClient`.
- Produces: a translate input + button in the existing proto overlay that logs the round-trip.

- [ ] **Step 1: Add a translate panel** to `NativeTtsProto.tsx` — add a second client ref and handler:

```tsx
// add near the existing imports:
import { NativeTranslateClient } from '../../lib/local-inference/native/NativeTranslateClient';

// inside the component, alongside the tts client ref:
  const tclient = useRef<NativeTranslateClient | null>(null);
  const [srcText, setSrcText] = useState('Hola, ¿cómo estás?');

  const onTranslate = async () => {
    if (!tclient.current) {
      tclient.current = new NativeTranslateClient();
      tclient.current.onStatus = push;
      tclient.current.onError = (e) => push('ERROR: ' + e);
      const r = await tclient.current.init('Spanish', 'English');
      push(`translate ready loadMs=${r.loadTimeMs}`);
    }
    const res = await tclient.current.translate(srcText);
    push(`translated: "${res.translatedText}" (${res.inferenceTimeMs}ms)`);
  };
```

and in the JSX, before the closing `</div>`:

```tsx
      <hr style={{ margin: '16px 0', borderColor: '#444' }} />
      <h4>Translate</h4>
      <textarea value={srcText} onChange={(e) => setSrcText(e.target.value)} style={{ width: '100%', height: 40 }} />
      <button onClick={onTranslate} style={{ marginTop: 8 }}>translate</button>
```

- [ ] **Step 2: Sanity-check the proto still compiles** by running the existing native vitest (no regression in imports). Run: `npx vitest run src/lib/local-inference/native/`. Expected: all native tests pass.

- [ ] **Step 3: Manual e2e (env-permitting).** `npm run electron:dev` → `Ctrl+Shift+N` → type Spanish → "translate" → English appears in the log. Requires torch + a downloaded model; skip if headless.

- [ ] **Step 4: Commit.**

```bash
git add src/components/dev/NativeTtsProto.tsx
git commit -m "feat(dev): add translate panel to native sidecar proto"
```

---

## Self-Review

**Spec coverage (Phase 2, translation half):** native translation backend via `transformers` LLM (Task 1) matching the per-stage table; renderer client reusing the request/response transport (Task 2); proof of life (Task 3). The **ASR half** (sherpa-onnx + faster-whisper + transformers, with a *streaming* WS protocol — binary audio frames + partial/final) is deliberately split into a follow-up plan (`phase2b-asr`) because it needs new protocol machinery, not a reuse. **opus-mt onnxruntime (torch-free) seq2seq** is a deferred follow-up to this plan; LLM-first is justified because LLMs carry ~all measured translation usage.

**Placeholder scan:** all steps carry complete code; the only env-gated steps (Task 1 Step 7, Task 3 Step 3) are real-model runs explicitly marked optional, with fake-engine/fake-WS unit tests as the always-on gate.

**Type consistency:** `TranslationResult { sourceText, translatedText, inferenceTimeMs }` flows identically through the WS `translation` message, `NativeTranslateClient.translate`, and the proto. `translate_init`/`translate`/`translation`/`ready` names match between `translate_engine.py`, `nativeProtocol.ts`, and the client. Both engines coexist in `state` under `engine`/`translate_engine` with non-colliding message types.

## Execution Handoff

Same as Phase 1: execute task-by-task (subagent-driven or inline), committing each in the worktree. ASR (Phase 2b) follows as its own plan.
