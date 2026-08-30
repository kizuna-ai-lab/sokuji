#!/bin/bash
# Hardware test: does the Hardened Runtime deny the microphone with no prompt
# unless com.apple.security.device.audio-input is present? (#458)
#
# Two arms, same code, same signature type, both signed with --options runtime:
#   noent : electron-builder's default entitlements (what v0.39.1 shipped with)
#   ent   : the same three plus com.apple.security.device.audio-input (the fix)
#
# Each arm is launched through LaunchServices (`open`), the same path as a
# Finder launch, and writes the AVFoundation authorization status before and
# after requestAccess to its own log. Measured on macOS 26.6.1 (arm64),
# 2026-08-31, ad-hoc identity:
#   noent : "request returned after 0.00s granted=0 after=2 (denied)", no dialog;
#           tccd: "Prompting policy for hardened runtime; service:
#           kTCCServiceMicrophone requires entitlement
#           com.apple.security.device.audio-input but it is missing ...
#           Policy disallows prompt ... access to kTCCServiceMicrophone denied"
#   ent   : the system dialog appears (tccd: AUTHREQ_PROMPTING,
#           service=kTCCServiceMicrophone) and requestAccess blocks on it.
#
# The identity is irrelevant to the entitlement check, so ad-hoc ("-") is the
# default: it needs no keychain, which an ssh session cannot unlock anyway.
# Pass IDENTITY="Some Cert" to sign with a real one.
#
#   bash scripts/verify-macos-hardened-mic.sh
#
# Needs the Xcode command line tools (clang). Leaves nothing behind except the
# work directory it names at the end.
set -uo pipefail

IDENTITY="${IDENTITY:--}"
WORK="$HOME/.hardened-mic-ab"
WAIT="${WAIT:-8}"
rm -rf "$WORK"; mkdir -p "$WORK"

write_entitlements() { # $1 = path, $2 = with-audio-input (0/1)
  {
    echo '<?xml version="1.0" encoding="UTF-8"?>'
    echo '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">'
    echo '<plist version="1.0"><dict>'
    echo '  <key>com.apple.security.cs.allow-jit</key><true/>'
    echo '  <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>'
    echo '  <key>com.apple.security.cs.disable-library-validation</key><true/>'
    [ "$2" = 1 ] && echo '  <key>com.apple.security.device.audio-input</key><true/>'
    echo '</dict></plist>'
  } > "$1"
}

build_app() { # $1 = arm
  local arm="$1" app="$WORK/HRTest-$1.app" bid="ai.kizunaai.hrtest.$1" name="HRTest-$1"
  mkdir -p "$app/Contents/MacOS"
  cat > "$WORK/main-$arm.m" <<EOF
#import <Foundation/Foundation.h>
#import <AVFoundation/AVFoundation.h>
static const char *label(long s) {
  return s == 0 ? "notDetermined" : s == 1 ? "restricted" : s == 2 ? "denied" : "authorized";
}
static void append(NSString *log, NSString *line) {
  NSFileHandle *fh = [NSFileHandle fileHandleForWritingAtPath:log];
  if (!fh) { [[NSFileManager defaultManager] createFileAtPath:log contents:nil attributes:nil];
             fh = [NSFileHandle fileHandleForWritingAtPath:log]; }
  [fh seekToEndOfFile];
  [fh writeData:[line dataUsingEncoding:NSUTF8StringEncoding]];
  [fh closeFile];
}
int main(void) {
  @autoreleasepool {
    NSString *log = @"$WORK/$arm.log";
    long before = [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio];
    append(log, [NSString stringWithFormat:@"before=%ld (%s)\n", before, label(before)]);
    NSDate *t0 = [NSDate date];
    __block BOOL granted = NO;
    dispatch_semaphore_t sem = dispatch_semaphore_create(0);
    [AVCaptureDevice requestAccessForMediaType:AVMediaTypeAudio
                             completionHandler:^(BOOL g) { granted = g; dispatch_semaphore_signal(sem); }];
    long rc = dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW, 600ull * NSEC_PER_SEC));
    long after = [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio];
    append(log, [NSString stringWithFormat:@"request %s after %.2fs granted=%d after=%ld (%s)\n",
                 rc == 0 ? "returned" : "TIMED OUT", -[t0 timeIntervalSinceNow], (int)granted, after, label(after)]);
  }
  return 0;
}
EOF
  xcrun clang -fobjc-arc -o "$app/Contents/MacOS/$name" "$WORK/main-$arm.m" \
    -framework Foundation -framework AVFoundation || return 1
  cat > "$app/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key><string>$name</string>
  <key>CFBundleIdentifier</key><string>$bid</string>
  <key>CFBundleName</key><string>$name</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>NSMicrophoneUsageDescription</key><string>Sokuji #458 hardened-runtime A/B ($arm).</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
</dict></plist>
EOF
}

run_arm() { # $1 = arm, $2 = with-audio-input
  local arm="$1" app="$WORK/HRTest-$1.app" bid="ai.kizunaai.hrtest.$1"
  echo "=== arm: $arm ==="
  build_app "$arm" || { echo "build failed"; return 1; }
  write_entitlements "$WORK/$arm.entitlements.plist" "$2"
  codesign --force --options runtime --entitlements "$WORK/$arm.entitlements.plist" \
    --sign "$IDENTITY" "$app" 2>&1 | sed 's/^/  codesign: /'
  echo "  signature: $(codesign -dv "$app" 2>&1 | grep -E '^CodeDirectory' | head -1)"
  echo "  entitlements: $(codesign -d --entitlements - "$app" 2>/dev/null | grep '\[Key\]' | sed 's/.*\[Key\] //' | tr '\n' ' ')"
  # "No such bundle identifier" here just means TCC has never seen this arm.
  tccutil reset Microphone "$bid" 2>&1 | sed 's/^/  tccutil: /'
  rm -f "$WORK/$arm.log"
  open -a "$app" || { echo "  open failed"; return 1; }
  sleep "$WAIT"
  echo "  --- $arm.log after ${WAIT}s ---"
  sed 's/^/    /' "$WORK/$arm.log" 2>/dev/null || echo "    (no log written yet)"
  echo "  --- process still running? ---"
  pgrep -fl "HRTest-$arm" | sed 's/^/    /' || echo "    (exited)"
}

run_arm noent 0
run_arm ent 1

echo
echo "=== tccd log (last 2 minutes, hrtest only) ==="
log show --last 2m --predicate 'process == "tccd"' --style compact 2>/dev/null \
  | grep -i "hrtest" | grep -i "PROMPTING\|disallows\|requires entitlement\|denied" | cut -c1-220 | tail -6 | sed 's/^/  /'

echo
echo "=== leaving the 'ent' dialog on screen for 60s so it can be answered, then cleaning up ==="
sleep 60
sed 's/^/  ent.log final: /' "$WORK/ent.log" 2>/dev/null
pkill -f "HRTest-ent" 2>/dev/null
pkill -f "HRTest-noent" 2>/dev/null
tccutil reset Microphone ai.kizunaai.hrtest.noent >/dev/null 2>&1
tccutil reset Microphone ai.kizunaai.hrtest.ent >/dev/null 2>&1
echo "done (work dir kept at $WORK)"
