#!/bin/bash

# Build script for unsigned PKG installer
# This creates an unsigned PKG that includes the Sokuji app with installation scripts

set -e  # Exit on error

echo "Building unsigned PKG installer for Sokuji..."

# Step 0: Clean up previous builds (might need sudo if ownership was changed)
echo "Step 0: Cleaning up previous builds..."
if [ -d "out/Sokuji-darwin-arm64/Sokuji.app" ]; then
    # Check if we need sudo to remove (if owned by root)
    if [ ! -w "out/Sokuji-darwin-arm64/Sokuji.app" ]; then
        echo "Note: Previous build has root ownership, need password to clean up"
        sudo rm -rf out/Sokuji-darwin-arm64/Sokuji.app
    else
        rm -rf out/Sokuji-darwin-arm64/Sokuji.app
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
if [ ! -d "out/Sokuji-darwin-arm64/Sokuji.app" ]; then
    echo "❌ Error: Sokuji.app was not created during packaging"
    exit 1
fi

# Ensure correct ownership (packaging sometimes leaves root ownership)
if [ ! -w "out/Sokuji-darwin-arm64/Sokuji.app" ]; then
    echo "Fixing app ownership..."
    sudo chown -R $(whoami):staff out/Sokuji-darwin-arm64/Sokuji.app
fi

# Step 3: Create output directory if it doesn't exist
echo "Step 3: Preparing output directory..."
mkdir -p out/make

# Step 4: Build unsigned PKG
echo "Step 4: Creating unsigned PKG installer..."

# Create a temporary directory for clean packaging
TEMP_DIR=$(mktemp -d)
cp -R out/Sokuji-darwin-arm64/Sokuji.app "$TEMP_DIR/"

# First create a component package WITH SCRIPTS
pkgbuild \
    --root "$TEMP_DIR" \
    --identifier com.electron.sokuji \
    --version 0.9.16 \
    --install-location /Applications \
    --scripts pkg-scripts \
    out/make/Sokuji-component.pkg

# Then create the product package
productbuild \
    --package out/make/Sokuji-component.pkg \
    out/make/Sokuji-unsigned.pkg

# Clean up
rm -rf "$TEMP_DIR"
rm -f out/make/Sokuji-component.pkg

# Step 5: Report success
if [ -f out/make/Sokuji-unsigned.pkg ]; then
    PKG_SIZE=$(du -h out/make/Sokuji-unsigned.pkg | cut -f1)
    echo "✅ Successfully created unsigned PKG installer"
    echo "📦 Location: out/make/Sokuji-unsigned.pkg"
    echo "📊 Size: $PKG_SIZE"
    echo ""
    echo "⚠️  Note: To avoid installation issues, remove or rename out/Sokuji-darwin-arm64"
    echo "   before installing the PKG, or run:"
    echo "   rm -rf out/Sokuji-darwin-arm64"
else
    echo "❌ Failed to create PKG installer"
    exit 1
fi