#!/bin/bash

# Build script for Sokuji Virtual Audio driver
# Based on BlackHole official documentation

set -e

echo "================================"
echo "  Building Sokuji Virtual Audio Driver"
echo "================================"
echo ""

# Configuration
DRIVER_NAME="SokujiVirtualAudio"
BUNDLE_ID="com.sokuji.virtualaudio"
ICON="Sokuji.icns"
DEVICE_NAME="SokujiVirtualAudio"  # Simplified to avoid space issues
CHANNELS=2

# Copy Sokuji icon to BlackHole source directory
cp assets/icon.icns BlackHole/Sokuji.icns
echo "  Using Sokuji.icns as driver icon"

# Navigate to BlackHole directory
cd BlackHole

# Clean previous builds
echo "Cleaning previous builds..."
xcodebuild clean -quiet || true
rm -rf build/

# Build the driver
echo "Building driver with custom configuration..."
echo "  Driver Name: $DRIVER_NAME"
echo "  Bundle ID: $BUNDLE_ID"
echo "  Device Name: $DEVICE_NAME"
echo "  Channels: $CHANNELS"
echo ""

xcodebuild \
  -project BlackHole.xcodeproj \
  -configuration Release \
  -quiet \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY="" \
  CODE_SIGN_ENTITLEMENTS="" \
  DEVELOPMENT_TEAM="" \
  MACOSX_DEPLOYMENT_TARGET=10.13 \
  PRODUCT_BUNDLE_IDENTIFIER="$BUNDLE_ID" \
  PRODUCT_NAME="SokujiVirtualAudio" \
  GCC_PREPROCESSOR_DEFINITIONS="\$GCC_PREPROCESSOR_DEFINITIONS kDriver_Name=\\\"${DRIVER_NAME}\\\" kPlugIn_BundleID=\\\"${BUNDLE_ID}\\\" kPlugIn_Icon=\\\"${ICON}\\\" kDevice_Name=\\\"${DEVICE_NAME}\\\" kNumber_Of_Channels=${CHANNELS}"

echo "Build completed!"
echo ""

# Check if build was successful
if [ -d "build/Release/SokujiVirtualAudio.driver" ]; then
    echo "✅ Driver built successfully"

    # Copy to resources directory
    echo "Copying driver to resources/drivers..."

    # Remove old driver if exists
    rm -rf ../resources/drivers/SokujiVirtualAudio.driver

    # Copy the driver (no need to rename, it's already named correctly)
    cp -R build/Release/SokujiVirtualAudio.driver ../resources/drivers/SokujiVirtualAudio.driver

    # Replace the icon with Sokuji icon (rename from BlackHole.icns to Sokuji.icns)
    rm -f ../resources/drivers/SokujiVirtualAudio.driver/Contents/Resources/BlackHole.icns
    cp ../assets/icon.icns ../resources/drivers/SokujiVirtualAudio.driver/Contents/Resources/Sokuji.icns
    echo "  Replaced driver icon with Sokuji.icns"

    # Update the Info.plist to ensure correct executable name
    PLIST_FILE="../resources/drivers/SokujiVirtualAudio.driver/Contents/Info.plist"
    if [ -f "$PLIST_FILE" ]; then
        # Update bundle name to show "Sokuji" in system
        /usr/libexec/PlistBuddy -c "Set :CFBundleName 'SokujiVirtualAudio'" "$PLIST_FILE" 2>/dev/null || true

        # Generate unique UUID for Sokuji to avoid conflicts with BlackHole
        SOKUJI_UUID="8a70ea4a-c3ed-4dc1-a01b-0ed9bc34f76a"

        # Delete the old BlackHole UUID entry and add new one with Sokuji UUID
        /usr/libexec/PlistBuddy -c "Delete :CFPlugInFactories:e395c745-4eea-4d94-bb92-46224221047c" "$PLIST_FILE" 2>/dev/null || true
        /usr/libexec/PlistBuddy -c "Add :CFPlugInFactories:$SOKUJI_UUID string BlackHole_Create" "$PLIST_FILE" 2>/dev/null || true

        # Update the CFPlugInTypes array to use the new UUID
        /usr/libexec/PlistBuddy -c "Set :CFPlugInTypes:443ABAB8-E7B3-491A-B985-BEB9187030DB:0 $SOKUJI_UUID" "$PLIST_FILE" 2>/dev/null || true

        echo "  Updated plugin UUID to avoid conflicts with BlackHole"
    fi

    echo "✅ Driver copied to resources/drivers/SokujiVirtualAudio.driver"
    echo ""
    echo "Driver details:"
    ls -la ../resources/drivers/SokujiVirtualAudio.driver/Contents/MacOS/
    echo ""
    echo "To test the driver:"
    echo "1. Run: npm run make:pkg"
    echo "2. Install the PKG"
    echo "3. The driver should appear as 'Sokuji Virtual Audio' in your audio devices"
else
    echo "❌ Build failed - driver not found"
    echo "Check the build output above for errors"
    exit 1
fi

cd ..

# Clean up the temporary icon file from BlackHole source
rm -f BlackHole/Sokuji.icns
echo "Cleaned up temporary icon file"

echo "Done!"