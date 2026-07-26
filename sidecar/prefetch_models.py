"""Tier-0 model prefetch for the native sidecar.

Downloads the models the three native stages need into the active HuggingFace
cache (honors HF_HOME), so first-run init is offline-fast and the model-gated
tests can run. Each model is independent: a failure is reported and the rest
continue. Run via setup.sh, or directly: `.venv/bin/python prefetch_models.py`.
"""
import os
import sys

from huggingface_hub import hf_hub_download, snapshot_download

from sokuji_sidecar.catalog import _gguf_artifact, split_artifact

# The english Pocket mirror (flat model repo staged by scripts/mirror_pocket_tts.py).
POCKET_REPO = os.environ.get("SOKUJI_POCKET_TTS_EN_REPO", "jiangzhuo9357/pocket-tts-en-onnx")
# Catalog default translate row: qwen2.5-0.5b GGUF, q8_0 quant (llamacpp_qwen backend).
# Upstream-sourced (Task 14b): an "org/repo/file.gguf" artifact, not a snapshot-able repo.
TRANSLATE = _gguf_artifact("qwen2.5-0.5b", "q8_0")
# Catalog default ASR row: sense-voice via transcribe.cpp — one pinned GGUF.
from sokuji_sidecar.catalog import asr_model as _asr_model
ASR_ARTIFACT = _asr_model("sense-voice").deployments[0].artifact
# silero VAD: no clean HF mirror matches sherpa-onnx's expected signature; the canonical
# file lives in the k2-fsa release (same source family as scripts/download-sherpa-wasm.sh).
VAD_URL = os.environ.get(
    "SOKUJI_VAD_URL",
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx")


def fetch(name, **kw):
    try:
        path = snapshot_download(**kw)
        print(f"  OK  {name}: {path}")
        return path
    except Exception as e:  # one model failing must not abort the others
        print(f"  FAIL {name}: {type(e).__name__}: {e}", file=sys.stderr)
        return None


def main():
    print(f"HF_HOME={os.environ.get('HF_HOME', '(default ~/.cache/huggingface)')}\n")

    print("Pocket TTS (voice cloning):")
    pocket_root = fetch("pocket", repo_id=POCKET_REPO)

    print(f"\nTranslation LLM ({TRANSLATE}):")
    repo, fname = split_artifact(TRANSLATE)
    try:
        path = hf_hub_download(repo, fname)
        print(f"  OK  translate: {path}")
    except Exception as e:  # one model failing must not abort the others
        print(f"  FAIL translate: {type(e).__name__}: {e}", file=sys.stderr)

    print(f"\nASR sense-voice ({ASR_ARTIFACT}):")
    arepo, afname = split_artifact(ASR_ARTIFACT)
    try:
        path = hf_hub_download(arepo, afname)
        print(f"  OK  asr: {path}")
    except Exception as e:  # one model failing must not abort the others
        print(f"  FAIL asr: {type(e).__name__}: {e}", file=sys.stderr)

    print(f"\nASR VAD ({VAD_URL}):")
    try:
        import urllib.request
        cache = os.path.join(
            os.environ.get("HF_HOME", os.path.expanduser("~/.cache/huggingface")), "sokuji-vad")
        os.makedirs(cache, exist_ok=True)
        dst = os.path.join(cache, "silero_vad.onnx")
        if not os.path.exists(dst):
            urllib.request.urlretrieve(VAD_URL, dst)
        print(f"  OK  vad: {dst}")
    except Exception as e:
        print(f"  FAIL vad: {type(e).__name__}: {e}", file=sys.stderr)

    if pocket_root:
        print("\nFor the model-gated Pocket pytest (sidecar/tests):")
        print(f"  export POCKET_MODEL_DIR={pocket_root}")
    print("\nTo let the Electron app reuse this cache, launch with the same HF_HOME, e.g.:")
    print(f"  HF_HOME={os.environ.get('HF_HOME', os.path.expanduser('~/.cache/huggingface'))} npm run electron:dev")


if __name__ == "__main__":
    main()