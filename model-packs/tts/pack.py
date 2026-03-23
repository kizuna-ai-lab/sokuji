#!/usr/bin/env python3
"""
Build a browser-ready WASM package for sherpa-onnx TTS models.

Downloads the selected model, packs it into an Emscripten .data file,
patches the JS glue from piper-en, and copies shared WASM assets.

NOTE: fp16 Piper models do NOT work in WASM — the ONNX Runtime CPU provider
      lacks float16 kernel support (microsoft/onnxruntime#9758, closed "Not Planned").
      Only fp32 and int8 variants are supported.

Usage:
    python3 pack.py                   # pack all models (all variants for Piper)
    python3 pack.py kitten            # Kitten Nano EN (fp16)
    python3 pack.py kokoro            # Kokoro Multi-Lang int8
    python3 pack.py piper-en-libritts_r-medium        # both variants (fp32, int8)
    python3 pack.py piper-en-libritts_r-medium:int8   # int8 only
    python3 pack.py all               # all models, all variants
    python3 pack.py all:int8          # all models, int8 only

Output per model (e.g. wasm-kitten/):
    wasm-{model}/sherpa-onnx-wasm-main-tts.js    (patched glue)
    wasm-{model}/sherpa-onnx-wasm-main-tts.wasm  (shared binary)
    wasm-{model}/sherpa-onnx-wasm-main-tts.data  (model data)
    wasm-{model}/sherpa-onnx-tts.js              (shared TTS API)
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

# Variant suffixes for Piper models: variant_name -> tarball suffix
# NOTE: fp16 excluded — ONNX Runtime WASM CPU provider does not support float16 tensors.
VARIANTS = {"fp32": "", "int8": "-int8"}
ALL_VARIANTS = list(VARIANTS.keys())

BASE_URL = "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/"
VOCODER_BASE_URL = "https://github.com/k2-fsa/sherpa-onnx/releases/download/vocoder-models/"

MODELS = {
    # --- Non-Piper models: explicit url/tarball, no variant support ---
    "kitten": {
        "url": "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kitten-nano-en-v0_2-fp16.tar.bz2",
        "tarball": "kitten-nano-en-v0_2-fp16.tar.bz2",
        "dir_hint": "kitten",
    },
    "kokoro": {
        "url": "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-int8-multi-lang-v1_0.tar.bz2",
        "tarball": "kokoro-int8-multi-lang-v1_0.tar.bz2",
        "dir_hint": "kokoro",
    },
    "kitten-mini": {
        "url": "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kitten-mini-en-v0_1-fp16.tar.bz2",
        "tarball": "kitten-mini-en-v0_1-fp16.tar.bz2",
        "dir_hint": "kitten",
    },
    "kokoro-v1_1": {
        "url": "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-int8-multi-lang-v1_1.tar.bz2",
        "tarball": "kokoro-int8-multi-lang-v1_1.tar.bz2",
        "dir_hint": "kokoro",
    },
    "kokoro-fp32": {
        "url": "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_1.tar.bz2",
        "tarball": "kokoro-multi-lang-v1_1.tar.bz2",
        "dir_hint": "kokoro",
    },
    "kokoro-en": {
        "url": "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-en-v0_19.tar.bz2",
        "tarball": "kokoro-en-v0_19.tar.bz2",
        "dir_hint": "kokoro",
    },
    "kokoro-en-int8": {
        "url": "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-int8-en-v0_19.tar.bz2",
        "tarball": "kokoro-int8-en-v0_19.tar.bz2",
        "dir_hint": "kokoro",
    },
    "kokoro-v1_0-fp32": {
        "url": "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_0.tar.bz2",
        "tarball": "kokoro-multi-lang-v1_0.tar.bz2",
        "dir_hint": "kokoro",
    },
    "kitten-v0_1": {
        "url": "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kitten-nano-en-v0_1-fp16.tar.bz2",
        "tarball": "kitten-nano-en-v0_1-fp16.tar.bz2",
        "dir_hint": "kitten",
    },
    # --- Matcha models: acoustic model + external vocoder ---
    "matcha-en-ljspeech": {
        "url": BASE_URL + "matcha-icefall-en_US-ljspeech.tar.bz2",
        "tarball": "matcha-icefall-en_US-ljspeech.tar.bz2",
        "dir_hint": "matcha",
        "vocoder": "vocos-22khz-univ.onnx",
    },
    "matcha-zh-baker": {
        "url": BASE_URL + "matcha-icefall-zh-baker.tar.bz2",
        "tarball": "matcha-icefall-zh-baker.tar.bz2",
        "dir_hint": "matcha",
        "vocoder": "vocos-22khz-univ.onnx",
    },
    "matcha-zh-en": {
        "url": BASE_URL + "matcha-icefall-zh-en.tar.bz2",
        "tarball": "matcha-icefall-zh-en.tar.bz2",
        "dir_hint": "matcha",
        "vocoder": "vocos-16khz-univ.onnx",
    },
    "matcha-fa-en-khadijah": {
        "url": BASE_URL + "matcha-tts-fa_en-khadijah.tar.bz2",
        "tarball": "matcha-tts-fa_en-khadijah.tar.bz2",
        "dir_hint": "matcha",
        "vocoder": "vocos-22khz-univ.onnx",
    },
    "matcha-fa-en-musa": {
        "url": BASE_URL + "matcha-tts-fa_en-musa.tar.bz2",
        "tarball": "matcha-tts-fa_en-musa.tar.bz2",
        "dir_hint": "matcha",
        "vocoder": "vocos-22khz-univ.onnx",
    },
    # --- ZipVoice models: encoder + decoder + external vocoder ---
    "zipvoice-distill-fp32": {
        "url": BASE_URL + "sherpa-onnx-zipvoice-distill-fp32-zh-en-emilia.tar.bz2",
        "tarball": "sherpa-onnx-zipvoice-distill-fp32-zh-en-emilia.tar.bz2",
        "dir_hint": "zipvoice",
        "vocoder": "vocos_24khz.onnx",
    },
    "zipvoice-distill-int8": {
        "url": BASE_URL + "sherpa-onnx-zipvoice-distill-int8-zh-en-emilia.tar.bz2",
        "tarball": "sherpa-onnx-zipvoice-distill-int8-zh-en-emilia.tar.bz2",
        "dir_hint": "zipvoice",
        "vocoder": "vocos_24khz.onnx",
    },
    # --- Pocket TTS models: self-contained, no vocoder ---
    "pocket": {
        "url": BASE_URL + "sherpa-onnx-pocket-tts-2026-01-26.tar.bz2",
        "tarball": "sherpa-onnx-pocket-tts-2026-01-26.tar.bz2",
        "dir_hint": "pocket",
    },
    "pocket-int8": {
        "url": BASE_URL + "sherpa-onnx-pocket-tts-int8-2026-01-26.tar.bz2",
        "tarball": "sherpa-onnx-pocket-tts-int8-2026-01-26.tar.bz2",
        "dir_hint": "pocket",
    },
    # --- Supertonic 2: diffusion TTS, 5 languages ---
    "supertonic-int8": {
        "url": BASE_URL + "sherpa-onnx-supertonic-tts-int8-2026-03-06.tar.bz2",
        "tarball": "sherpa-onnx-supertonic-tts-int8-2026-03-06.tar.bz2",
        "dir_hint": "supertonic",
    },
    # --- Coqui VITS models: character-level tokenization, no espeak-ng (except en-vctk) ---
    "coqui-bg-cv": {"url": BASE_URL + "vits-coqui-bg-cv.tar.bz2", "tarball": "vits-coqui-bg-cv.tar.bz2", "dir_hint": "coqui"},
    "coqui-bn-custom_female": {"url": BASE_URL + "vits-coqui-bn-custom_female.tar.bz2", "tarball": "vits-coqui-bn-custom_female.tar.bz2", "dir_hint": "coqui"},
    "coqui-cs-cv": {"url": BASE_URL + "vits-coqui-cs-cv.tar.bz2", "tarball": "vits-coqui-cs-cv.tar.bz2", "dir_hint": "coqui"},
    "coqui-da-cv": {"url": BASE_URL + "vits-coqui-da-cv.tar.bz2", "tarball": "vits-coqui-da-cv.tar.bz2", "dir_hint": "coqui"},
    "coqui-de-css10": {"url": BASE_URL + "vits-coqui-de-css10.tar.bz2", "tarball": "vits-coqui-de-css10.tar.bz2", "dir_hint": "coqui"},
    "coqui-en-ljspeech": {"url": BASE_URL + "vits-coqui-en-ljspeech.tar.bz2", "tarball": "vits-coqui-en-ljspeech.tar.bz2", "dir_hint": "coqui"},
    "coqui-en-neon": {"url": BASE_URL + "vits-coqui-en-ljspeech-neon.tar.bz2", "tarball": "vits-coqui-en-ljspeech-neon.tar.bz2", "dir_hint": "coqui"},
    "coqui-en-vctk": {"url": BASE_URL + "vits-coqui-en-vctk.tar.bz2", "tarball": "vits-coqui-en-vctk.tar.bz2", "dir_hint": "coqui"},
    "coqui-es-css10": {"url": BASE_URL + "vits-coqui-es-css10.tar.bz2", "tarball": "vits-coqui-es-css10.tar.bz2", "dir_hint": "coqui"},
    "coqui-et-cv": {"url": BASE_URL + "vits-coqui-et-cv.tar.bz2", "tarball": "vits-coqui-et-cv.tar.bz2", "dir_hint": "coqui"},
    "coqui-fi-css10": {"url": BASE_URL + "vits-coqui-fi-css10.tar.bz2", "tarball": "vits-coqui-fi-css10.tar.bz2", "dir_hint": "coqui"},
    "coqui-fr-css10": {"url": BASE_URL + "vits-coqui-fr-css10.tar.bz2", "tarball": "vits-coqui-fr-css10.tar.bz2", "dir_hint": "coqui"},
    "coqui-ga-cv": {"url": BASE_URL + "vits-coqui-ga-cv.tar.bz2", "tarball": "vits-coqui-ga-cv.tar.bz2", "dir_hint": "coqui"},
    "coqui-hr-cv": {"url": BASE_URL + "vits-coqui-hr-cv.tar.bz2", "tarball": "vits-coqui-hr-cv.tar.bz2", "dir_hint": "coqui"},
    "coqui-lt-cv": {"url": BASE_URL + "vits-coqui-lt-cv.tar.bz2", "tarball": "vits-coqui-lt-cv.tar.bz2", "dir_hint": "coqui"},
    "coqui-lv-cv": {"url": BASE_URL + "vits-coqui-lv-cv.tar.bz2", "tarball": "vits-coqui-lv-cv.tar.bz2", "dir_hint": "coqui"},
    "coqui-mt-cv": {"url": BASE_URL + "vits-coqui-mt-cv.tar.bz2", "tarball": "vits-coqui-mt-cv.tar.bz2", "dir_hint": "coqui"},
    "coqui-nl-css10": {"url": BASE_URL + "vits-coqui-nl-css10.tar.bz2", "tarball": "vits-coqui-nl-css10.tar.bz2", "dir_hint": "coqui"},
    "coqui-pl-mai_female": {"url": BASE_URL + "vits-coqui-pl-mai_female.tar.bz2", "tarball": "vits-coqui-pl-mai_female.tar.bz2", "dir_hint": "coqui"},
    "coqui-pt-cv": {"url": BASE_URL + "vits-coqui-pt-cv.tar.bz2", "tarball": "vits-coqui-pt-cv.tar.bz2", "dir_hint": "coqui"},
    "coqui-ro-cv": {"url": BASE_URL + "vits-coqui-ro-cv.tar.bz2", "tarball": "vits-coqui-ro-cv.tar.bz2", "dir_hint": "coqui"},
    "coqui-sk-cv": {"url": BASE_URL + "vits-coqui-sk-cv.tar.bz2", "tarball": "vits-coqui-sk-cv.tar.bz2", "dir_hint": "coqui"},
    "coqui-sl-cv": {"url": BASE_URL + "vits-coqui-sl-cv.tar.bz2", "tarball": "vits-coqui-sl-cv.tar.bz2", "dir_hint": "coqui"},
    "coqui-sv-cv": {"url": BASE_URL + "vits-coqui-sv-cv.tar.bz2", "tarball": "vits-coqui-sv-cv.tar.bz2", "dir_hint": "coqui"},
    "coqui-uk-mai": {"url": BASE_URL + "vits-coqui-uk-mai.tar.bz2", "tarball": "vits-coqui-uk-mai.tar.bz2", "dir_hint": "coqui"},
    # --- Mimic3 VITS models: IPA tokenization, espeak-ng-data ALWAYS required ---
    "mimic3-af-google_nwu-low": {"url": BASE_URL + "vits-mimic3-af_ZA-google-nwu_low.tar.bz2", "tarball": "vits-mimic3-af_ZA-google-nwu_low.tar.bz2", "dir_hint": "mimic3"},
    "mimic3-bn-multi-low": {"url": BASE_URL + "vits-mimic3-bn-multi_low.tar.bz2", "tarball": "vits-mimic3-bn-multi_low.tar.bz2", "dir_hint": "mimic3"},
    "mimic3-el-rapunzelina-low": {"url": BASE_URL + "vits-mimic3-el_GR-rapunzelina_low.tar.bz2", "tarball": "vits-mimic3-el_GR-rapunzelina_low.tar.bz2", "dir_hint": "mimic3"},
    "mimic3-es-m_ailabs-low": {"url": BASE_URL + "vits-mimic3-es_ES-m-ailabs_low.tar.bz2", "tarball": "vits-mimic3-es_ES-m-ailabs_low.tar.bz2", "dir_hint": "mimic3"},
    "mimic3-fa-haaniye-low": {"url": BASE_URL + "vits-mimic3-fa-haaniye_low.tar.bz2", "tarball": "vits-mimic3-fa-haaniye_low.tar.bz2", "dir_hint": "mimic3"},
    "mimic3-fi-harri_tapani_ylilammi-low": {"url": BASE_URL + "vits-mimic3-fi_FI-harri-tapani-ylilammi_low.tar.bz2", "tarball": "vits-mimic3-fi_FI-harri-tapani-ylilammi_low.tar.bz2", "dir_hint": "mimic3"},
    "mimic3-gu-cmu_indic-low": {"url": BASE_URL + "vits-mimic3-gu_IN-cmu-indic_low.tar.bz2", "tarball": "vits-mimic3-gu_IN-cmu-indic_low.tar.bz2", "dir_hint": "mimic3"},
    "mimic3-hu-diana_majlinger-low": {"url": BASE_URL + "vits-mimic3-hu_HU-diana-majlinger_low.tar.bz2", "tarball": "vits-mimic3-hu_HU-diana-majlinger_low.tar.bz2", "dir_hint": "mimic3"},
    "mimic3-ko-kss-low": {"url": BASE_URL + "vits-mimic3-ko_KO-kss_low.tar.bz2", "tarball": "vits-mimic3-ko_KO-kss_low.tar.bz2", "dir_hint": "mimic3"},
    "mimic3-ne-ne_google-low": {"url": BASE_URL + "vits-mimic3-ne_NP-ne-google_low.tar.bz2", "tarball": "vits-mimic3-ne_NP-ne-google_low.tar.bz2", "dir_hint": "mimic3"},
    "mimic3-pl-m_ailabs-low": {"url": BASE_URL + "vits-mimic3-pl_PL-m-ailabs_low.tar.bz2", "tarball": "vits-mimic3-pl_PL-m-ailabs_low.tar.bz2", "dir_hint": "mimic3"},
    "mimic3-tn-google_nwu-low": {"url": BASE_URL + "vits-mimic3-tn_ZA-google-nwu_low.tar.bz2", "tarball": "vits-mimic3-tn_ZA-google-nwu_low.tar.bz2", "dir_hint": "mimic3"},
    "mimic3-vi-vais1000-low": {"url": BASE_URL + "vits-mimic3-vi_VN-vais1000_low.tar.bz2", "tarball": "vits-mimic3-vi_VN-vais1000_low.tar.bz2", "dir_hint": "mimic3"},
    # --- MeloTTS VITS models: lexicon-based, optional dict+ruleFsts for Chinese ---
    "melo-tts-en": {"url": BASE_URL + "vits-melo-tts-en.tar.bz2", "tarball": "vits-melo-tts-en.tar.bz2", "dir_hint": "melo"},
    "melo-tts-zh-en": {"url": BASE_URL + "vits-melo-tts-zh_en.tar.bz2", "tarball": "vits-melo-tts-zh_en.tar.bz2", "dir_hint": "melo"},
    # --- Cantonese VITS model: lexicon + rule.fst ---
    "cantonese": {"url": BASE_URL + "vits-cantonese-hf-xiaomaiiwn.tar.bz2", "tarball": "vits-cantonese-hf-xiaomaiiwn.tar.bz2", "dir_hint": "cantonese"},
    # --- Icefall VITS models ---
    "icefall-en-ljspeech-low": {"url": BASE_URL + "vits-icefall-en_US-ljspeech-low.tar.bz2", "tarball": "vits-icefall-en_US-ljspeech-low.tar.bz2", "dir_hint": "icefall"},
    "icefall-en-ljspeech-medium": {"url": BASE_URL + "vits-icefall-en_US-ljspeech-medium.tar.bz2", "tarball": "vits-icefall-en_US-ljspeech-medium.tar.bz2", "dir_hint": "icefall"},
    "icefall-zh-aishell3": {"url": BASE_URL + "vits-icefall-zh-aishell3.tar.bz2", "tarball": "vits-icefall-zh-aishell3.tar.bz2", "dir_hint": "icefall"},
    # --- Chinese VITS zh-ll: lexicon + dict + ruleFsts ---
    "zh-ll": {"url": BASE_URL + "sherpa-onnx-vits-zh-ll.tar.bz2", "tarball": "sherpa-onnx-vits-zh-ll.tar.bz2", "dir_hint": "zh-ll"},
    # --- MMS VITS models: grapheme tokenization, no espeak-ng ---
    "mms-deu": {"url": BASE_URL + "vits-mms-deu.tar.bz2", "tarball": "vits-mms-deu.tar.bz2", "dir_hint": "mms"},
    "mms-eng": {"url": BASE_URL + "vits-mms-eng.tar.bz2", "tarball": "vits-mms-eng.tar.bz2", "dir_hint": "mms"},
    "mms-fra": {"url": BASE_URL + "vits-mms-fra.tar.bz2", "tarball": "vits-mms-fra.tar.bz2", "dir_hint": "mms"},
    "mms-nan": {"url": BASE_URL + "vits-mms-nan.tar.bz2", "tarball": "vits-mms-nan.tar.bz2", "dir_hint": "mms"},
    "mms-rus": {"url": BASE_URL + "vits-mms-rus.tar.bz2", "tarball": "vits-mms-rus.tar.bz2", "dir_hint": "mms"},
    "mms-spa": {"url": BASE_URL + "vits-mms-spa.tar.bz2", "tarball": "vits-mms-spa.tar.bz2", "dir_hint": "mms"},
    "mms-tha": {"url": BASE_URL + "vits-mms-tha.tar.bz2", "tarball": "vits-mms-tha.tar.bz2", "dir_hint": "mms"},
    "mms-ukr": {"url": BASE_URL + "vits-mms-ukr.tar.bz2", "tarball": "vits-mms-ukr.tar.bz2", "dir_hint": "mms"},
    # --- Piper models: base_tarball pattern, supports fp32/fp16/int8 variants ---
    "piper-en-libritts_r-medium": {
        "base_tarball": "vits-piper-en_US-libritts_r-medium",
        "dir_hint": "piper",
    },
    "piper-zh-huayan-medium": {
        "base_tarball": "vits-piper-zh_CN-huayan-medium",
        "dir_hint": "piper",
        "variants": ["fp32"],
    },
    "piper-de-thorsten_emotional-medium": {
        "base_tarball": "vits-piper-de_DE-thorsten_emotional-medium",
        "dir_hint": "piper",
    },
    "piper-ar-kareem-medium": {
        "base_tarball": "vits-piper-ar_JO-kareem-medium",
        "dir_hint": "piper",
    },
    "piper-ca-upc_ona-medium": {
        "base_tarball": "vits-piper-ca_ES-upc_ona-medium",
        "dir_hint": "piper",
    },
    "piper-cs-jirka-medium": {
        "base_tarball": "vits-piper-cs_CZ-jirka-medium",
        "dir_hint": "piper",
    },
    "piper-cy-gwryw_gogleddol-medium": {
        "base_tarball": "vits-piper-cy_GB-gwryw_gogleddol-medium",
        "dir_hint": "piper",
    },
    "piper-da-talesyntese-medium": {
        "base_tarball": "vits-piper-da_DK-talesyntese-medium",
        "dir_hint": "piper",
    },
    "piper-el-rapunzelina-low": {
        "base_tarball": "vits-piper-el_GR-rapunzelina-low",
        "dir_hint": "piper",
    },
    "piper-en-gb-northern_english_male-medium": {
        "base_tarball": "vits-piper-en_GB-northern_english_male-medium",
        "dir_hint": "piper",
    },
    "piper-es-davefx-medium": {
        "base_tarball": "vits-piper-es_ES-davefx-medium",
        "dir_hint": "piper",
    },
    "piper-es-ar-daniela-high": {
        "base_tarball": "vits-piper-es_AR-daniela-high",
        "dir_hint": "piper",
    },
    "piper-es-mx-ald-medium": {
        "base_tarball": "vits-piper-es_MX-ald-medium",
        "dir_hint": "piper",
    },
    "piper-fa-amir-medium": {
        "base_tarball": "vits-piper-fa_IR-amir-medium",
        "dir_hint": "piper",
    },
    "piper-fa-en-rezahedayatfar-ibrahimwalk-medium": {
        "base_tarball": "vits-piper-fa_en-rezahedayatfar-ibrahimwalk-medium",
        "dir_hint": "piper",
        "variants": ["fp32"],
    },
    "piper-fi-harri-medium": {
        "base_tarball": "vits-piper-fi_FI-harri-medium",
        "dir_hint": "piper",
    },
    "piper-fr-tom-medium": {
        "base_tarball": "vits-piper-fr_FR-tom-medium",
        "dir_hint": "piper",
    },
    "piper-hi-rohan-medium": {
        "base_tarball": "vits-piper-hi_IN-rohan-medium",
        "dir_hint": "piper",
    },
    "piper-hu-anna-medium": {
        "base_tarball": "vits-piper-hu_HU-anna-medium",
        "dir_hint": "piper",
    },
    "piper-id-news_tts-medium": {
        "base_tarball": "vits-piper-id_ID-news_tts-medium",
        "dir_hint": "piper",
    },
    "piper-is-bui-medium": {
        "base_tarball": "vits-piper-is_IS-bui-medium",
        "dir_hint": "piper",
    },
    "piper-it-paola-medium": {
        "base_tarball": "vits-piper-it_IT-paola-medium",
        "dir_hint": "piper",
    },
    "piper-ka-natia-medium": {
        "base_tarball": "vits-piper-ka_GE-natia-medium",
        "dir_hint": "piper",
    },
    "piper-kk-issai-high": {
        "base_tarball": "vits-piper-kk_KZ-issai-high",
        "dir_hint": "piper",
    },
    "piper-lb-marylux-medium": {
        "base_tarball": "vits-piper-lb_LU-marylux-medium",
        "dir_hint": "piper",
    },
    "piper-lv-aivars-medium": {
        "base_tarball": "vits-piper-lv_LV-aivars-medium",
        "dir_hint": "piper",
    },
    "piper-ml-meera-medium": {
        "base_tarball": "vits-piper-ml_IN-meera-medium",
        "dir_hint": "piper",
    },
    "piper-ne-chitwan-medium": {
        "base_tarball": "vits-piper-ne_NP-chitwan-medium",
        "dir_hint": "piper",
    },
    "piper-nl-ronnie-medium": {
        "base_tarball": "vits-piper-nl_NL-ronnie-medium",
        "dir_hint": "piper",
    },
    "piper-nl-be-rdh-medium": {
        "base_tarball": "vits-piper-nl_BE-rdh-medium",
        "dir_hint": "piper",
        "variants": ["fp32"],
    },
    "piper-no-talesyntese-medium": {
        "base_tarball": "vits-piper-no_NO-talesyntese-medium",
        "dir_hint": "piper",
    },
    "piper-pl-darkman-medium": {
        "base_tarball": "vits-piper-pl_PL-darkman-medium",
        "dir_hint": "piper",
    },
    "piper-pt-tugao-medium": {
        "base_tarball": "vits-piper-pt_PT-tugao-medium",
        "dir_hint": "piper",
    },
    "piper-pt-br-faber-medium": {
        "base_tarball": "vits-piper-pt_BR-faber-medium",
        "dir_hint": "piper",
    },
    "piper-ro-mihai-medium": {
        "base_tarball": "vits-piper-ro_RO-mihai-medium",
        "dir_hint": "piper",
        "variants": ["fp32"],
    },
    "piper-ru-irina-medium": {
        "base_tarball": "vits-piper-ru_RU-irina-medium",
        "dir_hint": "piper",
    },
    "piper-sk-lili-medium": {
        "base_tarball": "vits-piper-sk_SK-lili-medium",
        "dir_hint": "piper",
    },
    "piper-sl-artur-medium": {
        "base_tarball": "vits-piper-sl_SI-artur-medium",
        "dir_hint": "piper",
    },
    "piper-sr-serbski_institut-medium": {
        "base_tarball": "vits-piper-sr_RS-serbski_institut-medium",
        "dir_hint": "piper",
    },
    "piper-sv-nst-medium": {
        "base_tarball": "vits-piper-sv_SE-nst-medium",
        "dir_hint": "piper",
    },
    "piper-sw-lanfrica-medium": {
        "base_tarball": "vits-piper-sw_CD-lanfrica-medium",
        "dir_hint": "piper",
    },
    "piper-tr-fettah-medium": {
        "base_tarball": "vits-piper-tr_TR-fettah-medium",
        "dir_hint": "piper",
    },
    "piper-uk-ukrainian_tts-medium": {
        "base_tarball": "vits-piper-uk_UA-ukrainian_tts-medium",
        "dir_hint": "piper",
    },
    "piper-vi-vais1000-medium": {
        "base_tarball": "vits-piper-vi_VN-vais1000-medium",
        "dir_hint": "piper",
    },
    # --- Additional Piper voice variants (alternative voices per language) ---
    "piper-nl-be-rdh-x_low": {
        "base_tarball": "vits-piper-nl_BE-rdh-x_low",
        "dir_hint": "piper",
        "variants": ["fp32"],
    },
    "piper-ca-upc_ona-x_low": {
        "base_tarball": "vits-piper-ca_ES-upc_ona-x_low",
        "dir_hint": "piper",
    },
    "piper-ca-upc_pau-x_low": {
        "base_tarball": "vits-piper-ca_ES-upc_pau-x_low",
        "dir_hint": "piper",
    },
    "piper-de-eva_k-x_low": {
        "base_tarball": "vits-piper-de_DE-eva_k-x_low",
        "dir_hint": "piper",
    },
    "piper-es-carlfm-x_low": {
        "base_tarball": "vits-piper-es_ES-carlfm-x_low",
        "dir_hint": "piper",
    },
    "piper-it-riccardo-x_low": {
        "base_tarball": "vits-piper-it_IT-riccardo-x_low",
        "dir_hint": "piper",
    },
    "piper-kk-iseke-x_low": {
        "base_tarball": "vits-piper-kk_KZ-iseke-x_low",
        "dir_hint": "piper",
    },
    "piper-kk-raya-x_low": {
        "base_tarball": "vits-piper-kk_KZ-raya-x_low",
        "dir_hint": "piper",
    },
    "piper-nl-be-nathalie-x_low": {
        "base_tarball": "vits-piper-nl_BE-nathalie-x_low",
        "dir_hint": "piper",
    },
    "piper-uk-lada-x_low": {
        "base_tarball": "vits-piper-uk_UA-lada-x_low",
        "dir_hint": "piper",
    },
    "piper-ne-google-x_low": {
        "base_tarball": "vits-piper-ne_NP-google-x_low",
        "dir_hint": "piper",
    },
    "piper-vi-vivos-x_low": {
        "base_tarball": "vits-piper-vi_VN-vivos-x_low",
        "dir_hint": "piper",
    },
    "piper-fr-siwis-low": {
        "base_tarball": "vits-piper-fr_FR-siwis-low",
        "dir_hint": "piper",
    },
    "piper-ar-kareem-low": {
        "base_tarball": "vits-piper-ar_JO-kareem-low",
        "dir_hint": "piper",
    },
    "piper-cs-jirka-low": {
        "base_tarball": "vits-piper-cs_CZ-jirka-low",
        "dir_hint": "piper",
    },
    "piper-de-glados-low": {
        "base_tarball": "vits-piper-de_DE-glados-low",
        "dir_hint": "piper",
    },
    "piper-de-glados_turret-low": {
        "base_tarball": "vits-piper-de_DE-glados_turret-low",
        "dir_hint": "piper",
    },
    "piper-de-karlsson-low": {
        "base_tarball": "vits-piper-de_DE-karlsson-low",
        "dir_hint": "piper",
    },
    "piper-de-kerstin-low": {
        "base_tarball": "vits-piper-de_DE-kerstin-low",
        "dir_hint": "piper",
    },
    "piper-de-pavoque-low": {
        "base_tarball": "vits-piper-de_DE-pavoque-low",
        "dir_hint": "piper",
    },
    "piper-de-ramona-low": {
        "base_tarball": "vits-piper-de_DE-ramona-low",
        "dir_hint": "piper",
    },
    "piper-de-thorsten-low": {
        "base_tarball": "vits-piper-de_DE-thorsten-low",
        "dir_hint": "piper",
    },
    "piper-en-gb-alan-low": {
        "base_tarball": "vits-piper-en_GB-alan-low",
        "dir_hint": "piper",
    },
    "piper-en-gb-south-female-low": {
        "base_tarball": "vits-piper-en_GB-southern_english_female-low",
        "dir_hint": "piper",
    },
    "piper-en-amy-low": {
        "base_tarball": "vits-piper-en_US-amy-low",
        "dir_hint": "piper",
    },
    "piper-en-danny-low": {
        "base_tarball": "vits-piper-en_US-danny-low",
        "dir_hint": "piper",
    },
    "piper-en-kathleen-low": {
        "base_tarball": "vits-piper-en_US-kathleen-low",
        "dir_hint": "piper",
    },
    "piper-en-lessac-low": {
        "base_tarball": "vits-piper-en_US-lessac-low",
        "dir_hint": "piper",
    },
    "piper-en-ryan-low": {
        "base_tarball": "vits-piper-en_US-ryan-low",
        "dir_hint": "piper",
    },
    "piper-fi-harri-low": {
        "base_tarball": "vits-piper-fi_FI-harri-low",
        "dir_hint": "piper",
    },
    "piper-fr-gilles-low": {
        "base_tarball": "vits-piper-fr_FR-gilles-low",
        "dir_hint": "piper",
    },
    "piper-pt-br-edresson-low": {
        "base_tarball": "vits-piper-pt_BR-edresson-low",
        "dir_hint": "piper",
    },
    "piper-vi-25hours-low": {
        "base_tarball": "vits-piper-vi_VN-25hours_single-low",
        "dir_hint": "piper",
    },
    "piper-de-glados-medium": {
        "base_tarball": "vits-piper-de_DE-glados-medium",
        "dir_hint": "piper",
    },
    "piper-de-glados_turret-medium": {
        "base_tarball": "vits-piper-de_DE-glados_turret-medium",
        "dir_hint": "piper",
    },
    "piper-de-thorsten-medium": {
        "base_tarball": "vits-piper-de_DE-thorsten-medium",
        "dir_hint": "piper",
    },
    "piper-en-gb-alan-medium": {
        "base_tarball": "vits-piper-en_GB-alan-medium",
        "dir_hint": "piper",
    },
    "piper-en-gb-alba-medium": {
        "base_tarball": "vits-piper-en_GB-alba-medium",
        "dir_hint": "piper",
    },
    "piper-en-gb-cori-medium": {
        "base_tarball": "vits-piper-en_GB-cori-medium",
        "dir_hint": "piper",
    },
    "piper-en-gb-jenny-medium": {
        "base_tarball": "vits-piper-en_GB-jenny_dioco-medium",
        "dir_hint": "piper",
    },
    "piper-en-amy-medium": {
        "base_tarball": "vits-piper-en_US-amy-medium",
        "dir_hint": "piper",
    },
    "piper-en-bryce-medium": {
        "base_tarball": "vits-piper-en_US-bryce-medium",
        "dir_hint": "piper",
    },
    "piper-en-hfc_female-medium": {
        "base_tarball": "vits-piper-en_US-hfc_female-medium",
        "dir_hint": "piper",
    },
    "piper-en-hfc_male-medium": {
        "base_tarball": "vits-piper-en_US-hfc_male-medium",
        "dir_hint": "piper",
    },
    "piper-en-joe-medium": {
        "base_tarball": "vits-piper-en_US-joe-medium",
        "dir_hint": "piper",
    },
    "piper-en-john-medium": {
        "base_tarball": "vits-piper-en_US-john-medium",
        "dir_hint": "piper",
    },
    "piper-en-kristin-medium": {
        "base_tarball": "vits-piper-en_US-kristin-medium",
        "dir_hint": "piper",
    },
    "piper-en-kusal-medium": {
        "base_tarball": "vits-piper-en_US-kusal-medium",
        "dir_hint": "piper",
    },
    "piper-en-lessac-medium": {
        "base_tarball": "vits-piper-en_US-lessac-medium",
        "dir_hint": "piper",
    },
    "piper-en-ljspeech-medium": {
        "base_tarball": "vits-piper-en_US-ljspeech-medium",
        "dir_hint": "piper",
    },
    "piper-en-norman-medium": {
        "base_tarball": "vits-piper-en_US-norman-medium",
        "dir_hint": "piper",
    },
    "piper-en-reza-medium": {
        "base_tarball": "vits-piper-en_US-reza_ibrahim-medium",
        "dir_hint": "piper",
    },
    "piper-en-ryan-medium": {
        "base_tarball": "vits-piper-en_US-ryan-medium",
        "dir_hint": "piper",
    },
    "piper-en-sam-medium": {
        "base_tarball": "vits-piper-en_US-sam-medium",
        "dir_hint": "piper",
    },
    "piper-es-glados-medium": {
        "base_tarball": "vits-piper-es_ES-glados-medium",
        "dir_hint": "piper",
    },
    "piper-es-mx-claude-high": {
        "base_tarball": "vits-piper-es_MX-claude-high",
        "dir_hint": "piper",
    },
    "piper-fa-ganji-medium": {
        "base_tarball": "vits-piper-fa_IR-ganji-medium",
        "dir_hint": "piper",
    },
    "piper-fa-ganji_adabi-medium": {
        "base_tarball": "vits-piper-fa_IR-ganji_adabi-medium",
        "dir_hint": "piper",
    },
    "piper-fa-gyro-medium": {
        "base_tarball": "vits-piper-fa_IR-gyro-medium",
        "dir_hint": "piper",
    },
    "piper-fa-reza-medium": {
        "base_tarball": "vits-piper-fa_IR-reza_ibrahim-medium",
        "dir_hint": "piper",
    },
    "piper-fr-siwis-medium": {
        "base_tarball": "vits-piper-fr_FR-siwis-medium",
        "dir_hint": "piper",
    },
    "piper-fr-tjiho1-medium": {
        "base_tarball": "vits-piper-fr_FR-tjiho-model1",
        "dir_hint": "piper",
    },
    "piper-fr-tjiho2-medium": {
        "base_tarball": "vits-piper-fr_FR-tjiho-model2",
        "dir_hint": "piper",
    },
    "piper-fr-tjiho3-medium": {
        "base_tarball": "vits-piper-fr_FR-tjiho-model3",
        "dir_hint": "piper",
    },
    "piper-hi-pratham-medium": {
        "base_tarball": "vits-piper-hi_IN-pratham-medium",
        "dir_hint": "piper",
    },
    "piper-hi-priyamvada-medium": {
        "base_tarball": "vits-piper-hi_IN-priyamvada-medium",
        "dir_hint": "piper",
    },
    "piper-hu-berta-medium": {
        "base_tarball": "vits-piper-hu_HU-berta-medium",
        "dir_hint": "piper",
    },
    "piper-hu-imre-medium": {
        "base_tarball": "vits-piper-hu_HU-imre-medium",
        "dir_hint": "piper",
    },
    "piper-is-salka-medium": {
        "base_tarball": "vits-piper-is_IS-salka-medium",
        "dir_hint": "piper",
    },
    "piper-is-steinn-medium": {
        "base_tarball": "vits-piper-is_IS-steinn-medium",
        "dir_hint": "piper",
    },
    "piper-is-ugla-medium": {
        "base_tarball": "vits-piper-is_IS-ugla-medium",
        "dir_hint": "piper",
    },
    "piper-ml-arjun-medium": {
        "base_tarball": "vits-piper-ml_IN-arjun-medium",
        "dir_hint": "piper",
    },
    "piper-nl-pim-medium": {
        "base_tarball": "vits-piper-nl_NL-pim-medium",
        "dir_hint": "piper",
    },
    "piper-nl-be-nathalie-medium": {
        "base_tarball": "vits-piper-nl_BE-nathalie-medium",
        "dir_hint": "piper",
    },
    "piper-pl-gosia-medium": {
        "base_tarball": "vits-piper-pl_PL-gosia-medium",
        "dir_hint": "piper",
    },
    "piper-pl-jarvis-medium": {
        "base_tarball": "vits-piper-pl_PL-jarvis_wg_glos-medium",
        "dir_hint": "piper",
    },
    "piper-pl-justyna-medium": {
        "base_tarball": "vits-piper-pl_PL-justyna_wg_glos-medium",
        "dir_hint": "piper",
    },
    "piper-pl-mc_speech-medium": {
        "base_tarball": "vits-piper-pl_PL-mc_speech-medium",
        "dir_hint": "piper",
    },
    "piper-pl-meski-medium": {
        "base_tarball": "vits-piper-pl_PL-meski_wg_glos-medium",
        "dir_hint": "piper",
    },
    "piper-pl-zenski-medium": {
        "base_tarball": "vits-piper-pl_PL-zenski_wg_glos-medium",
        "dir_hint": "piper",
    },
    "piper-pt-br-cadu-medium": {
        "base_tarball": "vits-piper-pt_BR-cadu-medium",
        "dir_hint": "piper",
    },
    "piper-pt-br-jeff-medium": {
        "base_tarball": "vits-piper-pt_BR-jeff-medium",
        "dir_hint": "piper",
    },
    "piper-ru-denis-medium": {
        "base_tarball": "vits-piper-ru_RU-denis-medium",
        "dir_hint": "piper",
    },
    "piper-ru-dmitri-medium": {
        "base_tarball": "vits-piper-ru_RU-dmitri-medium",
        "dir_hint": "piper",
    },
    "piper-ru-ruslan-medium": {
        "base_tarball": "vits-piper-ru_RU-ruslan-medium",
        "dir_hint": "piper",
    },
    "piper-sv-lisa-medium": {
        "base_tarball": "vits-piper-sv_SE-lisa-medium",
        "dir_hint": "piper",
    },
    "piper-tr-dfki-medium": {
        "base_tarball": "vits-piper-tr_TR-dfki-medium",
        "dir_hint": "piper",
    },
    "piper-tr-fahrettin-medium": {
        "base_tarball": "vits-piper-tr_TR-fahrettin-medium",
        "dir_hint": "piper",
    },
    "piper-cy-bu_tts-medium": {
        "base_tarball": "vits-piper-cy_GB-bu_tts-medium",
        "dir_hint": "piper",
    },
    "piper-en-gb-aru-medium": {
        "base_tarball": "vits-piper-en_GB-aru-medium",
        "dir_hint": "piper",
    },
    "piper-en-gb-semaine-medium": {
        "base_tarball": "vits-piper-en_GB-semaine-medium",
        "dir_hint": "piper",
    },
    "piper-en-gb-south-female-medium": {
        "base_tarball": "vits-piper-en_GB-southern_english_female-medium",
        "dir_hint": "piper",
    },
    "piper-en-gb-south-male-medium": {
        "base_tarball": "vits-piper-en_GB-southern_english_male-medium",
        "dir_hint": "piper",
    },
    "piper-en-gb-vctk-medium": {
        "base_tarball": "vits-piper-en_GB-vctk-medium",
        "dir_hint": "piper",
    },
    "piper-en-arctic-medium": {
        "base_tarball": "vits-piper-en_US-arctic-medium",
        "dir_hint": "piper",
    },
    "piper-en-l2arctic-medium": {
        "base_tarball": "vits-piper-en_US-l2arctic-medium",
        "dir_hint": "piper",
    },
    "piper-es-sharvard-medium": {
        "base_tarball": "vits-piper-es_ES-sharvard-medium",
        "dir_hint": "piper",
    },
    "piper-fr-upmc-medium": {
        "base_tarball": "vits-piper-fr_FR-upmc-medium",
        "dir_hint": "piper",
    },
    "piper-ne-google-medium": {
        "base_tarball": "vits-piper-ne_NP-google-medium",
        "dir_hint": "piper",
    },
    "piper-ar-dii-high": {
        "base_tarball": "vits-piper-ar_JO-SA_dii-high",
        "dir_hint": "piper",
    },
    "piper-ar-miro-high": {
        "base_tarball": "vits-piper-ar_JO-SA_miro-high",
        "dir_hint": "piper",
    },
    "piper-ar-miro_v2-high": {
        "base_tarball": "vits-piper-ar_JO-SA_miro_V2-high",
        "dir_hint": "piper",
    },
    "piper-de-dii-high": {
        "base_tarball": "vits-piper-de_DE-dii-high",
        "dir_hint": "piper",
    },
    "piper-de-miro-high": {
        "base_tarball": "vits-piper-de_DE-miro-high",
        "dir_hint": "piper",
    },
    "piper-en-gb-dii-high": {
        "base_tarball": "vits-piper-en_GB-dii-high",
        "dir_hint": "piper",
    },
    "piper-en-gb-miro-high": {
        "base_tarball": "vits-piper-en_GB-miro-high",
        "dir_hint": "piper",
    },
    "piper-en-miro-high": {
        "base_tarball": "vits-piper-en_US-miro-high",
        "dir_hint": "piper",
    },
    "piper-es-miro-high": {
        "base_tarball": "vits-piper-es_ES-miro-high",
        "dir_hint": "piper",
    },
    "piper-fr-miro-high": {
        "base_tarball": "vits-piper-fr_FR-miro-high",
        "dir_hint": "piper",
    },
    "piper-it-dii-high": {
        "base_tarball": "vits-piper-it_IT-dii-high",
        "dir_hint": "piper",
    },
    "piper-it-miro-high": {
        "base_tarball": "vits-piper-it_IT-miro-high",
        "dir_hint": "piper",
    },
    "piper-nl-dii-high": {
        "base_tarball": "vits-piper-nl_NL-dii-high",
        "dir_hint": "piper",
    },
    "piper-nl-miro-high": {
        "base_tarball": "vits-piper-nl_NL-miro-high",
        "dir_hint": "piper",
    },
    "piper-pt-br-dii-high": {
        "base_tarball": "vits-piper-pt_BR-dii-high",
        "dir_hint": "piper",
    },
    "piper-pt-br-miro-high": {
        "base_tarball": "vits-piper-pt_BR-miro-high",
        "dir_hint": "piper",
    },
    "piper-pt-dii-high": {
        "base_tarball": "vits-piper-pt_PT-dii-high",
        "dir_hint": "piper",
    },
    "piper-pt-miro-high": {
        "base_tarball": "vits-piper-pt_PT-miro-high",
        "dir_hint": "piper",
    },
}

# Relative to project root (sokuji-react/): script is at model-packs/tts/pack.py
PIPER_EN_DIR = Path(__file__).resolve().parent.parent.parent / "public" / "wasm" / "sherpa-onnx-tts-piper-en"
SCRIPT_DIR = Path(__file__).resolve().parent


def _is_piper(model_cfg: dict) -> bool:
    """Check if a model config uses the base_tarball pattern (Piper model)."""
    return "base_tarball" in model_cfg


def _available_variants(model_cfg: dict) -> list[str]:
    """Return the list of variants available for a model."""
    if not _is_piper(model_cfg):
        return ["fp32"]
    return model_cfg.get("variants", ALL_VARIANTS)


def _resolve_tarball_and_url(model_cfg: dict, variant: str) -> tuple[str, str]:
    """Resolve tarball filename and download URL for a model+variant."""
    if _is_piper(model_cfg):
        suffix = VARIANTS[variant]
        tarball = f"{model_cfg['base_tarball']}{suffix}.tar.bz2"
        url = BASE_URL + tarball
        return tarball, url
    else:
        return model_cfg["tarball"], model_cfg["url"]


def _output_dir_name(model_name: str, variant: str) -> str:
    """Compute output directory name: wasm-{key}/ for fp32, wasm-{key}-{variant}/ for others."""
    if variant == "fp32":
        return f"wasm-{model_name}"
    else:
        return f"wasm-{model_name}-{variant}"


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

    # The tarball extracts to a directory like kitten-nano-en-v0_2-fp16/
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


def collect_files(model_dir: Path) -> list[tuple[str, Path]]:
    """
    Walk model directory and collect (virtual_path, real_path) pairs.
    Virtual paths are relative to model root, prefixed with '/'.
    """
    files = []
    for real_path in sorted(model_dir.rglob("*")):
        if real_path.is_file():
            rel = real_path.relative_to(model_dir)
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
        # Collect all parent directories (e.g. /espeak-ng-data/lang/en -> add /espeak-ng-data, /espeak-ng-data/lang)
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


def patch_glue_js(piper_js_path: Path, output_js_path: Path, metadata: list[dict], data_size: int):
    """
    Take piper-en's glue JS file and patch it with new model metadata.

    Patches:
    1. PACKAGE_NAME: fix the path to just the filename
    2. datafile_ references: update to match new PACKAGE_NAME
    3. FS_createPath block: regenerate for new model's directory structure
    4. loadPackage({...}): replace the entire JSON metadata
    """
    content = piper_js_path.read_text()

    # 1. Fix PACKAGE_NAME from "../../bin/sherpa-onnx-wasm-main-tts.data"
    #    to "sherpa-onnx-wasm-main-tts.data"
    content = content.replace(
        'var PACKAGE_NAME="../../bin/sherpa-onnx-wasm-main-tts.data"',
        'var PACKAGE_NAME="sherpa-onnx-wasm-main-tts.data"',
    )

    # 2. Fix datafile_ references
    content = content.replace(
        'datafile_../../bin/sherpa-onnx-wasm-main-tts.data',
        'datafile_sherpa-onnx-wasm-main-tts.data',
    )

    # 3. Replace FS_createPath block with paths for this model
    cp_pattern = re.compile(r'Module\["FS_createPath"\]\([^)]+\);')
    cp_matches = list(cp_pattern.finditer(content))
    if not cp_matches:
        raise RuntimeError("Could not find FS_createPath calls in glue JS")

    first_start = cp_matches[0].start()
    last_end = cp_matches[-1].end()
    new_cp_calls = _build_create_path_calls(metadata)
    content = content[:first_start] + new_cp_calls + content[last_end:]
    print(f"  Patched FS_createPath: {len(cp_matches)} old -> {new_cp_calls.count('FS_createPath')} new")

    # 4. Replace loadPackage(...) metadata
    # Handle two formats:
    #   - Unpatched:       loadPackage({"files":[...],...})
    #   - Already-patched: loadPackage(Module._dataPackageMetadata||{"files":[...],...})
    lp_start = content.find("loadPackage(")
    if lp_start == -1:
        raise RuntimeError("Could not find loadPackage( in glue JS")

    # Find the opening { of the JSON metadata (skip Module._dataPackageMetadata|| if present)
    after_paren = lp_start + len("loadPackage(")
    brace_start = content.find("{", after_paren)
    if brace_start == -1:
        raise RuntimeError("Could not find opening { after loadPackage(")

    # Find the matching closing brace for the JSON object
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

    # Replace: loadPackage(...old...) -> loadPackage(Module._dataPackageMetadata||{...new...})
    content = content[:lp_start] + "loadPackage(Module._dataPackageMetadata||" + new_json + ")" + content[close_paren + 1:]

    output_js_path.write_text(content)
    print(f"  Patched glue JS: {output_js_path.name}")


def pack_model(model_name: str, model_cfg: dict, variant: str, skip_existing: bool = False):
    """Pack a single model variant into its own wasm-{name}[-{variant}]/ directory."""
    dir_name = _output_dir_name(model_name, variant)
    output_dir = SCRIPT_DIR / dir_name
    tarball_name, url = _resolve_tarball_and_url(model_cfg, variant)

    # Skip if output directory already has a .data file (i.e. fully packed)
    if skip_existing:
        data_files = list(output_dir.glob("*.data")) if output_dir.exists() else []
        if data_files:
            print(f"\n  SKIP (already packed): {dir_name}/")
            return

    print(f"\n{'='*50}")
    print(f"Packing model: {model_name} ({variant}) -> {dir_name}/")
    print(f"{'='*50}")

    # Verify piper-en source exists
    if not PIPER_EN_DIR.exists():
        print(f"ERROR: Source directory not found: {PIPER_EN_DIR}")
        print("Make sure sherpa-onnx-tts-piper-en WASM package is downloaded.")
        sys.exit(1)

    # Create output directory
    output_dir.mkdir(parents=True, exist_ok=True)

    # Step 1: Download model
    tarball = download_model(SCRIPT_DIR, tarball_name, url)

    # Step 2: Extract model
    with tempfile.TemporaryDirectory() as tmpdir:
        model_dir = extract_model(tarball, Path(tmpdir), model_cfg["dir_hint"])

        # Step 2.5: Download and add vocoder if needed
        vocoder_name = model_cfg.get("vocoder")
        if vocoder_name:
            vocoder_url = VOCODER_BASE_URL + vocoder_name
            vocoder_cached = download_model(SCRIPT_DIR, vocoder_name, vocoder_url)
            vocoder_dest = model_dir / vocoder_name
            shutil.copy2(vocoder_cached, vocoder_dest)
            print(f"  Added vocoder: {vocoder_name}")

        # Step 3: Collect files
        files = collect_files(model_dir)
        print(f"  Collected {len(files)} files from model")
        for vpath, _ in files[:5]:
            print(f"    {vpath}")
        if len(files) > 5:
            print(f"    ... and {len(files) - 5} more")

        # Step 4: Build .data file
        data_path = output_dir / "sherpa-onnx-wasm-main-tts.data"
        metadata = build_data_file(files, data_path)

    # Step 5: Patch glue JS
    data_size = data_path.stat().st_size
    patch_glue_js(
        PIPER_EN_DIR / "sherpa-onnx-wasm-main-tts.js",
        output_dir / "sherpa-onnx-wasm-main-tts.js",
        metadata,
        data_size,
    )

    # Step 6: Copy shared files
    for filename in ["sherpa-onnx-wasm-main-tts.wasm", "sherpa-onnx-tts.js"]:
        src = PIPER_EN_DIR / filename
        dst = output_dir / filename
        shutil.copy2(src, dst)
        print(f"  Copied {filename}")

    print(f"  Done: {dir_name}/")


def _parse_arg(arg: str) -> list[tuple[str, list[str]]]:
    """
    Parse a CLI argument into a list of (model_name, [variants]).

    Examples:
        "piper-en-libritts_r-medium"       -> [("piper-en-libritts_r-medium", ["fp32", "fp16", "int8"])]  (all variants for Piper)
        "piper-en-libritts_r-medium:fp16"  -> [("piper-en-libritts_r-medium", ["fp16"])]
        "kitten"         -> [("kitten", ["fp32"])]                    (non-Piper, ignore variant)
        "kitten:int8"    -> [("kitten", ["fp32"])]                    (non-Piper, ignore variant)
        "all"            -> all models, all variants
        "all:int8"       -> all models, int8 only
    """
    if ":" in arg:
        name_part, variant_part = arg.split(":", 1)
        if variant_part not in VARIANTS:
            print(f"ERROR: Unknown variant '{variant_part}'. Available: {', '.join(ALL_VARIANTS)}")
            sys.exit(1)
        requested_variants = [variant_part]
    else:
        name_part = arg
        requested_variants = None  # means "all applicable"

    if name_part == "all":
        result = []
        for name, cfg in MODELS.items():
            available = _available_variants(cfg)
            if requested_variants:
                # Filter to only requested variants that are actually available
                variants = [v for v in requested_variants if v in available]
                if not variants:
                    print(f"  Skipping {name}: {requested_variants[0]} not available (only {', '.join(available)})")
                    continue
            else:
                variants = available
            result.append((name, variants))
        return result
    elif name_part in MODELS:
        cfg = MODELS[name_part]
        available = _available_variants(cfg)
        if requested_variants:
            variants = [v for v in requested_variants if v in available]
            if not variants:
                print(f"ERROR: {name_part} does not have variant '{requested_variants[0]}'. Available: {', '.join(available)}")
                sys.exit(1)
        else:
            variants = available
        return [(name_part, variants)]
    else:
        print(f"ERROR: Unknown model '{name_part}'. Available: {', '.join(MODELS.keys())}, all")
        sys.exit(1)


def main():
    arg = sys.argv[1] if len(sys.argv) > 1 else "all"
    jobs = _parse_arg(arg)
    is_all = arg.split(":")[0] == "all"
    skip_existing = is_all
    failed = []

    for name, variants in jobs:
        cfg = MODELS[name]
        for variant in variants:
            try:
                pack_model(name, cfg, variant, skip_existing=skip_existing)
            except urllib.error.HTTPError as e:
                if e.code == 404 and is_all:
                    print(f"  SKIP (404 not found): {name} ({variant})")
                    failed.append(f"{name}:{variant}")
                else:
                    raise

    if failed:
        print(f"\nSkipped {len(failed)} models due to 404:")
        for f in failed:
            print(f"  - {f}")

    print()
    print("To test:")
    print(f"  cd {SCRIPT_DIR}")
    print("  python3 -m http.server 8080")
    print("  Open http://localhost:8080/kitten.html")
    print("  Open http://localhost:8080/kokoro.html")
    print("  Open http://localhost:8080/matcha.html")
    print("  Open http://localhost:8080/zipvoice.html")
    print("  Open http://localhost:8080/pocket.html")

    # Show a few representative Coqui URLs
    coqui_keys = [k for k in MODELS if k.startswith("coqui-")]
    for key in coqui_keys[:3]:
        print(f"  Open http://localhost:8080/coqui.html?model={key}")
    if len(coqui_keys) > 3:
        print(f"  ... and {len(coqui_keys) - 3} more Coqui languages")

    # Show a few representative Mimic3 URLs
    mimic3_keys = [k for k in MODELS if k.startswith("mimic3-")]
    for key in mimic3_keys[:3]:
        print(f"  Open http://localhost:8080/mimic3.html?model={key}")
    if len(mimic3_keys) > 3:
        print(f"  ... and {len(mimic3_keys) - 3} more Mimic3 languages")

    # Show a few representative MMS URLs
    mms_keys = [k for k in MODELS if k.startswith("mms-")]
    for key in mms_keys[:3]:
        print(f"  Open http://localhost:8080/mms.html?model={key}")
    if len(mms_keys) > 3:
        print(f"  ... and {len(mms_keys) - 3} more MMS languages")

    # Show special VITS model URLs
    special_vits_keys = ["melo-tts-en", "melo-tts-zh-en", "cantonese", "icefall-en-ljspeech-low", "icefall-en-ljspeech-medium", "icefall-zh-aishell3", "zh-ll"]
    for key in special_vits_keys:
        if key in MODELS:
            print(f"  Open http://localhost:8080/vits.html?model={key}")

    # Show a few representative Piper URLs
    piper_keys = [k for k in MODELS if _is_piper(MODELS[k])]
    for key in piper_keys[:3]:
        print(f"  Open http://localhost:8080/piper.html?model={key}")
        print(f"  Open http://localhost:8080/piper.html?model={key}&precision=int8")
    if len(piper_keys) > 3:
        print(f"  ... and {len(piper_keys) - 3} more Piper languages")


if __name__ == "__main__":
    main()
