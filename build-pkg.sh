#!/bin/bash

# Build script for unsigned PKG installer
# This creates an unsigned PKG that includes the Eburon app with installation scripts

set -e  # Exit on error

# Detect architecture: allow override via ARCH env var
if [ -z "$ARCH" ]; then
    MACHINE=$(uname -m)
    case "$MACHINE" in
        x86_64) ARCH="x64" ;;
        arm64)  ARCH="arm64" ;;
        *)      echo "❌ Unsupported architecture: $MACHINE"; exit 1 ;;
    esac
fi
echo "Architecture: ${ARCH}"

APP_DIR="out/Eburon-darwin-${ARCH}"

# Extract version from package.json
VERSION=$(node -p "require('./package.json').version")
echo "Building unsigned PKG installer for Eburon v${VERSION} (${ARCH})..."

# Step 0: Clean up previous builds (might need sudo if ownership was changed)
echo "Step 0: Cleaning up previous builds..."
if [ -d "${APP_DIR}/Eburon.app" ]; then
    # Check if we need sudo to remove (if owned by root)
    if [ ! -w "${APP_DIR}/Eburon.app" ]; then
        echo "Note: Previous build has root ownership, need password to clean up"
        sudo rm -rf "${APP_DIR}/Eburon.app"
    else
        rm -rf "${APP_DIR}/Eburon.app"
    fi
fi

# Step 1: Build the React app
echo "Step 1: Building React app..."
npm run build

# Step 2: Package the Electron app
echo "Step 2: Packaging Electron app..."
npm run package -- --platform=darwin

# Step 2.5: Verify the app was created and fix permissions if needed
echo "Step 2.5: Verifying packaged app..."
if [ ! -d "${APP_DIR}/Eburon.app" ]; then
    echo "❌ Error: Eburon.app was not created during packaging"
    exit 1
fi

# Ensure correct ownership (packaging sometimes leaves root ownership)
if [ ! -w "${APP_DIR}/Eburon.app" ]; then
    echo "Fixing app ownership..."
    sudo chown -R $(whoami):staff "${APP_DIR}/Eburon.app"
fi

# Step 2.6: Ad-hoc sign the app (required for macOS to show permission dialogs)
echo "Step 2.6: Ad-hoc signing the app..."
codesign --force --deep --sign - "${APP_DIR}/Eburon.app"
echo "✅ App signed successfully"

# Step 3: Create output directory if it doesn't exist
echo "Step 3: Preparing output directory..."
mkdir -p out/make

# Step 4: Build unsigned PKG
echo "Step 4: Creating unsigned PKG installer..."

PKG_NAME="Eburon-${VERSION}-${ARCH}.pkg"

# Create a temporary directory for clean packaging
TEMP_DIR=$(mktemp -d)
cp -R "${APP_DIR}/Eburon.app" "$TEMP_DIR/"

# First create a component package WITH SCRIPTS
pkgbuild \
    --root "$TEMP_DIR" \
    --identifier com.electron.Eburon \
    --version $VERSION \
    --install-location /Applications \
    --scripts pkg-scripts \
    out/make/Eburon-component.pkg

# Then create the product package
productbuild \
    --package out/make/Eburon-component.pkg \
    "out/make/${PKG_NAME}"

# Clean up
rm -rf "$TEMP_DIR"
rm -f out/make/Eburon-component.pkg

# Step 5: Report success
if [ -f "out/make/${PKG_NAME}" ]; then
    PKG_SIZE=$(du -h "out/make/${PKG_NAME}" | cut -f1)
    echo "✅ Successfully created unsigned PKG installer"
    echo "📦 Location: out/make/${PKG_NAME}"
    echo "📊 Size: $PKG_SIZE"
    echo ""
    echo "⚠️  Note: To avoid installation issues, remove or rename ${APP_DIR}"
    echo "   before installing the PKG, or run:"
    echo "   rm -rf ${APP_DIR}"
else
    echo "❌ Failed to create PKG installer"
    exit 1
fi
