#!/usr/bin/env bash
# Download sherpa-onnx WASM prebuilt packages for ASR and TTS.
# Usage: bash scripts/download-sherpa-wasm.sh [sensevoice|reazonspeech|piper-en|piper-de|all-asr|all-tts|all]
#
# Packages are extracted into public/wasm/ and excluded from git via .gitignore.

set -euo pipefail

VERSION="1.12.25"
BASE_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/v${VERSION}"
DEST_DIR="public/wasm"

# Package definitions: name -> tarball filename -> target directory
declare -A PACKAGES=(
  # ASR packages
  [sensevoice]="sherpa-onnx-wasm-simd-${VERSION}-vad-asr-zh_en_ja_ko_cantonese-sense_voice_small.tar.bz2"
  [reazonspeech]="sherpa-onnx-wasm-simd-${VERSION}-vad-asr-ja-zipformer_reazonspeech.tar.bz2"
  # TTS packages
  [piper-en]="sherpa-onnx-wasm-simd-${VERSION}-vits-piper-en_US-libritts_r-medium.tar.bz2"
  [piper-de]="sherpa-onnx-wasm-simd-${VERSION}-vits-piper-de_DE-thorsten_emotional-medium.tar.bz2"
)

declare -A TARGET_DIRS=(
  # ASR target directories
  [sensevoice]="sherpa-onnx-asr-sensevoice"
  [reazonspeech]="sherpa-onnx-asr-reazonspeech"
  # TTS target directories
  [piper-en]="sherpa-onnx-tts-piper-en"
  [piper-de]="sherpa-onnx-tts-piper-de"
)

# Check files to detect if package is already extracted
declare -A CHECK_FILES=(
  [sensevoice]="sherpa-onnx-wasm-main-vad-asr.wasm"
  [reazonspeech]="sherpa-onnx-wasm-main-vad-asr.wasm"
  [piper-en]="sherpa-onnx-wasm-main-tts.wasm"
  [piper-de]="sherpa-onnx-wasm-main-tts.wasm"
)

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
    mv "$extracted_dir" "$target_dir"
  fi

  echo "✓ ${name} extracted to ${target_dir}"
  echo "  Files:"
  ls -lh "${target_dir}/"
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
  echo "Usage: $0 [sensevoice|reazonspeech|piper-en|piper-de|all-asr|all-tts|all] [--activate <name>]"
  echo ""
  echo "ASR Packages:"
  echo "  sensevoice    Download SenseVoice multilingual (ja/zh/en/ko/cantonese, ~158MB)"
  echo "  reazonspeech  Download ReazonSpeech Japanese-only (~137MB)"
  echo "  all-asr       Download all ASR packages"
  echo ""
  echo "TTS Packages:"
  echo "  piper-en      Download Piper LibriTTS-R English multi-speaker (~81MB)"
  echo "  piper-de      Download Piper Thorsten Emotional German (~79MB)"
  echo "  all-tts       Download all TTS packages"
  echo ""
  echo "  all           Download all ASR + TTS packages"
  echo ""
  echo "Options:"
  echo "  --activate <name>  Set the active ASR model (creates symlink at public/wasm/sherpa-onnx-asr)"
  echo ""
  echo "Examples:"
  echo "  $0 sensevoice                    # Download SenseVoice only"
  echo "  $0 piper-en                      # Download English TTS only"
  echo "  $0 all --activate sensevoice     # Download everything, activate SenseVoice for ASR"
  echo "  $0 --activate reazonspeech       # Switch active ASR model (already downloaded)"
}

# Parse arguments
COMMAND="${1:-}"
ACTIVATE=""

shift || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --activate)
      ACTIVATE="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      usage
      exit 1
      ;;
  esac
done

case "$COMMAND" in
  sensevoice)
    download_package "sensevoice"
    ACTIVATE="${ACTIVATE:-sensevoice}"
    ;;
  reazonspeech)
    download_package "reazonspeech"
    ACTIVATE="${ACTIVATE:-reazonspeech}"
    ;;
  piper-en)
    download_package "piper-en"
    ;;
  piper-de)
    download_package "piper-de"
    ;;
  all-asr)
    download_package "sensevoice"
    download_package "reazonspeech"
    ACTIVATE="${ACTIVATE:-sensevoice}"
    ;;
  all-tts)
    download_package "piper-en"
    download_package "piper-de"
    ;;
  all)
    download_package "sensevoice"
    download_package "reazonspeech"
    download_package "piper-en"
    download_package "piper-de"
    ACTIVATE="${ACTIVATE:-sensevoice}"
    ;;
  --activate)
    # Handle case where --activate is the first arg
    ACTIVATE="$1"
    shift || true
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
