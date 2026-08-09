#!/bin/bash
# Acceptance test for sokuji-audio-host on macOS (issues #335, #393).
#
# Proves the four properties the per-application path rests on:
#   1. Continuity  - the stream flows at the right rate while the target is
#      silent, so nothing downstream has to fill gaps.
#   2. Late start  - an application that is not playing when the session starts
#      is still captured once it does. Its audio process objects do not exist
#      yet at that moment, and refusing to start on that basis refused most
#      applications most of the time.
#   3. Retargeting - when the target replaces the child that renders its audio -
#      what Chrome does with its audio.mojom.AudioService - capture follows it
#      instead of going permanently silent on a dead object.
#   4. Isolation   - a target that never plays yields silence while another
#      process is audibly playing, i.e. the tap did not widen to everything.
#
# The audio assertions need the "System Audio Recording Only" grant, which TCC
# attributes to the *responsible* process - here the terminal, not this script.
# Without it every sample is zero by design; the script detects that, keeps the
# structural assertions and skips the ones it cannot judge.
#
# Expected output ends with VERIFY OK.
set -uo pipefail
cd "$(dirname "$0")"

BIN=${1:-out/sokuji-audio-host-darwin-arm64}
[ -x "$BIN" ] || { echo "not built: $BIN (run mac/build.sh)"; exit 1; }

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
TONE=$WORK/tone.wav

# 440 Hz at amplitude 12000, 44.1 kHz mono - deliberately NOT the 24 kHz capture
# rate, so a pass also proves the helper's resampling ratio is right.
python3 - "$TONE" <<'PY'
import math, struct, sys, wave
w = wave.open(sys.argv[1], 'w')
w.setnchannels(1); w.setsampwidth(2); w.setframerate(44100)
w.writeframes(b''.join(struct.pack('<h', int(12000 * math.sin(2 * math.pi * 440 * t / 44100)))
                      for t in range(44100 * 4)))
w.close()
PY

fails=0
check() {  # check <description> <condition-exit-status>
  if [ "$2" -eq 0 ]; then echo "  ok   - $1"; else echo "  FAIL - $1"; fails=$((fails + 1)); fi
}

# peaks <pcm> -> one peak amplitude per second of 24 kHz mono s16, plus duration
peaks() {
  python3 - "$1" <<'PY'
import struct, sys
d = open(sys.argv[1], 'rb').read()
s = struct.unpack('<%dh' % (len(d) // 2), d[:len(d) // 2 * 2])
print('%.2f' % (len(s) / 24000.0))
print(' '.join(str(max((abs(x) for x in s[i*24000:(i+1)*24000]), default=0))
               for i in range(int(len(s) / 24000))))
PY
}

# capture <pcm-out> <log-out> <target> <seconds>
capture() {
  "$BIN" --target "$3" > "$1" 2> "$2" &
  local h=$!
  sleep "$4"
  kill -TERM $h 2>/dev/null
  wait $h 2>/dev/null
}

echo "== sokuji-audio-host verify ($BIN) =="

# Is the grant present? A global tap over a tone answers that in one shot, and
# whether the helper resamples correctly at all.
( sleep 1; afplay "$TONE" ) &
capture "$WORK/g.pcm" "$WORK/g.log" system 6
wait 2>/dev/null
read -r GDUR <<< "$(peaks "$WORK/g.pcm" | head -1)"
GPEAK=$(peaks "$WORK/g.pcm" | tail -1 | tr ' ' '\n' | sort -n | tail -1)
GRANTED=$([ "${GPEAK:-0}" -gt 1000 ] && echo yes || echo no)
echo "global tap: ${GDUR}s captured, peak ${GPEAK:-0}, grant=$GRANTED"
if [ "$GRANTED" = no ]; then
  echo "  NOTE: no System Audio Recording grant for this terminal - audio-content"
  echo "        assertions are skipped. Structural ones still apply."
fi

# 1 + 2. Target owns no audio object at capture start, plays three seconds in.
echo "-- idle at start, plays later --"
bash -c 'sleep 3; afplay "$0"' "$TONE" &
T=$!
capture "$WORK/a.pcm" "$WORK/a.log" "pid:$T" 8
kill $T 2>/dev/null; wait 2>/dev/null
ADUR=$(peaks "$WORK/a.pcm" | head -1)
APEAKS=$(peaks "$WORK/a.pcm" | tail -1)
echo "  ${ADUR}s captured, per-second peaks: $APEAKS"
grep -q no_such_audio_process "$WORK/a.log"; check "starts on an idle target" $((1 - $?))
grep -q '"event":"format"' "$WORK/a.log"; check "announces its format" $?
awk -v d="$ADUR" 'BEGIN { exit !(d > 6.5) }'; check "stream never stalls (>6.5s in 8s)" $?
if [ "$GRANTED" = yes ]; then
  echo "$APEAKS" | awk '{ exit !($1 == 0 && $NF > 1000) }'
  check "silent before playback, audible after" $?
fi

# 3. The child holding the audio is replaced while capture is running.
echo "-- audio child replaced mid-capture --"
bash -c 'afplay "$0"; afplay "$0"' "$TONE" &
T=$!
sleep 0.5
capture "$WORK/b.pcm" "$WORK/b.log" "pid:$T" 8
kill $T 2>/dev/null; wait 2>/dev/null
BPEAKS=$(peaks "$WORK/b.pcm" | tail -1)
echo "  per-second peaks: $BPEAKS"
if [ "$GRANTED" = yes ]; then
  echo "$BPEAKS" | awk '{ for (i = 1; i <= NF; i++) if ($i < 1000) exit 1; exit 0 }'
  check "audio survives the target's audio child being replaced" $?
fi

# 4. A target that never plays must not pick up the tone another process plays.
echo "-- isolation --"
bash -c 'sleep 30' &
T=$!
( sleep 1; afplay "$TONE" ) &
capture "$WORK/c.pcm" "$WORK/c.log" "pid:$T" 6
kill $T 2>/dev/null; wait 2>/dev/null
CPEAK=$(peaks "$WORK/c.pcm" | tail -1 | tr ' ' '\n' | sort -n | tail -1)
echo "  peak from a silent target while another process plays: ${CPEAK:-0}"
[ "${CPEAK:-0}" -lt 100 ]; check "a silent target does not capture other applications" $?

echo
if [ "$fails" -eq 0 ]; then echo "VERIFY OK"; else echo "VERIFY FAILED ($fails)"; exit 1; fi
