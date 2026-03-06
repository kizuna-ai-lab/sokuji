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
  # Core pairs (ja/zh/ko/de/fr/es ↔ en)
  [opus-mt-ja-en]="Xenova/opus-mt-ja-en"
  [opus-mt-en-jap]="Xenova/opus-mt-en-jap"
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

  # English → Other languages
  [opus-mt-en-af]="Xenova/opus-mt-en-af"
  [opus-mt-en-ar]="Xenova/opus-mt-en-ar"
  [opus-mt-en-cs]="Xenova/opus-mt-en-cs"
  [opus-mt-en-da]="Xenova/opus-mt-en-da"
  [opus-mt-en-nl]="Xenova/opus-mt-en-nl"
  [opus-mt-en-fi]="Xenova/opus-mt-en-fi"
  [opus-mt-en-hi]="Xenova/opus-mt-en-hi"
  [opus-mt-en-hu]="Xenova/opus-mt-en-hu"
  [opus-mt-en-id]="Xenova/opus-mt-en-id"
  [opus-mt-en-mul]="Xenova/opus-mt-en-mul"
  [opus-mt-en-ro]="Xenova/opus-mt-en-ro"
  [opus-mt-en-ru]="Xenova/opus-mt-en-ru"
  [opus-mt-en-sv]="Xenova/opus-mt-en-sv"
  [opus-mt-en-uk]="Xenova/opus-mt-en-uk"
  [opus-mt-en-vi]="Xenova/opus-mt-en-vi"
  [opus-mt-en-xh]="Xenova/opus-mt-en-xh"

  # Other languages → English
  [opus-mt-af-en]="Xenova/opus-mt-af-en"
  [opus-mt-ar-en]="Xenova/opus-mt-ar-en"
  [opus-mt-bat-en]="Xenova/opus-mt-bat-en"
  [opus-mt-cs-en]="Xenova/opus-mt-cs-en"
  [opus-mt-hi-en]="Xenova/opus-mt-hi-en"
  [opus-mt-id-en]="Xenova/opus-mt-id-en"
  [opus-mt-it-en]="Xenova/opus-mt-it-en"
  [opus-mt-nl-en]="Xenova/opus-mt-nl-en"
  [opus-mt-pl-en]="Xenova/opus-mt-pl-en"
  [opus-mt-ru-en]="Xenova/opus-mt-ru-en"
  [opus-mt-sv-en]="Xenova/opus-mt-sv-en"
  [opus-mt-tr-en]="Xenova/opus-mt-tr-en"
  [opus-mt-uk-en]="Xenova/opus-mt-uk-en"
  [opus-mt-xh-en]="Xenova/opus-mt-xh-en"

  # Non-English pairs
  [opus-mt-da-de]="Xenova/opus-mt-da-de"
  [opus-mt-fi-de]="Xenova/opus-mt-fi-de"
  [opus-mt-fr-de]="Xenova/opus-mt-fr-de"
  [opus-mt-de-fr]="Xenova/opus-mt-de-fr"
  [opus-mt-fr-ro]="Xenova/opus-mt-fr-ro"
  [opus-mt-ro-fr]="Xenova/opus-mt-ro-fr"
  [opus-mt-fr-ru]="Xenova/opus-mt-fr-ru"
  [opus-mt-ru-fr]="Xenova/opus-mt-ru-fr"
  [opus-mt-fr-es]="Xenova/opus-mt-fr-es"
  [opus-mt-es-fr]="Xenova/opus-mt-es-fr"
  [opus-mt-de-es]="Xenova/opus-mt-de-es"
  [opus-mt-es-de]="Xenova/opus-mt-es-de"
  [opus-mt-it-fr]="Xenova/opus-mt-it-fr"
  [opus-mt-it-es]="Xenova/opus-mt-it-es"
  [opus-mt-es-it]="Xenova/opus-mt-es-it"
  [opus-mt-no-de]="Xenova/opus-mt-no-de"
  [opus-mt-ru-uk]="Xenova/opus-mt-ru-uk"
  [opus-mt-uk-ru]="Xenova/opus-mt-uk-ru"
  [opus-mt-es-ru]="Xenova/opus-mt-es-ru"
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
