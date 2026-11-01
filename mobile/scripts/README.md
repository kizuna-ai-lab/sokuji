`build-apm-android.sh` rebuilds the prebuilt WebRTC libraries in `modules/audio-capture/android/libs`; it needs git, meson, ninja and the NDK.

`transcribe.mjs` sends recordings to Soniox, with the key from the file named by `SONIOX_API_KEY_FILE`, and `score.py` counts per playback window what was recognised against `reference-zh.txt`, the text the Mac reads.
