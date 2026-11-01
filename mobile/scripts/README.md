`build-apm-android.sh` rebuilds the WebRTC libraries; it needs git, meson, ninja and the NDK. Builds fetch them from the `webrtc-apm-v2.1` release (`fetchApm` in `modules/audio-capture/android/build.gradle`).

`transcribe.mjs` sends recordings to Soniox, with the key from the file named by `SONIOX_API_KEY_FILE`, and `score.py` counts per playback window what was recognised against `reference-zh.txt`, the text the Mac reads.
