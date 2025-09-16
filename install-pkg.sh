#!/bin/bash

# Install script for Sokuji unsigned PKG

PKG_PATH="out/make/Sokuji-unsigned.pkg"

if [ ! -f "$PKG_PATH" ]; then
    echo "❌ PKG file not found at $PKG_PATH"
    echo "Please run 'npm run make:pkg' first to build the installer"
    exit 1
fi

echo "📦 Installing Sokuji from unsigned PKG..."
echo "This will install Sokuji.app to /Applications"
echo ""
echo "⚠️  Note: You may need to enter your administrator password"
echo ""

# Clean up any existing installation first
if [ -d "/Applications/Sokuji.app" ]; then
    echo "Found existing Sokuji.app, removing..."
    sudo rm -rf /Applications/Sokuji.app
fi

# Remove any existing package receipts
pkgutil --pkgs | grep -i sokuji | while read pkg; do
    echo "Removing receipt for $pkg"
    sudo pkgutil --forget "$pkg" 2>/dev/null
done

# Install the PKG with verbose output
echo "Installing package..."
sudo installer -pkg "$PKG_PATH" -target / -verbose

if [ $? -eq 0 ]; then
    echo ""
    echo "Checking installation..."

    # Check if app was actually installed
    if [ -d "/Applications/Sokuji.app" ]; then
        echo "✅ Installation successful!"
        echo "📍 Sokuji has been installed to /Applications/Sokuji.app"
        echo ""
        # Show app info
        ls -la /Applications/Sokuji.app
        echo ""
        echo "You can now:"
        echo "  • Open Sokuji from Launchpad"
        echo "  • Or run: open /Applications/Sokuji.app"
    else
        echo "⚠️  Installation completed but app not found in /Applications"
        echo "Checking package receipt..."
        pkgutil --pkg-info com.electron.sokuji
        echo ""
        echo "Files should be at:"
        pkgutil --only-dirs --files com.electron.sokuji | head -5
    fi
else
    echo ""
    echo "❌ Installation failed"
    echo "Please check the error messages above"
fi