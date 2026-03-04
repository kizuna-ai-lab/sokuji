#!/usr/bin/env python3
"""
Build a browser-ready WASM package for sherpa-onnx ASR models.

Downloads the selected model, packs it into an Emscripten .data file,
patches the JS glue from the appropriate reference directory, and copies
shared WASM assets.

Two WASM engines are supported:

  - Offline (VAD+ASR): Uses sherpa-onnx-wasm-main-vad-asr.{js,wasm,data}
    plus sherpa-onnx-asr.js and sherpa-onnx-vad.js.
    Reference: public/wasm/sherpa-onnx-asr-sensevoice/

  - Streaming: Uses sherpa-onnx-wasm-main-asr.{js,wasm,data}
    plus sherpa-onnx-asr.js (no VAD).
    Reference: public/wasm/sherpa-onnx-asr-stream-en/

Usage:
    python3 pack.py                           # pack all models
    python3 pack.py sensevoice-nano-int8      # single model
    python3 pack.py all                       # all models

Output per model (e.g. wasm-sensevoice-nano-int8/):
    wasm-{model}/sherpa-onnx-wasm-main-vad-asr.js    (patched glue, offline)
    wasm-{model}/sherpa-onnx-wasm-main-vad-asr.wasm  (shared binary, offline)
    wasm-{model}/sherpa-onnx-wasm-main-vad-asr.data  (model data, offline)
    wasm-{model}/sherpa-onnx-asr.js                  (shared ASR API)
    wasm-{model}/sherpa-onnx-vad.js                  (shared VAD API, offline only)

  or for streaming:
    wasm-{model}/sherpa-onnx-wasm-main-asr.js        (patched glue)
    wasm-{model}/sherpa-onnx-wasm-main-asr.wasm      (shared binary)
    wasm-{model}/sherpa-onnx-wasm-main-asr.data       (model data)
    wasm-{model}/sherpa-onnx-asr.js                   (shared ASR API)
"""

import json
import os
import re
import shutil
import struct
import subprocess
import sys
import tarfile
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

# --- Configuration ---

BASE_URL = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/"

# Reference directories (relative to project root: script is at model-packs/asr/pack.py)
OFFLINE_REF_DIR = Path(__file__).resolve().parent.parent.parent / "public" / "wasm" / "sherpa-onnx-asr-sensevoice"
STREAMING_REF_DIR = Path(__file__).resolve().parent.parent.parent / "public" / "wasm" / "sherpa-onnx-asr-stream-en"
SCRIPT_DIR = Path(__file__).resolve().parent

# Engine configurations: maps engine type to reference directory, glue file base name,
# and the set of shared JS API files to copy alongside the WASM binary.
ENGINES = {
    "offline": {
        "ref_dir": OFFLINE_REF_DIR,
        "glue_base": "sherpa-onnx-wasm-main-vad-asr",
        "shared_files": ["sherpa-onnx-asr.js", "sherpa-onnx-vad.js"],
    },
    "streaming": {
        "ref_dir": STREAMING_REF_DIR,
        "glue_base": "sherpa-onnx-wasm-main-asr",
        "shared_files": ["sherpa-onnx-asr.js"],
    },
}

# --- Model Registry ---
# Each entry has:
#   url      - full download URL for the tarball
#   tarball  - filename for caching
#   dir_hint - substring to match when locating the extracted directory
#   engine   - "offline" (VAD+ASR) or "streaming"

MODELS = {
    # === Offline models (VAD+ASR engine) ===

    # --- SenseVoice ---
    "sensevoice-nano-int8": {
        "url": BASE_URL + "sherpa-onnx-sense-voice-funasr-nano-int8-2025-12-17.tar.bz2",
        "tarball": "sherpa-onnx-sense-voice-funasr-nano-int8-2025-12-17.tar.bz2",
        "dir_hint": "sense-voice",
        "engine": "offline",
        # Tarball uses generic "model.int8.onnx"; rename to match fileExists detection
        "renames": {"model.int8.onnx": "sense-voice.onnx"},
    },
    "sensevoice-int8": {
        "url": BASE_URL + "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09.tar.bz2",
        "tarball": "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09.tar.bz2",
        "dir_hint": "sense-voice",
        "engine": "offline",
        "renames": {"model.int8.onnx": "sense-voice.onnx"},
    },

    # --- Moonshine ---
    "moonshine-tiny-en-quant": {
        "url": BASE_URL + "sherpa-onnx-moonshine-tiny-en-quantized-2026-02-27.tar.bz2",
        "tarball": "sherpa-onnx-moonshine-tiny-en-quantized-2026-02-27.tar.bz2",
        "dir_hint": "moonshine",
        "engine": "offline",
        "renames": {"encoder_model.ort": "moonshine-encoder.ort", "decoder_model_merged.ort": "moonshine-merged-decoder.ort"},
    },
    "moonshine-base-zh-quant": {
        "url": BASE_URL + "sherpa-onnx-moonshine-base-zh-quantized-2026-02-27.tar.bz2",
        "tarball": "sherpa-onnx-moonshine-base-zh-quantized-2026-02-27.tar.bz2",
        "dir_hint": "moonshine",
        "engine": "offline",
        "renames": {"encoder_model.ort": "moonshine-encoder.ort", "decoder_model_merged.ort": "moonshine-merged-decoder.ort"},
    },
    "moonshine-base-ja-quant": {
        "url": BASE_URL + "sherpa-onnx-moonshine-base-ja-quantized-2026-02-27.tar.bz2",
        "tarball": "sherpa-onnx-moonshine-base-ja-quantized-2026-02-27.tar.bz2",
        "dir_hint": "moonshine",
        "engine": "offline",
        "renames": {"encoder_model.ort": "moonshine-encoder.ort", "decoder_model_merged.ort": "moonshine-merged-decoder.ort"},
    },
    "moonshine-tiny-ko-quant": {
        "url": BASE_URL + "sherpa-onnx-moonshine-tiny-ko-quantized-2026-02-27.tar.bz2",
        "tarball": "sherpa-onnx-moonshine-tiny-ko-quantized-2026-02-27.tar.bz2",
        "dir_hint": "moonshine",
        "engine": "offline",
        "renames": {"encoder_model.ort": "moonshine-encoder.ort", "decoder_model_merged.ort": "moonshine-merged-decoder.ort"},
    },
    "moonshine-base-es-quant": {
        "url": BASE_URL + "sherpa-onnx-moonshine-base-es-quantized-2026-02-27.tar.bz2",
        "tarball": "sherpa-onnx-moonshine-base-es-quantized-2026-02-27.tar.bz2",
        "dir_hint": "moonshine",
        "engine": "offline",
        "renames": {"encoder_model.ort": "moonshine-encoder.ort", "decoder_model_merged.ort": "moonshine-merged-decoder.ort"},
    },
    "moonshine-base-ar-quant": {
        "url": BASE_URL + "sherpa-onnx-moonshine-base-ar-quantized-2026-02-27.tar.bz2",
        "tarball": "sherpa-onnx-moonshine-base-ar-quantized-2026-02-27.tar.bz2",
        "dir_hint": "moonshine",
        "engine": "offline",
        "renames": {"encoder_model.ort": "moonshine-encoder.ort", "decoder_model_merged.ort": "moonshine-merged-decoder.ort"},
    },
    "moonshine-base-uk-quant": {
        "url": BASE_URL + "sherpa-onnx-moonshine-base-uk-quantized-2026-02-27.tar.bz2",
        "tarball": "sherpa-onnx-moonshine-base-uk-quantized-2026-02-27.tar.bz2",
        "dir_hint": "moonshine",
        "engine": "offline",
        "renames": {"encoder_model.ort": "moonshine-encoder.ort", "decoder_model_merged.ort": "moonshine-merged-decoder.ort"},
    },
    "moonshine-base-vi-quant": {
        "url": BASE_URL + "sherpa-onnx-moonshine-base-vi-quantized-2026-02-27.tar.bz2",
        "tarball": "sherpa-onnx-moonshine-base-vi-quantized-2026-02-27.tar.bz2",
        "dir_hint": "moonshine",
        "engine": "offline",
        "renames": {"encoder_model.ort": "moonshine-encoder.ort", "decoder_model_merged.ort": "moonshine-merged-decoder.ort"},
    },
    "moonshine-tiny-ja-quant": {
        "url": BASE_URL + "sherpa-onnx-moonshine-tiny-ja-quantized-2026-02-27.tar.bz2",
        "tarball": "sherpa-onnx-moonshine-tiny-ja-quantized-2026-02-27.tar.bz2",
        "dir_hint": "moonshine",
        "engine": "offline",
        "renames": {"encoder_model.ort": "moonshine-encoder.ort", "decoder_model_merged.ort": "moonshine-merged-decoder.ort"},
    },

    # --- NeMo ---
    "nemo-fastconf-multi-int8": {
        "url": BASE_URL + "sherpa-onnx-nemo-fast-conformer-ctc-be-de-en-es-fr-hr-it-pl-ru-uk-20k-int8.tar.bz2",
        "tarball": "sherpa-onnx-nemo-fast-conformer-ctc-be-de-en-es-fr-hr-it-pl-ru-uk-20k-int8.tar.bz2",
        "dir_hint": "nemo",
        "engine": "offline",
        "renames": {"model.int8.onnx": "nemo-ctc.onnx"},
    },
    "nemo-canary-int8": {
        "url": BASE_URL + "sherpa-onnx-nemo-canary-180m-flash-en-es-de-fr-int8.tar.bz2",
        "tarball": "sherpa-onnx-nemo-canary-180m-flash-en-es-de-fr-int8.tar.bz2",
        "dir_hint": "nemo",
        "engine": "offline",
        "renames": {"encoder.int8.onnx": "canary-encoder.onnx", "decoder.int8.onnx": "canary-decoder.onnx"},
    },
    "nemo-fastconf-de-int8": {
        "url": BASE_URL + "sherpa-onnx-nemo-stt_de_fastconformer_hybrid_large_pc-int8.tar.bz2",
        "tarball": "sherpa-onnx-nemo-stt_de_fastconformer_hybrid_large_pc-int8.tar.bz2",
        "dir_hint": "nemo",
        "engine": "offline",
        "renames": {"model.int8.onnx": "nemo-ctc.onnx"},
    },
    "nemo-fastconf-pt-int8": {
        "url": BASE_URL + "sherpa-onnx-nemo-stt_pt_fastconformer_hybrid_large_pc-int8.tar.bz2",
        "tarball": "sherpa-onnx-nemo-stt_pt_fastconformer_hybrid_large_pc-int8.tar.bz2",
        "dir_hint": "nemo",
        "engine": "offline",
        "renames": {"model.int8.onnx": "nemo-ctc.onnx"},
    },
    "nemo-fastconf-es-int8": {
        "url": BASE_URL + "sherpa-onnx-nemo-fast-conformer-ctc-es-1424-int8.tar.bz2",
        "tarball": "sherpa-onnx-nemo-fast-conformer-ctc-es-1424-int8.tar.bz2",
        "dir_hint": "nemo",
        "engine": "offline",
        "renames": {"model.int8.onnx": "nemo-ctc.onnx"},
    },

    # --- Zipformer ---
    "zipformer-vi-30m-int8": {
        "url": BASE_URL + "sherpa-onnx-zipformer-vi-30M-int8-2026-02-09.tar.bz2",
        "tarball": "sherpa-onnx-zipformer-vi-30M-int8-2026-02-09.tar.bz2",
        "dir_hint": "zipformer",
        "engine": "offline",
        "renames": {"encoder.int8.onnx": "transducer-encoder.onnx", "decoder.onnx": "transducer-decoder.onnx", "joiner.int8.onnx": "transducer-joiner.onnx"},
    },
    "zipformer-ru-int8": {
        "url": BASE_URL + "sherpa-onnx-zipformer-ru-int8-2025-04-20.tar.bz2",
        "tarball": "sherpa-onnx-zipformer-ru-int8-2025-04-20.tar.bz2",
        "dir_hint": "zipformer",
        "engine": "offline",
        "renames": {"encoder.int8.onnx": "transducer-encoder.onnx", "decoder.onnx": "transducer-decoder.onnx", "joiner.int8.onnx": "transducer-joiner.onnx"},
    },

    # --- Dolphin ---
    "dolphin-base-int8": {
        "url": BASE_URL + "sherpa-onnx-dolphin-base-ctc-multi-lang-int8-2025-04-02.tar.bz2",
        "tarball": "sherpa-onnx-dolphin-base-ctc-multi-lang-int8-2025-04-02.tar.bz2",
        "dir_hint": "dolphin",
        "engine": "offline",
        "renames": {"model.int8.onnx": "dolphin.onnx"},
    },

    # --- Whisper ---
    "whisper-tiny": {
        "url": BASE_URL + "sherpa-onnx-whisper-tiny.tar.bz2",
        "tarball": "sherpa-onnx-whisper-tiny.tar.bz2",
        "dir_hint": "whisper",
        "engine": "offline",
        "renames": {"tiny-encoder.onnx": "whisper-encoder.onnx", "tiny-decoder.onnx": "whisper-decoder.onnx", "tiny-tokens.txt": "tokens.txt"},
        "excludes": ["tiny-encoder.int8.onnx", "tiny-decoder.int8.onnx"],
    },

    # --- WeNetSpeech ---
    "wenetspeech-yue-int8": {
        "url": BASE_URL + "sherpa-onnx-wenetspeech-yue-u2pp-conformer-ctc-zh-en-cantonese-int8-2025-09-10.tar.bz2",
        "tarball": "sherpa-onnx-wenetspeech-yue-u2pp-conformer-ctc-zh-en-cantonese-int8-2025-09-10.tar.bz2",
        "dir_hint": "wenetspeech",
        "engine": "offline",
        "renames": {"model.int8.onnx": "wenet-ctc.onnx"},
    },

    # --- Omnilingual ---
    "omnilingual-300m-int8-v2": {
        "url": BASE_URL + "sherpa-onnx-omnilingual-asr-1600-languages-300M-ctc-v2-int8-2026-02-05.tar.bz2",
        "tarball": "sherpa-onnx-omnilingual-asr-1600-languages-300M-ctc-v2-int8-2026-02-05.tar.bz2",
        "dir_hint": "omnilingual",
        "engine": "offline",
        "renames": {"model.int8.onnx": "omnilingual.onnx"},
    },

    # === Streaming models (streaming ASR engine) ===

    "stream-en-kroko": {
        "url": BASE_URL + "sherpa-onnx-streaming-zipformer-en-kroko-2025-08-06.tar.bz2",
        "tarball": "sherpa-onnx-streaming-zipformer-en-kroko-2025-08-06.tar.bz2",
        "dir_hint": "streaming",
        "engine": "streaming",
    },
    "stream-fr-kroko": {
        "url": BASE_URL + "sherpa-onnx-streaming-zipformer-fr-kroko-2025-08-06.tar.bz2",
        "tarball": "sherpa-onnx-streaming-zipformer-fr-kroko-2025-08-06.tar.bz2",
        "dir_hint": "streaming",
        "engine": "streaming",
    },
    "stream-de-kroko": {
        "url": BASE_URL + "sherpa-onnx-streaming-zipformer-de-kroko-2025-08-06.tar.bz2",
        "tarball": "sherpa-onnx-streaming-zipformer-de-kroko-2025-08-06.tar.bz2",
        "dir_hint": "streaming",
        "engine": "streaming",
    },
    "stream-es-kroko": {
        "url": BASE_URL + "sherpa-onnx-streaming-zipformer-es-kroko-2025-08-06.tar.bz2",
        "tarball": "sherpa-onnx-streaming-zipformer-es-kroko-2025-08-06.tar.bz2",
        "dir_hint": "streaming",
        "engine": "streaming",
    },
    "stream-zh-int8": {
        "url": BASE_URL + "sherpa-onnx-streaming-zipformer-multi-zh-hans-int8-2023-12-13.tar.bz2",
        "tarball": "sherpa-onnx-streaming-zipformer-multi-zh-hans-int8-2023-12-13.tar.bz2",
        "dir_hint": "streaming",
        "engine": "streaming",
        # createOnlineRecognizer probes for encoder.onnx, not .int8.onnx
        "renames": {
            "encoder-epoch-20-avg-1-chunk-16-left-128.int8.onnx": "encoder.onnx",
            "decoder-epoch-20-avg-1-chunk-16-left-128.onnx": "decoder.onnx",
            "joiner-epoch-20-avg-1-chunk-16-left-128.int8.onnx": "joiner.onnx",
        },
    },
    "stream-ru-vosk-int8": {
        "url": BASE_URL + "sherpa-onnx-streaming-zipformer-small-ru-vosk-int8-2025-08-16.tar.bz2",
        "tarball": "sherpa-onnx-streaming-zipformer-small-ru-vosk-int8-2025-08-16.tar.bz2",
        "dir_hint": "streaming",
        "engine": "streaming",
        # createOnlineRecognizer probes for encoder.onnx, not .int8.onnx
        "renames": {"encoder.int8.onnx": "encoder.onnx", "joiner.int8.onnx": "joiner.onnx"},
    },
    "stream-multi-8lang": {
        "url": BASE_URL + "sherpa-onnx-streaming-zipformer-ar_en_id_ja_ru_th_vi_zh-2025-02-10.tar.bz2",
        "tarball": "sherpa-onnx-streaming-zipformer-ar_en_id_ja_ru_th_vi_zh-2025-02-10.tar.bz2",
        "dir_hint": "streaming",
        "engine": "streaming",
        # createOnlineRecognizer probes for encoder.onnx, not .int8.onnx
        "renames": {
            "encoder-epoch-75-avg-11-chunk-16-left-128.int8.onnx": "encoder.onnx",
            "decoder-epoch-75-avg-11-chunk-16-left-128.onnx": "decoder.onnx",
            "joiner-epoch-75-avg-11-chunk-16-left-128.int8.onnx": "joiner.onnx",
        },
    },
    "stream-bn-vosk": {
        "url": BASE_URL + "sherpa-onnx-streaming-zipformer-bn-vosk-2026-02-09.tar.bz2",
        "tarball": "sherpa-onnx-streaming-zipformer-bn-vosk-2026-02-09.tar.bz2",
        "dir_hint": "streaming",
        "engine": "streaming",
    },
    "stream-nemo-ctc-en-80ms-int8": {
        "url": BASE_URL + "sherpa-onnx-nemo-streaming-fast-conformer-ctc-en-80ms-int8.tar.bz2",
        "tarball": "sherpa-onnx-nemo-streaming-fast-conformer-ctc-en-80ms-int8.tar.bz2",
        "dir_hint": "nemo",
        "engine": "streaming",
        "renames": {"model.int8.onnx": "nemo-ctc.onnx"},
    },
    "stream-zh-2025-int8": {
        "url": BASE_URL + "sherpa-onnx-streaming-zipformer-zh-int8-2025-06-30.tar.bz2",
        "tarball": "sherpa-onnx-streaming-zipformer-zh-int8-2025-06-30.tar.bz2",
        "dir_hint": "streaming",
        "engine": "streaming",
        # createOnlineRecognizer probes for encoder.onnx, not .int8.onnx
        "renames": {"encoder.int8.onnx": "encoder.onnx", "joiner.int8.onnx": "joiner.onnx"},
    },
}


# --- Utility Functions ---

def download_model(dest_dir: Path, tarball: str, url: str) -> Path:
    """Download model tarball if not already cached."""
    tarball_path = dest_dir / tarball
    if tarball_path.exists():
        print(f"Using cached {tarball_path}")
        return tarball_path

    print(f"Downloading {url} ...")
    urllib.request.urlretrieve(url, tarball_path, reporthook=_progress)
    print()
    return tarball_path


def _progress(block_num, block_size, total_size):
    downloaded = block_num * block_size
    if total_size > 0:
        pct = min(100.0, downloaded / total_size * 100)
        mb = downloaded / 1024 / 1024
        total_mb = total_size / 1024 / 1024
        print(f"\r  {pct:5.1f}%  ({mb:.1f}/{total_mb:.1f} MB)", end="", flush=True)


def extract_model(tarball: Path, dest_dir: Path, dir_hint: str) -> Path:
    """Extract model files. Returns the directory containing model files."""
    print(f"Extracting {tarball.name} ...")
    with tarfile.open(tarball, "r:bz2") as tf:
        tf.extractall(dest_dir)

    # The tarball extracts to a directory like sherpa-onnx-sense-voice-.../
    extracted = dest_dir / tarball.stem.replace(".tar", "")
    if not extracted.exists():
        # Try to find the extracted directory using dir_hint
        dirs = [d for d in dest_dir.iterdir() if d.is_dir() and dir_hint in d.name.lower()]
        if dirs:
            extracted = dirs[0]
        else:
            raise RuntimeError(f"Could not find extracted model directory in {dest_dir}")

    print(f"  Extracted to: {extracted}")
    return extracted


_SKIP_DIRS = {"test_wavs", "test-wavs", "__MACOSX"}
_SKIP_FILES = {"README.md", "README", ".DS_Store"}


def collect_files(model_dir: Path) -> list[tuple[str, Path]]:
    """
    Walk model directory and collect (virtual_path, real_path) pairs.
    Virtual paths are relative to model root, prefixed with '/'.

    Skips test audio, README files, and OS metadata.
    """
    files = []
    for real_path in sorted(model_dir.rglob("*")):
        if real_path.is_file():
            # Skip files in excluded directories
            rel = real_path.relative_to(model_dir)
            if any(part in _SKIP_DIRS for part in rel.parts):
                continue
            # Skip excluded filenames
            if rel.name in _SKIP_FILES:
                continue
            virtual = "/" + str(rel)
            files.append((virtual, real_path))
    return files


def build_data_file(files: list[tuple[str, Path]], output_path: Path) -> list[dict]:
    """
    Concatenate all files into a single .data blob.
    Returns metadata list: [{filename, start, end}, ...]
    """
    metadata = []
    offset = 0

    with open(output_path, "wb") as out:
        for virtual_path, real_path in files:
            data = real_path.read_bytes()
            out.write(data)
            metadata.append({
                "filename": virtual_path,
                "start": offset,
                "end": offset + len(data),
            })
            offset += len(data)

    total_size = offset
    print(f"  Built .data file: {total_size / 1024 / 1024:.1f} MB ({len(files)} files)")
    return metadata


def _build_create_path_calls(metadata: list[dict]) -> str:
    """
    Generate FS_createPath() JS calls for all directories needed by the files.
    Emscripten requires parent directories to exist before creating files.
    """
    dirs: set[str] = set()
    for entry in metadata:
        path = entry["filename"]
        # Collect all parent directories (e.g. /model/encoder -> add /model)
        parts = path.split("/")
        for depth in range(2, len(parts)):  # skip root '/' and filename
            dirs.add("/".join(parts[:depth]))

    # Generate calls sorted by depth then name (parents before children)
    calls = []
    for d in sorted(dirs, key=lambda x: (x.count("/"), x)):
        parent = "/".join(d.split("/")[:-1]) or "/"
        name = d.split("/")[-1]
        calls.append(f'Module["FS_createPath"]("{parent}","{name}",true,true);')

    return "".join(calls)


def patch_glue_js(
    ref_js_path: Path,
    output_js_path: Path,
    metadata: list[dict],
    data_size: int,
    glue_base: str,
):
    """
    Take the reference engine's glue JS file and patch it with new model metadata.

    The glue_base parameter identifies which engine's .data file to reference
    (e.g. "sherpa-onnx-wasm-main-vad-asr" for offline, "sherpa-onnx-wasm-main-asr"
    for streaming).

    Patches:
    1. PACKAGE_NAME: fix the path to just the filename
    2. datafile_ references: update to match new PACKAGE_NAME
    3. FS_createPath block: regenerate for new model's directory structure
    4. loadPackage({...}): replace the entire JSON metadata
    """
    content = ref_js_path.read_text()
    data_filename = f"{glue_base}.data"

    # 1. Fix PACKAGE_NAME from "../../bin/{data_filename}" to just "{data_filename}"
    old_package_name = f'var PACKAGE_NAME="../../bin/{data_filename}"'
    new_package_name = f'var PACKAGE_NAME="{data_filename}"'
    content = content.replace(old_package_name, new_package_name)

    # 2. Fix datafile_ references
    old_datafile = f"datafile_../../bin/{data_filename}"
    new_datafile = f"datafile_{data_filename}"
    content = content.replace(old_datafile, new_datafile)

    # 3. Replace FS_createPath block with paths for this model
    new_cp_calls = _build_create_path_calls(metadata)
    cp_pattern = re.compile(r'Module\["FS_createPath"\]\([^)]+\);')
    cp_matches = list(cp_pattern.finditer(content))
    if cp_matches:
        # Replace existing FS_createPath calls
        first_start = cp_matches[0].start()
        last_end = cp_matches[-1].end()
        content = content[:first_start] + new_cp_calls + content[last_end:]
        print(f"  Patched FS_createPath: {len(cp_matches)} old -> {new_cp_calls.count('FS_createPath')} new")
    elif new_cp_calls:
        # No existing calls but new model needs directories — insert before loadPackage
        insert_pos = content.find("loadPackage({")
        if insert_pos == -1:
            raise RuntimeError("Could not find loadPackage({ to insert FS_createPath calls")
        content = content[:insert_pos] + new_cp_calls + content[insert_pos:]
        print(f"  Inserted {new_cp_calls.count('FS_createPath')} FS_createPath calls")
    else:
        print("  No FS_createPath calls needed (all files at root)")

    # 4. Replace loadPackage({...}) metadata
    lp_start = content.find("loadPackage({")
    if lp_start == -1:
        raise RuntimeError("Could not find loadPackage({ in glue JS")

    # Find the matching closing brace for the JSON object
    brace_start = lp_start + len("loadPackage(")
    brace_count = 0
    i = brace_start
    while i < len(content):
        if content[i] == "{":
            brace_count += 1
        elif content[i] == "}":
            brace_count -= 1
            if brace_count == 0:
                break
        i += 1

    # The closing ) after the JSON
    close_paren = content.index(")", i)

    # Build new metadata JSON (compact, no spaces)
    new_metadata = {
        "files": metadata,
        "remote_package_size": data_size,
    }
    new_json = json.dumps(new_metadata, separators=(",", ":"))

    # Replace: loadPackage({...old...}) -> loadPackage({...new...})
    content = content[:lp_start] + "loadPackage(" + new_json + ")" + content[close_paren + 1:]

    output_js_path.write_text(content)
    print(f"  Patched glue JS: {output_js_path.name}")


def _extract_file_from_ref_data(
    ref_dir: Path, glue_base: str, virtual_path: str, dest_dir: Path
) -> Path | None:
    """
    Extract a single file from the reference engine's .data blob.

    Reads the loadPackage metadata from the reference glue JS to find the
    file's byte range, then extracts it from the .data file.
    """
    glue_js = ref_dir / f"{glue_base}.js"
    data_file = ref_dir / f"{glue_base}.data"
    if not glue_js.exists() or not data_file.exists():
        return None

    content = glue_js.read_text()
    lp_start = content.find("loadPackage({")
    if lp_start == -1:
        return None

    brace_start = lp_start + len("loadPackage(")
    brace_count = 0
    i = brace_start
    while i < len(content):
        if content[i] == "{":
            brace_count += 1
        elif content[i] == "}":
            brace_count -= 1
            if brace_count == 0:
                break
        i += 1

    metadata = json.loads(content[brace_start : i + 1])
    for entry in metadata.get("files", []):
        if entry["filename"] == virtual_path:
            start, end = entry["start"], entry["end"]
            with open(data_file, "rb") as f:
                f.seek(start)
                data = f.read(end - start)
            out_path = dest_dir / virtual_path.lstrip("/")
            out_path.parent.mkdir(parents=True, exist_ok=True)
            out_path.write_bytes(data)
            return out_path

    return None


# --- Main Packing Logic ---

def pack_model(model_name: str, model_cfg: dict, skip_existing: bool = False):
    """Pack a single ASR model into its own wasm-{name}/ directory."""
    engine_type = model_cfg["engine"]
    engine = ENGINES[engine_type]
    ref_dir = engine["ref_dir"]
    glue_base = engine["glue_base"]

    dir_name = f"wasm-{model_name}"
    output_dir = SCRIPT_DIR / dir_name

    # Skip if output directory already has a .data file (i.e. fully packed)
    if skip_existing:
        data_files = list(output_dir.glob("*.data")) if output_dir.exists() else []
        if data_files:
            print(f"\n  SKIP (already packed): {dir_name}/")
            return

    print(f"\n{'='*60}")
    print(f"Packing model: {model_name} ({engine_type}) -> {dir_name}/")
    print(f"{'='*60}")

    # Verify reference directory exists
    if not ref_dir.exists():
        print(f"ERROR: Reference directory not found: {ref_dir}")
        print(f"Make sure the {engine_type} ASR WASM package is downloaded.")
        sys.exit(1)

    # Create output directory
    output_dir.mkdir(parents=True, exist_ok=True)

    # Step 1: Download model
    tarball = download_model(SCRIPT_DIR, model_cfg["tarball"], model_cfg["url"])

    # Step 2: Extract model
    with tempfile.TemporaryDirectory() as tmpdir:
        model_dir = extract_model(tarball, Path(tmpdir), model_cfg["dir_hint"])

        # Step 3: Collect files
        files = collect_files(model_dir)

        # Apply excludes (remove unwanted files like unused int8 variants)
        excludes = set(model_cfg.get("excludes", []))
        if excludes:
            before = len(files)
            files = [(v, r) for v, r in files if v.rsplit("/", 1)[-1] not in excludes]
            print(f"  Excluded {before - len(files)} files: {', '.join(sorted(excludes))}")

        # Apply file renames (e.g. model.int8.onnx -> sense-voice.onnx)
        renames = model_cfg.get("renames", {})
        if renames:
            renamed_files = []
            for vpath, rpath in files:
                basename = vpath.rsplit("/", 1)[-1]
                if basename in renames:
                    new_name = renames[basename]
                    new_vpath = vpath.rsplit("/", 1)[0] + "/" + new_name
                    renamed_files.append((new_vpath, rpath))
                    print(f"  Renamed: {basename} -> {new_name}")
                else:
                    renamed_files.append((vpath, rpath))
            files = renamed_files

        # For offline models, inject silero_vad.onnx from reference .data
        # (it's a shared VAD model not included in individual model tarballs)
        if engine_type == "offline" and not any(v == "/silero_vad.onnx" for v, _ in files):
            vad_path = _extract_file_from_ref_data(ref_dir, glue_base, "/silero_vad.onnx", Path(tmpdir))
            if vad_path:
                files.append(("/silero_vad.onnx", vad_path))
                print("  Injected silero_vad.onnx from reference .data")

        print(f"  Collected {len(files)} files for .data")
        for vpath, _ in files[:5]:
            print(f"    {vpath}")
        if len(files) > 5:
            print(f"    ... and {len(files) - 5} more")

        # Step 4: Build .data file
        data_path = output_dir / f"{glue_base}.data"
        metadata = build_data_file(files, data_path)

    # Step 5: Patch glue JS
    data_size = data_path.stat().st_size
    patch_glue_js(
        ref_dir / f"{glue_base}.js",
        output_dir / f"{glue_base}.js",
        metadata,
        data_size,
        glue_base,
    )

    # Step 6: Copy shared files (.wasm binary + JS API files)
    shared_copy_list = [f"{glue_base}.wasm"] + engine["shared_files"]
    for filename in shared_copy_list:
        src = ref_dir / filename
        dst = output_dir / filename
        shutil.copy2(src, dst)
        print(f"  Copied {filename}")

    # Step 7: Write package-metadata.json (for bundled runtime pattern)
    # This allows the app to bundle shared JS/WASM and only download
    # .data + metadata per model. The metadata tells the Emscripten
    # glue how to unpack the .data into the virtual filesystem.
    pkg_metadata = {"files": metadata, "remote_package_size": data_size}
    metadata_path = output_dir / "package-metadata.json"
    with open(metadata_path, "w") as f:
        json.dump(pkg_metadata, f, separators=(",", ":"))
    print(f"  Wrote package-metadata.json ({len(metadata)} files)")

    print(f"  Done: {dir_name}/")


# --- CLI ---

def _parse_arg(arg: str) -> list[str]:
    """
    Parse a CLI argument into a list of model names.

    Examples:
        "sensevoice-nano-int8"  -> ["sensevoice-nano-int8"]
        "all"                   -> [all model names]
    """
    if arg == "all":
        return list(MODELS.keys())
    elif arg in MODELS:
        return [arg]
    else:
        print(f"ERROR: Unknown model '{arg}'. Available: {', '.join(MODELS.keys())}, all")
        sys.exit(1)


def main():
    arg = sys.argv[1] if len(sys.argv) > 1 else "all"
    model_names = _parse_arg(arg)
    is_all = arg == "all"
    skip_existing = is_all
    failed = []

    for name in model_names:
        cfg = MODELS[name]
        try:
            pack_model(name, cfg, skip_existing=skip_existing)
        except urllib.error.HTTPError as e:
            if e.code == 404 and is_all:
                print(f"  SKIP (404 not found): {name}")
                failed.append(name)
            else:
                raise

    if failed:
        print(f"\nSkipped {len(failed)} models due to 404:")
        for f in failed:
            print(f"  - {f}")

    # Summary
    offline_keys = [k for k, v in MODELS.items() if v["engine"] == "offline"]
    streaming_keys = [k for k, v in MODELS.items() if v["engine"] == "streaming"]
    packed = [n for n in model_names if n not in failed]

    print()
    print(f"Packed {len(packed)} model(s): {len([n for n in packed if MODELS[n]['engine'] == 'offline'])} offline, "
          f"{len([n for n in packed if MODELS[n]['engine'] == 'streaming'])} streaming")
    print()
    print("To test:")
    print(f"  cd {SCRIPT_DIR}")
    print("  python3 -m http.server 8080")

    # Show a few representative offline model names
    shown = 0
    for key in offline_keys[:3]:
        print(f"  Offline:    wasm-{key}/")
        shown += 1
    if len(offline_keys) > 3:
        print(f"  ... and {len(offline_keys) - 3} more offline models")

    # Show a few representative streaming model names
    for key in streaming_keys[:3]:
        print(f"  Streaming:  wasm-{key}/")
    if len(streaming_keys) > 3:
        print(f"  ... and {len(streaming_keys) - 3} more streaming models")


if __name__ == "__main__":
    main()
