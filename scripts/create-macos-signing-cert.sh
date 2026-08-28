#!/bin/bash
# Create the self-signed code-signing certificate that macOS auto-update needs.
#
# WHY: Squirrel.Mac verifies each update against the designated requirement
# captured from the running bundle. Ad-hoc signing produces a per-build cdhash,
# which can never match; any real certificate produces
# `identifier "…" and certificate root = H"…"`, which is identical across
# rebuilds. It does NOT have to be an Apple certificate — verified on macOS
# 26.6.1. See docs/build/macos-auto-update.md §2.5.
#
# This certificate is NOT for Gatekeeper. It gives the app a stable identity so
# that (a) updates install, (b) the microphone permission survives updates, and
# (c) the keychain stops prompting after each update. First-install Gatekeeper
# friction is unaffected — that needs notarization, which needs a paid account.
#
#   bash scripts/create-macos-signing-cert.sh [output-dir]
#
# ⚠️  CUSTODY: the .p12 this produces becomes a permanent project secret.
#     Rotating or losing it breaks the update chain for every existing install
#     and resets every user's microphone permission. Back it up somewhere the
#     team can reach, and do not commit it.

set -euo pipefail

OUT_DIR="${1:-$HOME/sokuji-signing}"
CN="Sokuji Code Signing"
ORG="Kizuna AI Lab"
DAYS=7300  # ~20 years; codesign refuses to sign with an expired certificate

if [ "$(uname)" != "Darwin" ]; then
  echo "Run this on macOS — it uses the system keychain tooling to verify." >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
chmod 700 "$OUT_DIR"
KEY="$OUT_DIR/sokuji-signing.key"
CRT="$OUT_DIR/sokuji-signing.crt"
P12="$OUT_DIR/sokuji-signing.p12"

if [ -f "$P12" ]; then
  echo "Refusing to overwrite an existing certificate at $P12" >&2
  echo "Replacing it would break updates for every existing install." >&2
  exit 1
fi

# Prefer Homebrew OpenSSL if present; both work, but the export below needs the
# right flag depending on which one it is.
OPENSSL=/usr/bin/openssl
[ -x /opt/homebrew/bin/openssl ] && OPENSSL=/opt/homebrew/bin/openssl
echo "Using $($OPENSSL version)"

read -r -s -p "Choose a password for the .p12 (you will store this as a CI secret): " P12_PASS
echo
[ -n "$P12_PASS" ] || { echo "A password is required." >&2; exit 1; }

echo "Generating a self-signed code-signing certificate..."
"$OPENSSL" req -x509 -newkey rsa:2048 -sha256 -days "$DAYS" -nodes \
  -keyout "$KEY" -out "$CRT" \
  -subj "/CN=$CN/O=$ORG" \
  -addext "basicConstraints=critical,CA:false" \
  -addext "keyUsage=critical,digitalSignature" \
  -addext "extendedKeyUsage=critical,codeSigning" >/dev/null 2>&1

# macOS's Security framework cannot import PKCS#12 written with OpenSSL 3's
# defaults (AES-256/SHA-256) — `security import` fails with "MAC verification
# failed during PKCS12 import (wrong password?)", which has nothing to do with
# the password. -legacy restores algorithms it understands; LibreSSL has no
# such flag and already writes a compatible file.
if "$OPENSSL" pkcs12 -help 2>&1 | grep -q -- '-legacy'; then
  "$OPENSSL" pkcs12 -export -legacy -out "$P12" -inkey "$KEY" -in "$CRT" \
    -passout "pass:$P12_PASS"
else
  "$OPENSSL" pkcs12 -export -out "$P12" -inkey "$KEY" -in "$CRT" \
    -passout "pass:$P12_PASS"
fi
chmod 600 "$KEY" "$P12"

# Prove the result is actually usable before anyone wires it into CI.
echo "Verifying the certificate can sign..."
KC="$OUT_DIR/verify.keychain"
security delete-keychain "$KC" 2>/dev/null || true
security create-keychain -p "$P12_PASS" "$KC" >/dev/null
security unlock-keychain -p "$P12_PASS" "$KC" >/dev/null
security set-keychain-settings "$KC"
security import "$P12" -k "$KC" -P "$P12_PASS" -A >/dev/null 2>&1
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$P12_PASS" "$KC" >/dev/null 2>&1
security list-keychains -d user -s "$KC" $(security list-keychains -d user | tr -d '"')

TMPAPP="$OUT_DIR/.verify.app"
rm -rf "$TMPAPP"; mkdir -p "$TMPAPP/Contents/MacOS" "$TMPAPP/Contents/Resources"
printf 'int main(void){return 0;}\n' > "$OUT_DIR/.v.c"
xcrun clang -o "$TMPAPP/Contents/MacOS/v" "$OUT_DIR/.v.c"
cat > "$TMPAPP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>v</string>
<key>CFBundleIdentifier</key><string>ai.kizunaai.sokuji</string>
<key>CFBundleName</key><string>v</string>
<key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>
PLIST
codesign --force --sign "$CN" --keychain "$KC" "$TMPAPP" 2>&1 | sed 's/^/  /'
DR=$(codesign -d -r- "$TMPAPP" 2>&1 | grep 'designated =>' | sed 's/^#* *designated => //')
security delete-keychain "$KC" 2>/dev/null || true
rm -rf "$TMPAPP" "$OUT_DIR/.v.c"

if [ -z "$DR" ]; then
  echo "FAILED: the certificate could not sign anything. Do not use it." >&2
  exit 1
fi

echo
echo "Designated requirement Sokuji builds will carry:"
echo "  $DR"
echo
echo "This string must stay identical across releases — it is what Squirrel.Mac,"
echo "TCC and the keychain all match on."
echo
echo "Next: store these as repository secrets on kizuna-ai-lab/sokuji."
echo "Review them before running — the first one contains the private key."
echo
echo "  gh secret set MACOS_CSC_LINK --repo kizuna-ai-lab/sokuji < <(base64 -i '$P12')"
echo "  gh secret set MACOS_CSC_KEY_PASSWORD --repo kizuna-ai-lab/sokuji"
echo
echo "Then back up $P12 and its password somewhere durable, and keep"
echo "$OUT_DIR out of any repository."
