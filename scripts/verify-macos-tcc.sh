#!/bin/bash
# Hardware test 1: does TCC keep a microphone grant across a rebuild signed
# with the SAME self-signed certificate?
#
# Two arms, separate bundle identifiers so they cannot contaminate each other:
#   selfsigned  - both builds signed with one self-signed cert  (expect: kept)
#   adhoc       - both builds ad-hoc signed                     (expect: lost)
#
# The measurement is the authorization status the SECOND build sees at launch:
#   0 notDetermined  -> TCC forgot it; macOS will prompt again
#   3 authorized     -> TCC kept the grant; no prompt at all
#
# Usage: tcc-test.sh <setup|swap|report|cleanup> <selfsigned|adhoc>

set -uo pipefail

MODE="${1:-}"; ARM="${2:-selfsigned}"
WORK="$HOME/.tcc-test-work"
LOG="$HOME/tcc-test-$ARM.log"
case "$ARM" in
  selfsigned) BID="ai.kizunaai.tcctest.selfsigned"; APPNAME="TCCSelfSigned" ;;
  adhoc)      BID="ai.kizunaai.tcctest.adhoc";      APPNAME="TCCAdhoc" ;;
  *) echo "arm must be selfsigned or adhoc" >&2; exit 1 ;;
esac
APP="/Applications/$APPNAME.app"
KC="$WORK/tcc.keychain"
KCP="tcc-test-pass"
CN="Sokuji TCC Test Cert"
# Populated only while the search list is mutated, so the trap can restore it.
ORIG_KEYCHAINS=()

ensure_cert() {
  [ -f "$WORK/cert.p12" ] && return 0
  mkdir -p "$WORK" || return 1

  # Resolve through PATH: the Homebrew prefix differs on Intel (/usr/local) and
  # is absent entirely on a machine without Homebrew, where the system LibreSSL
  # at /usr/bin/openssl does the job.
  local openssl
  openssl="$(command -v openssl)" || { echo "openssl not found on PATH" >&2; return 1; }

  "$openssl" req -x509 -newkey rsa:2048 -sha256 -days 7300 -nodes \
    -keyout "$WORK/key.pem" -out "$WORK/cert.pem" \
    -subj "/CN=$CN/O=Sokuji TCC Verify" \
    -addext "basicConstraints=critical,CA:false" \
    -addext "keyUsage=critical,digitalSignature" \
    -addext "extendedKeyUsage=critical,codeSigning" >/dev/null 2>&1 \
    || { echo "openssl could not create the certificate" >&2; return 1; }

  # -legacy is an OpenSSL 3 flag and the export fails without it there, because
  # macOS cannot import the AES-256/SHA-256 default. LibreSSL has no such flag
  # and already writes something importable, so fall back to a plain export.
  "$openssl" pkcs12 -export -legacy -out "$WORK/cert.p12" \
    -inkey "$WORK/key.pem" -in "$WORK/cert.pem" -passout "pass:$KCP" >/dev/null 2>&1 \
    || "$openssl" pkcs12 -export -out "$WORK/cert.p12" \
       -inkey "$WORK/key.pem" -in "$WORK/cert.pem" -passout "pass:$KCP" >/dev/null 2>&1 \
    || { echo "openssl could not export the PKCS#12 bundle" >&2; return 1; }
}

# Read the current search list into an array so that paths containing spaces
# survive; the obvious unquoted $(...) splat does not handle them.
read_keychains() {
  local line
  ORIG_KEYCHAINS=()
  while IFS= read -r line; do
    line="${line#"${line%%[![:space:]]*}"}"   # strip leading blanks
    line="${line%\"}"                          # strip trailing quote
    line="${line#\"}"                          # strip leading quote
    # Skip our own keychain: a previous run that died before its trap fired
    # could have left it there, and we would otherwise add it twice.
    [ -n "$line" ] && [ "$line" != "$KC" ] && ORIG_KEYCHAINS+=("$line")
  done < <(security list-keychains -d user)
}

restore_keychains() {
  if [ ${#ORIG_KEYCHAINS[@]} -gt 0 ]; then
    security list-keychains -d user -s "${ORIG_KEYCHAINS[@]}" 2>/dev/null
    ORIG_KEYCHAINS=()
  fi
}
trap restore_keychains EXIT

ensure_keychain() {
  # Create and populate only once; the certificate has to be the same across
  # both builds or the experiment measures nothing.
  if ! security find-certificate -c "$CN" "$KC" >/dev/null 2>&1; then
    security create-keychain -p "$KCP" "$KC" >/dev/null 2>&1 \
      || { echo "could not create $KC" >&2; return 1; }
    security unlock-keychain -p "$KCP" "$KC" >/dev/null 2>&1 \
      || { echo "could not unlock $KC" >&2; return 1; }
    security set-keychain-settings "$KC"
    security import "$WORK/cert.p12" -k "$KC" -P "$KCP" -A >/dev/null 2>&1 \
      || { echo "could not import the certificate into $KC" >&2; return 1; }
    security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KCP" "$KC" >/dev/null 2>&1
  else
    security unlock-keychain -p "$KCP" "$KC" >/dev/null 2>&1
  fi

  # Outside the branch above on purpose. The EXIT trap restores the search list
  # when the script ends, so a second `setup` run would otherwise sign against a
  # keychain that is no longer searchable. `codesign --keychain <kc>` alone does
  # NOT resolve an identity by common name -- it reports "no identity found" and
  # leaves the bundle ad-hoc signed, which is exactly the state this script
  # exists to tell apart from a real signature. Verified on macOS 26.6.1.
  read_keychains
  security list-keychains -d user -s "$KC" "${ORIG_KEYCHAINS[@]}"
}

build_app() { # $1 = dest .app, $2 = build tag (must differ between builds)
  local dest="$1" tag="$2"
  rm -rf "$dest"
  mkdir -p "$dest/Contents/MacOS" "$dest/Contents/Resources"

  cat > "$WORK/main.m" <<EOF
#import <Foundation/Foundation.h>
#import <AVFoundation/AVFoundation.h>

// Padding differs per build so the two bundles have different cdhashes.
static const char kBuildPadding[] = "$tag-------------------------------------------------";

int main(void) {
  @autoreleasepool {
    NSString *log = [NSString stringWithFormat:@"%@/tcc-test-$ARM.log", NSHomeDirectory()];
    AVAuthorizationStatus before =
        [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio];

    NSMutableString *line = [NSMutableString string];
    [line appendFormat:@"build=%s statusBefore=%ld (%s)\n",
        "$tag", (long)before,
        before == 0 ? "notDetermined" : before == 1 ? "restricted" :
        before == 2 ? "denied" : "AUTHORIZED"];

    __block BOOL granted = NO;
    dispatch_semaphore_t sem = dispatch_semaphore_create(0);
    [AVCaptureDevice requestAccessForMediaType:AVMediaTypeAudio
                             completionHandler:^(BOOL g) { granted = g; dispatch_semaphore_signal(sem); }];
    dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW, 180ull * NSEC_PER_SEC));

    AVAuthorizationStatus after =
        [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio];
    [line appendFormat:@"build=%s granted=%d statusAfter=%ld padding=%zu\n",
        "$tag", (int)granted, (long)after, sizeof(kBuildPadding)];

    NSFileHandle *fh = [NSFileHandle fileHandleForWritingAtPath:log];
    if (!fh) { [[NSFileManager defaultManager] createFileAtPath:log contents:nil attributes:nil];
               fh = [NSFileHandle fileHandleForWritingAtPath:log]; }
    [fh seekToEndOfFile];
    [fh writeData:[line dataUsingEncoding:NSUTF8StringEncoding]];
    [fh closeFile];
  }
  return 0;
}
EOF

  xcrun clang -fobjc-arc -o "$dest/Contents/MacOS/$APPNAME" "$WORK/main.m" \
    -framework Foundation -framework AVFoundation 2>&1 | head -5

  cat > "$dest/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key><string>$APPNAME</string>
  <key>CFBundleIdentifier</key><string>$BID</string>
  <key>CFBundleName</key><string>$APPNAME</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>NSMicrophoneUsageDescription</key><string>Sokuji TCC persistence test.</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
</dict></plist>
EOF
}

sign_app() { # $1 = .app
  if [ "$ARM" = "adhoc" ]; then
    codesign --force --sign - "$1" 2>&1 | sed 's/^/    /'
  else
    codesign --force --sign "$CN" --keychain "$KC" "$1" 2>&1 | sed 's/^/    /'
  fi
}

# Ad-hoc designated requirements are printed with a leading "# ", so match both.
show_dr() { codesign -d -r- "$1" 2>&1 | grep 'designated =>' | sed 's/^#* *designated => //'; }

case "$MODE" in
setup)
  # Stop here rather than build and "sign" against a certificate that was never
  # created -- that would silently produce ad-hoc bundles and quietly invalidate
  # the whole experiment.
  ensure_cert || { echo "certificate setup failed" >&2; exit 1; }
  ensure_keychain || { echo "keychain setup failed" >&2; exit 1; }
  rm -f "$LOG"
  echo "=== arm: $ARM   bundle id: $BID ==="
  build_app "$WORK/v1.app" "V1"
  build_app "$WORK/v2.app" "V2-different-code-entirely"
  sign_app "$WORK/v1.app"; sign_app "$WORK/v2.app"
  echo "  v1 DR: $(show_dr "$WORK/v1.app")"
  echo "  v2 DR: $(show_dr "$WORK/v2.app")"
  echo "  v1 cdhash: $(codesign -dv "$WORK/v1.app" 2>&1 | grep CandidateCDHash | head -1)"
  echo "  v2 cdhash: $(codesign -dv "$WORK/v2.app" 2>&1 | grep CandidateCDHash | head -1)"
  [ "$(show_dr "$WORK/v1.app")" = "$(show_dr "$WORK/v2.app")" ] \
    && echo "  => DRs match" || echo "  => DRs DIFFER"

  echo "--- clearing any previous TCC decision for $BID ---"
  tccutil reset Microphone "$BID" 2>&1 | sed 's/^/    /'

  rm -rf "$APP"; cp -R "$WORK/v1.app" "$APP"
  echo "--- installed v1 at $APP, launching ---"
  open -a "$APP" 2>&1 | sed 's/^/    /' || echo "    open failed — launch it by hand"
  echo
  echo ">>> A microphone permission dialog should appear. Click ALLOW. <<<"
  ;;

swap)
  echo "=== arm: $ARM — replacing with v2 and relaunching ==="
  rm -rf "$APP"; cp -R "$WORK/v2.app" "$APP"
  open -a "$APP" 2>&1 | sed 's/^/    /' || echo "    open failed — launch it by hand"
  sleep 6
  echo "--- log so far ---"
  cat "$LOG" 2>/dev/null | sed 's/^/    /'
  ;;

report)
  echo "=== $ARM log ==="
  cat "$LOG" 2>/dev/null | sed 's/^/    /' || echo "    (no log yet)"
  ;;

cleanup)
  rm -rf /Applications/TCCSelfSigned.app /Applications/TCCAdhoc.app
  tccutil reset Microphone ai.kizunaai.tcctest.selfsigned >/dev/null 2>&1
  tccutil reset Microphone ai.kizunaai.tcctest.adhoc >/dev/null 2>&1
  security delete-keychain "$KC" 2>/dev/null
  rm -rf "$WORK" "$HOME/tcc-test-selfsigned.log" "$HOME/tcc-test-adhoc.log"
  echo "cleaned up"
  ;;
*)
  echo "usage: $0 <setup|swap|report|cleanup> <selfsigned|adhoc>" >&2; exit 1 ;;
esac
