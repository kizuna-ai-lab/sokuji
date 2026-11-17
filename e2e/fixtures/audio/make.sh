#!/usr/bin/env bash
# Makes the import tests' short audio files from a recording already in the repository, so nothing new is spoken
# or synthesised. Needs GStreamer with its base, good and ugly plugins (lame, flac, opus, vpx).
# Made elsewhere, from the same repository recordings (no encoder for them here):
#   sample-aac.m4a, sample-alac.m4a  macOS afconvert from scripts/dev/wire-probe/assets/ja/door.wav
#   sample-ac3-5.1.ac3, sample-ac3-5.1.mp4  ffmpeg -i meeting.wav -t 4 \
#     -af "aresample=48000,pan=5.1|FL=c0|FR=c0|FC=c0|LFE=0.3*c0|BL=0.5*c0|BR=0.5*c0" -c:a ac3 -b:a 384k out.ac3 (and out.mp4)
set -euo pipefail
cd "$(dirname "$0")"
SRC=../../../scripts/dev/wire-probe/assets/ja/meeting.wav
from() { echo "filesrc location=$SRC ! wavparse ! audioconvert ! audioresample"; }

# PCM WAV at 22.05 kHz stereo: a rate and a channel count other than the source's.
gst-launch-1.0 -q $(from) ! audio/x-raw,rate=22050,channels=2 ! wavenc ! filesink location=sample.wav
gst-launch-1.0 -q $(from) ! audio/x-raw,rate=44100 ! lamemp3enc target=bitrate bitrate=64 ! id3v2mux ! filesink location=sample.mp3
gst-launch-1.0 -q $(from) ! flacenc ! filesink location=sample.flac
gst-launch-1.0 -q $(from) ! audio/x-raw,rate=48000 ! opusenc ! oggmux ! filesink location=sample.opus
# MP4 holding Opus (MP4 with AAC is the m4a made on macOS), and a WebM video file: a small test picture beside the
# sound, as long as the sound.
gst-launch-1.0 -q $(from) ! audio/x-raw,rate=48000 ! opusenc ! mp4mux ! filesink location=sample.mp4
gst-launch-1.0 -q -e $(from) ! audio/x-raw,rate=48000 ! opusenc ! queue ! mux. \
  videotestsrc num-buffers=75 ! video/x-raw,width=64,height=48,framerate=25/1 ! videoconvert ! vp8enc deadline=1 ! queue ! mux. \
  webmmux name=mux ! filesink location=sample.webm
