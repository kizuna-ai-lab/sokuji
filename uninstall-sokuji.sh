#!/bin/bash

# Sokuji Uninstaller Script
# Removes Sokuji app, virtual audio driver, and package receipts

echo "================================"
echo "    Sokuji Uninstaller"
echo "================================"
echo ""
echo "This will remove:"
echo "  • Sokuji.app from /Applications"
echo "  • SokujiVirtualAudio.driver from /Library/Audio/Plug-Ins/HAL"
echo "  • Package receipts"
echo ""
echo "⚠️  You may be prompted for your administrator password"
echo ""

# Confirm uninstallation
read -p "Are you sure you want to uninstall Sokuji? (y/N): " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Uninstallation cancelled"
    exit 0
fi

echo ""
echo "Uninstalling Sokuji..."

# Remove the application
if [ -d "/Applications/Sokuji.app" ]; then
    echo "• Removing Sokuji.app..."
    sudo rm -rf /Applications/Sokuji.app
    echo "  ✓ Application removed"
else
    echo "  ⚠️  Sokuji.app not found in /Applications"
fi

# Remove the virtual audio driver
if [ -d "/Library/Audio/Plug-Ins/HAL/SokujiVirtualAudio.driver" ]; then
    echo "• Removing SokujiVirtualAudio driver..."
    sudo rm -rf /Library/Audio/Plug-Ins/HAL/SokujiVirtualAudio.driver
    echo "  ✓ Virtual audio driver removed"

    # Restart CoreAudio to unload the driver
    echo "• Restarting CoreAudio..."
    sudo launchctl kill SIGTERM system/com.apple.audio.coreaudiod || true
    echo "  ✓ CoreAudio restarted"
else
    echo "  ⚠️  SokujiVirtualAudio.driver not found"
fi

# Remove package receipts
echo "• Removing package receipts..."
RECEIPTS_FOUND=false
pkgutil --pkgs | grep -i sokuji | while read pkg; do
    RECEIPTS_FOUND=true
    echo "  Removing receipt: $pkg"
    sudo pkgutil --forget "$pkg" 2>/dev/null
done

if [ "$RECEIPTS_FOUND" = false ]; then
    echo "  ⚠️  No package receipts found"
else
    echo "  ✓ Package receipts removed"
fi

# Check for any leftover files
echo ""
echo "Checking for leftover files..."

# Check user Application Support
USER_SUPPORT="$HOME/Library/Application Support/Sokuji"
if [ -d "$USER_SUPPORT" ]; then
    echo "• Found user data at: $USER_SUPPORT"
    read -p "  Remove user data? (y/N): " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        rm -rf "$USER_SUPPORT"
        echo "  ✓ User data removed"
    else
        echo "  ⚠️  User data preserved"
    fi
fi

# Check user Preferences
PREF_FILES=$(find "$HOME/Library/Preferences" -name "*sokuji*" -o -name "*com.electron.sokuji*" 2>/dev/null)
if [ ! -z "$PREF_FILES" ]; then
    echo "• Found preference files:"
    echo "$PREF_FILES"
    read -p "  Remove preference files? (y/N): " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "$PREF_FILES" | xargs rm -f
        echo "  ✓ Preference files removed"
    else
        echo "  ⚠️  Preference files preserved"
    fi
fi

echo ""
echo "================================"
echo "   Uninstallation Complete"
echo "================================"
echo ""
echo "Sokuji has been removed from your system."
echo "Thank you for using Sokuji!"
echo ""