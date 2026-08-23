#!/bin/bash
# Verify the assumptions behind the self-signed auto-update plan.
# See docs/build/macos-auto-update.md — this script covers hardware tests 2-6.
# Test 1 (does TCC keep the microphone grant?) needs a GUI click and is not here.
#
# Safe to run on a dev Mac or a CI runner. Creates only temp files plus one
# throwaway directory in /Applications, which it removes again.
#
#   bash scripts/verify-macos-selfsigned.sh

set -uo pipefail

if [ "$(uname)" != "Darwin" ]; then
  echo "This script only runs on macOS." >&2
  exit 1
fi

WORK="$(mktemp -d)"
KEYCHAIN="$WORK/verify.keychain"
KC_PASS="verify-$$"
CERT_CN="Sokuji Self-Signed Test"
PASS=0
FAIL=0

cleanup() {
  security delete-keychain "$KEYCHAIN" 2>/dev/null
  sudo rm -rf "/Applications/.sokuji-verify-$$" 2>/dev/null
  rm -rf "$WORK"
}
trap cleanup EXIT

ok()   { echo "  PASS  $1"; PASS=$((PASS+1)); }
bad()  { echo "  FAIL  $1"; FAIL=$((FAIL+1)); }
note() { echo "        $1"; }

echo "=== macOS $(sw_vers -productVersion) ($(uname -m)) ==="
echo

# ---------------------------------------------------------------------------
# Test 5: can a self-signed cert be created and seen as a valid codesigning
#         identity in a fresh keychain, WITHOUT add-trusted-cert?
#         electron-builder's createKeychain() only does `security import`.
# ---------------------------------------------------------------------------
echo "[5] self-signed identity in a fresh keychain"

openssl req -x509 -newkey rsa:2048 -sha256 -days 7300 -nodes \
  -keyout "$WORK/key.pem" -out "$WORK/cert.pem" \
  -subj "/CN=$CERT_CN/O=Sokuji Verify" \
  -addext "basicConstraints=critical,CA:false" \
  -addext "keyUsage=critical,digitalSignature" \
  -addext "extendedKeyUsage=critical,codeSigning" >/dev/null 2>&1 \
  || { bad "openssl could not create the certificate"; exit 1; }

openssl pkcs12 -export -out "$WORK/cert.p12" -inkey "$WORK/key.pem" \
  -in "$WORK/cert.pem" -passout "pass:$KC_PASS" >/dev/null 2>&1

security create-keychain -p "$KC_PASS" "$KEYCHAIN" >/dev/null
security unlock-keychain -p "$KC_PASS" "$KEYCHAIN" >/dev/null
security set-keychain-settings "$KEYCHAIN"
security list-keychains -d user -s "$KEYCHAIN" $(security list-keychains -d user | tr -d '"')
security import "$WORK/cert.p12" -k "$KEYCHAIN" -P "$KC_PASS" \
  -T /usr/bin/codesign -T /usr/bin/productbuild >/dev/null 2>&1
security set-key-partition-list -S apple-tool:,apple: -s -k "$KC_PASS" "$KEYCHAIN" >/dev/null 2>&1

if security find-identity -v -p codesigning "$KEYCHAIN" | grep -q "$CERT_CN"; then
  ok "listed as a VALID codesigning identity (no add-trusted-cert needed)"
else
  bad "not listed by 'find-identity -v' — CI must run add-trusted-cert"
  note "retrying with an explicit trust setting..."
  sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "$WORK/cert.pem" 2>/dev/null
  if security find-identity -v -p codesigning "$KEYCHAIN" | grep -q "$CERT_CN"; then
    note "add-trusted-cert fixes it — add that step to CI"
  else
    note "still not valid; investigate before relying on Option S"
  fi
fi
echo

# ---------------------------------------------------------------------------
# Tests 3 + 6: is the designated requirement stable across two DIFFERENT
#              builds signed with the same cert, and does build B satisfy the
#              DR captured from build A? That is exactly what Squirrel.Mac does.
# ---------------------------------------------------------------------------
echo "[3] designated requirement stability (the core of the plan)"

make_app() { # $1 = path, $2 = distinguishing payload
  local app="$1"
  mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
  cat > "$WORK/main.c" <<EOF
#include <stdio.h>
int main(void) { printf("$2\n"); return 0; }
EOF
  clang -o "$app/Contents/MacOS/verifyapp" "$WORK/main.c" 2>/dev/null
  cat > "$app/Contents/Info.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key><string>verifyapp</string>
  <key>CFBundleIdentifier</key><string>ai.kizunaai.sokuji.verify</string>
  <key>CFBundleName</key><string>verifyapp</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
</dict></plist>
EOF
}

make_app "$WORK/v1.app" "version one"
make_app "$WORK/v2.app" "version two, different bytes entirely"

codesign --force --sign "$CERT_CN" --keychain "$KEYCHAIN" "$WORK/v1.app" 2>/dev/null
codesign --force --sign "$CERT_CN" --keychain "$KEYCHAIN" "$WORK/v2.app" 2>/dev/null

DR1="$(codesign -d -r- "$WORK/v1.app" 2>&1 | grep '^designated' | sed 's/^designated => //')"
DR2="$(codesign -d -r- "$WORK/v2.app" 2>&1 | grep '^designated' | sed 's/^designated => //')"

note "v1 DR: $DR1"
note "v2 DR: $DR2"

if [ -n "$DR1" ] && [ "$DR1" = "$DR2" ]; then
  ok "DR is IDENTICAL across two different builds"
else
  bad "DR differs across builds — Option S does not work as designed"
fi

# The decisive check: does v2 satisfy the requirement captured from v1?
if codesign --verify --deep --strict -R="$DR1" "$WORK/v2.app" 2>/dev/null; then
  ok "v2 satisfies v1's DR — Squirrel.Mac would accept this update"
else
  bad "v2 does NOT satisfy v1's DR"
fi

# Contrast: ad-hoc must fail the same check, confirming the test is meaningful.
make_app "$WORK/a1.app" "adhoc one"
make_app "$WORK/a2.app" "adhoc two, different"
codesign --force --sign - "$WORK/a1.app" 2>/dev/null
codesign --force --sign - "$WORK/a2.app" 2>/dev/null
ADR1="$(codesign -d -r- "$WORK/a1.app" 2>&1 | grep '^designated' | sed 's/^designated => //')"
if codesign --verify --strict -R="$ADR1" "$WORK/a2.app" 2>/dev/null; then
  bad "ad-hoc build ALSO passed — the test is not discriminating, investigate"
else
  ok "ad-hoc correctly fails the same check (control)"
fi
echo

echo "[6] strict nested validation with an unsigned nested Mach-O"
cp -R "$WORK/v1.app" "$WORK/nested.app"
mkdir -p "$WORK/nested.app/Contents/Resources/drivers/Fake.driver/Contents/MacOS"
clang -o "$WORK/nested.app/Contents/Resources/drivers/Fake.driver/Contents/MacOS/Fake" "$WORK/main.c" 2>/dev/null
codesign --force --sign "$CERT_CN" --keychain "$KEYCHAIN" "$WORK/nested.app" 2>/dev/null
if codesign --verify --deep --strict "$WORK/nested.app" 2>/dev/null; then
  note "an unsigned Mach-O under Resources/ did NOT break strict validation here"
  note "(still sign the HAL driver — do not rely on this)"
else
  ok "unsigned nested Mach-O breaks strict validation, as expected"
  note "=> SokujiVirtualAudio.driver MUST be signed with the same identity"
fi
echo

# ---------------------------------------------------------------------------
# Test 2: can a normal admin user rename a root-owned, write-disabled
#         directory inside /Applications? Decides whether the PKG must chown
#         the app bundle for Squirrel to be able to swap it.
# ---------------------------------------------------------------------------
echo "[2] renaming a root-owned bundle in /Applications (decides the chown)"
TESTDIR="/Applications/.sokuji-verify-$$"
if sudo mkdir -p "$TESTDIR/Contents" && sudo chown -R root:wheel "$TESTDIR" && sudo chmod -R 755 "$TESTDIR"; then
  note "/Applications is $(stat -f '%Sp %Su:%Sg' /Applications)"
  note "test bundle is $(stat -f '%Sp %Su:%Sg' "$TESTDIR")"
  if mv "$TESTDIR" "${TESTDIR}-moved" 2>/dev/null; then
    ok "admin CAN rename a root-owned bundle — no chown needed"
    sudo rm -rf "${TESTDIR}-moved"
  else
    bad "admin CANNOT rename it — the PKG must set ownership (failure mode 12)"
    sudo rm -rf "$TESTDIR"
  fi
else
  note "SKIPPED — needs sudo"
fi
echo

# ---------------------------------------------------------------------------
# Test 4: does a file downloaded by Node's https (not a browser) carry
#         com.apple.quarantine? Gates the Option C fallback.
# ---------------------------------------------------------------------------
echo "[4] quarantine on a Node-downloaded file"
if command -v node >/dev/null 2>&1; then
  cat > "$WORK/dl.js" <<'EOF'
const https = require('https'); const fs = require('fs');
const out = fs.createWriteStream(process.argv[3]);
const get = u => https.get(u, r => {
  if (r.statusCode === 301 || r.statusCode === 302) { r.resume(); return get(r.headers.location); }
  r.pipe(out);
});
get(process.argv[2]);
out.on('finish', () => process.exit(0));
EOF
  node "$WORK/dl.js" "https://raw.githubusercontent.com/kizuna-ai-lab/sokuji/main/README.md" "$WORK/dl.bin" 2>/dev/null
  sleep 2
  if [ -s "$WORK/dl.bin" ]; then
    XA="$(xattr -l "$WORK/dl.bin" 2>/dev/null)"
    if echo "$XA" | grep -q "com.apple.quarantine"; then
      bad "Node-downloaded file IS quarantined — Option C does not help"
    else
      ok "no com.apple.quarantine — Option C's premise holds"
    fi
  else
    note "SKIPPED — download produced nothing (network?)"
  fi
else
  note "SKIPPED — node not on PATH"
fi
echo

echo "=== $PASS passed, $FAIL failed ==="
echo "Test 1 (does TCC keep the microphone grant across a re-sign?) still needs"
echo "a human on a real Mac — it requires clicking the permission dialog."
[ "$FAIL" -eq 0 ]
