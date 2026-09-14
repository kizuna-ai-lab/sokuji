# ASR punctuation restoration: survey and Sokuji fit

Date: 2026-09-14. Worktree `research-asr-punctuation` at `fb384d84` (v0.41.0). Research note: no code changed.

## TL;DR

- **The gap is smaller than it looks, and much of it is configuration.** Per their own sources, most cards we recommend already emit punctuation (§2): Cohere, Whisper, SenseVoice (ITN on), Canary, Parakeet v3, the Nemotron streaming models, plus Qwen3-ASR and Voxtral Realtime (our own observation). The unpunctuated output comes from:
  - **Fun-ASR:** transcribe.cpp runs it with ITN off by default and Sokuji never overrides that (`native/src/sk_asr.cpp:183-185`), so it drops the final `。`.
  - **Granite in the browser:** we prompt it without asking for punctuation (`granite-speech-webgpu.worker.ts:183`).
  - **English CTC/RNNT Parakeets and Granite 4.1 plus:** no punctuation by design.
  - **Unverified:** Moonshine (including the ja/zh/ko fine-tunes), Breeze, and the sherpa streaming zipformers.
- **`Intl.Segmenter` cannot help.** UAX #29 never breaks a sentence without a terminator, and a local check confirmed it for en/ja/zh/ko (§5).
- **No open model does punctuation, truecasing and segmentation well for all of ja/zh/ko/en.**
  - **Best single model:** 1-800-BAD-CODE `xlm-roberta_punctuation_fullstop_truecase`. It is Apache-2.0 and covers 47 languages including ja/zh/ko. But it has no Korean metrics and no `！`, Japanese `、` F1 is 67.03, and its card says it is "unlikely to be of production quality".
  - **Best for Chinese:** FireRedPunc (Apache-2.0, zh F1 82.96).
  - **Japanese-only and Korean-only options:** weak or unevaluated.
  - **Blocked for us:** Silero (non-commercial), Riva (Riva-only EULA), p208p2002 (no license).

**Recommendation for the browser (Local Inference):**
1. **Add no model yet.**
   - Change the translation prompts (`prompts.ts:54-56`, `translate_backend.py:126-131`) to say the transcript may lack punctuation and to ask for punctuated output.
   - Ask Granite for punctuation in its prompt.
   - Run the benchmarks in §7.
2. **If a model is still needed:**
   - **What:** PCS-47, in a renderer worker, on **finals only**, gated to card and language pairs that don't already punctuate.
   - **How:** raw onnxruntime-web on the WASM EP, from our own int8 export. That export is estimated at about 280 MB, by analogy with `onnx-community/punctuate-all-ONNX` int8 at 278,658,098 B, an XLM-R base encoder. PCS-47 is inferred to be XLM-R base from its file size; its card does not say.
   - **Why not transformers.js:** its pipeline can't load PCS's custom 4-head graph or its SentencePiece model.
   - **Chinese-heavy use:** FireRedPunc's third-party int8 ONNX (102,189,962 B) is the more accurate choice.

**Recommendation for native (Local Native):**
1. **Configure transcribe.cpp per card.** Set `pnc`/`itn` explicitly (turn Fun-ASR's ITN on). Check whether Nemotron 3.5's `<xx-XX>` language tag reaches the text.
2. **Don't add a punctuation runtime to the ggml-only sidecar first.** `LocalNativeClient` runs in the renderer, so the renderer-side punctuator from the browser plan serves Local Native as well.
3. **If it has to be native:**
   - **What:** vendor CrispASR's MIT `crisp_punc` (`pcs.cpp`, `fireredpunc.cpp`) behind a new `sk_punc_*` stage, loading `cstr/pcs-xlmr-base-GGUF` Q8_0 (301,964,352 B) and/or `cstr/fireredpunc-GGUF` Q8_0 (108,664,800 B).
   - **Feasibility:** every graph op it uses exists in our pinned ggml 0.22.
   - **Risks:** it was developed on a ggml fork, so it needs parity tests, and tokenizer fidelity is a known risk (§4.8).
   - **Not upstream llama.cpp:** it cannot run token-classification heads (PR #19725 is open and covers only BERT/ModernBERT).

**The LLM route:** use the translation call we already make, by changing its prompt. A separate LLM punctuation pass costs a whole extra generation and may rewrite words (§4.9).

---

## 1. The problem in Sokuji

Three places depend on sentence punctuation. None of them can recover it.

**1a. Finalizing a streaming result.**
- `src/lib/local-inference/workers/_shared/streaming-generation.ts:237` defines `SENTENCE_END_PATTERN = /[.。!?！？]\s*$/`.
- `:306` finalizes the pending text the moment it ends with one of those marks. The check runs unless `punctuationEndpoint === false`, so it is on by default.
- Only the Voxtral Realtime browser worker constructs this accumulator, with `PUNCTUATION_ENDPOINT_ENABLED = true` (`voxtral-webgpu.worker.ts:168`, `:280`). Our own spike found that model "batches output (holds an utterance's tail ~3 s through a pause), so sentence punctuation — not VAD timing — is the reliable cut signal" (`docs/superpowers/plans/2026-06-25-voxtral-always-stream.md:13`).
- Every other path cuts on the VAD:
  - **Local Native** uses the renderer VAD worker: by default 1.4 s of silence ends a segment (`native-vad.worker.ts:84`), and 20 s of speech forces a cut (`:87`, `:138-146`). `LocalNativeClient.ts:247-251` forwards `speech_start/end/cancel` as marks, and the sidecar is "mark-driven" (`sidecar/sokuji_sidecar/asr_engine.py:33`).
  - **The Local Inference WebGPU workers** each run the same vad-web `FrameProcessor` inside the worker (`whisper-webgpu.worker.ts:22`, `qwen3-asr-webgpu.worker.ts:26`, `voxtral-webgpu.worker.ts:25`), configured through `AsrEngine.ts:198-223`. I did not check their defaults.
  - **The sherpa-onnx streaming worker** uses `recognizer.isEndpoint` (`public/workers/sherpa-onnx-streaming-asr.worker.js:212`).
- So an unpunctuated model gets no early finalization. It holds a result until the VAD sees silence or the speech cap is reached (1.4 s and 20 s on the native path). A run-on of that length then goes to the translator as one unit.

**1b. Translation input.**
- The ASR text goes straight to the translator:
  - `LocalInferenceClient.ts:564` calls `translationEngine.translate(job.text, …)`.
  - `LocalNativeClient.ts:470` calls `translate.translate(text, …)`.
- Neither prompt tells the model its input may be unpunctuated:
  - The renderer prompt (`src/lib/local-inference/prompts.ts:54-56`) says "Translate the speech transcript inside <transcript> tags … Drop fillers … Fix stuttering and repetitions."
  - The sidecar default is `translate_backend.py:126-131`.

**1c. Per-sentence TTS.**
- `src/utils/splitSentences.ts:27` uses `Intl.Segmenter(locale, { granularity: 'sentence' })`, called from `LocalInferenceClient.ts:621` and `LocalNativeClient.ts:511`.
- It splits the **translated** text in the target language. It depends on the translator emitting punctuation, not on the ASR. §5 covers whether it can cope when the translator doesn't.

**1d. Sokuji never sets the ASR punctuation switches.**
- `native/src/sk_asr.cpp:183-185` (batch) and `:208-212` (stream) call `transcribe_run_params_init` and set only `language`. Every transcribe.cpp family therefore runs on its own default punctuation/ITN setting (§2).
- Browser:
  - Granite asks for plain transcription: `'<|audio|>Transcribe the speech to text'` (`granite-speech-webgpu.worker.ts:183`).
  - sherpa-onnx SenseVoice runs with `useInverseTextNormalization: 1` (`public/workers/sherpa-onnx-asr.worker.js:71`).
- The bundled sherpa-onnx WASM binaries contain no punctuation symbols. `grep -a -c Punct` returns 0 for both `public/wasm/sherpa-onnx-asr/sherpa-onnx-wasm-main-vad-asr.wasm` and `public/wasm/sherpa-onnx-asr-stream/sherpa-onnx-wasm-main-asr.wasm`.

---

## 2. Roster audit (A): which of our ASR models punctuate

Sources: each model's owner card or paper. transcribe.cpp docs are used where they describe the runtime default Sokuji inherits. "Unverified" means no primary source says. For CJK, "casing" is n/a.

| Card (runtime) | ja/zh/en/ko | Punct | Casing | Evidence | Source |
|---|---|---|---|---|---|
| nemotron-3.5-asr-streaming (native stream) | all four | yes (checked on en-US only) | yes | "native support for punctuation and capitalization" | [1] |
| nemotron-speech-streaming-en (native stream) | en | yes | yes | "full support for punctuation and capitalization" | [2] |
| multitalker-parakeet-streaming-0.6b-v1 (native stream) | en | yes | yes | NVIDIA card silent; the GGUF card says "with punctuation and capitalization" | [3] |
| moonshine-streaming-tiny/small/medium (native stream) | en | unverified | unverified | card and Moonshine v2 paper silent | [4] |
| voxtral-mini-4b-realtime (native stream and browser) | all four | yes (our observation only) | unverified | upstream card and arXiv 2602.11298 silent; our spike note (§1a) | [5] |
| parakeet-unified-en-0.6b (native batch) | en | yes | yes | "Built-in support for punctuation and capitalization" | [6] |
| cohere-transcribe-03-2026 (native and browser) | all four | yes, on by default | yes | GGUF card: "By default, punctuation is enabled" (owner card gated); transformers.js hard-codes `<\|pnc\|>` | [7] |
| qwen3-asr-0.6b / 1.7b (native and browser) | all four | yes (our observation only) | unverified | Qwen card and arXiv 2601.21337 silent | [8] |
| fun-asr-nano / fun-asr-mlt-nano (native batch) | zh/en/ja (+ko MLT) | partial: no final `。` with ITN off, which is the default | off | transcribe.cpp: "`--itn` to enable inverse text normalization (digits, capitalization, punctuation)" | [9] |
| sense-voice (native batch) | all four | yes (ITN on by default) | yes | "ITN is on by default … the ITN flag is what produces casing, punctuation" | [10] |
| sherpa SenseVoice int8 (browser WASM) | all four | yes | yes | `use_itn`: "Whether the output result includes punctuation"; we set it on | [11] |
| whisper family (native and browser) | all four | yes, not guaranteed | yes | trained to "predict the raw text of transcripts without any significant standardization" | [12] |
| granite-speech-4.1-2b (native and browser) | ja, en | only when prompted | only when prompted | "Punctuation and truecasing … with a simple prompt change"; our browser prompt does not ask | [13] |
| granite-speech-4.1-2b-plus (native) | en | no | no | "the plus model doesn't provide punctuation and capitalization" | [14] |
| granite-4.0-1b-speech, granite-4.1-2b-nar | ja/en, en | unverified | unverified | cards silent | [13] |
| moonshine-base/tiny -ja/-zh/-ko (native), moonshine-v2 (browser) | ja/zh/ko | unverified | n/a | cards silent; transcribe.cpp's jfk sample shows tiny punctuated and base with none | [15] |
| breeze-asr-25 (native) | zh, en | unverified | unverified | card silent | [16] |
| canary-1b-v2 / 1b-flash / 180m-flash (native) | en | yes (pnc on by default) | yes | "Punctuation and Capitalization included"; "`--pnc` (default)" | [17] |
| parakeet-tdt-0.6b-v3 / -v2, tdt_ctc-110m / -1.1b, canary-qwen-2.5b | en | yes | yes | "Automatic punctuation and capitalization" | [18] |
| parakeet-ctc-0.6b/1.1b, parakeet-rnnt-0.6b/1.1b | en | no | no | "transcribes speech in lower case English alphabet" | [19] |
| moss-transcribe-diarize (native) | zh, en | yes | yes | sample output is punctuated | [20] |
| sherpa streaming zipformers (zh, multi-8lang, Kroko), NeMo CTC 80 ms (browser) | zh/ja/en | unverified | unverified | no owner statement | [21] |

Nuances that matter for the design:
- **The ja/zh/ko picture is thin.** First-party CJK evidence exists only for SenseVoice (ITN) and Fun-ASR. Qwen3-ASR and Voxtral punctuation rests on our own observations. Whisper punctuation is known to be inconsistent [12].
- **The catalog comment on sense-voice is wrong.** `sidecar/sokuji_sidecar/catalog.py:309` says "(no ITN/punct)", but transcribe.cpp turns ITN on by default for SenseVoice [10].
- **Fun-ASR with ITN off drops the final terminator**, which is exactly what `SENTENCE_END_PATTERN` needs. transcribe.cpp shows zh "…下午五点" without ITN and "…五点。" with it; ja keeps commas but loses the final "。" [9].
- **Lower lookahead costs the trailing punctuation first.** For the NVIDIA cache-aware streaming models, transcribe.cpp found right-context R=0/1 "differ only in trailing punctuation (lower lookahead)", while R=6/13 is byte-equal to one-shot [22].
- **Nemotron 3.5 can put a tag after the final mark.** In auto-language mode it emits a `<xx-XX>` tag after the final punctuation [1]. I found no stripping code in `sidecar/`, `native/src/` or `src/lib/local-inference/`, so whether it reaches the text is unverified. If it does, a `$`-anchored end check fails.

---

## 3. Candidates compared (B)

Sizes are exact byte counts from the Hub or GitHub APIs. "Browser" means onnxruntime-web inside a renderer worker. "Native" means Sokuji's ggml-only sidecar. Bidirectional encoders all need right context (see §6.2).

| Model | Smallest usable artifact | ja / zh / ko / en | License (commercial?) | Output | Architecture, formats | Browser fit | Native (ggml) fit | Sources |
|---|---|---|---|---|---|---|---|---|
| **1-800-BAD-CODE `xlm-roberta_punctuation_fullstop_truecase`** ("PCS-47") | ONNX fp32 1,112,481,438 B; fp16 port 556,483,843 B; GGUF Q8_0 301,964,352 B / Q4_K 163,098,688 B | yes / yes / yes (no metrics) / yes; 47 languages | Apache-2.0 (yes) | 17 punctuation labels, truecase, sentence boundary; no `！` | XLM-R base, 4 heads; ONNX, `.nemo`, GGUF (CrispASR) | raw ORT-web + JS SentencePiece (not the transformers.js pipeline); int8 must be self-made | CrispASR `pcs.cpp` (MIT) | §4.1 |
| **FireRedPunc** | int8 ONNX 102,189,962 B (third party); GGUF Q8_0 108,664,800 B | no / yes / no / partial (regex post-fix) | Apache-2.0 (yes) | `，。？！`; English casing only at sentence start | BERT-base (LERT); PyTorch, ONNX and GGUF ports | raw ORT-web, WordPiece `tokenizer.json` | CrispASR `fireredpunc.cpp` (MIT) | §4.4 |
| sherpa-onnx CT-Transformer zh-en (FunASR) | int8 tarball 64,717,756 B (`model.int8.onnx` 72 MB) | no / yes / no / full-width marks only | FunASR card Apache-2.0 / `MODEL_LICENSE` (read before shipping) | `，。？、`, no casing | CT-Transformer (SANM); ONNX | needs a sherpa WASM build that links punctuation | none (ONNX only) | §4.2–4.3 |
| FunASR CT-Transformer vad_realtime | `model_quant.onnx` 281,877,652 B | no / yes / no / no | as above | `，。？、` | CT-Transformer with a per-segment cache | only via sherpa/FunASR runtime code | none | §4.3 |
| sherpa-onnx online punct en (Edge-Punct-Casing) | int8 7.1 MB (tarball 30,667,839 B) | en only | Apache-2.0 (yes) | `, . ?` + casing | CNN-BiLSTM; ONNX | small; sherpa WASM rebuild or raw ORT-web | none | §4.2 |
| kredor/punctuate-all | int8 ONNX 278,658,098 B | no CJK (12 European) | MIT (yes) | `. , ? - :`, no casing | XLM-R base token classification; ONNX, GGUF | transformers.js pipeline works | CrispASR | §4.1 |
| oliverguhr fullstop-multilang-large | GGUF Q4_K 321,063,584 B; safetensors 2,235,440,664 B | no CJK (en/de/fr/it) | MIT (yes) | `. , ? - :` | XLM-R large | too large | CrispASR | §4.1 |
| SaT `sat-3l-sm` (wtpsplit) | `model_optimized.onnx` fp16 427,756,189 B; community int8 214,691,162 B (no license tag) | yes / yes / yes / yes; 85 languages | MIT (yes) | **sentence boundaries only**, no punctuation or casing | XLM-R cut to 3 layers (`xlm-token`); ONNX fp16 | raw ORT-web (not in transformers.js); fp16 in WASM unverified | none | §4.1 |
| Mojicast / bobfromjapan ja punct | int8 ONNX 109,150,947 B | ja only | Apache-2.0 (yes) | `、。` only | char BERT-base; ONNX | raw ORT-web | none | §4.7 |
| whooray/koen_punctuation | safetensors 1,221,503,956 B | ko + en | Apache-2.0 (yes) | `, . ? !` | gte-multilingual-mlm-base, 305M params; no ONNX | would need an export | none | §4.7 |
| Translation LLM already loaded (Qwen3 / Qwen3.5 / HY-MT / TranslateGemma) | 0 B extra | all | per model | punctuation and casing by prompt | decoder LLM; GGUF (llama.cpp), ONNX (WebGPU) | already runs | already runs | §4.9 |
| *Excluded:* Riva ja/zh/ko PnC | — | yes / yes / yes / yes | NVIDIA AI Enterprise EULA, Riva-only | `, . ?` + casing | mBERT; encrypted | no | no | §4.5 |
| *Excluded:* Silero TE | 91,713,171 B | no CJK | CC BY-NC-SA 4.0 (**no**) | punctuation + casing | torch.package | no | no | §4.6 |
| *Excluded:* p208p2002 zh-wiki-punctuation-restore | 406,757,252 B | zh | **no license** | 6 marks | BERT | — | — | §4.7 |
| *Excluded:* NeMo `punctuation_en_bert` | size unverified | en | NGC Terms of Use | `, . ?` + casing | BERT; `.nemo` | no | no | §4.5 |

## 4. Per-candidate notes

### 4.1 Multilingual encoders (XLM-R family)

**1-800-BAD-CODE `xlm-roberta_punctuation_fullstop_truecase` ("PCS-47")** [23]
- **Coverage and license:**
  - 47 languages, including `ja`, `ko`, `zh` and `en` (`config.yaml` `languages`) [24].
  - Apache-2.0; last modified 2023-07-15.
- **Files:**
  - `model.onnx` 1,112,481,438 B; `sp.model` 5,069,059 B; `pcs47_1jun.nemo` 1,119,815,680 B.
  - No official quantized build.
  - About 278M parameters, derived from the fp32 file size; the card only says "xlm-roberta".
- **Heads:**
  - Pre-token punctuation (`¿`).
  - Post-token punctuation, 17 labels: `<NULL> <ACRONYM> . , ? ？ ， 。 、 ・ । ؟ ، ; ። ፣ ፧`. There is no `!`/`！` [24].
  - Sentence boundary, which is conditioned on the predicted punctuation.
  - Per-character truecasing.
  - `max_length: 256`.
  - Punctuation can land only after a subword. The card: "Predicting after every token allows for all other punctuation, including punctuation within continuous-script" languages.
- **ONNX interface:**
  - One input (`input_ids`) and four outputs.
  - The tokenizer is a patched SentencePiece `sp.model`, not a `tokenizer.json`.
  - Consequence: a browser port means raw onnxruntime-web, a JS SentencePiece, and a port of the card's decode loop. Our reading: the transformers.js pipeline cannot load it.
- **Accuracy.** Test set: News Crawl, 11 sentences joined, lowercased, punctuation stripped, 3,000 examples per language. Casing and sentence-boundary scores use the reference punctuation. Figures are P/R/F1 %:
  - en: `.` 90.97/93.91/92.42; UPPER 96.33/93.52/94.91
  - zh: `？` 81.85/87.31/84.49; `，` 74.08/93.67/82.73; `。` 96.51/96.93/96.72; FULLSTOP 99.55/99.90/99.72
  - ja: `？` 70.55/73.56/72.02; `。` 94.38/96.95/95.65; `、` 54.28/87.62/67.03; `・` 28.18/71.64/40.45; FULLSTOP 99.07/99.87/99.47
  - The card's metric sections cover English, Spanish, Amharic, Chinese, Japanese, Hindi and Arabic only. **Korean has no reported figures.**
- **Card caveats:** "This model is unlikely to be of production quality"; trained on news; over-predicts commas and `¿` [23].
- **Used in production:** kotoba-whisper-v2.2's Japanese pipeline calls it through `punctuators`, and skips any text that already contains `! ? 、 。` [25].
- **Ports:**
  - `Tiggang/xlm-roberta-punct-fullstop-truecase-onnx-fp16`: 556,483,843 B, Apache-2.0 [26].
  - `cstr/pcs-xlmr-base-GGUF` (§4.8). Its card says MIT and lists languages that differ from upstream; upstream is Apache-2.0.

**`punctuators` package** [27]
- Apache-2.0; last release v0.0.7 (2024-06-08). Runs on onnxruntime.
- `infer(texts, apply_sbd=True, overlap=16)` cuts input into windows of `max_len−2` tokens that overlap by `overlap`. On merge, each side drops `overlap//2` [28]. This is the reference sliding-window scheme for long text.

**1-800-BAD-CODE `punctuation_fullstop_truecase_english`** [29]
- `punct_cap_seg_en.onnx` 209,532,928 B (6 layers, d=512, 32k SentencePiece). Apache-2.0.
- F1: `.` 91.80, `,` 78.15, `?` 75.56, UPPER 93.76, full stop 92.49.
- A smaller English-only option.

**1-800-BAD-CODE `sentence_boundary_detection_multilang`** [30]
- 36,168,941 B, 49 languages.
- Its card says input "should be **punctuated**", so it does not apply here.

**kredor/punctuate-all** [31]
- 12 European languages, no CJK, no casing.
- `XLMRobertaForTokenClassification` on XLM-R base. MIT.
- Pooled F1: `.` 0.95, `,` 0.86, `?` 0.86, macro 0.77.
- `onnx-community/punctuate-all-ONNX` [32]: `model_int8.onnx` 278,658,098 B, `model_fp16.onnx` 555,239,208 B. It loads in the transformers.js token-classification pipeline (`registry.js:244` maps `xlm-roberta` → `XLMRobertaForTokenClassification`) [33].
- It is the best size reference for an int8 XLM-R-base encoder.

**oliverguhr/fullstop-punctuation-multilang-large** [34]
- en/de/fr/it; XLM-R large; MIT; safetensors 2,235,440,664 B. English macro F1 0.775.
- The companion `deepmultilingualpunctuation` package splits words on whitespace, so it cannot process zh/ja [35].
- **Excluded for CJK.**

**SaT, "Segment any Text" (wtpsplit)** [36] [37]
- **What it does:** predicts sentence boundaries only, as a newline probability per subword. **It inserts no punctuation and no casing.** MIT; 85 languages including ja/ko/zh.
- **Runtime:** the model type is `xlm-token`, which is absent from the transformers.js registry [33], so the browser needs raw ORT-web.
- **Sizes** (`model_optimized.onnx`, fp16 export) [38]:
  - sat-1l 399,384,010 B
  - sat-3l 427,946,487 B
  - sat-3l-sm 427,756,189 B
  - sat-12l-sm 556,287,754 B
  - `ModelCloud/sat-3l-sm-int8-onnx`: 214,691,162 B, with no license metadata [38]
- **Lookahead:**
  - `sat-3l` config has `lookahead: 48`; `sat-3l-sm` has `lookahead: null` [38].
  - The paper splits the lookahead N evenly across layers, "a_ij=0 for j>i+N_L, where N_L=N/L" [37].
  - `split()` defaults to `stride=64`, `block_size=512` [36].
- **Robustness to missing punctuation:**
  - Training: "We randomly remove all casing and punctuation in 10% of samples within a batch".
  - SEPP-NLG TED transcripts with no casing or punctuation, F1: SaT average 74.8; SaT+SM 79.8 (en 79.7). The paper says SaT+SM beats the shared-task winners.
  - Short unpunctuated **sentence pairs**, "proportion of perfectly segmented short sequences": SaT+SM 41.7 vs Llama 3 8B 66.9 [37].
  - I found no per-language unpunctuated ja/zh/ko figures.
- **LoRA adapters:** `loras/ted2020-corrupted/<lang>` exists for 76 languages, including ja/ko/zh/en, in `sat-3l` [38]. ONNX use needs a merged re-export.
- **JS/browser port:** none found.
- **Role for Sokuji:** it could cut unpunctuated run-ons (1a, 1c), but the translator would still receive unpunctuated sentences. PCS-47 has its own sentence-boundary head *and* restores punctuation.

**Other 2025–2026 items**
- **Cadence** (ai4bharat): `google/gemma-3-1b-pt` made bidirectional as a token classifier; gated; MIT metadata. English plus 22 Indic languages, no CJK [39] [40].
- **No ModernBERT/mmBERT punctuator** and no usable small instruction LLM fine-tuned for punctuation turned up in Hub searches.

### 4.2 sherpa-onnx punctuation (k2-fsa)

- **Offline CT-Transformer (zh+en)** [41]:
  - Converted from FunASR `iic/punc_ct-transformer_zh-cn-common-vocab272727-pytorch`.
  - Release tarballs: fp32 279,028,058 B, int8 64,717,756 B [42]. The docs list `model.int8.onnx` at 72 MB.
  - Labels `_ ， 。 ？ 、`, full-width even for English. No casing (tokens go through `ToLowerCase`).
  - Windowing: 20-token segments carry text after the last `。`/`？` forward. A run of 200 tokens with no end mark forces a comma to `。` (`offline-punctuation-ct-transformer-impl.h:46`, `:57-58`, `:124`) [43].
- **Online punct, English** (`sherpa-onnx-online-punct-en-2024-08-06`):
  - From frankyoujian/Edge-Punct-Casing, Apache-2.0 [44].
  - Tarball 30,667,839 B [42]; the docs list `model.int8.onnx` at 7.1 MB [41].
  - Architecture: CNN, then BiLSTM, then LSTM decoder; BPE vocab 5000.
  - Truecasing: yes (O/UPP/CAP; MIX is still a TODO at `online-punctuation-cnn-bilstm-impl.h:225`). Punctuation is `, . ?` only [45].
  - "Online" means built for on-device streaming ASR. It is a BiLSTM run statelessly on ≤200-token chunks (`kMaxSeqLen = 200`, `:30`), not an incremental decoder.
  - IWSLT2011: punctuation F1 71.0, casing F1 87.8. ONNX quantized 7 MB at 10 ms per paragraph, vs CT-Transformer 280 MB at 25 ms, on an i5-1035G1 [46].
- **API and WASM:**
  - `OfflinePunctuation`/`OnlinePunctuation` exist in every sherpa binding.
  - `wasm/wasm-common.cmake:109-117` exports all eight punctuation C functions [47].
  - The per-app `wasm/vad-asr` build, the kind Sokuji bundles, exports none. Our bundled WASM likewise has zero `Punct` symbols (§1d).
  - Browser use means a new sherpa WASM build, or a separate one, that links punctuation.
- **License:** sherpa-onnx code is Apache-2.0. The CT weights follow the FunASR cards (below).

### 4.3 FunASR CT-Transformer (ModelScope)

- **Three checkpoints** (sizes from the ModelScope file API):
  - `punc_ct-transformer_zh-cn-common-vocab272727`: `model.pt` 291,979,892 B [48]
  - `…-vad_realtime-vocab272727`: 288,802,610 B [49]
  - `…cn-en-common-vocab471067-large`: 1,125,507,622 B; its card says it currently runs only on Linux-x86_64 [50]
  - The ModelScope `model_quant.onnx` files are near fp32 size (282,752,912 B and 281,877,652 B). Sherpa's int8 is the small one.
- **Weight:** the 272,727×256 character embedding dominates the parameter count (config: 4 blocks, dim 256).
- **Labels:** `_ ， 。 ？ 、`. No casing.
- **Realtime variant** (`CT_Transformer_VadRealtime` in `funasr_onnx/punc_bin.py`) [51]:
  - Runs once per VAD segment.
  - A `cache` holds the words after the last `。`/`？`, and a `vad_mask` keeps cached positions from attending forward.
  - The last mark of each output is held back.
  - This is the only incremental, cache-based punctuation design found among the open models.
- **Accuracy.** The card's self-collected set gives F1 56.5 (common), 55.6 (realtime) and 58.8 (large). The paper gives IWSLT2011 F1 74.9 [52]. FireRedPunc's authors measure FunASR-Punc at zh 75.62 / en 49.91 F1 [53].
- **License:**
  - Card metadata says Apache-2.0.
  - The FunASR README says cards that link `MODEL_LICENSE` use those terms. `MODEL_LICENSE` v1.1 allows use and modification with attribution and has no commercial ban, but adds a termination clause [54].
  - Needs a legal read before shipping.

### 4.4 FireRedPunc (Xiaohongshu FireRedTeam, 2026-02)

- **Architecture:**
  - BERT token classifier initialised from `chinese-lert-base`.
  - Trained on "approximately 18.57B Chinese characters and 2.20B English words" [55].
  - `model.pth.tar` is 406,788,602 B. Apache-2.0 [53].
- **Labels:**
  - `out_dict` is `<space> ， 。 ？ ！`, full-width only [53].
  - The upstream Python applies a regex post-fix for English: `，`/`。` between Latin letters become `, `/`. `, and the first letter after `.!?。？！` is upper-cased (`fireredasr2s/fireredpunc/punc.py:98-104`, `:351-380`) [56].
  - So English gets sentence-initial capitals only, not truecasing. A port that skips the post-fix emits `，` inside English: CrispASR's own example card shows exactly that [57].
- **Accuracy** (P/R/F1 %):

  | Model | Multi-domain Chinese (88,644 sentences) | Multi-domain English (28,641 sentences) |
  |---|---|---|
  | FireRedPunc | 82.84 / 83.08 / 82.96 | 78.40 / 71.57 / 74.83 |
  | FunASR-Punc | 77.27 / 74.03 / 75.62 | 55.79 / 45.15 / 49.91 |

  Average F1 78.90 vs 62.77 [53].
- **Long input:** `sentence_max_length` (default −1, off) splits at the highest non-space probability once the budget is reached (`punc.py:132-180`).
- **Streaming:** offline and bidirectional [55].
- **Derivatives:**
  - `42ailab/FireRedPunc-ONNX`: `punc.int8.onnx` 102,189,962 B plus `tokenizer.json` 268,961 B. Apache-2.0, created 2026-07-26, 0 downloads. The packager claims int8 output "character-for-character identical" to PyTorch on its samples [58].
  - `cstr/fireredpunc-GGUF`: Q8_0 108,664,800 B; Q4_K 57,886,944 B, which the card says "occasionally drops commas" [57].
  - `OpenASR/firered-punc`: `.oasr` fp16 203,631,008 B. Calls itself "Chinese-only by construction" [59].
- **Coverage:** no Japanese or Korean support is claimed.

### 4.5 NVIDIA NeMo / Riva punctuation and capitalization

- **NeMo `punctuation_en_bert` / `_distilbert`** (NGC only) [60]:
  - BERT or DistilBERT with a punctuation head (`, . ?`) and a capitalization head.
  - Internal macro F1 77%. NGC Terms of Use. Last version 2023-04-04.
  - NeMo's inference windows overlap: `max_seq_length` 64, `step` 8, `margin` 16 [61].
- **Riva `punctuationcapitalization_{ja_jp,zh_cn,ko_kr}_bert_base`** [62]:
  - The only ja/ko PnC models from a major vendor.
  - mBERT-base; marks `, . ?`.
  - Internal macro F1: ja 66%, zh 76%, ko 88%.
  - The card says it "needs to be used with NVIDIA Hardware and Software" and is encrypted with key `tlt_encode`, under the NVIDIA AI Enterprise EULA.
  - Not usable in Sokuji.
- No standalone 2024–2026 NVIDIA PnC model found. NVIDIA moved PnC into the ASR models (§2).

### 4.6 Silero Text Enhancement

- en/de/ru/es only; punctuation plus casing.
- `v2_4lang_q.pt` is 91,713,171 B, `torch.package`, no ONNX [63].
- License: the LICENSE file is "Attribution-NonCommercial-ShareAlike 4.0 International", and the README says models are "CC-NC-BY" [63].
- **Excluded:** non-commercial, and no CJK.

### 4.7 Japanese, Korean and Chinese specialists

- **`bobfromjapan/bert_japanese_punctuation`** [64]:
  - Char-level `tohoku-nlp/bert-base-japanese-char-v3` (vocab 7,027).
  - Predicts only `、`/`。`, no `？`.
  - Trained on one novel's transcript (`train.txt` 828,786 B).
  - 365,846,615 B, Apache-2.0, no accuracy figures.
- **`ishiki-emo/mojicast-punct-onnx`** [65]:
  - ONNX of the model above: fp32 363,501,157 B, int8 109,150,947 B (per-channel MatMul). Apache-2.0, updated 2026-08-20.
  - On 948 real stream lines (Windows 11, 4 threads): about 11 ms per line for fp32, about 5 ms for int8.
  - int8 agrees with fp32 on 89.5% of lines, mostly by dropping a final `。`. Per-tensor quantization falls to 50.3%.
  - Evidence that a Japanese punctuator is small and fast enough, but it is a weakly trained model.
- **`oboroge0/hayamimi-punct-ja-fp16`** [66]:
  - fp16 181,803,211 B; 500-character cap; `？` added by rule.
  - Reports that the int8 build "non-functional on onnxruntime CPU EP", which contradicts Mojicast. Unresolved.
- **`whooray/koen_punctuation`** [67]:
  - ko+en; base `Alibaba-NLP/gte-multilingual-mlm-base` (305M params, 1,221,503,956 B); Apache-2.0.
  - Undisclosed eval set: macro F1 0.8256. 28 downloads.
- **`p208p2002/zh-wiki-punctuation-restore`** [68]:
  - bert-base-chinese, 406,757,252 B, six marks. 37,990 downloads.
  - **No license** on the card or the repo, so not shippable.

### 4.8 The native (ggml) route

**Upstream llama.cpp cannot run a token-classification head today.**
- `conversion/bert.py` on master (`093a2f86`, 2026-09-14) registers `*Model`, `*ForMaskedLM` and `*ForSequenceClassification` for BERT, DistilBERT, RoBERTa, XLM-R, NeoBERT and ModernBERT, but no `*ForTokenClassification` [69].
- The pooling types in `include/llama.h` are `NONE/MEAN/CLS/LAST/RANK`. `RANK` is "used by reranking models to attach the classification head" [70].
- PR #19725 "llama: add BertForTokenClassification support" (BERT and ModernBERT, not XLM-R) has been open and unmerged since 2026-02-19, last updated 2026-02-26 [71].
- On top of that, Sokuji's native ABI exposes only `sk_translate_load/chat/complete` for llama.cpp (`native/include/sokuji_native.h:251-267`).

**CrispASR already has a ggml implementation** [72]:
- MIT, pushed 2026-09-13.
- `crisp_punc/` provides a C API: `fireredpunc_init/process/free` and `pcs_init/process/free`.
- `pcs.cpp` runs 1-800-BAD-CODE's XLM-R punctuation + truecase + sentence-boundary model, with four heads.
- The graph ops used by `pcs.cpp` and `fireredpunc.cpp` (`mul_mat`, `get_rows`, `norm`, `gelu_erf`, `flash_attn_ext`, `soft_max_ext`, `permute`, `cont`, `view_2d`, `relu`) all exist in the ggml v0.22.0 header Sokuji pins (`34dc0e55`) [73].

Vendoring costs:
- CrispASR builds against its own ggml fork submodule (`CrispStrobe/ggml`, `.gitmodules`), so parity on pristine ggml is untested.
- Both files include CrispASR-internal `core/*` helpers (`gguf_loader`, `bert_pretok`, `punct_marks`, `gpu_backend_pref`, `ggml_cpu_backend`).
- `pcs.cpp:884-890` chunks at `max_pos − 2` tokens with **no overlap**.
- Tokenizer fidelity is a real risk. `cstr/punctuate-all-GGUF` was rebuilt on 2026-08-25 because the first conversion lacked Unigram scores: the GGUF runtime fell back to greedy tokenization, which matched HF on "0 of 7 segments" (6 of 7 after the fix) [74].

CrispASR's streaming policy (`examples/cli/crispasr_stream_punc.h`):
- Modes `off` / `final` / `partial`, default `final`.
- The header calls `final` "recommended for realtime use because it keeps the high-frequency partial path cheap".

GGUFs on the Hub:
- `cstr/pcs-xlmr-base-GGUF`: Q4_K 163,098,688 B / Q8_0 301,964,352 B / F16 947,134,528 B [75]. Its card says MIT "same as upstream"; see §4.1 for the upstream license.
- `cstr/punctuate-all-GGUF`: Q4_K 162,082,560 B.
- `cstr/fullstop-punc-multilang-GGUF`: Q4_K 321,063,584 B.

### 4.9 The LLM route

Sokuji already loads Qwen3/Qwen3.5/HY-MT/TranslateGemma translators, natively via llama.cpp (`catalog.py` `TRANSLATE_MODELS`) and in the browser (`modelManifest.ts:3170-3304`).

There are three ways to use them, in increasing cost:
1. **Change nothing but the prompt.** Tell the translator its input is an unpunctuated transcript that may hold several sentences, and ask it to emit punctuated target text. This fixes 1b and 1c with zero new models, but not 1a (endpointing). No source measures small-LLM translation quality on unpunctuated input; this needs our own benchmark.
2. **A separate punctuation pass with the same LLM.** It costs a second prefill plus a decode about as long as the input. An autoregressive rewrite can also change words, which is a hallucination risk.
   - [76] fine-tunes LLaMA for punctuation and adds Forward Pass Only Decoding, "a substantial 19.8x improvement in inference speed" with no hallucinations. It requires a fine-tuned model, not an off-the-shelf instruct model.
3. **LLM scoring with bounded lookahead** [77]:
   - Llama-3.2-1B compares "insert mark" hypotheses against "no insertion" at each word boundary, with a K-subword lookahead. K=2 gives macro F1 0.893 without fine-tuning and 0.937 with it, on IWSLT 2017 English.
   - The authors say it "does not yet include noisy ASR transcripts" and leave latency to future work.
   - It is an attractive streaming design (K=2 tokens of delay), but unproven on CJK and on ASR text.

- **Cadence** [40] shows an LLM-adapted punctuator beating prior state of the art, but for 22 Indian languages plus English. Not relevant to ja/zh/ko.
- **No small instruction model trained specifically for CJK punctuation restoration was found.**

---

## 5. Is `Intl.Segmenter` useful on unpunctuated text? (C)

No. Punctuation is its only sentence signal.

- **UAX #29 default rules.** Unicode 17.0.0, revision 47, 2025-08-17 [78]. A sentence break happens only after a paragraph separator (SB4) or after `STerm`/`ATerm` plus optional `Close`/`Sp` (SB9–SB11). Rule SB998 is "Otherwise, do not break." The annex itself warns: "Plain text provides inadequate information for determining good sentence boundaries." It allows implementations to tailor.
- **Character data** (`SentenceBreakProperty-17.0.0.txt` [79]):
  - `。` U+3002, `！` U+FF01, `？` U+FF1F and `｡` U+FF61 are `STerm`.
  - `.` and `．` U+FF0E are `ATerm`.
  - `、` U+3001 and `，` U+FF0C are `SContinue` and never break.
- **ECMA-402** [80]: "Boundary determination is implementation-dependent, but general default algorithms are specified in Unicode Standard Annex #29. It is recommended that implementations use locale-sensitive tailorings such as those provided by the Common Locale Data Repository."
- **Local check.** Node v22.23.1, ICU 78.2, Unicode 17.0, scratch script:
  - Unpunctuated en, ja, zh and ko utterances each came back as **one** segment.
  - The same en and ja text with punctuation came back as three.
  - `"the version is 3.5 and dr smith agreed"` stayed one segment.

For Sokuji:
- `splitSentences` is fine as long as its input carries punctuation. It cannot invent boundaries.
- A punctuation restorer (or a translator that emits punctuation) must run **before** it.
- It remains the right tool *after* restoration, because it handles abbreviations and decimals.

---

## 6. Integration options and streaming strategy (D)

### 6.1 Where a punctuator sits

```
ASR partial ──────────────────────────────► user bubble (as today)
ASR final (VAD end / accumulator end)
   └─► gate: does this card punctuate this source language? ── yes ─► translate
                                                             └ no ─► punctuate ─► translate
translated text ─► splitSentences(target) ─► per-sentence TTS (as today)
```

- **Put it on finals, in the renderer clients, just before translation.**
  - Local Inference: before `translationEngine.translate(job.text, …)` at `LocalInferenceClient.ts:564`.
  - Local Native: before `translate.translate(text, …)` at `LocalNativeClient.ts:470`.
  - This is one code path for both targets, and it never touches the ggml-only sidecar.
  - The user bubble should show the punctuated source too.
- **Not on partials by default.** Partials change on every chunk, so a pass on each would multiply the cost for text that will be revised anyway. CrispASR ships `final` as its default for real-time use for this reason [72].
- **Gate on the ASR, not only on the text.**
  - CrispASR auto-enables punctuation only when the backend has neither a native punctuation capability nor a toggle (`crispasr_punctuation_policy.h`) [72].
  - kotoba-whisper skips text that already contains `! ? 、 。` [25].
  - A card-level flag avoids double punctuation. A text check catches models that punctuate only sometimes (Whisper, Moonshine).
- **TTS needs no change.** Once the translator emits punctuation, `splitSentences` splits it. If the translator still returns a run-on, `splitSentences` returns one segment, which is today's behaviour, so there is no regression.

### 6.2 Streaming: cutting run-ons early (problem 1a), as an optional second step

None of the streaming cards we recommend needs this per §2. It matters for unpunctuated streaming models (Moonshine streaming, the sherpa zipformers, if they turn out not to punctuate), or to cut long monologues before the 1.4 s VAD silence or the 20 s cap.

- **Tick.** Every N new ASR tokens (or about 500 ms), run the punctuator over the last ≤254 tokens of pending text: PCS `max_length` is 256 including BOS/EOS, and `punctuators` overlaps windows by 16 [28].
- **Commit rule.** Commit a sentence only when a predicted boundary has at least R tokens of right context after it, and always hold back the last predicted mark. Prior art for this rule:
  - FunASR's realtime punctuator strips the last mark and carries the tail in `cache` to the next segment [51].
  - transcribe.cpp shows that low lookahead loses trailing punctuation first [22].
  - SaT limits lookahead to N=48 [37].
  - The 2026 LLM-scoring method decides with K=2 subword tokens of lookahead [77].
- **At the VAD end,** run once more over the uncommitted tail. The end of the utterance is itself a boundary, so no right context is needed.
- **Local Native caveat.** An early cut would also have to reach the sidecar, which today moves only on VAD marks (`asr_engine.py:33`). So prototype this in the browser path first.
- **R and the probability threshold** are benchmark variables (§7).

### 6.3 Latency and memory estimate

Evidence from the sources:
- int8 char-BERT-base Japanese punctuator: about 5 ms per line (fp32 about 11 ms) on native onnxruntime CPU with 4 threads [65].
- ONNX CNN-BiLSTM: 10 ms per paragraph; CT-Transformer: 25 ms, on an i5-1035G1 [46].
- XLM-R base has the same 12-layer, 768-dim encoder compute per token as BERT-base. Its 250k vocabulary enlarges the embedding table (download and memory), not compute per token.

Estimate, not measured:
- A finals-only pass over ≤256 tokens should cost tens of milliseconds on a native CPU. onnxruntime-web on WASM is slower by a factor we have not measured.
- Against the 1.4 s VAD redemption plus LLM translation time, one pass per final is small.
- The sliding-window variant in §6.2 multiplies the cost by the tick rate.
- Memory for an int8 XLM-R base should be about 280 MB in a worker (§4.1 size reference).
- Our own judgment: prefer the WASM EP, so the punctuator does not compete for the GPU with the WebGPU ASR and translation models.

### 6.4 Per-target summary

| Target | Do now | If a model is needed | Avoid |
|---|---|---|---|
| Browser (Local Inference) | Translation prompt that expects unpunctuated input; Granite prompt asks for punctuation; benchmark | PCS-47 int8 via raw onnxruntime-web (WASM EP) on finals, gated per card; FireRedPunc int8 ONNX for zh | transformers.js pipeline for PCS or SaT (unsupported graphs); relying on `Intl.Segmenter`; a separate LLM punctuation pass |
| Native (Local Native) | Set transcribe.cpp `pnc`/`itn` per card; check the Nemotron language tag | Reuse the renderer punctuator; only if needed, vendor CrispASR `crisp_punc` + GGUF Q8_0 behind `sk_punc_*` | Upstream llama.cpp (no token classification); ONNX in the sidecar (removed on purpose) |

---

## 7. Open questions: what to benchmark locally

1. **Punctuation rate per card and language.** On a ja/zh/en/ko clip set, how often does each recommended card end a final with a terminator: Qwen3-ASR, Voxtral Realtime, Whisper, Fun-ASR with ITN off vs on, Nemotron 3.5 on ja/zh/ko, Moonshine ja/zh/ko, the sherpa zipformers? This decides whether any model is needed.
2. **transcribe.cpp switches.** Does setting `itn`/`pnc` fix Fun-ASR and Granite natively? Does Nemotron 3.5 in auto mode leak `<xx-XX>` into the text, breaking the `$`-anchored end check?
3. **Translation robustness.**
   - Models: Qwen3 0.6B/1.7B, Qwen3.5 0.8B/2B, HY-MT, TranslateGemma.
   - Inputs: punctuated vs punctuation-stripped source, each with today's prompt and with a prompt that warns about missing punctuation.
   - Measures: COMET or an LLM judge, and whether the output itself carries punctuation (which TTS needs).
   - If the prompt closes the gap, stop here.
4. **PCS-47 on ASR-style ja/zh/ko.** The card is news-trained and has no Korean figures. Also measure over-predicted `、`; how far our own int8 export agrees with fp32 (Mojicast saw 89.5% with per-channel and 50.3% with per-tensor quantization [65]); and onnxruntime-web WASM/WebGPU latency and memory for 64/128/256 tokens.
5. **FireRedPunc int8 ONNX in onnxruntime-web.** Parity with PyTorch, and a port of the upstream English regex post-fix.
6. **The streaming commit rule (§6.2).** Over R and the probability threshold: premature-cut rate vs latency saved against the 1.4 s VAD.
7. **Native only.**
   - Parity of `pcs.cpp` on pristine ggml 0.22 vs the ONNX reference.
   - Does `cstr/pcs-xlmr-base-GGUF` carry Unigram scores? `cstr/punctuate-all-GGUF` did not until 2026-08-25.
   - Vulkan/Metal coverage for its ops.
   - Shape of the `sk_punc_*` ABI and the op-coverage recording it would need.
8. **SaT fp16 ONNX.** Does it run in onnxruntime-web at all? Is it worth it once punctuation exists?
9. **Legal.** FunASR `MODEL_LICENSE` terms. Provenance of third-party conversions (42ailab FireRedPunc ONNX, cstr GGUFs), whose metadata disagrees with upstream.

Could not verify:
- punctuation for Moonshine, Breeze, Voxtral 3B/24B, granite-4.0-1b and 4.1-nar, the sherpa zipformers and Kroko;
- Qwen3-ASR and Voxtral Realtime punctuation from their upstream sources;
- NeMo/Riva artifact sizes (NGC needs auth);
- onnxruntime-web op compatibility of the CT-Transformer (SANM) and SaT fp16 exports;
- whether the int8 Japanese punctuator works on the onnxruntime CPU EP (two community cards contradict each other);
- the base size of PCS-47 (inferred from its file size).

---

## 8. Sources

1. NVIDIA, nemotron-3.5-asr-streaming-0.6b model card — https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b
2. NVIDIA, nemotron-speech-streaming-en-0.6b model card — https://huggingface.co/nvidia/nemotron-speech-streaming-en-0.6b
3. handy-computer, multitalker-parakeet-streaming-0.6b-v1-gguf card — https://huggingface.co/handy-computer/multitalker-parakeet-streaming-0.6b-v1-gguf
4. Moonshine AI, moonshine-streaming-medium card; Moonshine v2 paper arXiv:2602.12241 — https://huggingface.co/moonshine-ai/moonshine-streaming-medium , https://arxiv.org/abs/2602.12241
5. Mistral, Voxtral-Mini-4B-Realtime-2602 card; arXiv:2602.11298; Sokuji docs/superpowers/plans/2026-06-25-voxtral-always-stream.md:13 — https://huggingface.co/mistralai/Voxtral-Mini-4B-Realtime-2602 , https://arxiv.org/abs/2602.11298
6. NVIDIA, parakeet-unified-en-0.6b card — https://huggingface.co/nvidia/parakeet-unified-en-0.6b
7. handy-computer, cohere-transcribe-03-2026-gguf card (owner card gated); transformers.js 4.2.0 src/models/cohere_asr/processing_cohere_asr.js — https://huggingface.co/handy-computer/cohere-transcribe-03-2026-gguf
8. Qwen, Qwen3-ASR card and arXiv:2601.21337 (both silent on punctuation); Sokuji-owned jiangzhuo9357/Qwen3-ASR-0.6B-ONNX card — https://huggingface.co/Qwen/Qwen3-ASR-1.7B , https://arxiv.org/abs/2601.21337 , https://huggingface.co/jiangzhuo9357/Qwen3-ASR-0.6B-ONNX
9. transcribe.cpp, docs/porting/families/funasr_nano.md — https://github.com/handy-computer/transcribe.cpp/blob/main/docs/porting/families/funasr_nano.md
10. transcribe.cpp, docs/models/sensevoice-small.md — https://github.com/handy-computer/transcribe.cpp/blob/main/docs/models/sensevoice-small.md
11. FunAudioLLM, SenseVoiceSmall card (use_itn) — https://huggingface.co/FunAudioLLM/SenseVoiceSmall
12. Radford et al., Robust Speech Recognition via Large-Scale Weak Supervision (Whisper), arXiv:2212.04356, section 2.1 — https://arxiv.org/abs/2212.04356
13. IBM, granite-speech-4.1-2b card; granite-speech-4.1-2b-nar card; transcribe.cpp docs/models/granite-speech.md — https://huggingface.co/ibm-granite/granite-speech-4.1-2b , https://huggingface.co/ibm-granite/granite-speech-4.1-2b-nar , https://github.com/handy-computer/transcribe.cpp/blob/main/docs/models/granite-speech.md
14. IBM, granite-speech-4.1-2b-plus card — https://huggingface.co/ibm-granite/granite-speech-4.1-2b-plus
15. Moonshine paper arXiv:2410.15608; transcribe.cpp docs/porting/families/moonshine.md — https://arxiv.org/abs/2410.15608 , https://github.com/handy-computer/transcribe.cpp/blob/main/docs/porting/families/moonshine.md
16. MediaTek Research, Breeze-ASR-25 card — https://huggingface.co/MediaTek-Research/Breeze-ASR-25
17. NVIDIA, canary-1b-v2 card; transcribe.cpp docs/porting/families/canary.md — https://huggingface.co/nvidia/canary-1b-v2 , https://github.com/handy-computer/transcribe.cpp/blob/main/docs/porting/families/canary.md
18. NVIDIA, parakeet-tdt-0.6b-v3, parakeet-tdt-0.6b-v2 and canary-qwen-2.5b cards — https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3 , https://huggingface.co/nvidia/parakeet-tdt-0.6b-v2 , https://huggingface.co/nvidia/canary-qwen-2.5b
19. NVIDIA, parakeet-ctc-0.6b card — https://huggingface.co/nvidia/parakeet-ctc-0.6b
20. transcribe.cpp, docs/porting/families/moss.md — https://github.com/handy-computer/transcribe.cpp/blob/main/docs/porting/families/moss.md
21. Banafo, Kroko-ASR card; NVIDIA NGC stt_en_fastconformer_hybrid_large_streaming_80ms — https://huggingface.co/Banafo/Kroko-ASR , https://catalog.ngc.nvidia.com/orgs/nvidia/nemo/models/stt_en_fastconformer_hybrid_large_streaming_80ms
22. transcribe.cpp, docs/porting/families/parakeet.md (streaming right-context table) — https://github.com/handy-computer/transcribe.cpp/blob/main/docs/porting/families/parakeet.md
23. 1-800-BAD-CODE/xlm-roberta_punctuation_fullstop_truecase (card, metrics, files) — https://huggingface.co/1-800-BAD-CODE/xlm-roberta_punctuation_fullstop_truecase
24. 1-800-BAD-CODE/xlm-roberta_punctuation_fullstop_truecase, config.yaml — https://huggingface.co/1-800-BAD-CODE/xlm-roberta_punctuation_fullstop_truecase/blob/main/config.yaml
25. kotoba-tech/kotoba-whisper-v2.2, pipeline/kotoba_whisper.py — https://huggingface.co/kotoba-tech/kotoba-whisper-v2.2/blob/main/pipeline/kotoba_whisper.py
26. Tiggang/xlm-roberta-punct-fullstop-truecase-onnx-fp16 — https://huggingface.co/Tiggang/xlm-roberta-punct-fullstop-truecase-onnx-fp16
27. 1-800-BAD-CODE/punctuators (GitHub; PyPI 0.0.7) — https://github.com/1-800-BAD-CODE/punctuators , https://pypi.org/project/punctuators/
28. punctuators, punctuators/data/infer_dataset.py and punctuators/collectors/pcs_collector.py — https://github.com/1-800-BAD-CODE/punctuators/blob/main/punctuators/data/infer_dataset.py , https://github.com/1-800-BAD-CODE/punctuators/blob/main/punctuators/collectors/pcs_collector.py
29. 1-800-BAD-CODE/punctuation_fullstop_truecase_english — https://huggingface.co/1-800-BAD-CODE/punctuation_fullstop_truecase_english
30. 1-800-BAD-CODE/sentence_boundary_detection_multilang — https://huggingface.co/1-800-BAD-CODE/sentence_boundary_detection_multilang
31. kredor/punctuate-all — https://huggingface.co/kredor/punctuate-all
32. onnx-community/punctuate-all-ONNX (files) — https://huggingface.co/onnx-community/punctuate-all-ONNX
33. transformers.js, packages/transformers/src/models/registry.js (token-classification mapping) — https://github.com/huggingface/transformers.js/blob/main/packages/transformers/src/models/registry.js
34. oliverguhr/fullstop-punctuation-multilang-large — https://huggingface.co/oliverguhr/fullstop-punctuation-multilang-large
35. oliverguhr/deepmultilingualpunctuation, punctuationmodel.py — https://github.com/oliverguhr/deepmultilingualpunctuation/blob/main/deepmultilingualpunctuation/punctuationmodel.py
36. segment-any-text/wtpsplit (README, wtpsplit/__init__.py) — https://github.com/segment-any-text/wtpsplit
37. Frohmann et al., Segment Any Text: A Universal Approach for Robust, Efficient and Adaptable Sentence Segmentation, arXiv:2406.16678 — https://arxiv.org/abs/2406.16678
38. segment-any-text/sat-1l, sat-3l, sat-3l-sm, sat-12l-sm (config.json, files, loras/); ModelCloud/sat-3l-sm-int8-onnx — https://huggingface.co/segment-any-text/sat-3l , https://huggingface.co/segment-any-text/sat-3l-sm , https://huggingface.co/ModelCloud/sat-3l-sm-int8-onnx
39. ai4bharat/Cadence (gated; base google/gemma-3-1b-pt) — https://huggingface.co/ai4bharat/Cadence
40. Pulipaka et al., Mark My Words: A Robust Multilingual Model for Punctuation in Text and Speech Transcripts (Cadence), arXiv:2506.03793 — https://arxiv.org/abs/2506.03793
41. k2-fsa, sherpa-onnx punctuation pretrained models — https://k2-fsa.github.io/sherpa/onnx/punctuation/pretrained_models.html
42. k2-fsa/sherpa-onnx GitHub release punctuation-models (asset sizes) — https://github.com/k2-fsa/sherpa-onnx/releases/tag/punctuation-models
43. sherpa-onnx, sherpa-onnx/csrc/offline-punctuation-ct-transformer-impl.h — https://github.com/k2-fsa/sherpa-onnx/blob/master/sherpa-onnx/csrc/offline-punctuation-ct-transformer-impl.h
44. frankyoujian/Edge-Punct-Casing (Apache-2.0) — https://github.com/frankyoujian/Edge-Punct-Casing
45. sherpa-onnx, sherpa-onnx/csrc/online-punctuation-cnn-bilstm-impl.h — https://github.com/k2-fsa/sherpa-onnx/blob/master/sherpa-onnx/csrc/online-punctuation-cnn-bilstm-impl.h
46. You and Li, A light-weight and efficient punctuation and word casing prediction model for on-device streaming ASR, arXiv:2407.13142 — https://arxiv.org/abs/2407.13142
47. sherpa-onnx, wasm/wasm-common.cmake and wasm/vad-asr/CMakeLists.txt — https://github.com/k2-fsa/sherpa-onnx/blob/master/wasm/wasm-common.cmake , https://github.com/k2-fsa/sherpa-onnx/blob/master/wasm/vad-asr/CMakeLists.txt
48. ModelScope, iic/punc_ct-transformer_zh-cn-common-vocab272727-pytorch (card, config, files) — https://modelscope.cn/models/iic/punc_ct-transformer_zh-cn-common-vocab272727-pytorch
49. ModelScope, iic/punc_ct-transformer_zh-cn-common-vad_realtime-vocab272727 — https://modelscope.cn/models/iic/punc_ct-transformer_zh-cn-common-vad_realtime-vocab272727
50. ModelScope, iic/punc_ct-transformer_cn-en-common-vocab471067-large — https://modelscope.cn/models/iic/punc_ct-transformer_cn-en-common-vocab471067-large
51. FunASR, runtime/python/onnxruntime/funasr_onnx/punc_bin.py (CT_Transformer_VadRealtime) — https://github.com/modelscope/FunASR/blob/main/runtime/python/onnxruntime/funasr_onnx/punc_bin.py
52. Chen et al., Controllable Time-Delay Transformer for Real-Time Punctuation Prediction and Disfluency Detection, arXiv:2003.01309 — https://arxiv.org/abs/2003.01309
53. FireRedTeam, FireRedPunc model card, benchmark table and out_dict — https://huggingface.co/FireRedTeam/FireRedPunc
54. FunASR, MODEL_LICENSE — https://github.com/modelscope/FunASR/blob/main/MODEL_LICENSE
55. Xu et al., FireRedASR2S technical report, arXiv:2603.10420 (v1 2026-03-11) — https://arxiv.org/abs/2603.10420
56. FireRedASR2S, fireredasr2s/fireredpunc/punc.py — https://github.com/FireRedTeam/FireRedASR2S/blob/main/fireredasr2s/fireredpunc/punc.py
57. cstr/fireredpunc-GGUF (files, card) — https://huggingface.co/cstr/fireredpunc-GGUF
58. 42ailab/FireRedPunc-ONNX (files, card) — https://huggingface.co/42ailab/FireRedPunc-ONNX
59. OpenASR/firered-punc (card) — https://huggingface.co/OpenASR/firered-punc
60. NVIDIA NGC, nemo/punctuation_en_bert and punctuation_en_distilbert (model API) — https://api.ngc.nvidia.com/v2/models/nvidia/nemo/punctuation_en_bert
61. NVIDIA NeMo docs, Punctuation and Capitalization model (inference windowing) — https://docs.nvidia.com/nemo-framework/user-guide/24.09/nemotoolkit/nlp/punctuation_and_capitalization.html
62. NVIDIA NGC, riva/punctuationcapitalization_{ja_jp,zh_cn,ko_kr}_bert_base (model API) — https://api.ngc.nvidia.com/v2/models/nvidia/riva/punctuationcapitalization_ja_jp_bert_base
63. snakers4/silero-models: LICENSE, README (Licence), models.yml te_models — https://github.com/snakers4/silero-models
64. bobfromjapan/bert_japanese_punctuation — https://huggingface.co/bobfromjapan/bert_japanese_punctuation
65. ishiki-emo/mojicast-punct-onnx (card with measurements) — https://huggingface.co/ishiki-emo/mojicast-punct-onnx
66. oboroge0/hayamimi-punct-ja-fp16 — https://huggingface.co/oboroge0/hayamimi-punct-ja-fp16
67. whooray/koen_punctuation — https://huggingface.co/whooray/koen_punctuation
68. p208p2002/zh-wiki-punctuation-restore; GitHub p208p2002/ZH-Punctuation-Restore — https://huggingface.co/p208p2002/zh-wiki-punctuation-restore , https://github.com/p208p2002/ZH-Punctuation-Restore
69. llama.cpp, conversion/bert.py (master @ 093a2f86, 2026-09-14) — https://github.com/ggml-org/llama.cpp/blob/master/conversion/bert.py
70. llama.cpp, include/llama.h (pooling types) — https://github.com/ggml-org/llama.cpp/blob/master/include/llama.h
71. llama.cpp PR #19725, llama: add BertForTokenClassification support (open) — https://github.com/ggml-org/llama.cpp/pull/19725
72. CrispStrobe/CrispASR (MIT): README, crisp_punc/, examples/cli/crispasr_stream_punc.h, crispasr_punctuation_policy.h, .gitmodules — https://github.com/CrispStrobe/CrispASR
73. ggml v0.22.0 include/ggml.h @ 34dc0e55 (Sokuji's pin) — https://github.com/ggml-org/ggml/blob/34dc0e5589504286cb40e13cbdae4bf2b5b4071b/include/ggml.h
74. cstr/punctuate-all-GGUF (files, card incl. 2026-08-25 tokenizer fix) — https://huggingface.co/cstr/punctuate-all-GGUF
75. cstr/pcs-xlmr-base-GGUF (files, card) — https://huggingface.co/cstr/pcs-xlmr-base-GGUF
76. Pang et al., LLaMA based Punctuation Restoration With Forward Pass Only Decoding, arXiv:2408.11845 — https://arxiv.org/abs/2408.11845
77. Woo, Kang and Kim, Efficient Punctuation Restoration via Weighted Lookahead Scoring Method for Streaming ASR Systems, arXiv:2606.05179 (v1 2026-04-18) — https://arxiv.org/abs/2606.05179
78. Unicode Standard Annex #29, Text Segmentation, rev. 47 (Unicode 17.0.0, 2025-08-17), Sentence Boundaries — https://www.unicode.org/reports/tr29/
79. Unicode Character Database, SentenceBreakProperty-17.0.0.txt — https://www.unicode.org/Public/UCD/latest/ucd/auxiliary/SentenceBreakProperty.txt
80. ECMA-402 source, spec/segmenter.html (tc39/ecma402 @ b1c96198, 2026-08-17), note on boundary determination — https://github.com/tc39/ecma402/blob/main/spec/segmenter.html

Sokuji code references are cited inline as `path:line` against worktree commit `fb384d84`. The `Intl.Segmenter` check was a local Node v22.23.1 (ICU 78.2, Unicode 17.0) run; its script is not kept.
