# Native TTS Voice Selection & Cloning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let native (Electron Python sidecar) TTS users pick a built-in named voice or a custom cloned voice (recorded/uploaded) for voice-capable models (MOSS-TTS-Nano), applied next session.

**Architecture:** Renderer-driven voice selection persisted in settings (`ttsVoice`), applied at session start via a unified sidecar `set_voice` message (built-in `{voice}` name vs custom binary clip; both → `_voice_rows`). Built-in names come from a new lightweight `list_tts_voices` query (reads the model manifest, no ONNX load). The existing `VoiceLibrarySection` is generalized to a capability-driven component shared by Supertonic and native.

**Tech Stack:** Python sidecar (websockets, huggingface_hub, onnxruntime), TypeScript/React renderer, Zustand store, IndexedDB (`idb`), vitest, pytest.

## Global Constraints

- TypeScript strict; English-only comments/docs. Conventional commits. Tests are the gate (vitest renderer, pytest sidecar); `tsc` is not repo-clean and is not a gate.
- Do not regress the existing Supertonic `VoiceLibrarySection` behavior.
- No dependency on issue #277 (silence governance). Unstable built-in voices remain reachable but flagged.
- Selected voice applies next session only; never hot-swap mid-session.
- `list_tts_voices` must not load the heavy ONNX model — read names from the snapshot manifest only.
- Sidecar is unreleased: no backward-compat obligation; reshape messages cleanly and update the renderer in lockstep.
- `ttsVoice` string forms: `''` (= per-language default), `'builtin:<Name>'`, `'custom:<id>'`. Reconciliation happens only in `LocalNativeClient.connect`.
- Default built-in voice for English is `Ava`.

## File Structure

- `sidecar/sokuji_sidecar/tts_voices.py` (new) — `list_builtin_voice_names(repo)` reading the manifest without a model load.
- `sidecar/sokuji_sidecar/tts_engine.py` (modify) — `_h_list_tts_voices` handler; register it.
- `sidecar/sokuji_sidecar/tts_backends.py` (modify) — `MossOnnxTtsBackend`: instance `preset_voice`; `set_builtin_voice(name)`; `set_voice` handler form for `{voice}`.
- `sidecar/sokuji_sidecar/tts_engine.py` (modify) — `_h_set_voice` accepts a `voice` name (no binary) path; `TtsEngine.set_builtin_voice`.
- `src/lib/local-inference/native/nativeProtocol.ts` (modify) — `list_tts_voices` / `list_tts_voices_result`.
- `src/lib/local-inference/native/NativeTtsClient.ts` (modify) — `setVoice(name)`.
- `src/lib/local-inference/native/NativeModelClient.ts` (modify) — `listTtsVoices(model?)`.
- `src/stores/nativeModelStore.ts` (modify) — `fetchTtsVoices` best-effort helper + cache.
- `src/lib/local-inference/native/nativeCatalog.ts` (modify) — curation map, `defaultTtsVoice`, `curatedBuiltinVoices`, `nativeTtsModelIsVoiceCapable`.
- `src/stores/settingsStore.ts` (modify) — `ttsVoice` field + session config.
- `src/services/interfaces/IClient.ts` (modify) — `ttsVoice?` on `LocalNativeSessionConfig`.
- `src/lib/local-inference/native/nativeTtsVoiceReconciliation.ts` (new) — `reconcileTtsVoice`.
- `src/services/clients/LocalNativeClient.ts` (modify) — apply built-in / custom voice at connect.
- `src/lib/local-inference/nativeVoiceStorage.ts` (new) — IndexedDB raw-audio custom voice library.
- `src/components/Settings/sections/VoiceLibrarySection.tsx` (modify) — capability-driven generalization.
- `src/components/Settings/sections/ProviderSpecificSettings.tsx` (modify) — Supertonic adapter to the generalized props.
- `src/components/Settings/sections/NativeVoiceSection.tsx` (new) — native adapter wiring the generalized section into the TTS group.
- `src/components/Settings/sections/NativeModelManagementSection.tsx` (modify) — render `NativeVoiceSection` for voice-capable TTS.

---

### Task 1: Sidecar `list_tts_voices` (manifest-only voice names)

**Files:**
- Create: `sidecar/sokuji_sidecar/tts_voices.py`
- Modify: `sidecar/sokuji_sidecar/tts_engine.py` (register handler)
- Test: `sidecar/tests/test_tts_voices.py`

**Interfaces:**
- Produces: `tts_voices.list_builtin_voice_names(repo: str | None = None) -> list[str]`; WS `{"type":"list_tts_voices", "model"?}` → `{"type":"list_tts_voices_result","id",​"voices":[str,…]}`.

- [ ] **Step 1: Write the failing test**

```python
# sidecar/tests/test_tts_voices.py
import json, os
from sokuji_sidecar import tts_voices

def test_list_builtin_voice_names_reads_manifest_without_model_load(tmp_path, monkeypatch):
    # Lay out a fake snapshot with a manifest containing two voices.
    snap = tmp_path / "snap"
    (snap / "MOSS-TTS-Nano-100M-ONNX").mkdir(parents=True)
    manifest = {"builtin_voices": [{"voice": "Ava"}, {"voice": "Junhao"}]}
    (snap / "MOSS-TTS-Nano-100M-ONNX" / "browser_poc_manifest.json").write_text(json.dumps(manifest))
    monkeypatch.setattr(tts_voices, "_snapshot_dir", lambda repo: str(snap))
    assert tts_voices.list_builtin_voice_names("any/repo") == ["Ava", "Junhao"]

def test_list_builtin_voice_names_empty_when_absent(monkeypatch):
    def boom(repo):
        raise FileNotFoundError("not downloaded")
    monkeypatch.setattr(tts_voices, "_snapshot_dir", boom)
    assert tts_voices.list_builtin_voice_names("any/repo") == []
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd sidecar && python -m pytest tests/test_tts_voices.py -q`
Expected: FAIL (module `tts_voices` not found).

- [ ] **Step 3: Implement `tts_voices.py`**

```python
# sidecar/sokuji_sidecar/tts_voices.py
"""Lightweight built-in TTS voice listing: read voice names from the MOSS model
manifest (browser_poc_manifest.json) WITHOUT loading any ONNX session."""
import json
from pathlib import Path

from .moss_tts.ort_runtime import MANIFEST_CANDIDATE_RELATIVE_PATHS, OnnxTtsRuntime


def _default_repo() -> str:
    from . import catalog
    m = catalog.tts_model("moss-tts-nano")
    # repos[0] is the LM repo that carries browser_poc_manifest.json
    return m.repos[0] if m and m.repos else "OpenMOSS-Team/MOSS-TTS-Nano-100M-ONNX"


def _snapshot_dir(repo: str) -> str:
    from huggingface_hub import snapshot_download
    return snapshot_download(repo_id=repo, local_files_only=True)


def list_builtin_voice_names(repo: str | None = None) -> list[str]:
    """Voice names from the snapshot manifest; [] if the model isn't downloaded."""
    try:
        root = Path(_snapshot_dir(repo or _default_repo()))
        manifest_path = OnnxTtsRuntime._resolve_manifest_path(root)
        manifest = json.loads(manifest_path.read_text())
        return [str(v["voice"]) for v in manifest.get("builtin_voices", [])]
    except Exception:
        return []
```

- [ ] **Step 4: Add the WS handler + register it**

In `sidecar/sokuji_sidecar/tts_engine.py`, add near the other handlers:

```python
async def _h_list_tts_voices(state, msg, _b, conn=None):
    from . import tts_voices
    voices = tts_voices.list_builtin_voice_names(msg.get("model"))
    return {"type": "list_tts_voices_result", "id": msg.get("id"), "voices": voices}, None
```

And extend `register`:

```python
def register(state: dict):
    state.setdefault("handlers", {}).update(
        {"tts_init": _h_tts_init, "set_voice": _h_set_voice,
         "tts_generate": _h_tts_generate, "tts_cancel": _h_tts_cancel,
         "list_tts_voices": _h_list_tts_voices})
```

- [ ] **Step 5: Add a handler test**

```python
# append to sidecar/tests/test_tts_voices.py
import asyncio
from sokuji_sidecar import tts_engine

def test_handler_returns_voices(monkeypatch):
    monkeypatch.setattr("sokuji_sidecar.tts_voices.list_builtin_voice_names", lambda model=None: ["Ava"])
    state = {}; tts_engine.register(state)
    reply, _ = asyncio.run(state["handlers"]["list_tts_voices"](state, {"id": 1, "type": "list_tts_voices"}, None, None))
    assert reply == {"type": "list_tts_voices_result", "id": 1, "voices": ["Ava"]}
```

- [ ] **Step 6: Run tests**

Run: `cd sidecar && python -m pytest tests/test_tts_voices.py -q`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add sidecar/sokuji_sidecar/tts_voices.py sidecar/sokuji_sidecar/tts_engine.py sidecar/tests/test_tts_voices.py
git commit -m "feat(native): list_tts_voices reads builtin voice names from manifest"
```

---

### Task 2: Sidecar unified `set_voice` (built-in name form) + instance preset

**Files:**
- Modify: `sidecar/sokuji_sidecar/tts_backends.py` (MossOnnxTtsBackend)
- Modify: `sidecar/sokuji_sidecar/tts_engine.py` (`_h_set_voice`, `TtsEngine.set_builtin_voice`)
- Test: `sidecar/tests/test_tts_backends.py`, `sidecar/tests/test_tts_engine.py`

**Interfaces:**
- Produces: `MossOnnxTtsBackend.preset_voice` (instance str); `MossOnnxTtsBackend.set_builtin_voice(name: str)`; `TtsEngine.set_builtin_voice(name: str)`; `set_voice` WS message accepts `{voice: str}` with no binary frame.

- [ ] **Step 1: Write the failing backend test**

```python
# append to sidecar/tests/test_tts_backends.py
def test_set_builtin_voice_sets_voice_rows_from_manifest(monkeypatch):
    from sokuji_sidecar.tts_backends import MossOnnxTtsBackend
    b = MossOnnxTtsBackend()
    class FakeRt:
        def list_builtin_voices(self):
            return [{"voice": "Ava", "prompt_audio_codes": [[1, 2]]},
                    {"voice": "Bella", "prompt_audio_codes": [[3, 4]]}]
    b._rt = FakeRt()
    b.set_builtin_voice("Bella")
    assert b._voice_rows == [[3, 4]]

def test_set_builtin_voice_unknown_name_raises():
    from sokuji_sidecar.tts_backends import MossOnnxTtsBackend, BackendLoadError
    b = MossOnnxTtsBackend()
    class FakeRt:
        def list_builtin_voices(self): return [{"voice": "Ava", "prompt_audio_codes": [[1]]}]
    b._rt = FakeRt()
    import pytest
    with pytest.raises(Exception):
        b.set_builtin_voice("Nope")
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd sidecar && python -m pytest tests/test_tts_backends.py -q -k set_builtin_voice`
Expected: FAIL (`set_builtin_voice` missing).

- [ ] **Step 3: Implement in `MossOnnxTtsBackend`**

Replace the `PRESET_VOICE` class attribute usage with an instance default and add the setter. In `__init__` add `self.preset_voice = os.environ.get("SOKUJI_MOSS_PRESET_VOICE", "Ava")`. Keep a module/class fallback only if referenced elsewhere; update `_resolve_prompt_audio_codes` to use `self.preset_voice`:

```python
    def set_builtin_voice(self, name: str) -> None:
        voices = self._rt.list_builtin_voices()
        match = next((v for v in voices if v.get("voice") == name), None)
        if match is None:
            from .backends import BackendLoadError
            raise BackendLoadError(f"unknown builtin voice: {name}")
        self._voice_rows = list(match["prompt_audio_codes"])

    def _resolve_prompt_audio_codes(self):
        if self._voice_rows is not None:
            return self._voice_rows
        voices = self._rt.list_builtin_voices()
        voice = next((v for v in voices if v.get("voice") == self.preset_voice), voices[0])
        return list(voice["prompt_audio_codes"])
```

- [ ] **Step 4: Wire `_h_set_voice` to accept the `{voice}` form**

In `sidecar/sokuji_sidecar/tts_engine.py`:

```python
async def _h_set_voice(state, msg, binary_in, conn=None):
    name = msg.get("voice")
    if name:                                  # built-in by name (no binary frame)
        state["tts_engine"].set_builtin_voice(str(name))
    else:                                     # custom clone from clip
        audio = np.frombuffer(binary_in, dtype=np.float32) if binary_in else np.zeros(0, np.float32)
        state["tts_engine"].set_voice(audio, int(msg.get("sampleRate", 24000)))
    return {"type": "ok", "id": msg.get("id")}, None
```

Add to `TtsEngine` (in `tts_engine.py`):

```python
    def set_builtin_voice(self, name):
        self._backend.set_builtin_voice(name)
```

- [ ] **Step 5: Add an engine handler test**

```python
# append to sidecar/tests/test_tts_engine.py
def test_h_set_voice_builtin_name_path():
    import asyncio
    from sokuji_sidecar import tts_engine
    called = {}
    class FakeEng:
        def set_builtin_voice(self, n): called["builtin"] = n
        def set_voice(self, a, sr): called["clip"] = (len(a), sr)
    state = {"tts_engine": FakeEng()}; tts_engine.register(state)
    reply, _ = asyncio.run(state["handlers"]["set_voice"](state, {"id": 1, "voice": "Ava"}, None, None))
    assert reply["type"] == "ok" and called == {"builtin": "Ava"}
```

- [ ] **Step 6: Run tests**

Run: `cd sidecar && python -m pytest tests/test_tts_backends.py tests/test_tts_engine.py -q`
Expected: PASS (existing + new).

- [ ] **Step 7: Commit**

```bash
git add sidecar/sokuji_sidecar/tts_backends.py sidecar/sokuji_sidecar/tts_engine.py sidecar/tests/test_tts_backends.py sidecar/tests/test_tts_engine.py
git commit -m "feat(native): unified set_voice supports builtin name; instance preset"
```

---

### Task 3: Renderer protocol + `NativeTtsClient.setVoice` + `listTtsVoices`

**Files:**
- Modify: `src/lib/local-inference/native/nativeProtocol.ts`
- Modify: `src/lib/local-inference/native/NativeTtsClient.ts`
- Modify: `src/lib/local-inference/native/NativeModelClient.ts`
- Test: `src/lib/local-inference/native/NativeTtsClient.test.ts`, `NativeModelClient.test.ts`

**Interfaces:**
- Consumes: sidecar `list_tts_voices` (Task 1), `set_voice {voice}` (Task 2).
- Produces: `NativeTtsClient.setVoice(name: string): Promise<void>`; `NativeModelClient.listTtsVoices(model?: string): Promise<string[]>`; `ListTtsVoicesResultMsg`.

- [ ] **Step 1: Add protocol types**

In `nativeProtocol.ts`, add and include in the `ServerMsg` union:

```ts
export interface ListTtsVoicesResultMsg { type: 'list_tts_voices_result'; id: number; voices: string[]; }
```
Append `| ListTtsVoicesResultMsg` to `ServerMsg`.

- [ ] **Step 2: Write the failing `NativeTtsClient.setVoice` test**

```ts
// in NativeTtsClient.test.ts (FakeWS already answers set_voice with {ok})
it('setVoice sends a builtin set_voice message', async () => {
  const c = new NativeTtsClient();
  await c.init('moss-tts-nano');
  await c.setVoice('Ava');
  const sent = FakeWS.last.sent.map((s) => typeof s === 'string' ? JSON.parse(s) : s);
  const sv = sent.find((m) => m && m.type === 'set_voice');
  expect(sv.voice).toBe('Ava');
});
```

(Ensure the FakeWS in this test file answers `set_voice` with `{type:'ok', id}`; if not present, add that branch mirroring the existing `tts_init` branch.)

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run src/lib/local-inference/native/NativeTtsClient.test.ts -t setVoice`
Expected: FAIL (`setVoice` not a function).

- [ ] **Step 4: Implement `setVoice`**

In `NativeTtsClient.ts`, beside `setReferenceVoice`:

```ts
  /** Select a built-in voice by name (applies to subsequent generate calls). */
  async setVoice(name: string): Promise<void> {
    await this.send({ type: 'set_voice', voice: name });
  }
```

- [ ] **Step 5: Implement + test `NativeModelClient.listTtsVoices`**

In `NativeModelClient.ts`:

```ts
  /** Built-in TTS voice names for a voice-capable model (empty if not downloaded). */
  async listTtsVoices(model?: string): Promise<string[]> {
    await this.connect();
    const payload: { type: 'list_tts_voices'; model?: string } = { type: 'list_tts_voices' };
    if (model) payload.model = model;
    const msg = await this.send(payload);
    return (msg as Extract<ServerMsg, { type: 'list_tts_voices_result' }>).voices;
  }
```

Test (in `NativeModelClient.test.ts`, add a `list_tts_voices` branch to its FakeWS returning `{voices:['Ava','Bella']}`):

```ts
it('listTtsVoices returns voice names', async () => {
  const c = new NativeModelClient();
  expect(await c.listTtsVoices('moss-tts-nano')).toEqual(['Ava', 'Bella']);
});
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run src/lib/local-inference/native/NativeTtsClient.test.ts src/lib/local-inference/native/NativeModelClient.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/local-inference/native/nativeProtocol.ts src/lib/local-inference/native/NativeTtsClient.ts src/lib/local-inference/native/NativeModelClient.ts src/lib/local-inference/native/NativeTtsClient.test.ts src/lib/local-inference/native/NativeModelClient.test.ts
git commit -m "feat(native): renderer setVoice + listTtsVoices wiring"
```

---

### Task 4: `nativeCatalog` curation, default, capability

**Files:**
- Modify: `src/lib/local-inference/native/nativeCatalog.ts`
- Test: `src/lib/local-inference/native/nativeCatalog.test.ts`

**Interfaces:**
- Produces:
  - `defaultTtsVoice(targetLanguage: string): string` → `'builtin:<Name>'`
  - `curatedBuiltinVoices(targetLanguage: string, allVoices: string[]): { curated: string[]; rest: string[] }`
  - `nativeTtsModelIsVoiceCapable(modelId: string): boolean`
  - `BUILTIN_VOICE_META: Record<string, { language?: string; curated?: boolean; unstable?: boolean }>`

- [ ] **Step 1: Write the failing test**

```ts
// in nativeCatalog.test.ts
import { defaultTtsVoice, curatedBuiltinVoices, nativeTtsModelIsVoiceCapable } from './nativeCatalog';

it('defaultTtsVoice returns Ava for English and a builtin: prefix', () => {
  expect(defaultTtsVoice('en')).toBe('builtin:Ava');
});
it('defaultTtsVoice falls back to Ava for unknown language', () => {
  expect(defaultTtsVoice('xx')).toBe('builtin:Ava');
});
it('curatedBuiltinVoices splits curated vs rest preserving membership', () => {
  const all = ['Ava', 'Adam', 'Bella', 'Junhao'];
  const { curated, rest } = curatedBuiltinVoices('en', all);
  expect(curated).toContain('Ava');
  expect([...curated, ...rest].sort()).toEqual([...all].sort());
  expect(curated.every((v) => all.includes(v))).toBe(true);
});
it('only MOSS is voice-capable', () => {
  expect(nativeTtsModelIsVoiceCapable('moss-tts-nano')).toBe(true);
  expect(nativeTtsModelIsVoiceCapable('csukuangfj/vits-piper-en_US-amy-low')).toBe(false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/local-inference/native/nativeCatalog.test.ts`
Expected: FAIL (new exports missing).

- [ ] **Step 3: Implement**

```ts
// nativeCatalog.ts — built-in voice curation (renderer-side product judgment;
// authoritative names come from list_tts_voices, this only annotates).
// Quality verified for English (Ava reliably clean); others are best-effort
// by language. Unstable voices stay reachable behind "show all" (see #277).
export const BUILTIN_VOICE_META: Record<string, { language?: string; curated?: boolean; unstable?: boolean }> = {
  Ava:    { language: 'en', curated: true },
  Bella:  { language: 'en', curated: true },
  Adam:   { language: 'en', unstable: true },
  Nathan: { language: 'en' },
  Trump:  { language: 'en' },
  Xiaoyu: { language: 'zh', curated: true },
  Yuewen: { language: 'zh', curated: true },
  Lingyu: { language: 'zh' },
  Junhao: { language: 'zh' },
  Zhiming:{ language: 'zh', unstable: true },
  Weiguo: { language: 'zh' },
  Saki:   { language: 'ja', curated: true },
  Soyo:   { language: 'ja', curated: true },
  Umiri:  { language: 'ja' },
  Mei:    { language: 'ja' },
  Anon:   { language: 'ja', unstable: true },
  Arisa:  { language: 'ja' },
  Mortis: { unstable: true },
};

const DEFAULT_VOICE_BY_LANG: Record<string, string> = { en: 'Ava', zh: 'Xiaoyu', ja: 'Saki' };

export function defaultTtsVoice(targetLanguage: string): string {
  return `builtin:${DEFAULT_VOICE_BY_LANG[targetLanguage] || 'Ava'}`;
}

/** Split the dynamic voice list into a curated subset (shown first) and the rest
 *  (behind "show all"). Curated = META.curated for the target language, else any
 *  curated voice; everything else goes to rest. Order: curated first (target-lang
 *  curated before other curated), then rest alphabetical. */
export function curatedBuiltinVoices(targetLanguage: string, allVoices: string[]): { curated: string[]; rest: string[] } {
  const curated: string[] = [];
  const rest: string[] = [];
  for (const v of allVoices) {
    if (BUILTIN_VOICE_META[v]?.curated) curated.push(v);
    else rest.push(v);
  }
  curated.sort((a, b) => {
    const am = BUILTIN_VOICE_META[a]?.language === targetLanguage ? 0 : 1;
    const bm = BUILTIN_VOICE_META[b]?.language === targetLanguage ? 0 : 1;
    return am - bm || a.localeCompare(b);
  });
  rest.sort((a, b) => a.localeCompare(b));
  return { curated, rest };
}

export function nativeTtsModelIsVoiceCapable(modelId: string): boolean {
  return nativeTtsVoices('en').concat(nativeTtsVoices('zh'), nativeTtsVoices('ja'))
    .some((o) => o.id === modelId && !!o.clones);
}
```

(Place these after the existing `MOSS_NANO_TTS`/`nativeTtsVoices` definitions so `nativeTtsVoices` is in scope.)

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/local-inference/native/nativeCatalog.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/local-inference/native/nativeCatalog.ts src/lib/local-inference/native/nativeCatalog.test.ts
git commit -m "feat(native): builtin voice curation + default + capability helpers"
```

---

### Task 5: `settingsStore.ttsVoice` + session config + IClient

**Files:**
- Modify: `src/stores/settingsStore.ts`
- Modify: `src/services/interfaces/IClient.ts`
- Test: `src/stores/settingsStore.ttsVoice.voice.test.ts` (new)

**Interfaces:**
- Produces: `localNative.ttsVoice: string` (default `''`); session config carries `ttsVoice`; `LocalNativeSessionConfig.ttsVoice?: string`.

- [ ] **Step 1: Write the failing test**

```ts
// src/stores/settingsStore.ttsVoice.voice.test.ts (mirror settingsStore.ttsDevice.test.ts mocks)
import { describe, it, expect, vi } from 'vitest';
import { Provider } from '../types/Provider';
const mockSetSetting = vi.fn().mockResolvedValue(undefined);
vi.mock('../services/ServiceFactory', () => ({ ServiceFactory: { getSettingsService: vi.fn(() => ({ setSetting: mockSetSetting, getSetting: vi.fn() })) } }));
vi.mock('../lib/local-inference/modelManifest', async () => ({ ...(await vi.importActual('../lib/local-inference/modelManifest')) }));
const { default: useSettingsStore } = await import('./settingsStore');

describe('ttsVoice setting', () => {
  it('defaults to empty string', () => {
    expect(useSettingsStore.getState().localNative.ttsVoice).toBe('');
  });
  it('is updatable', async () => {
    await useSettingsStore.getState().updateLocalNative({ ttsVoice: 'builtin:Bella' });
    expect(useSettingsStore.getState().localNative.ttsVoice).toBe('builtin:Bella');
  });
  it('session config carries ttsVoice verbatim', () => {
    useSettingsStore.setState({ provider: Provider.LOCAL_NATIVE, localNative: { ...useSettingsStore.getState().localNative, ttsVoice: 'custom:3' } } as any);
    expect((useSettingsStore.getState().createSessionConfig('sys') as any).ttsVoice).toBe('custom:3');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/stores/settingsStore.ttsVoice.voice.test.ts`
Expected: FAIL (`ttsVoice` undefined).

- [ ] **Step 3: Implement**

In `settingsStore.ts`: add to the `LocalNativeSettings` interface `ttsVoice: string;` (next to `ttsDevice`); add `ttsVoice: '',` to the defaults; add `ttsVoice: settings.ttsVoice,` to the LOCAL_NATIVE session-config block (next to `ttsDevice`). In `IClient.ts` add `ttsVoice?: string;` to `LocalNativeSessionConfig` (next to `ttsDevice?`).

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/stores/settingsStore.ttsVoice.voice.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/stores/settingsStore.ts src/services/interfaces/IClient.ts src/stores/settingsStore.ttsVoice.voice.test.ts
git commit -m "feat(native): ttsVoice setting + session config"
```

---

### Task 6: `reconcileTtsVoice`

**Files:**
- Create: `src/lib/local-inference/native/nativeTtsVoiceReconciliation.ts`
- Test: `src/lib/local-inference/native/nativeTtsVoiceReconciliation.test.ts`

**Interfaces:**
- Consumes: `defaultTtsVoice` (Task 4).
- Produces: `reconcileTtsVoice(ttsVoice: string, customVoiceIds: number[], targetLanguage: string): string` → always a concrete `'builtin:<Name>'` or `'custom:<id>'`.

- [ ] **Step 1: Write the failing test**

```ts
import { reconcileTtsVoice } from './nativeTtsVoiceReconciliation';

it('empty resolves to the per-language default', () => {
  expect(reconcileTtsVoice('', [], 'en')).toBe('builtin:Ava');
});
it('valid custom passes through', () => {
  expect(reconcileTtsVoice('custom:3', [3, 5], 'en')).toBe('custom:3');
});
it('deleted custom falls back to default', () => {
  expect(reconcileTtsVoice('custom:9', [3, 5], 'en')).toBe('builtin:Ava');
});
it('builtin passes through', () => {
  expect(reconcileTtsVoice('builtin:Bella', [], 'en')).toBe('builtin:Bella');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/local-inference/native/nativeTtsVoiceReconciliation.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
import { defaultTtsVoice } from './nativeCatalog';

/** Resolve a stored ttsVoice to a concrete voice: '' → per-language default;
 *  a custom:<id> whose id is gone → default; otherwise pass through. */
export function reconcileTtsVoice(ttsVoice: string, customVoiceIds: number[], targetLanguage: string): string {
  if (!ttsVoice) return defaultTtsVoice(targetLanguage);
  if (ttsVoice.startsWith('custom:')) {
    const id = Number(ttsVoice.slice('custom:'.length));
    if (!Number.isFinite(id) || !customVoiceIds.includes(id)) return defaultTtsVoice(targetLanguage);
  }
  return ttsVoice;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/local-inference/native/nativeTtsVoiceReconciliation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/local-inference/native/nativeTtsVoiceReconciliation.ts src/lib/local-inference/native/nativeTtsVoiceReconciliation.test.ts
git commit -m "feat(native): reconcileTtsVoice helper"
```

---

### Task 7: `LocalNativeClient` applies the built-in voice at connect

**Files:**
- Modify: `src/services/clients/LocalNativeClient.ts`
- Test: `src/services/clients/LocalNativeClient.test.ts`

**Interfaces:**
- Consumes: `NativeTtsClient.setVoice` (Task 3), `reconcileTtsVoice` (Task 6), `nativeVoiceStorage.listNativeVoices` (Task 8 — for custom ids; in this task pass `[]` so only built-in/default resolves; the custom branch lands in Task 11).
- Produces: built-in voice applied via `tts.init` then `tts.setVoice(name)`.

> Milestone: after this task the **built-in voice picker is end-to-end** (UI lands in Task 10, but the wire path works and is unit-tested).

- [ ] **Step 1: Write the failing test**

```ts
// in LocalNativeClient.test.ts
it('applies the selected builtin voice after init', async () => {
  const m = mocks();
  m.tts.init = vi.fn().mockResolvedValue({ sampleRate: 24000, loadTimeMs: 1, streaming: true });
  m.tts.setVoice = vi.fn().mockResolvedValue(undefined);
  const c = new LocalNativeClient(m);
  await c.connect({
    provider: 'local_native', model: 'native', sourceLanguage: 'en', targetLanguage: 'en',
    asrModelId: 'sense-voice', ttsModelId: 'moss-tts-nano', ttsVoice: 'builtin:Bella',
  } as any);
  expect(m.tts.init).toHaveBeenCalledWith('moss-tts-nano', undefined);
  expect(m.tts.setVoice).toHaveBeenCalledWith('Bella');
});

it('empty ttsVoice resolves to the per-language default builtin', async () => {
  const m = mocks();
  m.tts.init = vi.fn().mockResolvedValue({ sampleRate: 24000, loadTimeMs: 1 });
  m.tts.setVoice = vi.fn().mockResolvedValue(undefined);
  const c = new LocalNativeClient(m);
  await c.connect({ provider: 'local_native', model: 'native', sourceLanguage: 'en', targetLanguage: 'en',
    asrModelId: 'sense-voice', ttsModelId: 'moss-tts-nano' } as any);
  expect(m.tts.setVoice).toHaveBeenCalledWith('Ava');
});
```

(Ensure `mocks().tts` includes `setVoice: vi.fn()`.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/services/clients/LocalNativeClient.test.ts -t "builtin voice"`
Expected: FAIL (`setVoice` not called).

- [ ] **Step 3: Implement**

In `LocalNativeClient.ts`, in the `if (this.ttsEnabled)` block, after the successful `await this.tts.init(config.ttsModelId, config.ttsDevice)` and `setTtsResolved(...)`:

```ts
        // Apply the selected voice (next-session semantics). Custom ids resolve
        // against the stored library; the custom-clip path lands in Task 11.
        const customIds: number[] = [];
        const voice = reconcileTtsVoice(config.ttsVoice ?? '', customIds, config.targetLanguage);
        if (voice.startsWith('builtin:')) {
          await this.tts.setVoice(voice.slice('builtin:'.length));
        }
```

Add `import { reconcileTtsVoice } from '../../lib/local-inference/native/nativeTtsVoiceReconciliation';` at the top.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/services/clients/LocalNativeClient.test.ts`
Expected: PASS (all, including the two new).

- [ ] **Step 5: Commit**

```bash
git add src/services/clients/LocalNativeClient.ts src/services/clients/LocalNativeClient.test.ts
git commit -m "feat(native): apply selected builtin TTS voice at session start"
```

---

### Task 8: `nativeVoiceStorage` (IndexedDB raw-audio custom voices)

**Files:**
- Create: `src/lib/local-inference/nativeVoiceStorage.ts`
- Test: `src/lib/local-inference/nativeVoiceStorage.test.ts`

**Interfaces:**
- Consumes: `getDb` from `./modelStorage` (shared `sokuji-models` DB).
- Produces: `StoredNativeVoice { id:number; name:string; audio:ArrayBuffer; sampleRate:number; createdAt:number }`; `listNativeVoices()`, `getNativeVoice(id)`, `addNativeVoice(name, Float32Array, sampleRate)`, `renameNativeVoice(id, name)`, `deleteNativeVoice(id)`, `resetNativeVoiceStorageForTesting()`.

> Note: this adds a new object store. Check `src/lib/local-inference/modelStorage.ts` for the `idb` `upgrade` callback and DB version; bump the version and create the `native_voices` store (keyPath `id`, autoIncrement) in that upgrade. Include that change in this task.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { addNativeVoice, listNativeVoices, getNativeVoice, renameNativeVoice, deleteNativeVoice, resetNativeVoiceStorageForTesting } from './nativeVoiceStorage';

beforeEach(async () => { await resetNativeVoiceStorageForTesting(); });

it('add then list returns the voice with audio + sampleRate', async () => {
  const v = await addNativeVoice('My Voice', new Float32Array([0.1, -0.2, 0.3]), 16000);
  const all = await listNativeVoices();
  expect(all.map((x) => x.name)).toEqual(['My Voice']);
  const got = await getNativeVoice(v.id);
  expect(got!.sampleRate).toBe(16000);
  expect(new Float32Array(got!.audio).length).toBe(3);
});
it('uniquifies duplicate names', async () => {
  await addNativeVoice('V', new Float32Array([0]), 16000);
  const b = await addNativeVoice('V', new Float32Array([0]), 16000);
  expect(b.name).not.toBe('V');
});
it('rename and delete work', async () => {
  const v = await addNativeVoice('A', new Float32Array([0]), 16000);
  await renameNativeVoice(v.id, 'B');
  expect((await getNativeVoice(v.id))!.name).toBe('B');
  await deleteNativeVoice(v.id);
  expect(await getNativeVoice(v.id)).toBeUndefined();
});
```

(If `fake-indexeddb` isn't already a dev dependency, the existing `voiceStorage.test.ts` shows how this project tests IndexedDB — mirror its setup exactly instead of importing `fake-indexeddb/auto`.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/local-inference/nativeVoiceStorage.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement** (mirror `voiceStorage.ts`)

```ts
import { getDb } from './modelStorage';

export interface StoredNativeVoice { id: number; name: string; audio: ArrayBuffer; sampleRate: number; createdAt: number; }
const STORE = 'native_voices';

function uniquifyName(base: string, taken: string[]): string {
  if (!taken.includes(base)) return base;
  let i = 2;
  while (taken.includes(`${base} (${i})`)) i++;
  return `${base} (${i})`;
}

export async function listNativeVoices(): Promise<StoredNativeVoice[]> {
  const conn = await getDb();
  return ((await conn.getAll(STORE)) ?? []) as StoredNativeVoice[];
}
export async function getNativeVoice(id: number): Promise<StoredNativeVoice | undefined> {
  const conn = await getDb();
  return (await conn.get(STORE, id)) as StoredNativeVoice | undefined;
}
export async function addNativeVoice(name: string, audio: Float32Array, sampleRate: number): Promise<StoredNativeVoice> {
  const existing = await listNativeVoices();
  const finalName = uniquifyName(name.trim() || 'Voice', existing.map((v) => v.name));
  const buf = audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength);
  const record: Omit<StoredNativeVoice, 'id'> = { name: finalName, audio: buf, sampleRate, createdAt: Date.now() };
  const conn = await getDb();
  const id = (await conn.add(STORE, record)) as number;
  return { id, ...record };
}
export async function renameNativeVoice(id: number, name: string): Promise<void> {
  const conn = await getDb();
  const cur = (await conn.get(STORE, id)) as StoredNativeVoice | undefined;
  if (!cur) throw new Error(`Native voice ${id} not found`);
  await conn.put(STORE, { ...cur, name });
}
export async function deleteNativeVoice(id: number): Promise<void> {
  const conn = await getDb();
  await conn.delete(STORE, id);
}
export async function resetNativeVoiceStorageForTesting(): Promise<void> {
  const conn = await getDb();
  await conn.clear(STORE);
}
```

In `modelStorage.ts`, bump the DB version and add to the `upgrade` callback:

```ts
if (!db.objectStoreNames.contains('native_voices')) {
  db.createObjectStore('native_voices', { keyPath: 'id', autoIncrement: true });
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/local-inference/nativeVoiceStorage.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/local-inference/nativeVoiceStorage.ts src/lib/local-inference/nativeVoiceStorage.test.ts src/lib/local-inference/modelStorage.ts
git commit -m "feat(native): IndexedDB custom voice library (raw audio)"
```

---

### Task 9: Generalize `VoiceLibrarySection` (capability-driven) + keep Supertonic green

**Files:**
- Modify: `src/components/Settings/sections/VoiceLibrarySection.tsx`
- Modify: `src/components/Settings/sections/ProviderSpecificSettings.tsx` (adapter to new props)
- Test: `src/components/Settings/sections/VoiceLibrarySection.test.tsx` (new)

**Interfaces:**
- Produces:
  ```ts
  export interface VoiceEntry { id: string; label: string; group: 'builtin' | 'custom'; removable: boolean; meta?: { gender?: 'M'|'F'; curated?: boolean; unstable?: boolean; language?: string }; }
  export interface VoiceLibraryCapability { importModes: ('upload'|'record')[]; curation: boolean; }
  export interface VoiceLibrarySectionProps {
    voices: VoiceEntry[]; selectedId: string; onSelect: (id: string) => void;
    onImport?: (file: File) => Promise<void>; onRecord?: (clip: Float32Array, sampleRate: number) => Promise<void>;
    onRename: (id: string, name: string) => Promise<void>; onDelete: (id: string) => Promise<void>;
    capability: VoiceLibraryCapability; isSessionActive?: boolean;
  }
  ```

**Approach:** Refactor the component to consume the normalized `voices` + `capability` model. Keep the existing markup/SCSS classes. Render a built-in group, then (when `capability.curation` and there are non-curated builtins) a "show all" expander revealing the rest with `unstable` ones flagged; then a custom group with rename/delete on `removable` entries; then import controls — an Upload button when `'upload' ∈ importModes`, a Record button when `'record' ∈ importModes`. The `ProviderSpecificSettings` Supertonic usage becomes an adapter mapping its `SupertonicVoice[]`/`selectedSid`/sid-callbacks to `VoiceEntry[]`/`selectedId='preset:'+sid` etc., with `capability={importModes:['upload'], curation:false}`.

- [ ] **Step 1: Write failing tests (render both shapes)**

```tsx
import { render, screen } from '@testing-library/react';
import VoiceLibrarySection from './VoiceLibrarySection';

const base = { selectedId: 'builtin:Ava', onSelect: () => {}, onRename: async () => {}, onDelete: async () => {}, onImport: async () => {} };

it('renders builtin + custom groups and a record button when capability allows', () => {
  render(<VoiceLibrarySection {...base}
    voices={[{ id: 'builtin:Ava', label: 'Ava', group: 'builtin', removable: false, meta: { curated: true } },
             { id: 'custom:1', label: 'Mine', group: 'custom', removable: true }]}
    capability={{ importModes: ['record', 'upload'], curation: true }}
    onRecord={async () => {}} />);
  expect(screen.getByText('Ava')).toBeInTheDocument();
  expect(screen.getByText('Mine')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /record/i })).toBeInTheDocument();
});

it('hides the record button when record is not an import mode (Supertonic)', () => {
  render(<VoiceLibrarySection {...base} selectedId='preset:0'
    voices={[{ id: 'preset:0', label: 'Sarah', group: 'builtin', removable: false }]}
    capability={{ importModes: ['upload'], curation: false }} />);
  expect(screen.queryByRole('button', { name: /record/i })).toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/Settings/sections/VoiceLibrarySection.test.tsx`
Expected: FAIL (props shape mismatch / record button absent).

- [ ] **Step 3: Refactor `VoiceLibrarySection` to the new props** (keep existing SCSS classes; render groups + curation expander + conditional import buttons as described in Approach).

- [ ] **Step 4: Update `ProviderSpecificSettings` Supertonic usage to the adapter** (map sid voices → `VoiceEntry[]`, `onSelect(id)` → parse sid, `capability={importModes:['upload'],curation:false}`).

- [ ] **Step 5: Run tests + Supertonic regression**

Run: `npx vitest run src/components/Settings/sections/VoiceLibrarySection.test.tsx src/components/Settings/sections/ProviderSpecificSettings*.test.tsx`
Expected: PASS (new + any existing Supertonic tests still green).

- [ ] **Step 6: Commit**

```bash
git add src/components/Settings/sections/VoiceLibrarySection.tsx src/components/Settings/sections/ProviderSpecificSettings.tsx src/components/Settings/sections/VoiceLibrarySection.test.tsx
git commit -m "refactor(settings): capability-driven VoiceLibrarySection + Supertonic adapter"
```

---

### Task 10: `NativeVoiceSection` — built-in picker wired into the TTS group

**Files:**
- Create: `src/components/Settings/sections/NativeVoiceSection.tsx`
- Modify: `src/components/Settings/sections/NativeModelManagementSection.tsx`
- Test: `src/components/Settings/sections/NativeVoiceSection.test.tsx` (new)

**Interfaces:**
- Consumes: `listTtsVoices` (Task 3 via `nativeModelStore`), `curatedBuiltinVoices`/`defaultTtsVoice`/`nativeTtsModelIsVoiceCapable` (Task 4), `settings.ttsVoice` + `updateLocalNative` (Task 5), generalized `VoiceLibrarySection` (Task 9), `listNativeVoices` (Task 8).
- Produces: a component rendering the native voice library (built-in entries now; custom entries wired in Task 11) and writing `ttsVoice` on select.

> Milestone: after this task the **built-in voice picker is usable in the UI**.

- [ ] **Step 1: Write a failing render/selection test**

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import NativeVoiceSection from './NativeVoiceSection';

it('lists curated builtin voices and writes ttsVoice on select', () => {
  const onChange = vi.fn();
  render(<NativeVoiceSection builtinVoices={['Ava', 'Bella', 'Adam']} customVoices={[]}
    selected='builtin:Ava' targetLanguage='en' isSessionActive={false}
    onSelect={onChange} onImport={async () => {}} onRecord={async () => {}}
    onRename={async () => {}} onDelete={async () => {}} />);
  expect(screen.getByText('Ava')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Bella'));
  expect(onChange).toHaveBeenCalledWith('builtin:Bella');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/Settings/sections/NativeVoiceSection.test.tsx`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `NativeVoiceSection`** — build `VoiceEntry[]` from `curatedBuiltinVoices(targetLanguage, builtinVoices)` (curated first, rest behind expander, `meta.unstable` from `BUILTIN_VOICE_META`) + `customVoices` mapped to `custom:<id>` (group `custom`, removable). Render the generalized `VoiceLibrarySection` with `capability={importModes:['record','upload'], curation:true}`, forwarding callbacks.

- [ ] **Step 4: Wire into `NativeModelManagementSection`** — in the TTS `ModelGroup`, when `nativeTtsModelIsVoiceCapable(settings.ttsModel)` (resolve the selected TTS id), render `NativeVoiceSection` below the device control. Fetch built-in voices via `nativeModelStore` (best-effort; `[]` when model not downloaded → section shows the "download first" hint), and custom voices via `listNativeVoices()`. `onSelect` → `update({ ttsVoice })`.

- [ ] **Step 5: Run tests**

Run: `npx vitest run src/components/Settings/sections/NativeVoiceSection.test.tsx src/components/Settings/sections/NativeModelManagementSection.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/Settings/sections/NativeVoiceSection.tsx src/components/Settings/sections/NativeModelManagementSection.tsx src/components/Settings/sections/NativeVoiceSection.test.tsx
git commit -m "feat(native): builtin voice picker UI in the TTS group"
```

---

### Task 11: Custom cloning — capture, storage wiring, custom session path

**Files:**
- Modify: `src/components/Settings/sections/NativeVoiceSection.tsx` (record/upload → `addNativeVoice`)
- Modify: `src/services/clients/LocalNativeClient.ts` (custom voice at connect)
- Test: `src/services/clients/LocalNativeClient.test.ts`, `src/components/Settings/sections/NativeVoiceSection.test.tsx`

**Interfaces:**
- Consumes: `ModernAudioRecorder` (mic capture), `AudioContext.decodeAudioData` (upload), `addNativeVoice`/`getNativeVoice`/`listNativeVoices` (Task 8), `NativeTtsClient.setReferenceVoice` (existing).
- Produces: full clone flow — recorded/uploaded clip → stored → selectable → applied via `set_voice` clip at session start.

> Milestone: after this task **custom cloning is end-to-end**.

- [ ] **Step 1: Write the failing LocalNativeClient custom-path test**

```ts
it('applies a custom cloned voice via setReferenceVoice', async () => {
  const m = mocks();
  m.tts.init = vi.fn().mockResolvedValue({ sampleRate: 24000, loadTimeMs: 1 });
  m.tts.setReferenceVoice = vi.fn().mockResolvedValue(undefined);
  // Stub the storage read the client uses (inject via deps or vi.mock the module).
  vi.spyOn(await import('../../lib/local-inference/nativeVoiceStorage'), 'listNativeVoices')
    .mockResolvedValue([{ id: 7, name: 'Mine', audio: new Float32Array([0.1, 0.2]).buffer, sampleRate: 16000, createdAt: 0 }]);
  vi.spyOn(await import('../../lib/local-inference/nativeVoiceStorage'), 'getNativeVoice')
    .mockResolvedValue({ id: 7, name: 'Mine', audio: new Float32Array([0.1, 0.2]).buffer, sampleRate: 16000, createdAt: 0 });
  const c = new LocalNativeClient(m);
  await c.connect({ provider: 'local_native', model: 'native', sourceLanguage: 'en', targetLanguage: 'en',
    asrModelId: 'sense-voice', ttsModelId: 'moss-tts-nano', ttsVoice: 'custom:7' } as any);
  expect(m.tts.setReferenceVoice).toHaveBeenCalledWith(expect.any(Float32Array), 16000);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/services/clients/LocalNativeClient.test.ts -t "custom cloned voice"`
Expected: FAIL (custom branch not implemented; `customIds` is `[]`).

- [ ] **Step 3: Implement the custom branch in `LocalNativeClient`**

Replace the Task 7 stub:

```ts
        const customVoices = await listNativeVoices();
        const voice = reconcileTtsVoice(config.ttsVoice ?? '', customVoices.map((v) => v.id), config.targetLanguage);
        if (voice.startsWith('builtin:')) {
          await this.tts.setVoice(voice.slice('builtin:'.length));
        } else if (voice.startsWith('custom:')) {
          const id = Number(voice.slice('custom:'.length));
          const stored = await getNativeVoice(id);
          if (stored) await this.tts.setReferenceVoice(new Float32Array(stored.audio), stored.sampleRate);
        }
```

Add `import { listNativeVoices, getNativeVoice } from '../../lib/local-inference/nativeVoiceStorage';`.

- [ ] **Step 4: Implement capture in `NativeVoiceSection`**

Wire `onRecord`: capture via `ModernAudioRecorder` (start/stop UI), validate duration ~3–20s and non-silent (reject with a message otherwise), produce a `Float32Array` + sampleRate → `addNativeVoice(name, clip, sr)` → refresh custom list. Wire `onImport`: read the file, `AudioContext.decodeAudioData`, downmix to mono `Float32Array` at the context sample rate → `addNativeVoice`. Add a NativeVoiceSection test that a too-short recording is rejected (mock the recorder to yield a 0.5s clip → expect `addNativeVoice` not called and an error surfaced).

- [ ] **Step 5: Run tests**

Run: `npx vitest run src/services/clients/LocalNativeClient.test.ts src/components/Settings/sections/NativeVoiceSection.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/clients/LocalNativeClient.ts src/components/Settings/sections/NativeVoiceSection.tsx src/services/clients/LocalNativeClient.test.ts src/components/Settings/sections/NativeVoiceSection.test.tsx
git commit -m "feat(native): custom voice cloning end-to-end (record/upload + set_voice)"
```

---

## Self-Review

- **Spec coverage:** list_tts_voices (T1), unified set_voice + instance preset (T2), renderer protocol/client (T3), curation/default/capability (T4), settings ttsVoice + session config + IClient (T5), reconciliation (T6), built-in session wiring (T7), nativeVoiceStorage (T8), generalized VoiceLibrarySection + Supertonic adapter (T9), built-in picker UI (T10), custom cloning capture + custom session path (T11). All spec components mapped.
- **Type consistency:** `ttsVoice` string forms (`''`/`builtin:<Name>`/`custom:<id>`) are consistent across T5/T6/T7/T11; `setVoice(name)` vs `setReferenceVoice(clip, sr)` consistent T3/T7/T11; `StoredNativeVoice.audio: ArrayBuffer` consistently wrapped as `new Float32Array(stored.audio)` in T11; `reconcileTtsVoice(ttsVoice, customVoiceIds, targetLanguage)` signature consistent T6/T7/T11.
- **Note for executor:** T7 lands the built-in path with `customIds=[]`; T11 replaces that stub with the storage-backed list. This is intentional incremental sequencing (built-in shippable at T7, cloning at T11).
- **Verify-before-coding:** before T8, confirm `modelStorage.ts` DB version/upgrade shape; before T9, read the current `VoiceLibrarySection.tsx` body and `ProviderSpecificSettings.tsx:~1943` Supertonic usage to preserve behavior.

## Out of Scope

- Silence governance / runaway mitigation (#277).
- Per-language curated lists beyond en/zh/ja are best-effort.
- Voice export/sharing, cloud sync, multi-clip averaging.
