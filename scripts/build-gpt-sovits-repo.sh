#!/usr/bin/env bash
# Assemble the gpt-sovits-v2pp-onnx HF repo tree (issue #322).
#
# Inputs:
#   $1 = converted model dir (Genie converter output on the BASE checkpoints;
#        one-off torch step, see docs/superpowers/plans/2026-07-17-gpt-sovits-tts.md)
#   $2 = GenieData dir (High-Logic/Genie GenieData/ + GenieData(Optional)/RoBERTa)
#   $3 = output dir
# Publishes fp16 bins only — the sidecar expands them to fp32 at load time.
set -euo pipefail
CONVERTED=$1; GENIE=$2; OUT=$3

mkdir -p "$OUT/model" "$OUT/genie_data/G2P" "$OUT/voices"

# model graphs + fp16 bins + the (already-fp32) encoder bin. NO expanded fp32
# bins — publishing them would double the download for nothing.
for f in t2s_encoder_fp32.onnx t2s_encoder_fp32.bin \
         t2s_first_stage_decoder_fp32.onnx t2s_stage_decoder_fp32.onnx \
         t2s_shared_fp16.bin vits_fp32.onnx vits_fp16.bin \
         prompt_encoder_fp32.onnx prompt_encoder_fp16.bin; do
  cp "$CONVERTED/$f" "$OUT/model/"
done

# runtime assets (hubert stays fp16; RoBERTa + speaker encoder are fp32-only).
# -L: GenieData/RoBERTa is a symlink to GenieData(Optional)/RoBERTa in the
# High-Logic/Genie layout; plain `cp -r` copies the symlink itself (broken
# outside the source tree), not its target, so dereference explicitly.
cp -rL "$GENIE/chinese-hubert-base" "$OUT/genie_data/"
cp "$GENIE/speaker_encoder.onnx" "$OUT/genie_data/"
cp -rL "$GENIE/RoBERTa" "$OUT/genie_data/"
cp -rL "$GENIE/G2P/ChineseG2P" "$OUT/genie_data/G2P/"
cp -rL "$GENIE/G2P/EnglishG2P" "$OUT/genie_data/G2P/"

# default builtin voice: first utterance of the repo benchmark clip (JFK 1961
# inaugural — US government work, public domain), trimmed to ~4.4s.
python3 - "$OUT" <<'EOF'
import sys, soundfile as sf
out = sys.argv[1]
wav, sr = sf.read("benchmark/test-speech-silence-speech.wav", dtype="float32")
sf.write(f"{out}/voices/classic-en.wav", wav[: int(4.4 * sr)], sr)
with open(f"{out}/voices/classic-en.txt", "w") as f:
    f.write("Ask not what your country can do for you. "
            "Ask what you can do for your country.")
EOF
cat > "$OUT/voices/manifest.json" <<'EOF'
[
  {"name": "classic-en", "language": "en", "gender": "m",
   "curated": true, "unstable": false, "default": true}
]
EOF

cat > "$OUT/README.md" <<'EOF'
# GPT-SoVITS v2ProPlus — ONNX (Sokuji Local Native TTS)

Converted from the base pretrained checkpoints of
[GPT-SoVITS](https://github.com/RVC-Boss/GPT-SoVITS) (MIT) —
[lj1995/GPT-SoVITS](https://huggingface.co/lj1995/GPT-SoVITS) (MIT) —
via [Genie-TTS](https://github.com/High-Logic/Genie-TTS) (MIT).
Runtime assets (chinese-hubert-base, speaker encoder, RoBERTa, G2P dictionaries)
mirrored from [High-Logic/Genie](https://huggingface.co/High-Logic/Genie) (MIT;
hubert originally [TencentGameMate/chinese-hubert-base](https://huggingface.co/TencentGameMate/chinese-hubert-base), MIT;
RoBERTa Apache-2.0).

Weight bins under `model/` and `genie_data/chinese-hubert-base/` are fp16;
the Sokuji sidecar expands them to fp32 in place at load time.

Default voice clip: JFK 1961 inaugural address excerpt (US government work,
public domain).
EOF

# Guard against fp32 expansion pollution: `ensure_fp32_bins()` expands the
# fp16 bins to their fp32 twins IN PLACE at load time (see runtime.py
# FP16_TO_FP32), so any tree that was smoke-tested by loading the backend
# straight out of $OUT picks up these twins alongside the fp16 originals we
# actually want to publish. Delete them by exact path, not a glob — the
# encoder bin (t2s_encoder_fp32.bin) is a REAL fp32-only shipped file with no
# fp16 twin and must survive this.
for f in model/t2s_shared_fp32.bin model/vits_fp32.bin model/prompt_encoder_fp32.bin \
         genie_data/chinese-hubert-base/chinese-hubert-base_weights.bin; do
  if [ -f "$OUT/$f" ]; then
    echo "removing fp32 expansion twin: $f"
    rm -f "$OUT/$f"
  fi
done

du -sb "$OUT"
echo "repo tree assembled at $OUT"
