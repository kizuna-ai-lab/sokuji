#!/usr/bin/env bash
# The models test_ops_coverage re-records from (native/README.md's cache layout).
C=${SOKUJI_NATIVE_TEST_CACHE:-$HOME/.cache/sokuji-native-tests}
export SK_TEST_ASR_GGUF=$C/whisper-tiny-Q8_0.gguf
export SK_TEST_ASR_STREAM_GGUF=$C/moonshine-streaming-tiny-Q8_0.gguf
export SK_TEST_TRANSLATE_GGUF=$C/Qwen3-0.6B-Q8_0.gguf
export SK_TEST_TTS_MOSS_DIR=$C/tts/moss-tts-nano
export SK_TEST_TTS_SUPERTONIC_DIR=$C/tts/supertonic-3
export SK_TEST_TTS_QWEN3_DIR=$C/tts/qwen3-tts-0.6b
export SK_TEST_TTS_OMNIVOICE_DIR=$C/tts/omnivoice-0.6b
export SK_TEST_TTS_POCKET_DIR=$C/tts/pocket-tts-en
export SK_TEST_TTS_VOXCPM1_DIR=$C/tts/voxcpm1-0.5b
export SK_TEST_TTS_VOXCPM2_DIR=$C/tts/voxcpm2
export SK_TEST_TTS_IRODORI_DIR=$C/tts/irodori-tts-v4-small
export SK_TEST_TTS_INDEX_DIR=$C/tts/index-tts2.5
exec "$@"
