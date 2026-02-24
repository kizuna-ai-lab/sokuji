#!/usr/bin/env bash
# Download Opus-MT translation model files from HuggingFace Hub.
# Files are placed in public/wasm/{model-id}/ for CDN serving.
#
# Usage: bash scripts/download-translation-models.sh [model-id|all]
#
# Examples:
#   bash scripts/download-translation-models.sh opus-mt-ja-en
#   bash scripts/download-translation-models.sh all

set -euo pipefail

DEST_DIR="public/wasm"

# All available Opus-MT models (id → HuggingFace model ID)
declare -A MODELS=(
  [opus-mt-ja-en]="Xenova/opus-mt-ja-en"
  [opus-mt-en-ja]="Xenova/opus-mt-en-ja"
  [opus-mt-zh-en]="Xenova/opus-mt-zh-en"
  [opus-mt-en-zh]="Xenova/opus-mt-en-zh"
  [opus-mt-ko-en]="Xenova/opus-mt-ko-en"
  [opus-mt-en-ko]="Xenova/opus-mt-en-ko"
  [opus-mt-de-en]="Xenova/opus-mt-de-en"
  [opus-mt-en-de]="Xenova/opus-mt-en-de"
  [opus-mt-fr-en]="Xenova/opus-mt-fr-en"
  [opus-mt-en-fr]="Xenova/opus-mt-en-fr"
  [opus-mt-es-en]="Xenova/opus-mt-es-en"
  [opus-mt-en-es]="Xenova/opus-mt-en-es"
)

# Files to download per model (must match TRANSLATION_FILES in modelManifest.ts)
FILES=(
  "config.json"
  "generation_config.json"
  "tokenizer.json"
  "tokenizer_config.json"
  "onnx/encoder_model_quantized.onnx"
  "onnx/decoder_model_merged_quantized.onnx"
)

download_model() {
  local model_id="$1"
  local hf_model="${MODELS[$model_id]}"
  local target_dir="${DEST_DIR}/${model_id}"

  if [ -z "$hf_model" ]; then
    echo "✗ Unknown model: ${model_id}"
    echo "  Available: ${!MODELS[*]}"
    return 1
  fi

  # Check if already downloaded (verify the largest file exists)
  if [ -f "${target_dir}/onnx/decoder_model_merged_quantized.onnx" ]; then
    echo "✓ ${model_id} already exists at ${target_dir}, skipping."
    return 0
  fi

  echo "⬇ Downloading ${model_id} (${hf_model})..."
  mkdir -p "${target_dir}/onnx"

  local base_url="https://huggingface.co/${hf_model}/resolve/main"

  for file in "${FILES[@]}"; do
    local url="${base_url}/${file}"
    local dest="${target_dir}/${file}"

    # Skip if file already exists (resume support)
    if [ -f "$dest" ]; then
      echo "  ✓ ${file} (exists)"
      continue
    fi

    echo "  ⬇ ${file}..."
    curl -L --progress-bar -o "$dest" "$url"
  done

  echo "✓ ${model_id} downloaded to ${target_dir}"
  echo "  Files:"
  ls -lh "${target_dir}/"
  ls -lh "${target_dir}/onnx/"
}

usage() {
  echo "Usage: $0 [model-id|all]"
  echo ""
  echo "Available models:"
  for model_id in $(echo "${!MODELS[@]}" | tr ' ' '\n' | sort); do
    echo "  ${model_id}  (${MODELS[$model_id]})"
  done
  echo ""
  echo "  all  Download all translation models"
  echo ""
  echo "Examples:"
  echo "  $0 opus-mt-ja-en    # Download Japanese → English only"
  echo "  $0 all              # Download all translation models"
}

COMMAND="${1:-}"

case "$COMMAND" in
  all)
    for model_id in $(echo "${!MODELS[@]}" | tr ' ' '\n' | sort); do
      download_model "$model_id"
    done
    ;;
  "")
    usage
    exit 1
    ;;
  *)
    download_model "$COMMAND"
    ;;
esac

echo ""
echo "Done! Translation model files are in ${DEST_DIR}/opus-mt-*/"
echo "Run 'npm run dev' to serve them via the dev server."
