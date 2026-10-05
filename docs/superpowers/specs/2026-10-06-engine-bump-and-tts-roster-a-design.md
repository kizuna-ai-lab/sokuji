# Engine bump and TTS roster expansion (sub-project A) — design

Date: 2026-10-06. Owner: jiangzhuo. Status: approved in conversation section by section; this document records it for review.

## Goal

Every TTS family audio.cpp supports that fits Sokuji's rules becomes a Local Native card, on engines brought up to date. Success: each new family has a catalog card with its documented languages and the right licence gate, downloads and synthesises in the sidecar, carries the GPU tiers the fleet validated, and ships in one native and one sidecar release.

This is sub-project **A** of three, run in order A → B → C:

- **A (this document):** the four-engine bump and the families that need no new mechanism.
- **B:** eSpeak-ng (static build, data shipped in the bundle), then piper, inflect_v2, kitten_tts v1, sanotts, zipvoice and kokoro.
- **C:** a "voice description" input (voice design), then maya1, MOSS-VoiceGenerator, Qwen3-TTS VoiceDesign, Irodori 600M-VoiceDesign, FireRedTTS-3 Instruct and Breeze-TTS-2's design mode.

B and C get their own designs.

## Rulings (owner, 2026-10-06)

1. No language-coverage requirement: an English-only or Japanese-only family is welcome; tiny English-only families are welcome.
2. Families above 10 GB stay out: firered_audio, moss_tts_v15, moss_ttsd, dramabox.
3. Families that need a big change wait for B or C (eSpeak-ng, MeCab, voice design).
4. Third-party-hosted GGUFs are downloaded from their own repos, each pinned to a commit.
5. One branch, one native release and one sidecar release, staged internally (stages 1–5 below).
6. All four engines move together in stage 1: ggml v0.26.0, llama.cpp v0.6.0, transcribe.cpp v0.3.1, audio.cpp main.
7. The new cards are not "recommended" until measurements say otherwise.
8. A family that runs on no GPU lane loses its card (the 2026-09-03 rule); slowness is not a reason to drop one — device and quant are the planner's call.
9. A card's languages are those its vendor documents AND audio.cpp exposes (e.g. Chatterbox: the vendor lists 23, audio.cpp exposes 19 → 19).
10. Pocket TTS's extra preset voices stay out of A: R9 (audio.cpp's package spec is the authority) and 166 MB per language; adding them needs per-voice on-demand download, a new mechanism.
11. ASR architectures new in transcribe.cpp 0.3 are recorded, not carded, in A.
12. Non-commercial and conditional licences go behind the consent gate (standing rule); a licence is never by itself a reason to exclude a family.

Still out for reasons of their own: dots_tts (its vendor documents no language list), mira_tts (no official GGUF), sopro_tts (no GGUF), auk (CUDA-only), minimax_h3 / vevo2 / personaplex (not TTS), vieneu_v3_turbo (needs a SEA-G2P frontend; to be checked with B).

## Stage 1 — the four-engine bump

Pins (`native/cmake/upstreams.cmake`):

| upstream | version | commit |
|---|---|---|
| ggml | v0.26.0 | `d7cb574130e6f01ad25b3289685489200febcd74` |
| llama.cpp | v0.6.0 | `d81235049384534c167caea52b85a694f6103d14` |
| transcribe.cpp | v0.3.1 | `3f32fbcc7bb3246851a0234263438bc3c0fa1cac` |
| audio.cpp | main | the HEAD on the day stage 1 starts; `54aa279262bb2ce5702cb0bd343e4fc5872cc04d` (2026-10-05) at the time of writing |

audio.cpp's version string is `0.9.0+<7-char commit>` (based on 0.9.0, at that commit). Every literal the pins feed moves with them: `SOKUJI_AUDIOCPP_VERSION`/`SOKUJI_TRANSCRIBE_VERSION`/the llama version, the `sk_version()` and engine-version literals in `native/tests/test_common.cpp`, and the `ev[...]` assertions in `native/python/tests/test_sokuji_native.py`. Native moves to 1.3.0; the ABI stays 2.

Work, following `native/README.md` "Bumping a pin" and CLAUDE.md:

1. Re-check every exact-text patch: the four ggml patches (`ggml-gguf-bulk-array-read.json` may overlap upstream's faster model loading; `ggml-metal-pad-leading.json` may be obsolete now that upstream Metal supports left padding — a patch upstream made redundant is removed, not kept), `audio.cpp.json` and `transcribe.cpp.json`. A patch that no longer matches fails the build loudly.
2. Re-scan `src/audiocpp_compat.h` against ggml 0.26 and audio.cpp main.
3. Adapt `sk_asr` to transcribe.cpp 0.3's interface (its "generic prompting in interface" change, #178) and confirm the backend allowlist (#186) does not narrow which backends load.
4. Watch ggml 0.26's new rule that graph inputs are `GGML_OP_NONE`: each of the three engines must build and run; a failure is fixed at the engine's pin (a newer commit), not by patching ggml.
5. Re-record every `.ops` recording on GB10 Vulkan (the nine TTS families, and the ASR/translation recordings that exist), and rebuild the parity reference at the new audio.cpp pin (move the old `audiocpp-official*` trees aside first — a stale reference silently survives a pin bump).
6. OmniVoice's renamed request options: switch to the new names (`duration_sec`, `shift`, `audio_chunk_duration_sec`, `audio_chunk_threshold_sec`) so the old-name compatibility map can go away upstream without breaking us. OmniVoice and Qwen3-TTS now also honour a `language` option; A records that and changes nothing.
7. Note any ASR architecture transcribe.cpp 0.3 adds (ruling 11).

Done when, on this box's CPU and Vulkan lanes, CTest, the Python suite and the parity tests pass for every existing family. The five-SKU CI dry run follows in stage 4.

## Stage 2 — download and catalog plumbing

1. **Pinned third-party revisions.** One table in the sidecar maps each third-party repo to its commit; every download, status and delete call goes through one helper that adds `revision=`. Artifact strings and the wire stay as they are; the renderer is untouched. The official `audio-cpp/audio.cpp-gguf` repo stays unpinned, as today.
2. **Companion files.** A card's extra files may differ per quant (LFM2.5-Audio: backbone, mmproj, vocoder and tokenizer per quant) and may live in another folder of the same repo (MioTTS's codec). They are staged beside the main GGUF, as `extra_files` already are, so the engine finds them next to it; how each family locates its companions follows its audio.cpp package spec, read per family in stage 3.
3. **Voice requirement per card.** `TtsModel` carries its own `voice_required`, defaulting to the family's rule; Qwen3-TTS 1.7B CustomVoice sets it false. `tts_backend`'s family-level check reads the card. The wire already carries `voice.required` per model.
4. **Licence gate classes.** Non-commercial (Higgs Audio v3, Fish Audio S2 Pro, Breeze-TTS-2, OuteTTS, Echo-TTS, F5-TTS): `non_commercial=True, requires_consent=True`. Conditional or custom terms (NeuTTS, LFM2.5-Audio, KittenTTS 2, NVIDIA's Magpie licence): `non_commercial=False, requires_consent=True`, IndexTTS's wording. Apache-2.0 and MIT: no gate.
5. **Byte counts** are the exact Hub sizes from `benchmark/qwen3-asr-webgpu/hub_sizes.py`; a third-party file's size is read at its pinned commit.

## Stage 3 — the families, in five batches

New families (22; LFM2.5-Audio has two cards):

| batch | family | GGUF source | voice | licence class |
|---|---|---|---|---|
| 1 | CosyVoice3 | audio-cpp | reference clip | none |
| 1 | FireRedTTS-3 Base | audio-cpp | clip + transcript | none |
| 1 | MOSS-TTS-Local v1.5 | audio-cpp | optional | none |
| 1 | VibeVoice 1.5B | audio-cpp | reference clips | none |
| 1 | Chatterbox | audio-cpp | clip required | none |
| 1 | Chatterbox Turbo | audio-cpp | one built-in voice | none |
| 1 | Confucius4 (F32 only) | audio-cpp | clip | none |
| 2 | Magpie 357M | audio-cpp | 5 presets | conditional |
| 2 | NeuTTS-2E | audio-cpp | 9 presets | conditional |
| 2 | KugelAudio | audio-cpp | 4 presets | none |
| 3 | Higgs Audio v3 4B | audio-cpp | clip | non-commercial |
| 3 | Fish Audio S2 Pro | audio-cpp | optional | non-commercial |
| 3 | Breeze-TTS-2 (clone mode) | audio-cpp | clip + transcript | non-commercial |
| 4 | audio8_tts 0.6B | js-byte (pinned) | optional clip + exact transcript | none |
| 4 | Soprano 1.1 80M | WalkingCat (pinned) | none | none |
| 4 | GLM-TTS | mirek190 (pinned) | clip + exact transcript | none |
| 4 | OuteTTS 1.0 1B | mirek190 (pinned) | clip | non-commercial |
| 4 | Echo-TTS | dignome (pinned) | clone only | non-commercial |
| 4 | F5-TTS (Habibi unified) | trklou (pinned) | clip | non-commercial |
| 4 | KittenTTS 2 | dignome (pinned) | 48 presets, or clip + transcript | conditional |
| 5 | MioTTS 1.7B (+ MioCodec) | audio-cpp, two folders | clip | none |
| 5 | LFM2.5-Audio, English and Japanese | LiquidAI (pinned), four files per quant | presets | conditional |

New cards for families we already compile (batch 2 and 4):

| batch | card | note |
|---|---|---|
| 2 | Qwen3-TTS 1.7B CustomVoice | nine presets; `voice_required=False` (stage 2.3) |
| 2 | Irodori v3-500M, Irodori v4.1-Anime | Japanese, MIT |
| 4 | VoiceTut (OmniVoice Egyptian Arabic fine-tune) | third-party repo, pinned |

Per family, following CLAUDE.md's "A TTS family":

1. **Native.** Add it to `AUDIOCPP_MODELS` and give it a `kFamilies[]` row (streaming, clones, transcript_required, default rate, sample_decode, strict_options), read from audio.cpp's own source, not the model card. Add its env var and CPU/GPU rows in the Python tests and its export in `ops-env.sh`. The CPU synth case shows whether a bare synth works, whether a preset must be applied at load, and whether it rejects request options. A family that reads its language from request options (as irodori and index_tts2 do) may need a new `kFamilies` field; it is added in that batch with its test.
2. **Op recording** on GB10 Vulkan into `native/src/ops/tts-<family>.ops`, with its `CASES[]` row and the `test_common.cpp` counts and roster in the same commit.
3. **Sidecar card**, CPU tier only at first, with its `test_catalog`, `test_tts_backend` and `test_accel` cases.
4. **Renderer values:** a reference-clip ceiling in `MODEL_CLIP_LIMITS` for each card that clones; `TTS_ASSUMED_RTF` raised if a family is slower than index_tts2 on CPU.

audio8_tts needs `ggml_snake_1d` for its Metal path; it gets a shim in `audiocpp_compat.h` (batch 4).

`audiocpp_add_model`'s `DEPENDS` pulls more targets in on its own: miotts brings miocodec, qwen3_asr and qwen3_forced_aligner; chatterbox_turbo and kitten_tts2 bring chatterbox; glm_tts brings outetts (and its two qwen3 targets). These compile into the wheel whether or not they get a card.

A family that cannot synthesise on CPU, or cannot be recorded, for a reason that cannot be fixed, leaves A with its reason written down; the rest continue.

Test models live under `~/.cache/sokuji-native-tests/tts/<card-id>/` — about 88 GB at q8 for all of A. Disk space is checked before stage 3; if short, each batch's models are deleted after the batch.

## Stage 4 — CI and the fleet

1. Push the branch and dispatch `native-build.yml` (each asked first) for the five-SKU wheels.
2. With those wheels, run every new family, and a smoke of ASR and translation (the engines moved), on the fleet: GB10 (linux-arm64, Vulkan), the RTX 4070 SUPER box (linux-x64 and win-x64, Vulkan), the M4 (mac-arm64, Metal; about 11 GB free, so one model at a time, deleted after). mac-x64 is CPU-only and has no hardware here; CI compiling it is its check.
3. A family gets the GPU tier of every lane it runs on (ruling 8), recorded with its warm RTF.
4. Each wheel is checked against native-v1.2.0's: one shared ggml and no duplicate backend modules (`native/ci/check_single_ggml.py`), and its size and file list compared, with the growth reported to the owner.

## Stage 5 — release

Each step is asked first, in the order CLAUDE.md's Versions bullet fixes:

1. The owner merges the feature PR into main.
2. Tag `native-v1.3.0` on main; CI publishes five wheels (prerelease).
3. One commit: the five wheel URLs in `sidecar/requirements.txt`, `sidecar/tests/test_runtime_gate.py`, and `sidecarVersion` 0.5.0 in `package.json`; merged.
4. Tag `sidecar-v0.5.0` on that commit; CI builds the bundles.
5. Smoke the published bundles with `PYTHONNOUSERSITE=1`.
6. Users get sidecar 0.5.0 with a later ordinary app release.

## Testing

- Sidecar unit tests: card shapes and counts, per-card voice requirement, licence fields, the pinned-revision helper, companion staging.
- Native: CPU synthesis per family; the op-coverage gate on the record tree; parity for the existing families after the bump; ASR and translation suites after the engine bump.
- Fleet: GPU synthesis per family per lane; ASR and translation smoke.
- Renderer: only `MODEL_CLIP_LIMITS` and `TTS_ASSUMED_RTF` may change; the wire does not.

## Documents to update

`native/README.md` (families, counts, pins), CLAUDE.md's native bullets ("nine families", voice rules, pins and versions), the device-profile spec §3.2.1, the comments in `native/include/sokuji_native.h` and `src/lib/local-inference/native/nativeProtocol.ts`.

## Risks

- audio.cpp's pin is an unreleased commit; if upstream rewrites history and it vanishes, re-pin to the release that contains it.
- ggml 0.26's graph-input rule or transcribe.cpp 0.3's interface change can break an engine; stage 1 finds it before any family work starts.
- Large models (Confucius4 8.19 GB F32, MOSS-TTS-Local 7.51 GB, Fish 6.32 GB) may not fit the M4's memory; that lane then fails for them, which ruling 8 handles.
- Third-party repos can disappear; the pinned commit keeps the content fixed while the repo lives, and a mirror (as for supertonic-3) is the fallback.
