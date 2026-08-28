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
# Populated before the search list is touched, so cleanup can put it back.
ORIG_KEYCHAINS=()

cleanup() {
  # Restore the user's keychain search list. Leaving our temporary keychain in
  # it would strand a dead path once that keychain is deleted below.
  if [ ${#ORIG_KEYCHAINS[@]} -gt 0 ]; then
    security list-keychains -d user -s "${ORIG_KEYCHAINS[@]}" 2>/dev/null
  fi
  security delete-keychain "$KEYCHAIN" 2>/dev/null
  sudo rm -rf "/Applications/.sokuji-verify-$$" 2>/dev/null
  rm -rf "$WORK"
}
trap cleanup EXIT

# Read the current search list into an array so that paths containing spaces
# survive; the obvious unquoted $(...) splat does not handle them.
read_keychains() {
  local line
  ORIG_KEYCHAINS=()
  while IFS= read -r line; do
    line="${line#"${line%%[![:space:]]*}"}"   # strip leading blanks
    line="${line%\"}"                          # strip trailing quote
    line="${line#\"}"                          # strip leading quote
    [ -n "$line" ] && ORIG_KEYCHAINS+=("$line")
  done < <(security list-keychains -d user)
}

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

# OpenSSL 3.x defaults to AES-256/SHA-256 for PKCS#12, which macOS's Security
# framework cannot import ("MAC verification failed"). -legacy restores the
# algorithms it understands; LibreSSL (/usr/bin/openssl) does not need it.
if ! openssl pkcs12 -export -legacy -out "$WORK/cert.p12" -inkey "$WORK/key.pem" \
     -in "$WORK/cert.pem" -passout "pass:$KC_PASS" >/dev/null 2>&1; then
  openssl pkcs12 -export -out "$WORK/cert.p12" -inkey "$WORK/key.pem" \
    -in "$WORK/cert.pem" -passout "pass:$KC_PASS" >/dev/null 2>&1
fi

security create-keychain -p "$KC_PASS" "$KEYCHAIN" >/dev/null
security unlock-keychain -p "$KC_PASS" "$KEYCHAIN" >/dev/null
security set-keychain-settings "$KEYCHAIN"
# Putting the keychain in the search list is load-bearing, not cosmetic:
# `codesign --keychain <kc>` on its own does NOT resolve an identity by common
# name -- it reports "no identity found" and leaves the bundle ad-hoc signed
# (verified on macOS 26.6.1). cleanup() restores the previous list.
read_keychains
security list-keychains -d user -s "$KEYCHAIN" "${ORIG_KEYCHAINS[@]}"
IMPORT_OUT="$(security import "$WORK/cert.p12" -k "$KEYCHAIN" -P "$KC_PASS" -A 2>&1)"
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KC_PASS" "$KEYCHAIN" >/dev/null 2>&1

if echo "$IMPORT_OUT" | grep -qi "verification failed"; then
  bad "PKCS#12 import failed: $IMPORT_OUT"
else
  ok "PKCS#12 imported into a throwaway keychain"
fi

# Two different things: can codesign USE it (what matters), and does
# electron-builder's discovery SEE it (a CI plumbing detail).
if security find-identity -p codesigning "$KEYCHAIN" | grep -q "$CERT_CN"; then
  ok "identity present in the keychain"
else
  bad "identity not present at all"
fi

if security find-identity -v -p codesigning "$KEYCHAIN" | grep -q "$CERT_CN"; then
  ok "also listed as VALID — electron-builder's discovery will find it"
else
  note "NOT listed by 'find-identity -v' (expect CSSMERR_TP_NOT_TRUSTED)."
  note "codesign still works — see test 3 — but electron-builder discovers"
  note "identities with 'find-identity -v', so CI needs:"
  note "  sudo security add-trusted-cert -d -r trustRoot -p codeSign \\"
  note "       -k /Library/Keychains/System.keychain cert.pem"
  note "(passwordless on GitHub Actions runners; needs a GUI prompt locally)"
fi
echo

# ---------------------------------------------------------------------------
# Tests 3 + 6: is the designated requirement stable across two DIFFERENT
#              builds signed with the same cert, and does build B satisfy the
#              DR captured from build A? That is exactly what Squirrel.Mac does.
# ---------------------------------------------------------------------------
echo "[3] designated requirement stability (the core of the plan)"

SIGN_ID="$CERT_CN"

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

S1="$(codesign --force --sign "$SIGN_ID" --keychain "$KEYCHAIN" "$WORK/v1.app" 2>&1)"
S2="$(codesign --force --sign "$SIGN_ID" --keychain "$KEYCHAIN" "$WORK/v2.app" 2>&1)"
if echo "$S1$S2" | grep -qi "no identity found"; then
  bad "codesign could not use the self-signed identity: $S1"
else
  ok "codesign signed both bundles with the untrusted self-signed identity"
fi

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
echo "[2] renaming a write-disabled bundle in /Applications (decides the chown)"
note "/Applications is $(stat -f '%Sp %Su:%Sg' /Applications)"
if [ -d /Applications/Sokuji.app ]; then
  note "installed Sokuji.app is $(stat -f '%Sp %Su:%Sg' /Applications/Sokuji.app)"
fi

# rename(2)'s CONFORMANCE clause is about whether the CALLER can write into the
# directory being renamed — not about who owns it. So a directory we own but
# have chmod'd 555 reproduces a root-owned 755 bundle exactly, with no sudo and
# nothing destructive. The real root-owned case is checked too when sudo is
# available without a password.
TESTDIR="/Applications/.sokuji-verify-$$"
if mkdir -p "$TESTDIR/Contents" 2>/dev/null; then
  chmod 555 "$TESTDIR"
  note "test bundle is $(stat -f '%Sp %Su:%Sg' "$TESTDIR") (write-disabled for us)"
  if mv "$TESTDIR" "${TESTDIR}-moved" 2>/dev/null; then
    ok "a write-disabled bundle CAN be renamed — Squirrel can swap it"
    chmod 755 "${TESTDIR}-moved" 2>/dev/null; rm -rf "${TESTDIR}-moved"
  else
    bad "cannot rename a write-disabled bundle — the PKG must set ownership"
    chmod 755 "$TESTDIR" 2>/dev/null; rm -rf "$TESTDIR"
  fi
else
  note "SKIPPED — cannot create a directory in /Applications"
fi

# The genuine root-owned case, only if sudo needs no password.
if sudo -n true 2>/dev/null; then
  RTEST="/Applications/.sokuji-verify-root-$$"
  sudo mkdir -p "$RTEST/Contents" && sudo chown -R root:wheel "$RTEST" && sudo chmod -R 755 "$RTEST"
  if mv "$RTEST" "${RTEST}-moved" 2>/dev/null; then
    ok "a root-owned bundle CAN be renamed by an admin — no chown needed"
    sudo rm -rf "${RTEST}-moved"
  else
    bad "a root-owned bundle CANNOT be renamed — PKG must set ownership (fm 12)"
    sudo rm -rf "$RTEST"
  fi
else
  note "root-owned variant SKIPPED — sudo needs a password (the 555 case above"
  note "exercises the same kernel check)"
fi
echo

# ---------------------------------------------------------------------------
# Test 4: does a file downloaded by Node's https (not a browser) carry
#         com.apple.quarantine? Gates the Option C fallback.
# ---------------------------------------------------------------------------
echo "[4] quarantine on a file downloaded by a non-LaunchServices process"

# The mechanism is opt-in via LSFileQuarantineEnabled, so check the shipped app
# directly — this is the real question, not what some other tool does.
if [ -f /Applications/Sokuji.app/Contents/Info.plist ]; then
  if plutil -p /Applications/Sokuji.app/Contents/Info.plist 2>/dev/null | grep -qi "LSFileQuarantineEnabled"; then
    bad "Sokuji.app DECLARES LSFileQuarantineEnabled — its downloads would be quarantined"
  else
    ok "Sokuji.app does not declare LSFileQuarantineEnabled"
  fi
fi

# curl is Apple's own documented example of a tool that does not quarantine.
curl -fsSL -o "$WORK/curl.bin" "https://raw.githubusercontent.com/kizuna-ai-lab/sokuji/main/README.md" 2>/dev/null
if [ -s "$WORK/curl.bin" ]; then
  if xattr -l "$WORK/curl.bin" 2>/dev/null | grep -q "com.apple.quarantine"; then
    bad "even curl quarantined the file — the premise is wrong"
  else
    ok "curl-downloaded file carries no com.apple.quarantine"
  fi
fi

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
