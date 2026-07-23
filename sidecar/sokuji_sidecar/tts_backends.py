"""TTS backend adapters, registered into the shared `backends` registry so the
accel resolver (load_with_fallback) can load them. Contract adds set_voice /
generate / generate_stream on top of load/unload; load_with_fallback only calls
load(), so sharing the registry is safe."""
import hashlib
import json as _json
import logging
import os
import queue
import re
import shutil
import sys
import tempfile
import threading
import time
from pathlib import Path

import numpy as np
import soundfile as sf
# Module-level (not the other backends' local-import-inside-load() style):
# gpt_sovits_onnx's tests monkeypatch tts_backends.snapshot_download directly,
# which requires the name to live in this module's globals so load() picks up
# the patched callable instead of re-resolving huggingface_hub at call time.
from huggingface_hub import snapshot_download

from .backends import register_backend, BackendLoadError
from . import hf_symlinks as _hf_symlinks
from . import supertonic_frontend as _sf
from .cosyvoice3 import frontend as _cv3_frontend
from .cosyvoice3 import pipeline as _cv3_pipeline
from .cosyvoice3 import runtime as _cv3_runtime
from .omnivoice import decode as _omnivoice_decode
from .omnivoice import frontend as _omnivoice_frontend
from .omnivoice import higgs as _omnivoice_higgs
from .omnivoice import runtime as _omnivoice_runtime
from .qwen3_tts import codec as _q3_codec
from .qwen3_tts import config as _q3_config
from .qwen3_tts import mel as _q3_mel
from .qwen3_tts import runtime as _q3_runtime
from .qwen3_tts import template as _q3_template

logger = logging.getLogger(__name__)

# short id -> HF repo (unknown ids are treated as a repo id directly)
SHERPA_TTS_REPOS = {
    "piper-en-amy": "csukuangfj/vits-piper-en_US-amy-low",
}


@register_backend
class SherpaTtsBackend:
    """Non-cloning, one-shot sherpa-onnx OfflineTts. Currently builds a VITS
    config (piper / icefall-zh). Matcha/Kokoro families add their config branch
    here later. provider='cuda' when device=cuda (GPU build), else 'cpu'."""
    NAME = "sherpa_tts"
    STREAMING = False
    CLONES = False

    def __init__(self):
        self._tts = None
        self.sample_rate = 16000
        self._sid = 0

    def load(self, model_ref: str, device: str, compute_type: str, config=None) -> None:
        self._tts = None
        try:
            import sherpa_onnx
            from huggingface_hub import snapshot_download
            repo = SHERPA_TTS_REPOS.get(model_ref, model_ref)
            d = snapshot_download(repo_id=repo, local_files_only=True)
            onnx = next(f for f in os.listdir(d)
                        if f.endswith(".onnx") and not f.endswith(".onnx.json"))
            provider = "cuda" if device == "cuda" else "cpu"
            data_dir = f"{d}/espeak-ng-data"
            vits = sherpa_onnx.OfflineTtsVitsModelConfig(
                model=f"{d}/{onnx}", tokens=f"{d}/tokens.txt",
                data_dir=data_dir if os.path.isdir(data_dir) else "")
            # Chinese vits ships lexicon/dict instead of espeak-ng-data.
            if not os.path.isdir(data_dir) and os.path.exists(f"{d}/lexicon.txt"):
                vits.lexicon = f"{d}/lexicon.txt"
                if os.path.isdir(f"{d}/dict"):
                    vits.dict_dir = f"{d}/dict"
            cfg = sherpa_onnx.OfflineTtsConfig(
                model=sherpa_onnx.OfflineTtsModelConfig(
                    vits=vits,
                    num_threads=int(os.environ.get("SOKUJI_TTS_THREADS", "4")),
                    provider=provider),
                max_num_sentences=1)
            self._tts = sherpa_onnx.OfflineTts(cfg)
            self.sample_rate = self._tts.sample_rate
        except Exception as e:  # missing wheel / no GPU / bad repo → resolver falls back
            raise BackendLoadError(str(e))

    def set_voice(self, audio, sr):
        pass  # non-cloning

    def set_speaker(self, sid):
        self._sid = int(sid)

    def generate(self, text, speed=1.0):
        t0 = time.time()
        audio = self._tts.generate(text, sid=self._sid, speed=speed)
        return np.asarray(audio.samples, dtype=np.float32), int((time.time() - t0) * 1000)

    def unload(self) -> None:
        self._tts = None

    @property
    def is_loaded(self) -> bool:
        return self._tts is not None


# MOSS-TTS-Nano expects a sibling directory layout (the LM repo's manifest points
# at the codec repo via the relative path "../MOSS-Audio-Tokenizer-Nano-ONNX/...").
# huggingface_hub gives two unrelated cache dirs, and the runtime resolves paths
# with Path.resolve() (which follows symlinks) — so a symlinked layout escapes
# back to the separate snapshot dirs. We stage a hardlink (fallback copy) tree so
# every file is a real directory entry under one root.
_MOSS_LM_DIRNAME = "MOSS-TTS-Nano-100M-ONNX"
_MOSS_TOK_DIRNAME = "MOSS-Audio-Tokenizer-Nano-ONNX"


@register_backend
class MossOnnxTtsBackend:
    """MOSS-TTS-Nano-100M via its pure-onnxruntime core (vendored as
    moss_tts.ort_runtime). Streaming + zero-shot cloning. Incremental codec decode
    ONLY (never decode_full_audio — it attempts a single ~2.3GB alloc and OOMs).
    Torch-free: text is tokenized with sentencepiece and the reference clip is
    resampled with numpy, so none of the torch/torchaudio path is pulled in."""
    NAME = "moss_onnx"
    STREAMING = True
    CLONES = True

    def __init__(self):
        self._rt = None
        self._sp = None             # sentencepiece text tokenizer
        self._voice_rows = None     # prompt_audio_codes from set_voice (None -> preset)
        self.sample_rate = 24000
        # Default to "Ava": MOSS-TTS-Nano-100M has a silence-token attractor that the
        # speaker prompt strongly modulates; the Chinese "Junhao" voice triggers long
        # mid-sentence silences on English text almost every time, while "Ava" is the
        # most reliably clean preset for English. See issue #277 (silence governance).
        self.preset_voice = os.environ.get("SOKUJI_MOSS_PRESET_VOICE", "Ava")

    # ---- loading -----------------------------------------------------------
    def load(self, model_ref: str, device: str, compute_type: str, config=None) -> None:
        self._rt = None
        self._sp = None
        self._voice_rows = None
        try:
            import sentencepiece as spm
            from huggingface_hub import snapshot_download
            from .moss_tts.ort_runtime import OrtCpuRuntime
            tok_repo = os.environ.get("SOKUJI_MOSS_TTS_NANO_TOK_REPO",
                                      "OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano-ONNX")
            lm_dir = snapshot_download(repo_id=model_ref, local_files_only=True)
            tok_dir = snapshot_download(repo_id=tok_repo, local_files_only=True)
            root = self._stage_layout(lm_dir, tok_dir)
            # device is the resolver's TIER_DEVICE string: cuda | dml | cpu. Pass
            # the accelerator label straight to OrtCpuRuntime (which resolves the
            # provider list + verifies the session); anything else falls to cpu.
            provider = device if device in ("cuda", "dml") else "cpu"
            # OrtCpuRuntime resolves the codec repo from the manifest itself, so it
            # only takes the staged root as model_dir (no separate codec arg).
            self._rt = OrtCpuRuntime(
                model_dir=root,
                execution_provider=provider,
                thread_count=int(os.environ.get("SOKUJI_TTS_THREADS", "4")))
            tok_path = os.path.join(root, _MOSS_LM_DIRNAME, "tokenizer.model")
            self._sp = spm.SentencePieceProcessor(model_file=tok_path)
            self.sample_rate = int(self._rt.codec_meta["codec_config"]["sample_rate"])
        except Exception as e:  # missing onnxruntime-gpu / no CUDA / bad repo → fallback
            self._rt = None
            self._sp = None
            raise BackendLoadError(str(e))

    @staticmethod
    def _stage_layout(lm_dir: str, tok_dir: str) -> str:
        key = hashlib.blake2s(f"{lm_dir}|{tok_dir}".encode(), digest_size=8).hexdigest()
        root = os.path.join(tempfile.gettempdir(), "sokuji_moss_tts", key)
        MossOnnxTtsBackend._link_tree(lm_dir, os.path.join(root, _MOSS_LM_DIRNAME))
        MossOnnxTtsBackend._link_tree(tok_dir, os.path.join(root, _MOSS_TOK_DIRNAME))
        return root

    @staticmethod
    def _link_tree(src_dir: str, dst_dir: str) -> None:
        os.makedirs(dst_dir, exist_ok=True)
        for name in os.listdir(src_dir):
            src = os.path.realpath(os.path.join(src_dir, name))  # deref HF blob symlink
            if not os.path.isfile(src):
                continue
            dst = os.path.join(dst_dir, name)
            if os.path.exists(dst):
                continue
            try:
                os.link(src, dst)            # hardlink: a real entry, no symlink to follow
            except OSError:
                shutil.copy2(src, dst)       # cross-filesystem fallback

    # ---- voice cloning -----------------------------------------------------
    def set_builtin_voice(self, name: str) -> None:
        voices = self._rt.list_builtin_voices()
        match = next((v for v in voices if v.get("voice") == name), None)
        if match is None:
            raise BackendLoadError(f"unknown builtin voice: {name}")
        self._voice_rows = list(match["prompt_audio_codes"])

    def set_speaker(self, sid):
        pass  # MOSS selects voices by name/clip, not a numeric speaker id

    def set_voice(self, audio, sr):
        self._voice_rows = self._encode_reference(np.asarray(audio, dtype=np.float32), int(sr))

    def _encode_reference(self, audio: np.ndarray, sr: int):
        cfg = self._rt.codec_meta["codec_config"]
        target_sr = int(cfg["sample_rate"])
        target_ch = int(cfg["channels"])
        num_quantizers = int(cfg["num_quantizers"])
        if audio.ndim > 1:
            mono = audio.mean(axis=0).astype(np.float32)   # channel-first average
        else:
            mono = audio.astype(np.float32)
        if mono.size and sr != target_sr:
            mono = self._resample(mono, sr, target_sr)
        # (1, channels, samples): replicate mono across the codec's channel count.
        waveform = np.tile(mono[None, :], (target_ch, 1))[None, :, :].astype(np.float32)
        sess = self._rt.sessions["codec_encode"]
        outs = sess.run(None, {
            "waveform": waveform,
            "input_lengths": np.asarray([waveform.shape[-1]], dtype=np.int32),
        })
        named = dict(zip([o.name for o in sess.get_outputs()], outs))
        codes = np.asarray(named["audio_codes"], dtype=np.int32)
        code_len = int(np.asarray(named["audio_code_lengths"]).reshape(-1)[0])
        return [[int(codes[0, f, q]) for q in range(num_quantizers)] for f in range(code_len)]

    @staticmethod
    def _resample(x: np.ndarray, sr_in: int, sr_out: int) -> np.ndarray:
        n_out = int(round(x.shape[0] * sr_out / float(sr_in)))
        if n_out <= 0:
            return x.astype(np.float32)
        t_in = np.linspace(0.0, 1.0, num=x.shape[0], endpoint=False)
        t_out = np.linspace(0.0, 1.0, num=n_out, endpoint=False)
        return np.interp(t_out, t_in, x).astype(np.float32)

    # ---- synthesis ---------------------------------------------------------
    def generate(self, text, speed=1.0):
        t0 = time.time()
        parts = list(self._iter_chunks(text))
        full = np.concatenate(parts) if parts else np.zeros(0, dtype=np.float32)
        return full.astype(np.float32), int((time.time() - t0) * 1000)

    def generate_stream(self, text, speed=1.0):
        yield from self._iter_chunks(text)

    def _resolve_prompt_audio_codes(self):
        if self._voice_rows is not None:
            return self._voice_rows
        voices = self._rt.list_builtin_voices()
        voice = next((v for v in voices if v.get("voice") == self.preset_voice), voices[0])
        return list(voice["prompt_audio_codes"])

    def _iter_chunks(self, text):
        """Port of OnnxTtsRuntime._synthesize_streaming, torch-free: tokenize text,
        build voice-clone request rows, run the AR frame loop and decode each frame
        chunk INCREMENTALLY via codec_streaming_session.run_frames. The runtime's
        generate_audio_frames drives on_frame synchronously, so we run it on a worker
        thread and yield decoded audio off a queue as it is produced."""
        from .moss_tts.ort_runtime import _resolve_stream_decode_frame_budget

        rt = self._rt
        text_token_ids = [int(t) for t in self._sp.encode(str(text or ""), out_type=int)]
        prompt_audio_codes = self._resolve_prompt_audio_codes()
        request_rows = rt.build_voice_clone_request_rows(prompt_audio_codes, text_token_ids)
        sample_rate = int(rt.codec_meta["codec_config"]["sample_rate"])

        out_q: "queue.Queue" = queue.Queue()
        pending: list = []
        state = {"emitted": 0, "first_at": None}
        rt.codec_streaming_session.reset()

        def decode_pending(force: bool) -> None:
            count = len(pending)
            if count <= 0:
                return
            budget = _resolve_stream_decode_frame_budget(
                state["emitted"], sample_rate, state["first_at"])
            if not force and count < max(1, budget):
                return
            take = count if force else min(count, max(1, budget))
            frame_chunk = pending[:take]
            del pending[:take]
            decoded = rt.codec_streaming_session.run_frames(frame_chunk)
            if decoded is None:
                return
            audio, audio_length = decoded
            if audio_length <= 0:
                return
            if state["first_at"] is None:
                state["first_at"] = time.perf_counter()
            state["emitted"] += audio_length
            mono = audio[0, :, :audio_length].mean(axis=0).astype(np.float32)
            out_q.put(mono)

        def on_frame(_frames, _step_index, frame):
            pending.append(list(frame))
            decode_pending(False)

        def worker():
            try:
                rt.generate_audio_frames(request_rows, on_frame=on_frame)
                decode_pending(True)
            except Exception as exc:  # surface to the consumer
                out_q.put(exc)
            finally:
                rt.codec_streaming_session.reset()
                out_q.put(None)  # sentinel

        thread = threading.Thread(target=worker, daemon=True)
        thread.start()
        try:
            while True:
                item = out_q.get()
                if item is None:
                    break
                if isinstance(item, Exception):
                    raise item
                yield item
        finally:
            thread.join(timeout=60)
            if thread.is_alive():
                import logging
                logging.warning("moss_onnx generate worker did not finish within 60s")

    def unload(self) -> None:
        self._rt = None
        self._sp = None
        self._voice_rows = None

    @property
    def is_loaded(self) -> bool:
        return self._rt is not None


_SUPERTONIC_PRESET_CODES = ["F1", "F2", "F3", "F4", "F5", "M1", "M2", "M3", "M4", "M5"]
SUPERTONIC_VOICE_NAMES = ["Sarah", "Lily", "Jessica", "Olivia", "Emily",
                          "Alex", "James", "Robert", "Sam", "Daniel"]
_SUPERTONIC_GENDERS = ["F"] * 5 + ["M"] * 5
_SUPERTONIC_AVAILABLE_LANGS = {
    "en", "ko", "ja", "ar", "bg", "cs", "da", "de", "el", "es", "et", "fi", "fr",
    "hi", "hr", "hu", "id", "it", "lt", "lv", "nl", "pl", "pt", "ro", "ru", "sk",
    "sl", "sv", "tr", "uk", "vi"}


@register_backend
class SupertonicBackend:
    """Supertonic 3: non-AR 4-stage raw-onnxruntime diffusion TTS (port of
    supertonic-tts.worker.ts). provider='cuda' on GPU else cpu. Non-streaming,
    non-cloning; voices are pre-computed style vectors (10 presets + uploaded
    custom JSONs via set_style_voice)."""
    NAME = "supertonic"
    STREAMING = False
    CLONES = False
    _MODEL_FILES = {"dp": "onnx/duration_predictor.onnx", "tenc": "onnx/text_encoder.onnx",
                    "vest": "onnx/vector_estimator.onnx", "voc": "onnx/vocoder.onnx"}

    def __init__(self):
        self._sess = None; self._cfg = None; self._indexer = None
        self._presets = None; self._voice = None
        self.sample_rate = 44100; self._total_step = 16; self._default_sid = 7; self._lang = ""

    def load(self, model_ref, device, compute_type, config=None):
        self._sess = None
        try:
            import onnxruntime as ort
            from huggingface_hub import snapshot_download
            d = snapshot_download(repo_id=model_ref, local_files_only=True)
            # device is the resolver's TIER_DEVICE string: cuda | dml | cpu.
            # DML runs every diffusion stage (spec D2 — no AR here, but the same
            # all-graphs-on-DML rule).
            provider = (["CUDAExecutionProvider", "CPUExecutionProvider"] if device == "cuda"
                        else ["DmlExecutionProvider", "CPUExecutionProvider"] if device == "dml"
                        else ["CPUExecutionProvider"])
            opts = ort.SessionOptions()
            opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            opts.log_severity_level = 3
            opts.intra_op_num_threads = int(os.environ.get("SOKUJI_TTS_THREADS", "4"))
            self._sess = {k: ort.InferenceSession(f"{d}/{f}", sess_options=opts, providers=provider)
                          for k, f in self._MODEL_FILES.items()}
            if device == "dml":
                # Fail-fast (mirrors moss_tts _session): a session that silently
                # dropped DirectML must raise so load_with_fallback picks the cpu
                # plan instead of reporting gpu-dml while running on CPU.
                for k, s in self._sess.items():
                    if "DmlExecutionProvider" not in s.get_providers():
                        raise RuntimeError(
                            f"DmlExecutionProvider was requested but session {k!r} was "
                            f"created without it (providers: {s.get_providers()})")
            with open(f"{d}/onnx/tts.json") as fh: self._cfg = _json.load(fh)
            with open(f"{d}/onnx/unicode_indexer.json") as fh: self._indexer = _json.load(fh)
            self.sample_rate = int(self._cfg["ae"]["sample_rate"])
            self._presets = {}
            for sid, code in enumerate(_SUPERTONIC_PRESET_CODES):
                with open(f"{d}/voice_styles/{code}.json") as fh: vj = _json.load(fh)
                self._presets[sid] = (self._as_tensor(vj["style_ttl"]), self._as_tensor(vj["style_dp"]))
            self._voice = self._presets[self._default_sid]
        except Exception as e:
            raise BackendLoadError(str(e))

    @staticmethod
    def _as_tensor(field):
        return np.asarray(field["data"], dtype=np.float32).reshape(field["dims"])

    def set_language(self, lang):
        self._lang = (lang or "").split("-")[0].lower()

    def set_speaker(self, sid):
        if self._presets is None: return
        self._voice = self._presets.get(int(sid), self._presets[self._default_sid])

    def set_builtin_voice(self, name):
        try: self.set_speaker(SUPERTONIC_VOICE_NAMES.index(name))
        except ValueError: self.set_speaker(self._default_sid)

    def set_style_voice(self, style_ttl, style_dp):
        self._voice = (np.asarray(style_ttl, dtype=np.float32), np.asarray(style_dp, dtype=np.float32))

    @staticmethod
    def list_builtin_voices():
        return [{"voice": n, "gender": g} for n, g in zip(SUPERTONIC_VOICE_NAMES, _SUPERTONIC_GENDERS)]

    def _run(self, key, feeds):
        s = self._sess[key]; names = [o.name for o in s.get_outputs()]
        return dict(zip(names, s.run(names, feeds)))

    def generate(self, text, speed=1.0):
        t0 = time.time()
        style_ttl, style_dp = self._voice
        base = self._cfg["ae"]["base_chunk_size"]; ccf = self._cfg["ttl"]["chunk_compress_factor"]
        chunk = base * ccf; latent_dim = self._cfg["ttl"]["latent_dim"] * ccf
        processed = _sf.preprocess_text(text, self._lang, _SUPERTONIC_AVAILABLE_LANGS)
        text_ids = np.array([_sf.apply_indexer(processed, self._indexer)], dtype=np.int64)
        text_mask = np.ones((1, 1, text_ids.shape[1]), dtype=np.float32)
        dur = self._run("dp", {"text_ids": text_ids, "style_dp": style_dp, "text_mask": text_mask})
        d = float(np.asarray(next(iter(dur.values()))).reshape(-1)[0])
        if speed and speed > 0: d = d / speed
        tenc = self._run("tenc", {"text_ids": text_ids, "style_ttl": style_ttl, "text_mask": text_mask})
        text_emb = next(iter(tenc.values())).astype(np.float32)
        wav_len = int(d * self.sample_rate)
        latent_len = max(1, (wav_len + chunk - 1) // chunk)
        lat = (np.random.randn(1, latent_dim, latent_len) * np.sqrt(0.7)).astype(np.float32)
        latent_mask = np.ones((1, 1, latent_len), dtype=np.float32)
        total_step = np.array([self._total_step], dtype=np.float32)
        for step in range(self._total_step):
            r = self._run("vest", {"noisy_latent": lat, "text_emb": text_emb, "style_ttl": style_ttl,
                                   "latent_mask": latent_mask, "text_mask": text_mask,
                                   "current_step": np.array([step], dtype=np.float32), "total_step": total_step})
            lat = next(iter(r.values())).astype(np.float32)
        voc = self._run("voc", {"latent": lat})
        wav = np.asarray(next(iter(voc.values())), dtype=np.float32).reshape(-1)
        return (wav[:wav_len] if 0 < wav_len <= wav.size else wav), int((time.time() - t0) * 1000)

    def unload(self):
        self._sess = None; self._presets = None; self._voice = None

    @property
    def is_loaded(self):
        return self._sess is not None


# Fixed sampling config for the talker AR loop and its per-codebook subtalker,
# matching the reference sample script (run_pipeline.py `main`) exactly.
_QWEN3_TTS_SAMPLING_PARAMS = {
    "do_sample": True, "top_k": 50, "top_p": 1.0, "temperature": 0.9,
    "repetition_penalty": 1.05,
    "subtalker_dosample": True, "subtalker_top_k": 50, "subtalker_top_p": 1.0,
    "subtalker_temperature": 0.9,
}


@register_backend
class Qwen3TtsOnnxBackend:
    """Qwen3-TTS (12Hz neural codec) via the ported ONNX talker runtime
    (sokuji_sidecar.qwen3_tts). Zero-shot voice cloning from a reference clip:
    full ICL (transcript + reference codec frames) when a transcript is given,
    x-vector-only conditioning (speaker embedding alone) otherwise. Six bundled
    ICL preset voices (voices/<name>.wav|.txt in the snapshot) are selectable by
    name via set_builtin_voice — cloning from our own curated clip, the same
    code path as a user-supplied one. Non-streaming (the full AR codec loop must
    finish before a single decode() call). provider='cuda' on GPU else 'cpu'
    (see runtime.build_sessions)."""
    NAME = "qwen3tts_onnx"
    STREAMING = False
    CLONES = True

    def __init__(self):
        self._sessions = None
        self._cfg = None
        self._emb = None
        self._codec = None
        self._tok = None
        self._dir = None
        self._lang_name = None
        self._voice_prompt = None
        self._ref_ids = None
        self.sample_rate = 24000

    # ---- loading -----------------------------------------------------------
    def load(self, model_ref: str, device: str, compute_type: str, config=None) -> None:
        self._sessions = None
        self._cfg = None
        self._emb = None
        self._codec = None
        self._tok = None
        self._dir = None
        try:
            from huggingface_hub import snapshot_download
            from .qwen_tokenizer import load_qwen2_tokenizer
            d = snapshot_download(repo_id=model_ref, local_files_only=True)
            threads = int(os.environ.get("SOKUJI_TTS_THREADS", "4"))
            # The >2GB talker graph stores weights in an external *.onnx.data
            # file that stays an HF-cache symlink into ../blobs/; ORT's
            # external-data validation rejects it as escaping the model dir.
            # Deref to real files.
            _hf_symlinks.materialize_symlinks(f"{d}/onnx")
            sessions = _q3_runtime.build_sessions(f"{d}/onnx", device, threads)
            self._cfg = _q3_config.load_model_config(d)
            self._tok = load_qwen2_tokenizer(d)
            self._emb = _q3_runtime.Embeddings.from_sessions(sessions)
            self._codec = _q3_codec.Codec12Hz(sessions)
            self._sessions = sessions
            self._dir = d
        except Exception as e:  # missing onnxruntime-gpu / no CUDA / bad repo → resolver falls back
            self._sessions = None
            self._cfg = None
            self._emb = None
            self._codec = None
            self._tok = None
            self._dir = None
            raise BackendLoadError(str(e))

    def _tokenize(self, text: str) -> np.ndarray:
        ids = self._tok.encode(text, add_special_tokens=False).ids
        return np.array([ids], dtype=np.int64)

    def _spk_embed(self, wav24k: np.ndarray) -> np.ndarray:
        mels = _q3_mel.log_mel(np.asarray(wav24k, dtype=np.float32), self._cfg.speaker_encoder)
        feed = mels.T[None, ...].astype(np.float32)
        sess = self._sessions["speaker_encoder"]
        outputs = sess.run(None, {"mels": feed})
        return np.asarray(outputs[0], dtype=np.float32)[0]

    # ---- voice / language ----------------------------------------------------
    def set_language(self, lang) -> None:
        self._lang_name = _q3_template.language_name(lang)

    def set_voice(self, audio, sr, ref_text: str = "") -> None:
        wav = np.asarray(audio, dtype=np.float32)
        if wav.ndim > 1:
            wav = wav.mean(axis=0).astype(np.float32)
        if int(sr) != 24000:
            import soxr
            wav = soxr.resample(wav, int(sr), 24000).astype(np.float32)
        spk_embedding = self._spk_embed(wav)
        ref_code = self._codec.encode(wav) if ref_text else None
        self._voice_prompt = {
            "ref_code": [ref_code],
            "ref_spk_embedding": [spk_embedding],
            "x_vector_only_mode": [not bool(ref_text)],
            "icl_mode": [bool(ref_text)],
        }
        self._ref_ids = [self._tokenize(_q3_template.build_ref_text(ref_text))] if ref_text else None

    def set_builtin_voice(self, name: str) -> None:
        """Select one of the bundled ICL preset voices (voices/<name>.wav|.txt in
        the model snapshot) — cloning from our own curated reference clip, the
        same code path as a user-supplied clip. Unknown name / missing files →
        BackendLoadError (mirrors MossOnnxTtsBackend.set_builtin_voice)."""
        try:
            import soundfile
            wav_path = Path(self._dir) / "voices" / f"{name}.wav"
            txt_path = Path(self._dir) / "voices" / f"{name}.txt"
            wav, sr = soundfile.read(str(wav_path), dtype="float32", always_2d=False)
            if wav.ndim > 1:  # soundfile layout is (frames, channels) — downmix here
                wav = wav.mean(axis=1).astype(np.float32)
            ref_text = txt_path.read_text(encoding="utf-8").strip()
        except Exception:
            raise BackendLoadError(f"unknown builtin voice: {name}")
        # set_voice resamples to 24k, so the clip's native rate is fine here.
        self.set_voice(wav, sr, ref_text=ref_text)

    @staticmethod
    def list_builtin_voices():
        return []  # descriptors come from tts_voices.list_builtin_voices() (manifest-based)

    # ---- synthesis -----------------------------------------------------------
    def generate(self, text, speed=1.0):
        t0 = time.time()
        input_ids = self._tokenize(_q3_template.build_assistant_text(text))
        talker_embed, attention_mask, trailing_text_hidden, tts_pad_embed = _q3_template.build_talker_inputs(
            self._cfg, self._emb, input_ids, self._ref_ids, self._voice_prompt, self._lang_name)

        eos_token_id = int(self._cfg.talker.codec_eos_token_id)
        vocab_size = int(self._cfg.talker.vocab_size)
        suppress_tokens = [i for i in range(vocab_size - 1024, vocab_size) if i != eos_token_id]
        max_new_tokens = int(os.environ.get("SOKUJI_QWEN3_TTS_MAX_FRAMES", "600"))

        # Verification hooks: a fixed seed and/or greedy decoding make runs
        # reproducible so optimized code paths can be A/B-compared numerically.
        seed = os.environ.get("SOKUJI_QWEN3_TTS_SEED")
        rng = np.random.default_rng(int(seed)) if seed else np.random.default_rng()
        sampling_params = _QWEN3_TTS_SAMPLING_PARAMS
        if os.environ.get("SOKUJI_QWEN3_TTS_GREEDY"):
            sampling_params = dict(sampling_params, do_sample=False, subtalker_dosample=False)

        codes_list, _hidden_list = _q3_runtime.generate_codes(
            self._sessions, self._cfg.talker,
            talker_embed, attention_mask, trailing_text_hidden, tts_pad_embed,
            max_new_tokens=max_new_tokens, sampling_params=sampling_params,
            eos_token_id=eos_token_id, suppress_tokens=suppress_tokens,
            rng=rng)
        codes = codes_list[0]

        ref_code = self._voice_prompt["ref_code"][0] if self._voice_prompt else None
        if ref_code is not None:
            # The ref prefix exists only to warm up the vocoder's receptive
            # field before the generated frames; decoding all ~100 frames of
            # the reference clip costs more codec time than a short utterance
            # itself. Keep a ~1s tail as context (ASR-loopback verified);
            # SOKUJI_QWEN3_TTS_REF_DECODE_FRAMES=-1 restores the full prefix.
            max_ref = int(os.environ.get("SOKUJI_QWEN3_TTS_REF_DECODE_FRAMES", "12"))
            if 0 <= max_ref < int(ref_code.shape[0]):
                ref_code = ref_code[int(ref_code.shape[0]) - max_ref:]
            codes_for_decode = np.concatenate([ref_code, codes], axis=0)
        else:
            codes_for_decode = codes
        wav = self._codec.decode(codes_for_decode)
        if ref_code is not None:
            ref_len = int(ref_code.shape[0])
            total_len = int(codes_for_decode.shape[0])
            if total_len > 0:
                cut = int(ref_len / total_len * wav.shape[0])
                wav = wav[cut:]

        return wav.astype(np.float32), int((time.time() - t0) * 1000)

    def unload(self) -> None:
        self._sessions = None
        self._cfg = None
        self._emb = None
        self._codec = None
        self._tok = None
        self._voice_prompt = None
        self._ref_ids = None

    @property
    def is_loaded(self) -> bool:
        return self._sessions is not None


# ---------------------------------------------------------------------------
# CosyVoice3 (Fun-CosyVoice3-0.5B) — issue #323. Fresh torch-free ONNX
# pipeline (see sokuji_sidecar.cosyvoice3): int4 LLM backbones + fp32
# flow/HiFT graphs from our own conversion of the community export.

_COSYVOICE3_DEFAULT_VOICE = "classic-zh"


@register_backend
class CosyVoice3OnnxBackend:
    """CosyVoice 3 (Fun-CosyVoice3-0.5B) zero-shot voice cloning TTS.

    Fresh torch-free ONNX pipeline (issue #323): int4 LLM backbones +
    fp32 flow/HiFT graphs from our own conversion of the community
    export. GPU-CUDA-only card; the CPU tier misses the realtime bar
    (spike RTF ~3.5) and is deliberately not shipped.
    ICL cloning: reference clip + transcript, both for bundled voices/
    presets and user clips (transcript required).
    """

    NAME = "cosyvoice3_onnx"
    STREAMING = False
    CLONES = True

    def __init__(self):
        self.sample_rate = 24000
        self._sessions = None
        self._tok = None
        self._dir = None
        self._prompt = None
        self._voice_cache = {}
        self._rng = None

    @property
    def is_loaded(self):
        return self._sessions is not None

    def load(self, model_ref: str, device: str, compute_type: str, config=None) -> None:
        try:
            # a reload (e.g. switching deployments) must not keep voice
            # prompts computed with the previous sessions/tokenizer
            self.unload()
            d = snapshot_download(repo_id=model_ref, local_files_only=True)
            threads = int(os.environ.get("SOKUJI_TTS_THREADS", "4"))
            self._tok = _cv3_frontend.load_tokenizer(d)
            self._sessions = _cv3_runtime.build_sessions(d, device, threads)
            self._dir = d
            self._rng = np.random.default_rng()
        except Exception as e:
            self.unload()
            raise BackendLoadError(str(e))

    def unload(self) -> None:
        self._sessions = None
        self._tok = None
        self._dir = None
        self._prompt = None
        self._voice_cache = {}

    def set_voice(self, audio, sr, ref_text: str = "") -> None:
        if not self.is_loaded:
            raise BackendLoadError("cosyvoice3 backend is not loaded")
        if not ref_text or not ref_text.strip():
            raise BackendLoadError("cosyvoice3 requires the reference transcript")
        audio32 = np.asarray(audio, dtype=np.float32)
        key = "custom:" + hashlib.sha1(
            audio32.tobytes() + str(int(sr)).encode() + ref_text.encode("utf-8")
        ).hexdigest()
        if key not in self._voice_cache:
            self._voice_cache[key] = _cv3_pipeline.process_prompt(
                self._sessions, self._tok, audio32, int(sr), ref_text)
        self._prompt = self._voice_cache[key]

    def set_builtin_voice(self, name: str) -> None:
        """Select one of the bundled ICL preset voices (voices/<name>.wav|.txt
        in the model snapshot) — cloning from our own curated reference clip,
        the same code path as a user-supplied clip. Unknown name / missing
        files -> BackendLoadError (mirrors Qwen3TtsOnnxBackend.set_builtin_voice)."""
        if not self.is_loaded:
            raise BackendLoadError("cosyvoice3 backend is not loaded")
        # names come over the wire: allow-list the charset so a crafted name
        # like "../../etc/x" can never resolve outside the voices/ directory
        if not re.fullmatch(r"[A-Za-z0-9._-]+", name) or ".." in name:
            raise BackendLoadError(f"unknown builtin voice: {name}")
        if name in self._voice_cache:
            self._prompt = self._voice_cache[name]
            return
        wav_path = f"{self._dir}/voices/{name}.wav"
        txt_path = f"{self._dir}/voices/{name}.txt"
        if not (os.path.exists(wav_path) and os.path.exists(txt_path)):
            raise BackendLoadError(f"unknown builtin voice: {name}")
        try:
            audio, sr = sf.read(wav_path, dtype="float32", always_2d=False)
            if audio.ndim > 1:  # soundfile layout is (frames, channels) — downmix here
                audio = audio.mean(axis=1).astype(np.float32)
            with open(txt_path, encoding="utf-8") as f:
                transcript = f.read().strip()
            prompt = _cv3_pipeline.process_prompt(
                self._sessions, self._tok, audio, sr, transcript)
        except Exception as e:
            raise BackendLoadError(str(e))
        self._voice_cache[name] = prompt
        self._prompt = prompt

    def generate(self, text, speed=1.0):
        if self._prompt is None:
            self.set_builtin_voice(
                os.environ.get("SOKUJI_COSYVOICE3_PRESET_VOICE", _COSYVOICE3_DEFAULT_VOICE))
        t0 = time.time()
        audio = _cv3_pipeline.synthesize(
            self._sessions, self._tok, text, self._prompt, self._rng,
            speed=float(speed))
        return audio.astype(np.float32), int((time.time() - t0) * 1000)

    @staticmethod
    def list_builtin_voices():
        return []  # descriptors come from voices/manifest.json (tts_voices)


# ---------------------------------------------------------------------------
# OmniVoice (k2-fsa/OmniVoice, corrected bidirectional re-export) — issue #351.
# 600+ language zero-shot cloning: Qwen3-0.6B backbone + Higgs Audio V2 codec,
# 32-step non-autoregressive iterative unmasking (sokuji_sidecar.omnivoice).
# Transcript-free cloning (no ICL reference text, unlike CosyVoice3/Qwen3-TTS/
# GPT-SoVITS above) — set_voice takes only (audio, sr); the engine's
# inspect.signature introspection (tts_engine.py:66-73) calls it without
# ref_text. GPU-CUDA-only card: the fp16/int4 backbone variants are CUDA-tuned
# and no cpu deployment is shipped.
# Curated presets (issue #351 follow-up): the repo ships
# voices/{classic-zh,classic-ja,sarah}.wav + voices/manifest.json
# (classic-zh is the default) — set_builtin_voice() reads only the .wav
# (still transcript-free) and generate() falls back to the "classic-zh"
# preset when no reference voice has been set, replacing the previous
# random-init auto-voice default with a stable one.

_OMNIVOICE_DECODE_CFG = _omnivoice_decode.DecodeConfig()


@register_backend
class OmniVoiceOnnxBackend:
    """OmniVoice zero-shot voice cloning TTS, transcript-free.

    Self-contained per-variant repo: the 3 HOT backbone graphs (audio_embeddings
    / llm_decoder / audio_heads) + tokenizer live at the repo ROOT, and the
    shared Higgs codec graphs in `audio_tokenizer/` (the 4 COLD graphs). Each
    precision (bf16 / fp32 / int4) is its own repo, so only the chosen variant
    downloads; `compute_type` is informational here (the repo IS the variant).
    `runtime.build_sessions` applies the per-graph execution-provider policy
    (HOT graphs on the requested device, COLD graphs always CPU).
    """

    NAME = "omnivoice_onnx"
    STREAMING = False
    CLONES = True

    def __init__(self):
        self.sample_rate = 24000
        self._sessions = None
        self._tok = None
        self._ref_codes = None
        self._dir = None
        self._voice_cache = {}

    @property
    def is_loaded(self):
        return self._sessions is not None

    def load(self, model_ref: str, device: str, compute_type: str, config=None) -> None:
        try:
            # a reload (e.g. switching deployments) must not keep a reference
            # voice encoded with the previous sessions
            self.unload()
            d = snapshot_download(repo_id=model_ref, local_files_only=True)
            self._dir = d
            threads = int(os.environ.get("SOKUJI_TTS_THREADS", "4"))
            model_dir = d              # backbone at the repo root (self-contained variant repo)
            higgs_dir = f"{d}/audio_tokenizer"
            # sbsa/aarch64: onnxruntime 1.24 rejects the HF-cache symlinked
            # .onnx.data files ("escapes model directory") — deref both dirs
            # before building sessions, same as every other ONNX backend.
            _hf_symlinks.materialize_symlinks(model_dir)
            _hf_symlinks.materialize_symlinks(higgs_dir)
            self._tok = _omnivoice_frontend.load_tokenizer(model_dir)
            self._sessions = _omnivoice_runtime.build_sessions(
                model_dir, higgs_dir, device, threads)
        except Exception as e:
            self.unload()
            raise BackendLoadError(str(e))

    def unload(self) -> None:
        self._sessions = None
        self._tok = None
        self._dir = None
        self._ref_codes = None
        self._voice_cache = {}

    def set_voice(self, audio, sr) -> None:
        if not self.is_loaded:
            raise BackendLoadError("omnivoice backend is not loaded")
        wav = np.asarray(audio, dtype=np.float32)
        if wav.ndim > 1:
            # Reference clips reach set_voice channel-first ([channels,
            # samples]), matching MOSS._encode_reference / mlx_tts.set_voice —
            # average over the CHANNEL axis (0), not the sample/time axis.
            wav = wav.mean(axis=0).astype(np.float32)
        # Trim silence + cap length + loudness-normalize: a long or silence-
        # padded or quiet user recording otherwise clones to near-silence
        # (the ref-code prefix destabilizes the non-AR decode). No-op for the
        # short curated presets. See higgs.prepare_reference.
        wav = _omnivoice_higgs.prepare_reference(wav, int(sr))
        # higgs.encode_reference is path-only (reads the clip from disk), so
        # stage it to a temp wav and remove it once encoding is done.
        fd, path = tempfile.mkstemp(prefix="sokuji_omnivoice_ref_", suffix=".wav")
        os.close(fd)
        try:
            sf.write(path, wav, int(sr))
            self._ref_codes = _omnivoice_higgs.encode_reference(self._sessions, path)
        finally:
            try:
                os.remove(path)
            except OSError:
                pass

    def set_builtin_voice(self, name: str) -> None:
        """Select one of the bundled curated preset voices (voices/<name>.wav
        in the model snapshot) — issue #351 follow-up. OmniVoice cloning is
        transcript-free (unlike CosyVoice3's ICL presets), so only the .wav
        is read: no transcript, no denoise-vs-ref distinction beyond what
        set_voice() already does. Unknown name -> BackendLoadError (mirrors
        CosyVoice3OnnxBackend.set_builtin_voice)."""
        if not self.is_loaded:
            raise BackendLoadError("omnivoice backend is not loaded")
        # names come over the wire: allow-list the charset so a crafted name
        # like "../../etc/x" can never resolve outside the voices/ directory
        if not re.fullmatch(r"[A-Za-z0-9._-]+", name) or ".." in name:
            raise BackendLoadError(f"unknown builtin voice: {name}")
        if name in self._voice_cache:
            self._ref_codes = self._voice_cache[name]
            return
        wav_path = f"{self._dir}/voices/{name}.wav"
        if not os.path.exists(wav_path):
            raise BackendLoadError(f"unknown builtin voice: {name}")
        codes = _omnivoice_higgs.encode_reference(self._sessions, wav_path)
        self._voice_cache[name] = codes
        self._ref_codes = codes

    # ~0.1s of silence stitched between synthesized chunks so phrases don't
    # run together (24 kHz).
    _CHUNK_GAP = 2400

    @staticmethod
    def _trim_edges(audio, sr=24000, keep=0.1):
        """Trim leading/trailing silence from a synthesized chunk, keeping
        ~`keep` seconds of natural margin. The duration-slack budget (see
        frontend.TTS_TARGET_SLACK) is mostly emitted as LEADING silence
        (measured 0.7-0.9s per chunk) — dead air that delays time-to-speech
        in a live translation session."""
        win = max(1, int(sr * 0.02))
        n = audio.size // win
        if not n:
            return audio
        energy = np.sqrt((audio[:n * win].reshape(n, win) ** 2).mean(axis=1))
        thr = max(1e-3, float(energy.max()) * 0.05)
        voiced = np.where(energy > thr)[0]
        if not voiced.size:
            return audio
        margin = int(sr * keep)
        start = max(0, voiced[0] * win - margin)
        end = min(audio.size, (voiced[-1] + 1) * win + margin)
        return audio[start:end]

    def _generate_one(self, text, speed):
        """Synthesize a single short phrase -> float32 waveform (24 kHz)."""
        # +25% duration slack so a slow prosody draw doesn't truncate the
        # sentence tail — see frontend.TTS_TARGET_SLACK.
        n = int(_omnivoice_frontend.estimate_target_tokens(text, speed=float(speed))
                * _omnivoice_frontend.TTS_TARGET_SLACK)
        has_ref = self._ref_codes is not None
        ids, amask, _ = _omnivoice_frontend.build_input_ids(
            self._tok, text, lang=None, ref_codes=self._ref_codes,
            num_target_tokens=n, denoise=has_ref)
        codes = _omnivoice_decode.generate_codes(
            self._sessions, ids, amask, n, cfg=_OMNIVOICE_DECODE_CFG)
        audio = np.asarray(_omnivoice_higgs.decode(self._sessions, codes), np.float32)
        return self._trim_edges(audio)

    def generate(self, text, speed=1.0):
        if self._ref_codes is None:
            # STABLE default voice out of the box (replaces the previous
            # random auto-voice default) — issue #351 follow-up.
            self.set_builtin_voice(
                os.environ.get("SOKUJI_OMNIVOICE_PRESET_VOICE", "classic-zh"))
        t0 = time.time()
        # OmniVoice's single-shot decode garbles long inputs (a 15-word sentence
        # returns near-noise), so split long text into short phrases and stitch
        # the per-chunk audio. Short text -> one chunk (unchanged).
        chunks = _omnivoice_frontend.split_for_tts(text)
        parts = []
        gap = np.zeros(self._CHUNK_GAP, np.float32)
        for i, chunk in enumerate(chunks):
            if i:
                parts.append(gap)
            parts.append(self._generate_one(chunk, speed))
        audio = np.concatenate(parts) if parts else np.zeros(0, np.float32)
        return audio.astype(np.float32), int((time.time() - t0) * 1000)

    @staticmethod
    def list_builtin_voices():
        return []  # descriptors come from voices/manifest.json (tts_voices)


# ---------------------------------------------------------------------------
# GPT-SoVITS (v2ProPlus) via the vendored Genie-TTS ONNX runtime — issue #322.
# CPU + CUDA tiers; fp16 bins expand to fp32 at load (see gpt_sovits.runtime).

_GPT_SOVITS_LANGS = {"zh": "chinese", "en": "english", "ja": "japanese"}


def _gpt_sovits_detect_language(text: str) -> str:
    """Best-effort language of a reference transcript (wire carries no refLang).

    Kana wins over Han (ja text usually mixes both); Han without kana is
    treated as Chinese — kanji-only Japanese is genuinely ambiguous, zh is the
    documented default. TODO(#322): consider a refLang wire field later.
    """
    if any("぀" <= ch <= "ヿ" for ch in text):
        return "japanese"
    if any("一" <= ch <= "鿿" for ch in text):
        return "chinese"
    return "english"


def _gpt_sovits_effective_len(text: str) -> int:
    """Count phoneme-bearing characters (CJK chars and latin letters)."""
    return sum(1 for ch in text
               if ch.isalpha() or "぀" <= ch <= "ヿ"
               or "一" <= ch <= "鿿")


def _gpt_sovits_stage_real_tree(src_dir: str) -> str:
    """Mirror a directory into real files if it contains symlinks.

    HF-cache snapshots are symlink farms into blobs/, and nltk's pathsec
    (used by the English G2P's perceptron tagger) rejects files whose
    realpath escapes its authorized roots — so the EnglishG2P dir must be
    materialized as real files before nltk touches it (recursive variant of
    MOSS's _link_tree; hardlink first, copy on cross-device).
    Returns src_dir unchanged when it already contains no symlinks.
    """
    has_symlink = False
    for root, _dirs, files in os.walk(src_dir):
        if any(os.path.islink(os.path.join(root, f)) for f in files):
            has_symlink = True
            break
    if not has_symlink:
        return src_dir
    # Stage NEXT TO the source (inside the user-private HF snapshot, like the
    # fp32 bin expansion), never in the world-writable tempdir — a predictable
    # /tmp path would let a local attacker pre-plant files that the
    # idempotent skip below would adopt.
    staged = src_dir + ".staged"
    if os.path.isdir(staged):
        # Built atomically (rename below), so existence == complete.
        return staged
    # Symlink targets must stay inside the HF repo cache (snapshots link into
    # its sibling blobs/); a link escaping it would materialize arbitrary
    # local files into the staged tree.
    allowed_root = None
    probe = os.path.dirname(src_dir)
    while probe != os.path.dirname(probe):
        if os.path.isdir(os.path.join(probe, "blobs")):
            allowed_root = os.path.realpath(probe)
            break
        probe = os.path.dirname(probe)
    tmp_root = f"{staged}.tmp{os.getpid()}"
    shutil.rmtree(tmp_root, ignore_errors=True)
    try:
        for root, _dirs, files in os.walk(src_dir):
            rel = os.path.relpath(root, src_dir)
            dst_root = tmp_root if rel == "." else os.path.join(tmp_root, rel)
            os.makedirs(dst_root, exist_ok=True)
            for name in files:
                src = os.path.realpath(os.path.join(root, name))
                if allowed_root is not None and not src.startswith(allowed_root + os.sep):
                    print(f"[gpt_sovits] skipping {name}: symlink target escapes "
                          f"the model cache ({src})", file=sys.stderr, flush=True)
                    continue
                dst = os.path.join(dst_root, name)
                try:
                    os.link(src, dst)
                except OSError:
                    shutil.copy2(src, dst)
        try:
            os.rename(tmp_root, staged)  # atomic: complete trees only
        except OSError:
            if not os.path.isdir(staged):  # lost a race to another process?
                raise
    finally:
        shutil.rmtree(tmp_root, ignore_errors=True)
    return staged


@register_backend
class GptSovitsOnnxBackend:
    NAME = "gpt_sovits_onnx"
    STREAMING = False
    CLONES = True
    # Inputs shorter than this synthesize unreliably on GPT-SoVITS (upstream
    # short-text hazards, spike 2026-07-16) — return brief silence instead.
    MIN_EFFECTIVE_CHARS = 2

    def __init__(self):
        self.sample_rate = 32000
        self._sessions = None
        self._synth = None
        self._hubert = None
        self._reference = None
        self._language = "english"
        self._snapshot = None

    @property
    def is_loaded(self):
        return self._synth is not None

    def load(self, model_ref, device, compute_type, config=None):
        from .gpt_sovits import assets as _gs_assets
        from .gpt_sovits import runtime as _gs_runtime
        try:
            d = snapshot_download(repo_id=model_ref, local_files_only=True)
            model_dir = os.path.join(d, "model")
            genie_dir = os.path.join(d, "genie_data")
            _gs_runtime.ensure_fp32_bins(model_dir)
            _gs_runtime.ensure_fp32_bins(
                os.path.join(genie_dir, "chinese-hubert-base"))
            # HF-cache weight bins shipped pre-expanded (e.g. t2s_encoder_fp32.bin)
            # stay symlinks into ../blobs/; ORT's external-data path validation
            # rejects those as escaping the model dir. Deref to real files first.
            _gs_runtime.ensure_real_bins(model_dir)
            _gs_runtime.ensure_real_bins(
                os.path.join(genie_dir, "chinese-hubert-base"))
            _gs_assets.configure(
                chinese_g2p_dir=os.path.join(genie_dir, "G2P", "ChineseG2P"),
                # EnglishG2P must be real files: nltk pathsec rejects HF-cache
                # blob symlinks (production-path smoke, 2026-07-17).
                english_g2p_dir=_gpt_sovits_stage_real_tree(
                    os.path.join(genie_dir, "G2P", "EnglishG2P")))
            self._sessions = _gs_runtime.build_model_sessions(model_dir, device)
            self._hubert = _gs_runtime.make_session(
                os.path.join(genie_dir, "chinese-hubert-base",
                             "chinese-hubert-base.onnx"), device)
            sv = _gs_runtime.make_session(
                os.path.join(genie_dir, "speaker_encoder.onnx"), device)
            roberta = self._load_roberta(genie_dir, device)
            from .gpt_sovits.inference import Synthesizer
            self._synth = Synthesizer(self._sessions, sv_session=sv,
                                      roberta=roberta)
            self._snapshot = d
        except Exception as e:  # noqa: BLE001 — contract: wrap all load failures
            self.unload()
            raise BackendLoadError(f"gpt_sovits_onnx load failed: {e}") from e

    def _load_roberta(self, genie_dir, device):
        from .gpt_sovits import runtime as _gs_runtime
        onnx_path = os.path.join(genie_dir, "RoBERTa", "RoBERTa.onnx")
        tok_path = os.path.join(genie_dir, "RoBERTa", "roberta_tokenizer",
                                "tokenizer.json")
        if not (os.path.isfile(onnx_path) and os.path.isfile(tok_path)):
            return None  # zh prosody degrades to zero BERT features
        from tokenizers import Tokenizer
        return (_gs_runtime.make_session(onnx_path, device),
                Tokenizer.from_file(tok_path))

    def set_language(self, lang):
        if not lang:
            return
        key = lang.lower().split("-")[0]
        if key not in _GPT_SOVITS_LANGS:
            raise ValueError(f"gpt_sovits_onnx does not support language {lang!r}")
        self._language = _GPT_SOVITS_LANGS[key]

    def set_voice(self, audio, sr, ref_text=""):
        if not ref_text or not ref_text.strip():
            raise ValueError(
                "gpt_sovits_onnx cloning requires the reference transcript "
                "(transcript_required=True)")
        from .gpt_sovits.reference import build_reference
        self._reference = build_reference(
            np.asarray(audio, dtype=np.float32), int(sr), ref_text.strip(),
            _gpt_sovits_detect_language(ref_text), self._hubert)

    def set_builtin_voice(self, name):
        import soundfile
        base = os.path.join(self._snapshot, "voices", name)
        if not (os.path.isfile(base + ".wav") and os.path.isfile(base + ".txt")):
            # A stale renderer setting can carry another model's voice name
            # (seen live: pocket's 'eponine' arriving here). Degrade to the
            # card's default voice rather than killing TTS for the session.
            default = self._default_voice_name()
            if default is None or default == name:
                raise BackendLoadError(f"unknown builtin voice: {name}")
            print(f"[gpt_sovits_onnx] unknown builtin voice {name!r}; "
                  f"falling back to default '{default}'", file=sys.stderr, flush=True)
            base = os.path.join(self._snapshot, "voices", default)
        wav, sr = soundfile.read(base + ".wav", dtype="float32")
        with open(base + ".txt", encoding="utf-8") as f:
            transcript = f.read().strip()
        self.set_voice(wav, sr, ref_text=transcript)

    def _default_voice_name(self):
        """Default entry from voices/manifest.json, or None when unavailable."""
        manifest_path = os.path.join(self._snapshot, "voices", "manifest.json")
        if not os.path.isfile(manifest_path):
            return None
        with open(manifest_path, encoding="utf-8") as f:
            voices = _json.load(f)
        if not voices:
            return None
        entry = next((v for v in voices if v.get("default")), voices[0])
        return entry["name"]

    def _ensure_voice(self):
        """Callers (notably accel.measure_rtf_tts, which benches right after
        load() with no set_voice/set_builtin_voice call) may invoke generate()
        before any voice is selected. Fall back to the card's default builtin
        voice — mirrors MossTtsBackend._resolve_prompt_audio_codes' fallback
        to the first builtin voice."""
        if self._reference is not None:
            return
        name = self._default_voice_name()
        if name is None:
            raise RuntimeError("gpt_sovits_onnx: no voice set — call set_voice first")
        print(f"[gpt_sovits_onnx] no voice set; using default builtin '{name}'",
              file=sys.stderr, flush=True)
        self.set_builtin_voice(name)

    def generate(self, text, speed=1.0):
        # NOTE: `speed` is accepted for engine-contract parity but not applied:
        # the converted VITS graph exposes no length/rate control (upstream
        # genie-tts has no speed parameter either), and naive resampling would
        # shift pitch. Revisit if a length_scale input lands upstream.
        self._ensure_voice()
        text = (text or "").strip()
        t0 = time.time()
        if _gpt_sovits_effective_len(text) < self.MIN_EFFECTIVE_CHARS:
            print(f"[gpt_sovits_onnx] input {text!r} below min length; emitting silence", file=sys.stderr, flush=True)
            return np.zeros(int(0.15 * self.sample_rate), dtype=np.float32), 0

        # Long inputs must be sentence-split before synthesis: the vendored
        # AR t2s loop is capped at MAX_AR_STEPS and degrades badly on long
        # multi-sentence inputs. TextSplitter is a one-shot batch API (no
        # feed/flush) — split() ahead of time, then synthesize per chunk.
        from .gpt_sovits.text_splitter import TextSplitter
        chunks = TextSplitter(max_len=40, min_len=5).split(text)
        # Unreachable in practice (short inputs are pre-guarded); belt against splitter returning [].
        if not chunks:
            chunks = [text]

        results = []
        any_chunk_errored = False
        for chunk in chunks:
            try:
                samples = self._synth.synthesize(chunk, self._reference, self._language)
            except Exception:
                # zh G2P has known crash inputs (e.g. vowel-less nasals); a live
                # translation session must survive them. Fixed upstream cases
                # are guarded in the vendored ToneSandhi; this is the safety
                # net — skip the bad chunk and keep going.
                any_chunk_errored = True
                logger.exception(
                    "gpt_sovits_onnx: synthesis failed for chunk %r; skipping", chunk)
                continue
            if samples is not None:
                results.append(np.asarray(samples, dtype=np.float32).reshape(-1))

        if not results:
            if any_chunk_errored:
                # Deliberate: if ANY chunk raised, degrade the whole call to silence — keep the live session alive rather than hard-fail on partial G2P crashes.
                print("[gpt_sovits_onnx] all chunks failed; emitting silence", file=sys.stderr, flush=True)
                return np.zeros(int(0.15 * self.sample_rate), dtype=np.float32), 0
            # A script/language mismatch (e.g. zh text through the English
            # G2P when tts_init carried no language) degenerates the AR loop
            # to instant EOS — name the likely cause in the error.
            detected = _gpt_sovits_detect_language(text)
            hint = ("" if detected == self._language else
                    f" (text looks {detected} but the session language is "
                    f"{self._language} — was tts_init sent without language?)")
            raise RuntimeError(f"gpt_sovits_onnx: synthesis produced no audio{hint}")

        samples = results[0] if len(results) == 1 else np.concatenate(results)
        gen_ms = int((time.time() - t0) * 1000)
        return samples.astype(np.float32), gen_ms

    def unload(self):
        self._sessions = None
        self._synth = None
        self._hubert = None
        self._reference = None
        self._snapshot = None
@register_backend
class PocketOnnxTtsBackend:
    """Pocket TTS (Kyutai CALM zero-shot voice cloning) via int8 ONNX on CPU.

    One language per model repo — the bundle's flow-LM is language-specific;
    all bundles ship the same eight predefined voices in voices.bin (KV-cache
    prefixes, so picking one skips the reference-encode prefill entirely).
    CPU-only by measurement: the int8 seqlen-1 AR decode is memory-bound and
    runs well above realtime on CPU, while the int8 operator set
    (MatMulInteger/DynamicQuantizeLinear) has no validated GPU kernel path.
    Runtime lives in pocket_inference/pocket_bundle/pocket_tokenizer."""
    NAME = "pocket_onnx"
    STREAMING = False
    CLONES = True

    def __init__(self):
        self._sessions = None
        self._meta = None
        self._bos = None
        self._tok = None
        self._flow = None       # voice-conditioned flow-LM state (KV prefix)
        self._voices = None     # parsed voices.bin, loaded on first builtin pick
        self._dir = None
        self.sample_rate = 24000
        self.preset_voice = os.environ.get("SOKUJI_POCKET_PRESET_VOICE", "alba")

    def load(self, model_ref: str, device: str, compute_type: str, config=None) -> None:
        self.unload()
        try:
            from huggingface_hub import snapshot_download
            from . import pocket_bundle as pb
            from . import pocket_inference as pi
            from .pocket_tokenizer import PocketTokenizer
            d = snapshot_download(repo_id=model_ref, local_files_only=True)
            self._sessions = pi.load_sessions(
                d, int(os.environ.get("POCKET_NATIVE_THREADS", "2")))
            with open(os.path.join(d, pb.METADATA_FILE), encoding="utf-8") as f:
                self._meta = _json.load(f)
            self._bos = (pb.parse_npy_float32(os.path.join(d, pb.BOS_FILE))
                         if self._meta.get("insert_bos_before_voice") else None)
            self._tok = PocketTokenizer(os.path.join(d, pb.TOKENIZER_FILE))
            self.sample_rate = int(self._meta.get("sample_rate", pb.SAMPLE_RATE))
            self._dir = d
        except Exception as e:  # missing snapshot / bad bundle -> resolver fallback
            self.unload()
            raise BackendLoadError(str(e))

    # ---- voices ----------------------------------------------------------
    def set_voice(self, audio, sr):
        from . import pocket_inference as pi
        ref = pi.resample_to_24k(np.asarray(audio, dtype=np.float32), int(sr))
        emb = pi.encode_reference(self._sessions, ref)
        self._flow = pi.build_voice_conditioned_state(
            self._sessions, self._meta, emb, self._bos)

    def set_builtin_voice(self, name: str) -> None:
        from . import pocket_bundle as pb
        from . import pocket_inference as pi
        if self._voices is None:
            self._voices = pb.parse_voices_bin(os.path.join(self._dir, pb.VOICES_FILE))
        record = self._voices.get(name)
        if record is None:
            raise BackendLoadError(f"unknown builtin voice: {name}")
        self._flow = pi.state_from_voice_record(self._meta, record)

    def set_speaker(self, sid):
        pass  # Pocket selects voices by name/clip, not a numeric speaker id

    # ---- synthesis -------------------------------------------------------
    def generate(self, text, speed=1.0):
        # `speed` is a deliberate no-op: frame count is EOS-governed (upstream
        # behaviour). No voice picked yet -> apply the preset; the post-load RTF
        # probe generates before the renderer ever sends set_voice, and the
        # predefined-voice path skips the reference-encode prefill entirely.
        from . import pocket_bundle as pb
        from . import pocket_inference as pi
        if self._flow is None:
            self.set_builtin_voice(self.preset_voice)
        t0 = time.time()
        ids = np.array(self._tok.encode_ids(text), np.int64).reshape(1, -1)
        tc = self._sessions["textConditioner"].run(None, {"token_ids": ids})[0]
        out = pi.generate(self._sessions, self._meta, tc, self._flow,
                          lsd_steps=pb.DEFAULT_LSD_STEPS,
                          max_frames=pb.DEFAULT_MAX_FRAMES)
        return out, int((time.time() - t0) * 1000)

    def unload(self) -> None:
        self._sessions = None
        self._meta = None
        self._bos = None
        self._tok = None
        self._flow = None
        self._voices = None
        self._dir = None

    @property
    def is_loaded(self) -> bool:
        return self._sessions is not None


# Registered in a separate module (Apple-Silicon-only mlx-audio), imported here so
# `from . import tts_backends` (tts_engine startup) self-registers mlx_audio_tts
# too — mirrors backends.py bottom-importing transcribe_backend. Import-safe on
# Linux: mlx_tts only touches mlx_audio lazily inside load().
from . import mlx_tts  # noqa: E402,F401
