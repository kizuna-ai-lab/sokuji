#!/usr/bin/env bash
# Download sherpa-onnx WASM prebuilt packages for ASR, TTS, and tools.
# Usage: bash scripts/download-sherpa-wasm.sh [package|group] [--activate <name>]
#
# Packages are extracted into public/wasm/ and excluded from git via .gitignore.

set -euo pipefail

VERSION="1.12.31"
BASE_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/v${VERSION}"
DEST_DIR="public/wasm"

# ─── Package definitions ────────────────────────────────────────────────────
# name -> tarball filename
# NOTE: Offline ASR/TTS tarballs use VERSION without 'v' prefix;
#       Streaming ASR and tool tarballs use 'v' + VERSION.

declare -A PACKAGES=(
  # ── Offline VAD+ASR (12) ──────────────────────────────────────────────────
  [sensevoice]="sherpa-onnx-wasm-simd-${VERSION}-vad-asr-zh_en_ja_ko_cantonese-sense_voice_small.tar.bz2"
  [reazonspeech]="sherpa-onnx-wasm-simd-${VERSION}-vad-asr-ja-zipformer_reazonspeech.tar.bz2"
  [whisper-en]="sherpa-onnx-wasm-simd-${VERSION}-vad-asr-en-whisper_tiny.tar.bz2"
  [zipformer-en]="sherpa-onnx-wasm-simd-${VERSION}-vad-asr-en-zipformer_gigaspeech.tar.bz2"
  [moonshine-en]="sherpa-onnx-wasm-simd-${VERSION}-vad-asr-en-moonshine_tiny.tar.bz2"
  [paraformer-small]="sherpa-onnx-wasm-simd-${VERSION}-vad-asr-zh_en-paraformer_small.tar.bz2"
  [paraformer-large]="sherpa-onnx-wasm-simd-${VERSION}-vad-asr-zh_en-paraformer_large.tar.bz2"
  [wenetspeech]="sherpa-onnx-wasm-simd-${VERSION}-vad-asr-zh-zipformer_wenetspeech.tar.bz2"
  [telespeech]="sherpa-onnx-wasm-simd-${VERSION}-vad-asr-zh-telespeech.tar.bz2"
  [zipformer-ctc-zh]="sherpa-onnx-wasm-simd-${VERSION}-vad-asr-zh-zipformer-ctc.tar.bz2"
  [dolphin]="sherpa-onnx-wasm-simd-${VERSION}-vad-asr-multi_lang-dolphin_ctc.tar.bz2"
  [gigaspeech2-th]="sherpa-onnx-wasm-simd-${VERSION}-vad-asr-th-zipformer_gigaspeech2.tar.bz2"

  # ── Streaming ASR (4) ────────────────────────────────────────────────────
  [stream-en]="sherpa-onnx-wasm-simd-v${VERSION}-en-asr-zipformer.tar.bz2"
  [stream-zh-en]="sherpa-onnx-wasm-simd-v${VERSION}-zh-en-asr-zipformer.tar.bz2"
  [stream-paraformer]="sherpa-onnx-wasm-simd-v${VERSION}-zh-en-asr-paraformer.tar.bz2"
  [stream-paraformer-cantonese]="sherpa-onnx-wasm-simd-v${VERSION}-zh-cantonese-en-asr-paraformer.tar.bz2"

  # ── TTS: Piper (2) ───────────────────────────────────────────────────────
  [piper-en]="sherpa-onnx-wasm-simd-${VERSION}-vits-piper-en_US-libritts_r-medium.tar.bz2"
  [piper-de]="sherpa-onnx-wasm-simd-${VERSION}-vits-piper-de_DE-thorsten_emotional-medium.tar.bz2"

  # ── TTS: Matcha (3) ──────────────────────────────────────────────────────
  [matcha-en]="sherpa-onnx-wasm-simd-${VERSION}-matcha-icefall-en_US-ljspeech.tar.bz2"
  [matcha-zh]="sherpa-onnx-wasm-simd-${VERSION}-matcha-icefall-zh-baker.tar.bz2"
  [matcha-zh-en]="sherpa-onnx-wasm-simd-${VERSION}-matcha-icefall-zh-en.tar.bz2"

  # ── Tools (4) ─────────────────────────────────────────────────────────────
  [vad]="sherpa-onnx-wasm-simd-v${VERSION}-vad.tar.bz2"
  [ten-vad]="sherpa-onnx-wasm-simd-v${VERSION}-ten-vad.tar.bz2"
  [speaker-diarization]="sherpa-onnx-wasm-simd-v${VERSION}-speaker-diarization.tar.bz2"
  [speech-enhancement]="sherpa-onnx-wasm-simd-v${VERSION}-speech-enhancement-gtcrn.tar.bz2"
)

# ─── Target directories (renamed from extracted tarball dir) ─────────────────

declare -A TARGET_DIRS=(
  # Offline ASR
  [sensevoice]="sherpa-onnx-asr-sensevoice"
  [reazonspeech]="sherpa-onnx-asr-reazonspeech"
  [whisper-en]="sherpa-onnx-asr-whisper-en"
  [zipformer-en]="sherpa-onnx-asr-zipformer-en"
  [moonshine-en]="sherpa-onnx-asr-moonshine-en"
  [paraformer-small]="sherpa-onnx-asr-paraformer-small"
  [paraformer-large]="sherpa-onnx-asr-paraformer-large"
  [wenetspeech]="sherpa-onnx-asr-wenetspeech"
  [telespeech]="sherpa-onnx-asr-telespeech"
  [zipformer-ctc-zh]="sherpa-onnx-asr-zipformer-ctc-zh"
  [dolphin]="sherpa-onnx-asr-dolphin"
  [gigaspeech2-th]="sherpa-onnx-asr-gigaspeech2-th"
  # Streaming ASR
  [stream-en]="sherpa-onnx-asr-stream-en"
  [stream-zh-en]="sherpa-onnx-asr-stream-zh-en"
  [stream-paraformer]="sherpa-onnx-asr-stream-paraformer"
  [stream-paraformer-cantonese]="sherpa-onnx-asr-stream-paraformer-cantonese"
  # TTS
  [piper-en]="sherpa-onnx-tts-piper-en"
  [piper-de]="sherpa-onnx-tts-piper-de"
  [matcha-en]="sherpa-onnx-tts-matcha-en"
  [matcha-zh]="sherpa-onnx-tts-matcha-zh"
  [matcha-zh-en]="sherpa-onnx-tts-matcha-zh-en"
  # Tools
  [vad]="sherpa-onnx-vad"
  [ten-vad]="sherpa-onnx-ten-vad"
  [speaker-diarization]="sherpa-onnx-speaker-diarization"
  [speech-enhancement]="sherpa-onnx-speech-enhancement"
)

# ─── Check files to detect if package is already extracted ───────────────────

declare -A CHECK_FILES=(
  # Offline ASR — all share the same WASM binary names
  [sensevoice]="sherpa-onnx-wasm-main-vad-asr.wasm"
  [reazonspeech]="sherpa-onnx-wasm-main-vad-asr.wasm"
  [whisper-en]="sherpa-onnx-wasm-main-vad-asr.wasm"
  [zipformer-en]="sherpa-onnx-wasm-main-vad-asr.wasm"
  [moonshine-en]="sherpa-onnx-wasm-main-vad-asr.wasm"
  [paraformer-small]="sherpa-onnx-wasm-main-vad-asr.wasm"
  [paraformer-large]="sherpa-onnx-wasm-main-vad-asr.wasm"
  [wenetspeech]="sherpa-onnx-wasm-main-vad-asr.wasm"
  [telespeech]="sherpa-onnx-wasm-main-vad-asr.wasm"
  [zipformer-ctc-zh]="sherpa-onnx-wasm-main-vad-asr.wasm"
  [dolphin]="sherpa-onnx-wasm-main-vad-asr.wasm"
  [gigaspeech2-th]="sherpa-onnx-wasm-main-vad-asr.wasm"
  # Streaming ASR — check file verified after download
  [stream-en]="sherpa-onnx-wasm-main-asr.wasm"
  [stream-zh-en]="sherpa-onnx-wasm-main-asr.wasm"
  [stream-paraformer]="sherpa-onnx-wasm-main-asr.wasm"
  [stream-paraformer-cantonese]="sherpa-onnx-wasm-main-asr.wasm"
  # TTS: Piper
  [piper-en]="sherpa-onnx-wasm-main-tts.wasm"
  [piper-de]="sherpa-onnx-wasm-main-tts.wasm"
  # TTS: Matcha — check file verified after download
  [matcha-en]="sherpa-onnx-wasm-main-tts.wasm"
  [matcha-zh]="sherpa-onnx-wasm-main-tts.wasm"
  [matcha-zh-en]="sherpa-onnx-wasm-main-tts.wasm"
  # Tools — check file guesses, verified after download
  [vad]="sherpa-onnx-wasm-main-vad.wasm"
  [ten-vad]="sherpa-onnx-wasm-main-ten-vad.wasm"
  [speaker-diarization]="sherpa-onnx-wasm-main-speaker-diarization.wasm"
  [speech-enhancement]="sherpa-onnx-wasm-main-speech-enhancement.wasm"
)

# ─── Group definitions ───────────────────────────────────────────────────────

OFFLINE_ASR_KEYS=(sensevoice reazonspeech whisper-en zipformer-en moonshine-en paraformer-small paraformer-large wenetspeech telespeech zipformer-ctc-zh dolphin gigaspeech2-th)
STREAM_ASR_KEYS=(stream-en stream-zh-en stream-paraformer stream-paraformer-cantonese)
TTS_PIPER_KEYS=(piper-en piper-de)
TTS_MATCHA_KEYS=(matcha-en matcha-zh matcha-zh-en)
TOOL_KEYS=(vad ten-vad speaker-diarization speech-enhancement)

# ─── Functions ───────────────────────────────────────────────────────────────

download_package() {
  local name="$1"
  local tarball="${PACKAGES[$name]}"
  local target_dir="${DEST_DIR}/${TARGET_DIRS[$name]}"
  local url="${BASE_URL}/${tarball}"

  local check_file="${CHECK_FILES[$name]}"
  if [ -d "$target_dir" ] && [ -f "${target_dir}/${check_file}" ]; then
    echo "✓ ${name} already exists at ${target_dir}, skipping."
    return 0
  fi

  echo "⬇ Downloading ${name} (${tarball})..."
  echo "  URL: ${url}"

  mkdir -p "${DEST_DIR}"

  # Download and extract — strip the top-level directory from tarball
  curl -L --progress-bar "${url}" | tar xjf - -C "${DEST_DIR}"

  # Rename extracted directory to our standard name
  local extracted_dir="${DEST_DIR}/${tarball%.tar.bz2}"
  if [ -d "$extracted_dir" ]; then
    rm -rf "$target_dir"
    mv "$extracted_dir" "$target_dir"
  fi

  echo "✓ ${name} extracted to ${target_dir}"
  echo "  Files:"
  ls -lh "${target_dir}/"
}

download_group() {
  local -n keys=$1
  for key in "${keys[@]}"; do
    download_package "$key"
  done
}

setup_active_model() {
  local name="$1"
  local source_dir="${DEST_DIR}/${TARGET_DIRS[$name]}"
  local active_dir="${DEST_DIR}/sherpa-onnx-asr"

  if [ ! -d "$source_dir" ]; then
    echo "✗ ${name} not found at ${source_dir}"
    return 1
  fi

  # Remove existing active directory (or symlink)
  rm -rf "$active_dir"

  # Create symlink
  ln -sfn "${TARGET_DIRS[$name]}" "$active_dir"
  echo "✓ Active ASR model set to ${name} (symlink: ${active_dir} → ${TARGET_DIRS[$name]})"
}

usage() {
  echo "Usage: $0 [package|group] [--activate <name>]"
  echo ""
  echo "Offline VAD+ASR (12 packages):"
  echo "  sensevoice              SenseVoice multilingual (ja/zh/en/ko/cantonese, ~158MB)"
  echo "  reazonspeech            ReazonSpeech Japanese-only (~137MB)"
  echo "  whisper-en              Whisper Tiny English (~51MB)"
  echo "  zipformer-en            Zipformer GigaSpeech English (~59MB)"
  echo "  moonshine-en            Moonshine Tiny English (~105MB)"
  echo "  paraformer-small        Paraformer Small zh/en (~77MB)"
  echo "  paraformer-large        Paraformer Large zh/en (~225MB)"
  echo "  wenetspeech             Zipformer WenetSpeech Chinese (~69MB)"
  echo "  telespeech              TeleSpeech Chinese (~177MB)"
  echo "  zipformer-ctc-zh        Zipformer CTC Chinese (~290MB)"
  echo "  dolphin                 Dolphin CTC multi-language (~80MB)"
  echo "  gigaspeech2-th          Zipformer GigaSpeech2 Thai (~126MB)"
  echo ""
  echo "Streaming ASR (4 packages):"
  echo "  stream-en               Streaming Zipformer English (~167MB)"
  echo "  stream-zh-en            Streaming Zipformer zh/en (~173MB)"
  echo "  stream-paraformer       Streaming Paraformer zh/en (~218MB)"
  echo "  stream-paraformer-cantonese  Streaming Paraformer zh/cantonese/en (~219MB)"
  echo ""
  echo "TTS: Piper (2 packages):"
  echo "  piper-en                Piper LibriTTS-R English multi-speaker (~81MB)"
  echo "  piper-de                Piper Thorsten Emotional German (~79MB)"
  echo ""
  echo "TTS: Matcha (3 packages):"
  echo "  matcha-en               Matcha LJSpeech English (~125MB)"
  echo "  matcha-zh               Matcha Baker Chinese (~120MB)"
  echo "  matcha-zh-en            Matcha zh/en bilingual (~127MB)"
  echo ""
  echo "Tools (4 packages):"
  echo "  vad                     Standalone VAD (~2.9MB)"
  echo "  ten-vad                 TEN VAD (~2.7MB)"
  echo "  speaker-diarization     Speaker diarization (~44MB)"
  echo "  speech-enhancement      Speech enhancement GTCRN (~2.5MB)"
  echo ""
  echo "Group downloads:"
  echo "  all-asr                 All offline VAD+ASR (12 packages)"
  echo "  all-asr-stream          All streaming ASR (4 packages)"
  echo "  all-tts-piper           All Piper TTS (2 packages)"
  echo "  all-tts-matcha          All Matcha TTS (3 packages)"
  echo "  all-tts                 All TTS (5 packages)"
  echo "  all-tools               All tools (4 packages)"
  echo "  all                     Everything (25 packages)"
  echo ""
  echo "Options:"
  echo "  --activate <name>  Set the active ASR model (creates symlink at public/wasm/sherpa-onnx-asr)"
  echo ""
  echo "Examples:"
  echo "  $0 sensevoice                    # Download SenseVoice only"
  echo "  $0 piper-en                      # Download English TTS only"
  echo "  $0 all-asr                       # Download all offline ASR models"
  echo "  $0 all --activate sensevoice     # Download everything, activate SenseVoice"
  echo "  $0 --activate reazonspeech       # Switch active ASR model (already downloaded)"
}

# ─── Parse arguments ─────────────────────────────────────────────────────────

COMMAND=""
ACTIVATE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --activate)
      ACTIVATE="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      if [ -z "$COMMAND" ]; then
        COMMAND="$1"
        shift
      else
        echo "Unknown option: $1"
        usage
        exit 1
      fi
      ;;
  esac
done

# ─── Execute command ─────────────────────────────────────────────────────────

case "$COMMAND" in
  # ── Individual offline ASR ──────────────────────────────────────────────
  sensevoice|reazonspeech|whisper-en|zipformer-en|moonshine-en|\
  paraformer-small|paraformer-large|wenetspeech|telespeech|\
  zipformer-ctc-zh|dolphin|gigaspeech2-th)
    download_package "$COMMAND"
    ACTIVATE="${ACTIVATE:-$COMMAND}"
    ;;

  # ── Individual streaming ASR ────────────────────────────────────────────
  stream-en|stream-zh-en|stream-paraformer|stream-paraformer-cantonese)
    download_package "$COMMAND"
    ;;

  # ── Individual TTS ──────────────────────────────────────────────────────
  piper-en|piper-de|matcha-en|matcha-zh|matcha-zh-en)
    download_package "$COMMAND"
    ;;

  # ── Individual tools ────────────────────────────────────────────────────
  vad|ten-vad|speaker-diarization|speech-enhancement)
    download_package "$COMMAND"
    ;;

  # ── Group: Offline ASR ──────────────────────────────────────────────────
  all-asr)
    download_group OFFLINE_ASR_KEYS
    ACTIVATE="${ACTIVATE:-sensevoice}"
    ;;

  # ── Group: Streaming ASR ────────────────────────────────────────────────
  all-asr-stream)
    download_group STREAM_ASR_KEYS
    ;;

  # ── Group: TTS Piper ────────────────────────────────────────────────────
  all-tts-piper)
    download_group TTS_PIPER_KEYS
    ;;

  # ── Group: TTS Matcha ───────────────────────────────────────────────────
  all-tts-matcha)
    download_group TTS_MATCHA_KEYS
    ;;

  # ── Group: All TTS ──────────────────────────────────────────────────────
  all-tts)
    download_group TTS_PIPER_KEYS
    download_group TTS_MATCHA_KEYS
    ;;

  # ── Group: All tools ────────────────────────────────────────────────────
  all-tools)
    download_group TOOL_KEYS
    ;;

  # ── All packages ────────────────────────────────────────────────────────
  all)
    download_group OFFLINE_ASR_KEYS
    download_group STREAM_ASR_KEYS
    download_group TTS_PIPER_KEYS
    download_group TTS_MATCHA_KEYS
    download_group TOOL_KEYS
    ACTIVATE="${ACTIVATE:-sensevoice}"
    ;;

  # ── Activate only (no download) ──────────────────────────────────────────
  "")
    if [ -n "$ACTIVATE" ]; then
      # --activate was given without a download command
      :
    else
      usage
      exit 1
    fi
    ;;

  *)
    usage
    exit 1
    ;;
esac

if [ -n "$ACTIVATE" ]; then
  setup_active_model "$ACTIVATE"
fi

echo ""
echo "Done! Run 'npm run electron:dev' or 'npm run dev' to test."
