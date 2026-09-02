"""Translation backend over sokuji_native's Translator (llama.cpp in-process, spec
§4.3/§5.3): one GGUF chat model per handle, three prompt-strategy classes selected by
the resolved catalog card's PlanConfig.prompt_family ("qwen" | "hunyuan" | "gemma").
Mirrors asr_backend's load()/unload() contract and native.module()/GGUF-resolution
pattern; exposes translate() (with an optional on_partial per-token callback) instead
of transcribe().

Historical note: the four llama-server/CTranslate2 backends this module replaces
(llamacpp_qwen/hunyuan/gemma, ct2_opus_translate) spawned an external process or a
separate CTranslate2 runtime; this backend runs in-process through sokuji_native, so
there is no child process, no --no-jinja/--completion transport split, and no
CTranslate2 Opus-MT pair-baked models (those 13 catalog rows are gone with the
runtime).

Worker registry (slice-5 task 5; ground truth .superpowers/slice5-surface-
inventory.md §10(b)) -- a translate() twin of tts_backend.NativeTtsBackend's I3
fix: unload() used to free the native handle unconditionally, while an executor
thread could still be inside self._t.chat()/complete() -- the same native
use-after-free class I3 fixed for TTS's one-shot generate(). translate() now
registers a (cancel Event, done Event) pair in self._workers on entry and
deregisters in a finally on exit -- there is no separate "start the worker" step
to do this eagerly at, unlike tts_backend's streaming generate_stream(). unload()
sets every live entry's cancel Event, then waits on every entry's done Event
against ONE shared 10s deadline before touching the model.

Final fix wave (2026-09-01), ruling I-1 -- the FIRST version of this fix (and
tts_backend.NativeTtsBackend's still-live twin for its one-shot generate(), fixed
alongside this one) registered (threading.current_thread(), cancel Event) and had
unload() call thread.join(timeout=...) on that thread. In production translate()
always runs via translate_engine._h_translate's `loop.run_in_executor(None, ...)`
(translate_engine.py) -- i.e. on a ThreadPoolExecutor worker -- and a pool worker
thread returns to the pool, IDLE, once the callable returns; it does NOT
terminate (only pool shutdown or interpreter exit actually ends it).
threading.Thread.join() waits for the underlying OS thread to terminate, not for
"the callable I care about finished" -- so unload() was joining a thread that
(in production) essentially never dies within the wait window, burning the FULL
10s deadline on every single unload(), regardless of whether translate() had
already returned. Both unload() triggers (_translate_teardown and _h_translate's
close-race branch) run ON the event loop, so this stalled the entire event loop
for up to 10s per teardown, and hollowed the very backstop the deadline exists to
enforce: the model got freed only after the full 10s had elapsed, whether or not
the in-flight native call had actually exited by then. The existing regression
test masked this because it ran translate() on a real, short-lived, dedicated
threading.Thread (which DOES terminate when its target returns) instead of
through a real executor -- see
test_unload_during_inflight_translate_joins_before_model_unload's rewrite.

Fixed by tracking completion with a `done` Event instead of the thread object:
translate()'s own finally sets `done` once the native call has actually returned
(successfully, cancelled, or raised) -- unload() then waits on
`done.wait(remaining)` per entry, which resolves the moment the callable itself
finishes, independent of what the underlying OS thread does afterward. The
shared-deadline semantics (ONE budget across every outstanding worker, not
_UNLOAD_DEADLINE_S each) are unchanged.

Unlike TTS's one-shot generate() (I3: event=None, offline generation cannot be
interrupted mid-run), a translate() IS interruptible mid-run: on_token is called
once per generated token (native/python/sokuji_native/__init__.py's
Translator._make_cb documents the contract -- `on_token(piece) is not False`,
i.e. returning anything but True cancels), so on_token here checks its own
cancel Event first and returns False once it's set, which the binding turns
into a clean native-level cancel (SK_ERR_CANCELLED, raised out of chat()/
complete()) within one token -- no new wire message this slice (ruling R20:
max_tokens bounds worst-case latency and no client sends a cancel). Ruling
R20 also decided this is disconnect-triggered only, never a client message.

Two independent triggers reach this Event, and they matter for DIFFERENT
races: TranslateEngine.cancel_active()/_translate_teardown (translate_engine.py
-- the translate-side twin of tts_engine._tts_teardown's CQ-4 order,
cancel_active() BEFORE close()) fires from server._conn's on_close list, which
only runs once _conn's own `async for raw in ws:` loop returns -- i.e. AFTER
whatever handler call was in flight when the connection closed has already
finished. That covers a stale/superseded-engine close and a same-connection
disconnect noticed at the NEXT message, but NOT a disconnect racing THIS
connection's own still-running generation (ruling R26; ground truth
.superpowers/slice5-surface-inventory.md §10(b) -- confirmed live: on_close
cannot fire mid-flight through server.py's serial per-connection dispatch).
That race is instead caught by translate_engine._h_translate itself, which
awaits the executor future racing conn.wait_closed() (server.Conn -- resolves
independent of _conn's recv() loop) and calls cancel_active() directly the
moment the close-waiter wins -- see that function's own docstring for the
full trace. unload()'s own cancel-everything-then-wait is the correctness
backstop common to both triggers, regardless of which (if either) fired first.

A cancellation this backend itself triggered is not a generation failure: the
raised exception is caught and the call returns whatever text was collected
before the cancel landed (empty if none) instead of propagating -- the caller
(translate_engine.py) is very possibly racing a connection that is already
gone and has no use for a full reply at that point (see _h_translate's own
comments on where replies go).

  QwenStrategy    — Qwen 2.5 / 3 / 3.5 chat template. Qwen3 and Qwen3.5 both default
                    to thinking mode on; disabled via an empty <think> block forced as
                    the assistant's prefill (config.disable_thinking) — the native
                    replacement for llama-server's chat_template_kwargs.enable_thinking
                    =false (the legacy formatter has no jinja kwargs, so killing
                    thinking at the token level is the only lever). /no_think is kept
                    appended to the system prompt for plain Qwen3 only
                    (config.append_no_think), belt-and-braces per Qwen3's own docs;
                    Qwen3.5 ignores it (verified live against llama-server).
  HunyuanStrategy — HY-MT2 / HY-MT1.5 1.8B / 7B: single-user-turn prompt, no prefill.
  GemmaStrategy   — TranslateGemma 4B: bypasses the chat template entirely (its jinja
                    template crashes the legacy chat-template formatter) via a
                    self-rendered prompt through sk_translate_complete — the same
                    prompt the old --no-jinja + /completion path used.
"""
import os
import re
import threading
import time

from . import native
from .backends import BackendLoadError, register_backend
from .catalog import split_artifact
from .planner import PlanConfig

_TRANSCRIPT_TAG = re.compile(r"</?transcript>", re.IGNORECASE)

# I-1: the single shared budget unload() gives EVERY outstanding translate()
# worker, combined, to self-report done before the model is freed regardless.
# A module constant (not inlined in unload()) so a test can shrink it to
# exercise the "still-blocked native call" path without a real 10s wait.
_UNLOAD_DEADLINE_S = 10.0


def _default_prompt(src: str, tgt: str) -> str:
    s = src or "the source language"
    t = tgt or "the target language"
    return (f"You are a translator. Translate the text from {s} to {t}. "
            "Output only the translation, no explanations, no refusal.")


def _clean_output(text: str) -> str:
    """Clean a model's raw translation output: drop any <think>…</think> reasoning
    block, then strip stray <transcript>/</transcript> tags. Small Qwen models echo
    the wrapped input's framing (e.g. trailing '</transcript>') into the output."""
    if "</think>" in text:
        text = text.split("</think>", 1)[1]
    text = _TRANSCRIPT_TAG.sub("", text)
    return text.strip()


def _hunyuan_prompt(tgt: str) -> str:
    t = tgt or "the target language"
    # HY-MT2's documented English instruction; the model auto-detects the source.
    return (f"Translate the following text into {t}. Note that you should only "
            "output the translated result without any additional explanation: ")


# Full English language name -> BCP-47 code for TranslateGemma's chat-template
# source_lang_code/target_lang_code fields. The engine passes full names; unknown
# names (or values that are already codes) pass through unchanged.
_GEMMA_LANG_CODE = {
    "English": "en", "Chinese": "zh", "Japanese": "ja", "Korean": "ko",
    "French": "fr", "German": "de", "Spanish": "es", "Portuguese": "pt",
    "Italian": "it", "Russian": "ru", "Arabic": "ar", "Hindi": "hi",
    "Dutch": "nl", "Vietnamese": "vi", "Thai": "th", "Indonesian": "id",
    "Turkish": "tr", "Polish": "pl", "Ukrainian": "uk", "Greek": "el",
}


def _gemma_code(name: str) -> str:
    return _GEMMA_LANG_CODE.get(name, name)


class QwenStrategy:
    max_tokens = 512

    def build(self, text, system_prompt, src, tgt, wrap, config):
        sys_p = system_prompt or _default_prompt(src, tgt)
        if config.append_no_think:
            sys_p = f"{sys_p} /no_think"
        user = f"<transcript>{text}</transcript>" if wrap else text
        messages = [{"role": "system", "content": sys_p}, {"role": "user", "content": user}]
        prefill = "<think>\n\n</think>\n\n" if config.disable_thinking else None
        return "chat", messages, prefill


class HunyuanStrategy:
    max_tokens = 512

    def build(self, text, system_prompt, src, tgt, wrap, config):
        instr = system_prompt or _hunyuan_prompt(tgt)
        body = f"<transcript>{text}</transcript>" if wrap else text
        messages = [{"role": "user", "content": f"{instr}{body}"}]
        return "chat", messages, None


class GemmaStrategy:
    max_tokens = 256

    def build(self, text, system_prompt, src, tgt, wrap, config):
        return "complete", self._render_prompt(text, src, tgt, wrap), None

    def _render_prompt(self, text, src, tgt, wrap):
        body = f"<transcript>{text}</transcript>" if wrap else text
        s_name, s_code = src or "the source language", _gemma_code(src)
        t_name, t_code = tgt or "the target language", _gemma_code(tgt)
        # A falsy src/tgt has no real code — _gemma_code(name) on a falsy name
        # just passes that same falsy value straight through the dict .get()
        # fallback — so appending " (code)" unconditionally rendered a leaked
        # empty parenthetical: "the source language ()". Only append it when
        # there's both a real language name AND a real code for it.
        s_label = f"{s_name} ({s_code})" if src and s_code else s_name
        t_label = f"{t_name} ({t_code})" if tgt and t_code else t_name
        return (f"<start_of_turn>user\nYou are a professional {s_label} to {t_label} "
                f"translator. Your goal is to accurately convey the meaning and nuances of the original "
                f"{s_name} text while adhering to {t_name} grammar, vocabulary, and cultural sensitivities.\n"
                f"Produce only the {t_name} translation, without any additional explanations or commentary. "
                f"Please translate the following {s_name} text into {t_name}:\n\n\n"
                f"{body}<end_of_turn>\n<start_of_turn>model\n")


STRATEGIES = {"qwen": QwenStrategy(), "hunyuan": HunyuanStrategy(), "gemma": GemmaStrategy()}


def _chatml_fallback(messages, prefill):
    """Minimal self-rendered chatml prompt for a GGUF whose template the legacy
    formatter doesn't know (sk_translate_chat's "chat template not supported"
    contract). Only ever used for the qwen/hunyuan strategies — gemma already
    bypasses the chat template via sk_translate_complete. Whether this path ever
    actually fires against a real GGUF is Task 5's live-run question."""
    rendered = "".join(f"<|im_start|>{m['role']}\n{m['content']}<|im_end|>\n" for m in messages)
    rendered += "<|im_start|>assistant\n"
    if prefill:
        rendered += prefill
    return rendered


@register_backend
class NativeTranslateBackend:
    NAME = "native_translate"

    def __init__(self):
        self._t = None
        self._config = PlanConfig()
        self._strategy = STRATEGIES["qwen"]
        # Every (cancel Event, done Event) pair for a translate() call that
        # hasn't finished self-cleanup yet, oldest first -- see the module
        # docstring's "Worker registry" and "Final fix wave" sections. `done`
        # is set once the call has actually returned -- I-1: unload() waits on
        # THIS, not on joining the calling thread (in production a
        # ThreadPoolExecutor worker, which returns to the pool instead of
        # terminating). Guarded by _workers_lock since translate() (append/
        # remove, from whatever executor thread is running it), cancel() (read
        # the tail), and unload() (snapshot + clear) can all run concurrently
        # on different threads.
        self._workers: list[tuple[threading.Event, threading.Event]] = []
        self._workers_lock = threading.Lock()

    def load(self, model_ref: str, device: str, compute_type: str, config=None) -> None:
        self.unload()
        try:
            if os.path.exists(model_ref):
                # A plain existing dir/file path passes through unchanged (used by
                # tests, and any future local-file catalog entry).
                path = model_ref
            else:
                from huggingface_hub import hf_hub_download
                repo, fname = split_artifact(model_ref)
                if not fname:
                    raise BackendLoadError(
                        f"native_translate needs an 'org/repo/file.gguf' artifact, got {model_ref!r}")
                path = hf_hub_download(repo, fname, local_files_only=True)
            # Always resolve an explicit device — including "cpu": passing NULL to
            # sk_translate_load leaves llama's defaults (n_gpu_layers=-1, all
            # devices), which fully offloads a cpu-resolved plan to the GPU on the
            # Vulkan/Metal wheels — breaking the resolver's GPU->CPU fallback and
            # corrupting the VRAM ledger (a cpu plan is supposed to claim 0).
            # native.device_for("cpu") returns the explicit CPU device, which
            # makes sk_translate_load's CPU branch set n_gpu_layers=0.
            dev = native.device_for(device)
            self._config = config or PlanConfig()
            # Unknown/missing prompt_family defaults to the qwen shape (plain
            # system+user messages) — the safest generic default among the three.
            self._strategy = STRATEGIES.get(self._config.prompt_family or "qwen", STRATEGIES["qwen"])
            self._t = native.module().translate_load(path, device=dev)
        except BackendLoadError:
            self.unload()
            raise
        except Exception as e:  # missing wheel/gguf, no vulkan/metal device, NativeError → resolver falls back
            self.unload()
            raise BackendLoadError(str(e))

    def translate(self, text: str, system_prompt: str, src: str, tgt: str,
                  wrap: bool, on_partial=None) -> tuple[str, int]:
        if self._t is None:
            raise BackendLoadError("native_translate not loaded")
        kind, payload, prefill = self._strategy.build(text, system_prompt, src, tgt, wrap, self._config)
        n = [0]
        acc = []
        # Disconnect-triggered cancel (module docstring's "Worker registry"
        # section): set by cancel()/unload() from another thread. Checked FIRST,
        # before touching acc/on_partial, so a cancelled call never emits one more
        # partial after the cancel was requested.
        cancelled = threading.Event()
        # I-1: set in the finally below once this call has actually returned --
        # unload() waits on THIS, not on joining the calling thread (see the
        # module docstring's "Final fix wave" paragraph for why that was wrong:
        # in production this thread is a ThreadPoolExecutor worker, which
        # returns to the pool instead of terminating).
        done = threading.Event()

        def on_token(piece):
            if cancelled.is_set():
                return False
            acc.append(piece)
            # Counts on_token deliveries, which since sokuji-native 1.0.1 are
            # complete-character events, not raw llama.cpp token pieces: a piece
            # that ends mid-multibyte-character is buffered and delivered with the
            # next one (R41). For Latin-script text the two counts coincide; for
            # CJK output this undercounts native tokens slightly. accel.measure_tps
            # compares GPU and CPU lanes on the same fixed text, so the ranking is
            # unaffected — only the absolute tokens/s figure moved.
            n[0] += 1
            if on_partial is not None:
                try:
                    on_partial(_clean_output("".join(acc)))
                except Exception:
                    # Per the binding's documented semantics, a raise escaping this
                    # callback is swallowed by ctypes into False and CANCELS the
                    # whole generation (SK_ERR_CANCELLED) — a broken partial
                    # consumer must cost one partial, not the entire translation.
                    pass
            return True

        # Register THIS call in the worker registry BEFORE reaching the native
        # layer (module docstring): register-on-entry/deregister-on-exit lives
        # right here, mirroring tts_backend.NativeTtsBackend.generate()'s I3/I-1
        # registration.
        entry = (cancelled, done)
        with self._workers_lock:
            self._workers.append(entry)
        try:
            # A generation failure here is not a load failure: it is not wrapped
            # into BackendLoadError — it propagates to the engine's caller,
            # mirroring the old backends' _send()/translate() raising straight
            # through. A CANCELLED generation (our own doing, via unload()/
            # cancel()) is the one exception: caught below and turned into a
            # harmless partial/empty result instead of propagating.
            try:
                if kind == "chat":
                    try:
                        full = self._t.chat(payload, max_tokens=self._strategy.max_tokens,
                                            assistant_prefill=prefill, on_token=on_token)
                    except Exception as e:
                        if cancelled.is_set():
                            raise
                        if "chat template not supported" not in str(e):
                            raise
                        # sk_translate.cpp validates the chat template BEFORE
                        # decoding the first token, so this fallback always fires
                        # token-free — no already-streamed partial can ever
                        # regress when acc/n reset here.
                        acc.clear()
                        n[0] = 0
                        prompt = _chatml_fallback(payload, prefill)
                        full = self._t.complete(prompt, max_tokens=self._strategy.max_tokens,
                                                on_token=on_token)
                else:
                    full = self._t.complete(payload, max_tokens=self._strategy.max_tokens,
                                            on_token=on_token)
            except Exception:
                if cancelled.is_set():
                    # Cancelled by cancel()/unload() (disconnect-triggered
                    # teardown — see the module docstring): the native call
                    # raised instead of returning, but this is not a generation
                    # failure. Return whatever was collected before the cancel
                    # landed (empty if none yet).
                    return _clean_output("".join(acc)), n[0]
                raise
            return _clean_output(full), n[0]
        finally:
            done.set()
            with self._workers_lock:
                if entry in self._workers:
                    self._workers.remove(entry)

    def cancel(self) -> None:
        """Signal the MOST RECENTLY STARTED translate() call to stop at its next
        token boundary (see the module docstring). Used by
        TranslateEngine.cancel_active(), itself called by _translate_teardown
        BEFORE eng.close() — signalling as early as possible, ahead of
        unload()'s own (also correct, but later) cancel+wait. A harmless no-op
        when nothing is in flight."""
        with self._workers_lock:
            if self._workers:
                self._workers[-1][0].set()

    def unload(self) -> None:
        # I3 twin / I-1 fix (module docstring's "Final fix wave" paragraph has
        # the full defect trace): cancel every outstanding translate() worker,
        # then WAIT for each one's own `done` Event — NOT join its calling
        # thread, which in production is a ThreadPoolExecutor worker that
        # returns to the pool instead of terminating — BEFORE touching the
        # model at all. sk_translate_unload takes the same per-handle mutex a
        # chat()/complete() call in flight is holding, so unloading before
        # every worker has actually finished would either block this call on
        # that mutex or — worse — free the handle out from under a still-live
        # chat()/complete() call (use-after-free; see
        # .superpowers/slice5-surface-inventory.md §10(b)).
        #
        # Snapshot-then-clear under the lock so a concurrent translate() can't
        # observe a half-cleared registry; cancel every entry, then wait on
        # every done Event against ONE shared deadline (not N *
        # _UNLOAD_DEADLINE_S) so unload()'s total worst case doesn't grow with
        # the number of outstanding workers.
        with self._workers_lock:
            workers = list(self._workers)
            self._workers.clear()
        for cancelled, _done in workers:
            cancelled.set()
        deadline = time.monotonic() + _UNLOAD_DEADLINE_S
        for _cancelled, done in workers:
            done.wait(timeout=max(0.0, deadline - time.monotonic()))
        t, self._t = self._t, None
        if t is not None:
            try:
                t.unload()
            except Exception:
                pass

    @property
    def is_loaded(self) -> bool:
        return self._t is not None
