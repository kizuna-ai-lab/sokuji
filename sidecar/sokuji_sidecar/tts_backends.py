"""TTS backend adapters, registered into the shared `backends` registry so the
accel resolver (load_with_fallback) can load them. Contract adds set_voice /
generate / generate_stream on top of load/unload; load_with_fallback only calls
load(), so sharing the registry is safe."""
import hashlib
import os
import queue
import shutil
import tempfile
import threading
import time

import numpy as np

from .backends import register_backend, BackendLoadError

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

    def load(self, model_ref: str, device: str, compute_type: str) -> None:
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

    def generate(self, text, speed=1.0):
        t0 = time.time()
        audio = self._tts.generate(text, sid=0, speed=speed)
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
    # Default to "Ava": MOSS-TTS-Nano-100M has a silence-token attractor that the
    # speaker prompt strongly modulates; the Chinese "Junhao" voice triggers long
    # mid-sentence silences on English text almost every time, while "Ava" is the
    # most reliably clean preset for English. See issue #277 (silence governance).
    PRESET_VOICE = os.environ.get("SOKUJI_MOSS_PRESET_VOICE", "Ava")

    def __init__(self):
        self._rt = None
        self._sp = None             # sentencepiece text tokenizer
        self._voice_rows = None     # prompt_audio_codes from set_voice (None -> preset)
        self.sample_rate = 24000

    # ---- loading -----------------------------------------------------------
    def load(self, model_ref: str, device: str, compute_type: str) -> None:
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
            provider = "cuda" if device == "cuda" else "cpu"
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
        key = hashlib.sha1(f"{lm_dir}|{tok_dir}".encode()).hexdigest()[:16]
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
        voice = next((v for v in voices if v.get("voice") == self.PRESET_VOICE), voices[0])
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
