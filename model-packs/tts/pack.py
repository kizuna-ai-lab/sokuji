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
    python3 pack.py piper-en          # both variants (fp32, int8)
    python3 pack.py piper-en:int8     # int8 only
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
    "matcha-en": {
        "url": BASE_URL + "matcha-icefall-en_US-ljspeech.tar.bz2",
        "tarball": "matcha-icefall-en_US-ljspeech.tar.bz2",
        "dir_hint": "matcha",
        "vocoder": "vocos-22khz-univ.onnx",
    },
    "matcha-zh": {
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
    # --- Coqui VITS models: character-level tokenization, no espeak-ng (except en-vctk) ---
    "coqui-bg": {"url": BASE_URL + "vits-coqui-bg-cv.tar.bz2", "tarball": "vits-coqui-bg-cv.tar.bz2", "dir_hint": "coqui"},
    "coqui-bn": {"url": BASE_URL + "vits-coqui-bn-custom_female.tar.bz2", "tarball": "vits-coqui-bn-custom_female.tar.bz2", "dir_hint": "coqui"},
    "coqui-cs": {"url": BASE_URL + "vits-coqui-cs-cv.tar.bz2", "tarball": "vits-coqui-cs-cv.tar.bz2", "dir_hint": "coqui"},
    "coqui-da": {"url": BASE_URL + "vits-coqui-da-cv.tar.bz2", "tarball": "vits-coqui-da-cv.tar.bz2", "dir_hint": "coqui"},
    "coqui-de": {"url": BASE_URL + "vits-coqui-de-css10.tar.bz2", "tarball": "vits-coqui-de-css10.tar.bz2", "dir_hint": "coqui"},
    "coqui-en": {"url": BASE_URL + "vits-coqui-en-ljspeech.tar.bz2", "tarball": "vits-coqui-en-ljspeech.tar.bz2", "dir_hint": "coqui"},
    "coqui-en-neon": {"url": BASE_URL + "vits-coqui-en-ljspeech-neon.tar.bz2", "tarball": "vits-coqui-en-ljspeech-neon.tar.bz2", "dir_hint": "coqui"},
    "coqui-en-vctk": {"url": BASE_URL + "vits-coqui-en-vctk.tar.bz2", "tarball": "vits-coqui-en-vctk.tar.bz2", "dir_hint": "coqui"},
    "coqui-es": {"url": BASE_URL + "vits-coqui-es-css10.tar.bz2", "tarball": "vits-coqui-es-css10.tar.bz2", "dir_hint": "coqui"},
    "coqui-et": {"url": BASE_URL + "vits-coqui-et-cv.tar.bz2", "tarball": "vits-coqui-et-cv.tar.bz2", "dir_hint": "coqui"},
    "coqui-fi": {"url": BASE_URL + "vits-coqui-fi-css10.tar.bz2", "tarball": "vits-coqui-fi-css10.tar.bz2", "dir_hint": "coqui"},
    "coqui-fr": {"url": BASE_URL + "vits-coqui-fr-css10.tar.bz2", "tarball": "vits-coqui-fr-css10.tar.bz2", "dir_hint": "coqui"},
    "coqui-ga": {"url": BASE_URL + "vits-coqui-ga-cv.tar.bz2", "tarball": "vits-coqui-ga-cv.tar.bz2", "dir_hint": "coqui"},
    "coqui-hr": {"url": BASE_URL + "vits-coqui-hr-cv.tar.bz2", "tarball": "vits-coqui-hr-cv.tar.bz2", "dir_hint": "coqui"},
    "coqui-lt": {"url": BASE_URL + "vits-coqui-lt-cv.tar.bz2", "tarball": "vits-coqui-lt-cv.tar.bz2", "dir_hint": "coqui"},
    "coqui-lv": {"url": BASE_URL + "vits-coqui-lv-cv.tar.bz2", "tarball": "vits-coqui-lv-cv.tar.bz2", "dir_hint": "coqui"},
    "coqui-mt": {"url": BASE_URL + "vits-coqui-mt-cv.tar.bz2", "tarball": "vits-coqui-mt-cv.tar.bz2", "dir_hint": "coqui"},
    "coqui-nl": {"url": BASE_URL + "vits-coqui-nl-css10.tar.bz2", "tarball": "vits-coqui-nl-css10.tar.bz2", "dir_hint": "coqui"},
    "coqui-pl": {"url": BASE_URL + "vits-coqui-pl-mai_female.tar.bz2", "tarball": "vits-coqui-pl-mai_female.tar.bz2", "dir_hint": "coqui"},
    "coqui-pt": {"url": BASE_URL + "vits-coqui-pt-cv.tar.bz2", "tarball": "vits-coqui-pt-cv.tar.bz2", "dir_hint": "coqui"},
    "coqui-ro": {"url": BASE_URL + "vits-coqui-ro-cv.tar.bz2", "tarball": "vits-coqui-ro-cv.tar.bz2", "dir_hint": "coqui"},
    "coqui-sk": {"url": BASE_URL + "vits-coqui-sk-cv.tar.bz2", "tarball": "vits-coqui-sk-cv.tar.bz2", "dir_hint": "coqui"},
    "coqui-sl": {"url": BASE_URL + "vits-coqui-sl-cv.tar.bz2", "tarball": "vits-coqui-sl-cv.tar.bz2", "dir_hint": "coqui"},
    "coqui-sv": {"url": BASE_URL + "vits-coqui-sv-cv.tar.bz2", "tarball": "vits-coqui-sv-cv.tar.bz2", "dir_hint": "coqui"},
    "coqui-uk": {"url": BASE_URL + "vits-coqui-uk-mai.tar.bz2", "tarball": "vits-coqui-uk-mai.tar.bz2", "dir_hint": "coqui"},
    # --- Mimic3 VITS models: IPA tokenization, espeak-ng-data ALWAYS required ---
    "mimic3-af": {"url": BASE_URL + "vits-mimic3-af_ZA-google-nwu_low.tar.bz2", "tarball": "vits-mimic3-af_ZA-google-nwu_low.tar.bz2", "dir_hint": "mimic3"},
    "mimic3-bn": {"url": BASE_URL + "vits-mimic3-bn-multi_low.tar.bz2", "tarball": "vits-mimic3-bn-multi_low.tar.bz2", "dir_hint": "mimic3"},
    "mimic3-el": {"url": BASE_URL + "vits-mimic3-el_GR-rapunzelina_low.tar.bz2", "tarball": "vits-mimic3-el_GR-rapunzelina_low.tar.bz2", "dir_hint": "mimic3"},
    "mimic3-es": {"url": BASE_URL + "vits-mimic3-es_ES-m-ailabs_low.tar.bz2", "tarball": "vits-mimic3-es_ES-m-ailabs_low.tar.bz2", "dir_hint": "mimic3"},
    "mimic3-fa": {"url": BASE_URL + "vits-mimic3-fa-haaniye_low.tar.bz2", "tarball": "vits-mimic3-fa-haaniye_low.tar.bz2", "dir_hint": "mimic3"},
    "mimic3-fi": {"url": BASE_URL + "vits-mimic3-fi_FI-harri-tapani-ylilammi_low.tar.bz2", "tarball": "vits-mimic3-fi_FI-harri-tapani-ylilammi_low.tar.bz2", "dir_hint": "mimic3"},
    "mimic3-gu": {"url": BASE_URL + "vits-mimic3-gu_IN-cmu-indic_low.tar.bz2", "tarball": "vits-mimic3-gu_IN-cmu-indic_low.tar.bz2", "dir_hint": "mimic3"},
    "mimic3-hu": {"url": BASE_URL + "vits-mimic3-hu_HU-diana-majlinger_low.tar.bz2", "tarball": "vits-mimic3-hu_HU-diana-majlinger_low.tar.bz2", "dir_hint": "mimic3"},
    "mimic3-ko": {"url": BASE_URL + "vits-mimic3-ko_KO-kss_low.tar.bz2", "tarball": "vits-mimic3-ko_KO-kss_low.tar.bz2", "dir_hint": "mimic3"},
    "mimic3-ne": {"url": BASE_URL + "vits-mimic3-ne_NP-ne-google_low.tar.bz2", "tarball": "vits-mimic3-ne_NP-ne-google_low.tar.bz2", "dir_hint": "mimic3"},
    "mimic3-pl": {"url": BASE_URL + "vits-mimic3-pl_PL-m-ailabs_low.tar.bz2", "tarball": "vits-mimic3-pl_PL-m-ailabs_low.tar.bz2", "dir_hint": "mimic3"},
    "mimic3-tn": {"url": BASE_URL + "vits-mimic3-tn_ZA-google-nwu_low.tar.bz2", "tarball": "vits-mimic3-tn_ZA-google-nwu_low.tar.bz2", "dir_hint": "mimic3"},
    "mimic3-vi": {"url": BASE_URL + "vits-mimic3-vi_VN-vais1000_low.tar.bz2", "tarball": "vits-mimic3-vi_VN-vais1000_low.tar.bz2", "dir_hint": "mimic3"},
    # --- MeloTTS VITS models: lexicon-based, optional dict+ruleFsts for Chinese ---
    "melo-tts-en": {"url": BASE_URL + "vits-melo-tts-en.tar.bz2", "tarball": "vits-melo-tts-en.tar.bz2", "dir_hint": "melo"},
    "melo-tts-zh-en": {"url": BASE_URL + "vits-melo-tts-zh_en.tar.bz2", "tarball": "vits-melo-tts-zh_en.tar.bz2", "dir_hint": "melo"},
    # --- Cantonese VITS model: lexicon + rule.fst ---
    "cantonese": {"url": BASE_URL + "vits-cantonese-hf-xiaomaiiwn.tar.bz2", "tarball": "vits-cantonese-hf-xiaomaiiwn.tar.bz2", "dir_hint": "cantonese"},
    # --- Icefall VITS models: lexicon + ruleFsts/ruleFars ---
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
    "piper-en": {
        "base_tarball": "vits-piper-en_US-libritts_r-medium",
        "dir_hint": "piper",
    },
    "piper-zh": {
        "base_tarball": "vits-piper-zh_CN-huayan-medium",
        "dir_hint": "piper",
        "variants": ["fp32"],
    },
    "piper-de": {
        "base_tarball": "vits-piper-de_DE-thorsten_emotional-medium",
        "dir_hint": "piper",
    },
    "piper-ar": {
        "base_tarball": "vits-piper-ar_JO-kareem-medium",
        "dir_hint": "piper",
    },
    "piper-ca": {
        "base_tarball": "vits-piper-ca_ES-upc_ona-medium",
        "dir_hint": "piper",
    },
    "piper-cs": {
        "base_tarball": "vits-piper-cs_CZ-jirka-medium",
        "dir_hint": "piper",
    },
    "piper-cy": {
        "base_tarball": "vits-piper-cy_GB-gwryw_gogleddol-medium",
        "dir_hint": "piper",
    },
    "piper-da": {
        "base_tarball": "vits-piper-da_DK-talesyntese-medium",
        "dir_hint": "piper",
    },
    "piper-el": {
        "base_tarball": "vits-piper-el_GR-rapunzelina-low",
        "dir_hint": "piper",
    },
    "piper-en-gb": {
        "base_tarball": "vits-piper-en_GB-northern_english_male-medium",
        "dir_hint": "piper",
    },
    "piper-es": {
        "base_tarball": "vits-piper-es_ES-davefx-medium",
        "dir_hint": "piper",
    },
    "piper-es-ar": {
        "base_tarball": "vits-piper-es_AR-daniela-high",
        "dir_hint": "piper",
    },
    "piper-es-mx": {
        "base_tarball": "vits-piper-es_MX-ald-medium",
        "dir_hint": "piper",
    },
    "piper-fa": {
        "base_tarball": "vits-piper-fa_IR-amir-medium",
        "dir_hint": "piper",
    },
    "piper-fa-en": {
        "base_tarball": "vits-piper-fa_en-rezahedayatfar-ibrahimwalk-medium",
        "dir_hint": "piper",
        "variants": ["fp32"],
    },
    "piper-fi": {
        "base_tarball": "vits-piper-fi_FI-harri-medium",
        "dir_hint": "piper",
    },
    "piper-fr": {
        "base_tarball": "vits-piper-fr_FR-tom-medium",
        "dir_hint": "piper",
    },
    "piper-hi": {
        "base_tarball": "vits-piper-hi_IN-rohan-medium",
        "dir_hint": "piper",
    },
    "piper-hu": {
        "base_tarball": "vits-piper-hu_HU-anna-medium",
        "dir_hint": "piper",
    },
    "piper-id": {
        "base_tarball": "vits-piper-id_ID-news_tts-medium",
        "dir_hint": "piper",
    },
    "piper-is": {
        "base_tarball": "vits-piper-is_IS-bui-medium",
        "dir_hint": "piper",
    },
    "piper-it": {
        "base_tarball": "vits-piper-it_IT-paola-medium",
        "dir_hint": "piper",
    },
    "piper-ka": {
        "base_tarball": "vits-piper-ka_GE-natia-medium",
        "dir_hint": "piper",
    },
    "piper-kk": {
        "base_tarball": "vits-piper-kk_KZ-issai-high",
        "dir_hint": "piper",
    },
    "piper-lb": {
        "base_tarball": "vits-piper-lb_LU-marylux-medium",
        "dir_hint": "piper",
    },
    "piper-lv": {
        "base_tarball": "vits-piper-lv_LV-aivars-medium",
        "dir_hint": "piper",
    },
    "piper-ml": {
        "base_tarball": "vits-piper-ml_IN-meera-medium",
        "dir_hint": "piper",
    },
    "piper-ne": {
        "base_tarball": "vits-piper-ne_NP-chitwan-medium",
        "dir_hint": "piper",
    },
    "piper-nl": {
        "base_tarball": "vits-piper-nl_NL-ronnie-medium",
        "dir_hint": "piper",
    },
    "piper-nl-be": {
        "base_tarball": "vits-piper-nl_BE-rdh-medium",
        "dir_hint": "piper",
        "variants": ["fp32"],
    },
    "piper-no": {
        "base_tarball": "vits-piper-no_NO-talesyntese-medium",
        "dir_hint": "piper",
    },
    "piper-pl": {
        "base_tarball": "vits-piper-pl_PL-darkman-medium",
        "dir_hint": "piper",
    },
    "piper-pt": {
        "base_tarball": "vits-piper-pt_PT-tugao-medium",
        "dir_hint": "piper",
    },
    "piper-pt-br": {
        "base_tarball": "vits-piper-pt_BR-faber-medium",
        "dir_hint": "piper",
    },
    "piper-ro": {
        "base_tarball": "vits-piper-ro_RO-mihai-medium",
        "dir_hint": "piper",
        "variants": ["fp32"],
    },
    "piper-ru": {
        "base_tarball": "vits-piper-ru_RU-irina-medium",
        "dir_hint": "piper",
    },
    "piper-sk": {
        "base_tarball": "vits-piper-sk_SK-lili-medium",
        "dir_hint": "piper",
    },
    "piper-sl": {
        "base_tarball": "vits-piper-sl_SI-artur-medium",
        "dir_hint": "piper",
    },
    "piper-sr": {
        "base_tarball": "vits-piper-sr_RS-serbski_institut-medium",
        "dir_hint": "piper",
    },
    "piper-sv": {
        "base_tarball": "vits-piper-sv_SE-nst-medium",
        "dir_hint": "piper",
    },
    "piper-sw": {
        "base_tarball": "vits-piper-sw_CD-lanfrica-medium",
        "dir_hint": "piper",
    },
    "piper-tr": {
        "base_tarball": "vits-piper-tr_TR-fettah-medium",
        "dir_hint": "piper",
    },
    "piper-uk": {
        "base_tarball": "vits-piper-uk_UA-ukrainian_tts-medium",
        "dir_hint": "piper",
    },
    "piper-vi": {
        "base_tarball": "vits-piper-vi_VN-vais1000-medium",
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

    # 4. Replace loadPackage({...}) metadata
    lp_start = content.find("loadPackage({")
    if lp_start == -1:
        raise RuntimeError("Could not find loadPackage({ in glue JS")

    # Find the matching closing brace for the JSON object
    brace_start = lp_start + len("loadPackage(")
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

    # Replace: loadPackage({...old...}) -> loadPackage({...new...})
    content = content[:lp_start] + "loadPackage(" + new_json + ")" + content[close_paren + 1:]

    output_js_path.write_text(content)
    print(f"  Patched glue JS: {output_js_path.name}")


def pack_model(model_name: str, model_cfg: dict, variant: str):
    """Pack a single model variant into its own wasm-{name}[-{variant}]/ directory."""
    dir_name = _output_dir_name(model_name, variant)
    output_dir = SCRIPT_DIR / dir_name
    tarball_name, url = _resolve_tarball_and_url(model_cfg, variant)

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
        "piper-en"       -> [("piper-en", ["fp32", "fp16", "int8"])]  (all variants for Piper)
        "piper-en:fp16"  -> [("piper-en", ["fp16"])]
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

    for name, variants in jobs:
        cfg = MODELS[name]
        for variant in variants:
            pack_model(name, cfg, variant)

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
    special_vits_keys = ["melo-tts-en", "melo-tts-zh-en", "cantonese", "icefall-zh-aishell3", "zh-ll"]
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
