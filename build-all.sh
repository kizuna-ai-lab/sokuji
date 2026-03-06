#!/bin/bash

# =============================================================================
# build-all.sh — Build Eburon for all platforms
# 
# Supported targets: mac, debian, windows, apk (android)
#
# Usage:
#   ./build-all.sh              # Build all platforms
#   ./build-all.sh mac          # Build macOS PKG only
#   ./build-all.sh debian       # Build Debian .deb only
#   ./build-all.sh windows      # Build Windows .exe only
#   ./build-all.sh apk          # Build Android APK only
#   ./build-all.sh mac apk      # Build macOS + Android
#
# Cross-compilation notes:
#   - macOS PKG: native on macOS only (requires pkgbuild/productbuild)
#   - Windows: cross-compile from macOS/Linux via electron-forge + Wine (optional)
#   - Debian: cross-compile from macOS via electron-forge --platform=linux
#   - Android APK: requires Java 17+ and Android SDK
# =============================================================================

set -e

VERSION=$(node -p "require('./package.json').version")
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log()   { echo -e "${BLUE}[BUILD]${NC} $*"; }
ok()    { echo -e "${GREEN}[  OK ]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN ]${NC} $*"; }
fail()  { echo -e "${RED}[FAIL ]${NC} $*"; }

# Determine which targets to build
TARGETS=("$@")
if [ ${#TARGETS[@]} -eq 0 ]; then
    TARGETS=(mac debian windows apk)
fi

# Track results
declare -A RESULTS

# ─────────────────────────────────────────────────────────────────────────────
# Shared: Build React web app (needed by all targets)
# ─────────────────────────────────────────────────────────────────────────────
build_web() {
    log "Building React web app..."
    npm run build
    ok "React web app built"
}

# Shared: Build Electron app (needed by Electron-based targets)
build_electron() {
    log "Building Electron app (vite + electron)..."
    npm run build:electron
    ok "Electron app built"
}

# ─────────────────────────────────────────────────────────────────────────────
# macOS — .pkg installer (arm64 + x64 auto-detected)
# ─────────────────────────────────────────────────────────────────────────────
build_mac() {
    log "═══════════════════════════════════════════════════"
    log "Building macOS PKG installer (v${VERSION})..."
    log "═══════════════════════════════════════════════════"

    if [[ "$(uname)" != "Darwin" ]]; then
        fail "macOS PKG can only be built on macOS"
        RESULTS[mac]="SKIPPED (not macOS)"
        return 1
    fi

    chmod +x build-pkg.sh
    ./build-pkg.sh

    # Find the output
    PKG_FILE=$(find out/make -name "*.pkg" -type f 2>/dev/null | head -1)
    if [ -n "$PKG_FILE" ]; then
        ok "macOS PKG: $PKG_FILE ($(du -h "$PKG_FILE" | cut -f1))"
        RESULTS[mac]="$PKG_FILE"
    else
        fail "macOS PKG build failed"
        RESULTS[mac]="FAILED"
        return 1
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Debian — .deb package (cross-compile from macOS or native on Linux)
# ─────────────────────────────────────────────────────────────────────────────
build_debian() {
    log "═══════════════════════════════════════════════════"
    log "Building Debian .deb package (v${VERSION})..."
    log "═══════════════════════════════════════════════════"

    # Check for dpkg (needed for .deb creation, install via: brew install dpkg)
    if ! command -v dpkg &>/dev/null; then
        if [[ "$(uname)" == "Darwin" ]]; then
            warn "dpkg not found. Installing via Homebrew..."
            brew install dpkg
        else
            fail "dpkg not found. Install it: sudo apt-get install dpkg"
            RESULTS[debian]="FAILED (missing dpkg)"
            return 1
        fi
    fi

    build_electron

    log "Packaging for Linux with electron-forge..."
    npx electron-forge make --platform=linux --targets=@electron-forge/maker-deb

    # Find the output
    DEB_FILE=$(find out/make -name "*.deb" -type f 2>/dev/null | head -1)
    if [ -n "$DEB_FILE" ]; then
        ok "Debian .deb: $DEB_FILE ($(du -h "$DEB_FILE" | cut -f1))"
        RESULTS[debian]="$DEB_FILE"
    else
        fail "Debian .deb build failed"
        RESULTS[debian]="FAILED"
        return 1
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Windows — Squirrel .exe installer (cross-compile from macOS/Linux)
# ─────────────────────────────────────────────────────────────────────────────
build_windows() {
    log "═══════════════════════════════════════════════════"
    log "Building Windows installer (v${VERSION})..."
    log "═══════════════════════════════════════════════════"

    if [[ "$(uname)" != "MINGW"* && "$(uname)" != "MSYS"* && "$(uname)" != "CYGWIN"* ]]; then
        # Cross-compiling from non-Windows
        if ! command -v wine &>/dev/null && ! command -v wine64 &>/dev/null; then
            warn "Wine not found. Windows cross-compilation may fail."
            warn "Install Wine: brew install --cask wine-stable"
            warn "Attempting build anyway..."
        fi
    fi

    build_electron

    log "Packaging for Windows with electron-forge..."
    npx electron-forge make --platform=win32 --targets=@electron-forge/maker-squirrel

    # Find the output
    EXE_FILE=$(find out/make -name "*.exe" -type f 2>/dev/null | head -1)
    if [ -n "$EXE_FILE" ]; then
        ok "Windows .exe: $EXE_FILE ($(du -h "$EXE_FILE" | cut -f1))"
        RESULTS[windows]="$EXE_FILE"
    else
        fail "Windows .exe build failed"
        RESULTS[windows]="FAILED"
        return 1
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Android — .apk via Capacitor + Gradle
# ─────────────────────────────────────────────────────────────────────────────
build_apk() {
    log "═══════════════════════════════════════════════════"
    log "Building Android APK (v${VERSION})..."
    log "═══════════════════════════════════════════════════"

    # Check for Java
    if ! command -v java &>/dev/null; then
        fail "Java not found. Install JDK 17+: brew install openjdk@17"
        RESULTS[apk]="FAILED (missing Java)"
        return 1
    fi

    # Android Gradle plugin requires JDK 17-21 (not 25+)
    # Try to find a compatible JDK
    if [[ "$(uname)" == "Darwin" ]]; then
        JDK17_HOME=$(/usr/libexec/java_home -v 17 2>/dev/null || true)
        JDK21_HOME=$(/usr/libexec/java_home -v 21 2>/dev/null || true)
        if [ -n "$JDK17_HOME" ]; then
            export JAVA_HOME="$JDK17_HOME"
            log "Using JDK 17: $JAVA_HOME"
        elif [ -n "$JDK21_HOME" ]; then
            export JAVA_HOME="$JDK21_HOME"
            log "Using JDK 21: $JAVA_HOME"
        else
            warn "No JDK 17 or 21 found. Android build may fail with newer JDKs."
            warn "Install: brew install --cask temurin@17"
        fi
    fi

    JAVA_VER=$(java -version 2>&1 | head -1 | cut -d'"' -f2 | cut -d'.' -f1)
    log "Java version: $JAVA_VER"

    # Check for Android SDK
    if [ -z "$ANDROID_HOME" ] && [ -z "$ANDROID_SDK_ROOT" ]; then
        # Try common macOS paths
        if [ -d "$HOME/Library/Android/sdk" ]; then
            export ANDROID_HOME="$HOME/Library/Android/sdk"
            export ANDROID_SDK_ROOT="$HOME/Library/Android/sdk"
            log "Auto-detected Android SDK: $ANDROID_HOME"
        elif [ -d "/usr/local/share/android-commandlinetools" ]; then
            export ANDROID_HOME="/usr/local/share/android-commandlinetools"
            export ANDROID_SDK_ROOT="$ANDROID_HOME"
            log "Auto-detected Android SDK: $ANDROID_HOME"
        else
            fail "Android SDK not found. Set ANDROID_HOME or install Android Studio."
            RESULTS[apk]="FAILED (missing Android SDK)"
            return 1
        fi
    fi

    log "Building web app for Android..."
    npm run build:android:web

    log "Syncing Capacitor..."
    npx cap sync android

    log "Building APK with Gradle..."
    cd android
    chmod +x gradlew
    ./gradlew assembleDebug
    cd ..

    # Find the output
    APK_FILE=$(find android/app/build/outputs/apk -name "*.apk" -type f 2>/dev/null | head -1)
    if [ -n "$APK_FILE" ]; then
        ok "Android APK: $APK_FILE ($(du -h "$APK_FILE" | cut -f1))"
        RESULTS[apk]="$APK_FILE"
    else
        fail "Android APK build failed"
        RESULTS[apk]="FAILED"
        return 1
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

echo ""
log "╔═══════════════════════════════════════════════════════╗"
log "║  Eburon v${VERSION} — Multi-platform Build            ║"
log "╠═══════════════════════════════════════════════════════╣"
log "║  Targets: ${TARGETS[*]}"
log "╚═══════════════════════════════════════════════════════╝"
echo ""

# Ensure deps are installed
log "Checking dependencies..."
if [ ! -d "node_modules" ]; then
    log "Installing npm dependencies..."
    npm ci
fi

FAILED=0

for TARGET in "${TARGETS[@]}"; do
    case "$TARGET" in
        mac|macos|pkg)
            build_mac || FAILED=$((FAILED+1))
            ;;
        deb|debian|linux)
            build_debian || FAILED=$((FAILED+1))
            ;;
        win|windows|exe)
            build_windows || FAILED=$((FAILED+1))
            ;;
        apk|android)
            build_apk || FAILED=$((FAILED+1))
            ;;
        *)
            warn "Unknown target: $TARGET (valid: mac, debian, windows, apk)"
            FAILED=$((FAILED+1))
            ;;
    esac
    echo ""
done

# ─────────────────────────────────────────────────────────────────────────────
# Summary
# ─────────────────────────────────────────────────────────────────────────────
echo ""
log "═══════════════════════════════════════════════════"
log " Build Summary — Eburon v${VERSION}"
log "═══════════════════════════════════════════════════"

for TARGET in "${TARGETS[@]}"; do
    case "$TARGET" in
        mac|macos|pkg) KEY="mac" ;;
        deb|debian|linux) KEY="debian" ;;
        win|windows|exe) KEY="windows" ;;
        apk|android) KEY="apk" ;;
        *) KEY="$TARGET" ;;
    esac

    RESULT="${RESULTS[$KEY]}"
    if [ -z "$RESULT" ]; then
        fail "  $TARGET: NOT ATTEMPTED"
    elif [[ "$RESULT" == FAILED* ]] || [[ "$RESULT" == SKIPPED* ]]; then
        fail "  $TARGET: $RESULT"
    else
        ok "  $TARGET: $RESULT"
    fi
done

echo ""
if [ $FAILED -eq 0 ]; then
    ok "All builds completed successfully! 🎉"
else
    warn "$FAILED target(s) failed. See output above for details."
fi

exit $FAILED
