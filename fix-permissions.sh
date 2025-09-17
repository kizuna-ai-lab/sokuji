#!/bin/bash

# Script to fix permissions before building PKG

echo "Fixing permissions for Sokuji build..."

# Fix ownership of existing app if it exists
if [ -d "out/Sokuji-darwin-arm64/Sokuji.app" ]; then
    echo "Fixing ownership of out/Sokuji-darwin-arm64/Sokuji.app..."
    sudo chown -R $(whoami):staff out/Sokuji-darwin-arm64/Sokuji.app
    echo "✅ Fixed ownership"
else
    echo "No existing app found to fix"
fi

# Clean up any root-owned files
echo "Cleaning up any root-owned files..."
sudo find out/ -user root -exec chown $(whoami):staff {} \; 2>/dev/null || true

echo "✅ Permissions fixed. You can now run: npm run make:pkg"