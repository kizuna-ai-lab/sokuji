# Third-Party Notices

This file lists the open-source models and libraries used in Sokuji's local inference and readings features, along with their licenses.

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

## Readings (Pronunciation Ruby)

| Library or data | Used for | License | Source |
|-----------------|----------|---------|--------|
| pinyin-pro | Chinese pinyin | MIT | [zh-lx/pinyin-pro](https://github.com/zh-lx/pinyin-pro) |
| Lindera WASM (`lindera-wasm`) | Japanese tokenizer | MIT | [lindera/lindera](https://github.com/lindera/lindera) |
| IPADIC (Lindera's dictionary archive) | Japanese readings | IPADIC license (NAIST, ICOT) | [taku910/mecab](https://github.com/taku910/mecab) |

Lindera's wasm is bundled; IPADIC, its dictionary, is downloaded from sokuji.kizuna.ai on first use. The three license texts follow.

### pinyin-pro

```text
MIT License

Copyright (c) 2022-present zh-lx

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Lindera WASM

```text
MIT License

Copyright (c) 2024 by the project authors.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### IPADIC

```text
Copyright 2000, 2001, 2002, 2003 Nara Institute of Science
and Technology.  All Rights Reserved.

Use, reproduction, and distribution of this software is permitted.
Any copy of this software, whether in its original form or modified,
must include both the above copyright notice and the following
paragraphs.

Nara Institute of Science and Technology (NAIST),
the copyright holders, disclaims all warranties with regard to this
software, including all implied warranties of merchantability and
fitness, in no event shall NAIST be liable for
any special, indirect or consequential damages or any damages
whatsoever resulting from loss of use, data or profits, whether in an
action of contract, negligence or other tortuous action, arising out
of or in connection with the use or performance of this software.

A large portion of the dictionary entries
originate from ICOT Free Software.  The following conditions for ICOT
Free Software applies to the current dictionary as well.

Each User may also freely distribute the Program, whether in its
original form or modified, to any third party or parties, PROVIDED
that the provisions of Section 3 ("NO WARRANTY") will ALWAYS appear
on, or be attached to, the Program, which is distributed substantially
in the same form as set out herein and that such intended
distribution, if actually made, will neither violate or otherwise
contravene any of the laws and regulations of the countries having
jurisdiction over the User or the intended distribution itself.

NO WARRANTY

The program was produced on an experimental basis in the course of the
research and development conducted during the project and is provided
to users as so produced on an experimental basis.  Accordingly, the
program is provided without any warranty whatsoever, whether express,
implied, statutory or otherwise.  The term "warranty" used herein
includes, but is not limited to, any warranty of the quality,
performance, merchantability and fitness for a particular purpose of
the program and the nonexistence of any infringement or violation of
any right of any third party.

Each user of the program will agree and understand, and be deemed to
have agreed and understood, that there is no warranty whatsoever for
the program and, accordingly, the entire risk arising from or
otherwise connected with the program is assumed by the user.

Therefore, neither ICOT, the copyright holder, or any other
organization that participated in or was otherwise related to the
development of the program and their respective officials, directors,
officers and other employees shall be held liable for any and all
damages, including, without limitation, general, special, incidental
and consequential damages, arising out of or otherwise in connection
with the use or inability to use the program or any product, material
or result produced or otherwise obtained by using the program,
regardless of whether they have been advised of, or otherwise had
knowledge of, the possibility of such damages at any time during the
project or thereafter.  Each user will be deemed to have agreed to the
foregoing by his or her commencement of use of the program.  The term
"use" as used herein includes, but is not limited to, the use,
modification, copying and distribution of the program and the
production of secondary products from the program.

In the case where the program, whether in its original form or
modified, was distributed or delivered to or received by a user from
any person, organization or entity other than ICOT, unless it makes or
grants independently of ICOT any specific warranty to the user in
writing, such person, organization or entity, will also be exempted
from and not be held liable to the user for any such damages as noted
above as far as the program is concerned.
```

## License Notes

- **CC-BY-NC 4.0** (MMS, Omnilingual 300M): Non-commercial use only.
- **AGPL-3.0** (Mimic 3): Copyleft license; modifications must be shared under the same license.
- **Gemma License** (TranslateGemma): Subject to Google's Gemma Terms of Use.
- **IPADIC license** (the Japanese readings dictionary): any copy must include its copyright notice and the paragraphs above.
- All other models are under permissive licenses (MIT, Apache 2.0, MPL 2.0, CC-BY 4.0).
