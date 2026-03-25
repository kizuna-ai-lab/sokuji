# Third-Party Notices

This file lists the open-source models and libraries used in Sokuji's local inference features, along with their licenses.

## Speech Recognition (ASR) Models

### sherpa-onnx Models
Distributed via [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) WASM packages.

| Model | Languages | License | Source |
|-------|-----------|---------|--------|
| SenseVoice / SenseVoice Nano | Multilingual | Apache 2.0 | [FunAudioLLM/SenseVoice](https://github.com/FunAudioLLM/SenseVoice) |
| Moonshine Tiny / Base | en, ja, ko, zh, es, ar, uk, vi | MIT | [usefulsensors/moonshine](https://github.com/usefulsensors/moonshine) |
| NeMo Canary | Multilingual | Apache 2.0 | [NVIDIA/NeMo](https://github.com/NVIDIA/NeMo) |
| NeMo FastConformer | en, de, es, pt, multi | Apache 2.0 | [NVIDIA/NeMo](https://github.com/NVIDIA/NeMo) |
| NeMo Parakeet TDT 0.6B | 25 EU languages | Apache 2.0 | [NVIDIA/NeMo](https://github.com/NVIDIA/NeMo) |
| Dolphin Base CTC | Multilingual | Apache 2.0 | [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) |
| Whisper Tiny (sherpa) | 99+ languages | MIT | [openai/whisper](https://github.com/openai/whisper) |
| WenetSpeech Yue U2++ | Cantonese | Apache 2.0 | [wenet-e2e/wenet](https://github.com/wenet-e2e/wenet) |
| Omnilingual 300M v2 | 1147 languages | CC-BY-NC 4.0 | [facebookresearch/fairseq](https://github.com/facebookresearch/fairseq) |
| Zipformer EN/RU/VI | en, ru, vi | Apache 2.0 | [k2-fsa/icefall](https://github.com/k2-fsa/icefall) |
| Streaming Zipformer | en, fr, de, es, zh, ru, bn, multi | Apache 2.0 | [k2-fsa/icefall](https://github.com/k2-fsa/icefall) |
| NeMo Streaming FastConformer CTC | en | Apache 2.0 | [NVIDIA/NeMo](https://github.com/NVIDIA/NeMo) |

### Whisper WebGPU Models
Run via [Hugging Face Transformers.js](https://github.com/huggingface/transformers.js) with WebGPU acceleration.

| Model | Languages | License | Source |
|-------|-----------|---------|--------|
| Whisper Tiny / Tiny EN | 99+ / en | MIT | [openai/whisper](https://github.com/openai/whisper) |
| Whisper Base | 99+ languages | MIT | [openai/whisper](https://github.com/openai/whisper) |
| Whisper Small | 99+ languages | MIT | [openai/whisper](https://github.com/openai/whisper) |
| Whisper Medium | 99+ languages | MIT | [openai/whisper](https://github.com/openai/whisper) |
| Whisper Large V3 Turbo | 99+ languages | MIT | [openai/whisper](https://github.com/openai/whisper) |

ONNX conversions by [Xenova](https://huggingface.co/Xenova) and [onnx-community](https://huggingface.co/onnx-community).

## Text-to-Speech (TTS) Models

### Piper Models
136+ voice models across 50+ languages via [Piper](https://github.com/rhasspy/piper).

| Engine | Languages | License | Source |
|--------|-----------|---------|--------|
| Piper | 50+ languages, 136+ voices | MIT | [rhasspy/piper](https://github.com/rhasspy/piper) |

Individual voice model licenses vary. See [Piper voice samples](https://rhasspy.github.io/piper-samples/) for details.

### Piper-Plus Models

| Model | Languages | License | Source |
|-------|-----------|---------|--------|
| Piper-Plus CSS10 JA | ja + 5 languages | MIT | [nickolay-kondratyev/piper-plus-plus](https://github.com/nickolay-kondratyev/piper-plus-plus) |

### Matcha-TTS Models

| Model | Languages | License | Source |
|-------|-----------|---------|--------|
| Matcha Baker | zh | MIT | [shivammehta25/Matcha-TTS](https://github.com/shivammehta25/Matcha-TTS) |
| Matcha Farsi | fa | MIT | [shivammehta25/Matcha-TTS](https://github.com/shivammehta25/Matcha-TTS) |

### Other TTS Models

| Model | Languages | License | Source |
|-------|-----------|---------|--------|
| Coqui TTS | bg, bn, et, ga, hr, lt, mt | MPL 2.0 | [coqui-ai/TTS](https://github.com/coqui-ai/TTS) |
| Mimic 3 | af, bn, el, fa, gu, ko, tn, vi | AGPL-3.0 | [MycroftAI/mimic3](https://github.com/MycroftAI/mimic3) |
| MMS | th, nan (Min Nan) | CC-BY-NC 4.0 | [facebookresearch/fairseq](https://github.com/facebookresearch/fairseq) |
| Cantonese VITS | yue (Cantonese) | Apache 2.0 | [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) |
| Icefall AISHELL3 | zh | Apache 2.0 | [k2-fsa/icefall](https://github.com/k2-fsa/icefall) |

## Translation Models

### Opus-MT Models
80+ language pair models via [Helsinki-NLP/Opus-MT](https://github.com/Helsinki-NLP/Opus-MT).

| Model Family | License | Source |
|-------------|---------|--------|
| Opus-MT (all pairs) | CC-BY 4.0 | [Helsinki-NLP/Opus-MT](https://github.com/Helsinki-NLP/Opus-MT) |

ONNX conversions by [Xenova](https://huggingface.co/Xenova).

### LLM-Based Translation Models
Run via [Hugging Face Transformers.js](https://github.com/huggingface/transformers.js) with WebGPU acceleration.

| Model | Languages | License | Source |
|-------|-----------|---------|--------|
| Qwen 2.5 0.5B Instruct | Multilingual | Apache 2.0 | [QwenLM/Qwen2.5](https://github.com/QwenLM/Qwen2.5) |
| Qwen 3 0.6B | 119+ languages | Apache 2.0 | [QwenLM/Qwen3](https://github.com/QwenLM/Qwen3) |
| Qwen 3.5 0.8B / 2B | 201+ languages | Apache 2.0 | [QwenLM/Qwen3](https://github.com/QwenLM/Qwen3) |
| TranslateGemma 4B | 51 languages | Gemma License | [google/translate-gemma](https://github.com/google-research/translate-gemma) |

ONNX conversions by [onnx-community](https://huggingface.co/onnx-community).

## Voice Activity Detection (VAD)

| Model | License | Source |
|-------|---------|--------|
| Silero VAD | MIT | [snakers4/silero-vad](https://github.com/snakers4/silero-vad) |

Used via [@ricky0123/vad-web](https://github.com/ricky0123/vad-web).

## Inference Engines

| Library | License | Source |
|---------|---------|--------|
| sherpa-onnx | Apache 2.0 | [k2-fsa/sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) |
| Hugging Face Transformers.js | Apache 2.0 | [huggingface/transformers.js](https://github.com/huggingface/transformers.js) |
| ONNX Runtime Web | MIT | [microsoft/onnxruntime](https://github.com/microsoft/onnxruntime) |

## License Notes

- **CC-BY-NC 4.0** (MMS, Omnilingual 300M): Non-commercial use only.
- **AGPL-3.0** (Mimic 3): Copyleft license; modifications must be shared under the same license.
- **Gemma License** (TranslateGemma): Subject to Google's Gemma Terms of Use.
- All other models are under permissive licenses (MIT, Apache 2.0, MPL 2.0, CC-BY 4.0).
