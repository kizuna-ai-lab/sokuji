# macOS Installer and Virtual Audio Driver Guide

## Overview

This guide covers the complete process of building, packaging, and distributing Sokuji for macOS, including the integrated virtual audio driver. The solution provides users with a one-click installation experience that includes both the application and virtual audio capabilities.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Virtual Audio Driver](#virtual-audio-driver)
3. [Build Process](#build-process)
4. [Package Creation](#package-creation)
5. [Code Signing and Notarization](#code-signing-and-notarization)
6. [Installation Process](#installation-process)
7. [Testing and Validation](#testing-and-validation)
8. [Troubleshooting](#troubleshooting)
9. [License Compliance](#license-compliance)

## Architecture Overview

### Package Components

```
Sokuji.pkg
├── Sokuji.app                          // Main Electron application
├── SokujiVirtualAudio.driver           // Custom virtual audio driver
├── preinstall script                   // Pre-installation checks
├── postinstall script                  // Driver installation
└── Installation UI                     // Welcome and conclusion pages
```

### Key Design Decisions

- **Integrated Installation**: Virtual audio driver bundled with the application
- **No Runtime Downloads**: All components included in the package
- **Custom Driver**: Based on BlackHole (GPL-3.0) with Sokuji-specific modifications
- **Cross-Platform**: Works on macOS 10.15+ with native audio subsystems

## Virtual Audio Driver

### Overview

The Sokuji Virtual Audio driver is a customized version of the open-source BlackHole project, modified to avoid conflicts and provide seamless integration with Sokuji.

### Driver Customization

#### Configuration File (`BlackHole/BlackHole/SokujiConfig.h`)

```c
#define kDriver_Name                    "Sokuji"
#define kPlugIn_BundleID               "com.sokuji.virtualaudio"
#define kPlugIn_Name                   "Sokuji Virtual Audio"
#define kDevice_Name                   "Sokuji Virtual Audio"
#define kNumber_Of_Channels            2
#define kNumber_Of_Input_Channels      2
#define kNumber_Of_Output_Channels     2
#define kLatency_Frame_Size            512
#define kSampleRates                   {44100.0, 48000.0}
```

#### Key Modifications from BlackHole

1. **Unique Bundle ID**: `com.sokuji.virtualaudio` prevents conflicts with original BlackHole
2. **Custom Device Name**: "Sokuji Virtual Audio" for clear identification in system preferences
3. **Optimized Configuration**: 2-channel stereo optimized for voice communication
4. **Sample Rate Support**: 44.1kHz and 48kHz for compatibility with video conferencing

### Building the Driver

#### Prerequisites

- macOS 10.15 or later
- Xcode command line tools
- Valid Apple Developer ID (for signing)

#### Build Process

1. **Clone and Configure**:
```bash
# Clone BlackHole repository
git clone https://github.com/ExistentialAudio/BlackHole.git
cd BlackHole

# Apply Sokuji customizations
cp /path/to/SokujiConfig.h BlackHole/BlackHole/
```

2. **Build the Driver**:
```bash
# Use the provided build script
./build-sokuji-driver.sh

# Or manually with xcodebuild
xcodebuild -project BlackHole.xcodeproj \
  -target BlackHole \
  -configuration Release \
  CODE_SIGN_IDENTITY="Developer ID Application: Your Name (XXXXXXXXXX)"
```

3. **Verify Build Output**:
```bash
# Check the driver bundle
ls -la build/Release/SokujiVirtualAudio.driver/
# Should show Contents/Info.plist, MacOS/BlackHole, etc.
```

### Driver Installation Location

- **System Location**: `/Library/Audio/Plug-Ins/HAL/SokujiVirtualAudio.driver`
- **Application Bundle**: `/Applications/Sokuji.app/Contents/Resources/drivers/`
- **Permissions**: Root ownership with 755 permissions

## Build Process

### Quick Build Commands

```bash
# Build the virtual audio driver
./build-sokuji-driver.sh

# Build PKG installer
./build-pkg.sh

# Or use npm scripts for Electron app
npm run make:pkg
```

### Build Scripts

#### Driver Build Script (`build-sokuji-driver.sh`)

Builds the customized Sokuji Virtual Audio driver from BlackHole source.

#### PKG Build Script (`build-pkg.sh`)

Creates an unsigned PKG installer that includes the Sokuji app with installation scripts.

#### PKG Build Script (`build-pkg.sh`)

```bash
#!/bin/bash

# PKG-specific build process:
# 1. Prepare Electron app
# 2. Copy driver to resources
# 3. Create installation scripts
# 4. Build PKG with productbuild
# 5. Sign with Developer ID Installer
```

### Build Configuration

#### Electron Forge Configuration (`forge.config.js`)

```javascript
{
  name: '@electron-forge/maker-pkg',
  config: {
    name: 'Sokuji',
    identity: 'Developer ID Installer: Your Name (XXXXXXXXXX)',
    scripts: 'pkg-scripts',
    installLocation: '/Applications',
    welcome: 'resources/installer-welcome.html',
    conclusion: 'resources/installer-conclusion.html'
  }
}
```

## Package Creation

### PKG Structure

```
Sokuji.pkg
├── Distribution.xml           // Package configuration
├── Resources/
│   ├── welcome.html          // Welcome page
│   ├── conclusion.html       // Conclusion page
│   └── background.png        // Installer background
├── Scripts/
│   ├── preinstall           // Pre-installation checks
│   └── postinstall          // Driver installation
└── Packages/
    └── Sokuji.pkg           // Application package
```

### Installation Scripts

#### Pre-installation Script (`pkg-scripts/preinstall`)

```bash
#!/bin/bash

# Check system requirements
if [[ $(sw_vers -productVersion | cut -d. -f1) -lt 11 ]]; then
    echo "macOS 11.0 or later required"
    exit 1
fi

# Check disk space (need at least 200MB)
available=$(df -k /Applications | tail -1 | awk '{print $4}')
if [[ $available -lt 204800 ]]; then
    echo "Insufficient disk space"
    exit 1
fi

exit 0
```

#### Post-installation Script (`pkg-scripts/postinstall`)

```bash
#!/bin/bash

# Install virtual audio driver
DRIVER_SOURCE="/Applications/Sokuji.app/Contents/Resources/drivers/SokujiVirtualAudio.driver"
DRIVER_DEST="/Library/Audio/Plug-Ins/HAL/"

if [ -d "$DRIVER_SOURCE" ]; then
    # Copy driver to system location
    sudo cp -R "$DRIVER_SOURCE" "$DRIVER_DEST"

    # Set proper permissions
    sudo chown -R root:wheel "$DRIVER_DEST/SokujiVirtualAudio.driver"
    sudo chmod -R 755 "$DRIVER_DEST/SokujiVirtualAudio.driver"

    # Restart CoreAudio to load the driver
    sudo killall coreaudiod
fi

exit 0
```

## Code Signing and Notarization

### Requirements

1. **Apple Developer Account**: Required for certificates
2. **Developer ID Application**: For signing the application
3. **Developer ID Installer**: For signing the PKG
4. **Notarization Credentials**: Apple ID with app-specific password

### Signing Process

#### Sign the Driver

```bash
codesign --force --deep --strict \
  --options=runtime \
  --sign "Developer ID Application: Your Name (XXXXXXXXXX)" \
  SokujiVirtualAudio.driver
```

#### Sign the Application

```bash
codesign --force --deep --strict \
  --options=runtime \
  --entitlements entitlements.plist \
  --sign "Developer ID Application: Your Name (XXXXXXXXXX)" \
  Sokuji.app
```

#### Sign the PKG

```bash
productsign --sign "Developer ID Installer: Your Name (XXXXXXXXXX)" \
  Sokuji-unsigned.pkg \
  Sokuji.pkg
```

### Notarization

```bash
# Submit for notarization
xcrun notarytool submit Sokuji.pkg \
  --keychain-profile "AC_PASSWORD" \
  --wait

# Staple the ticket
xcrun stapler staple Sokuji.pkg
```

### Entitlements Configuration

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.device.audio-input</key>
    <true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    <key>com.apple.security.cs.disable-library-validation</key>
    <true/>
</dict>
</plist>
```

## Installation Process

### User Experience Flow

1. **Download**: User downloads Sokuji.pkg from official source
2. **Launch Installer**: Double-click PKG file
3. **Welcome Screen**: Display features and system requirements
4. **License Agreement**: Show GPL-3.0 license for audio driver
5. **Authorization**: Request administrator password
6. **Pre-installation Check**: Verify system compatibility
7. **Installation**: Copy app and install driver
8. **CoreAudio Restart**: Automatic restart for driver activation
9. **Completion**: Show success message and next steps

### Installation Locations

- **Application**: `/Applications/Sokuji.app`
- **Virtual Audio Driver**: `/Library/Audio/Plug-Ins/HAL/SokujiVirtualAudio.driver`
- **Preferences**: `~/Library/Preferences/com.sokuji.app.plist`
- **Application Support**: `~/Library/Application Support/Sokuji/`

### Post-Installation Verification

After installation, the virtual audio device should appear in:
- System Preferences → Sound → Input/Output
- Audio MIDI Setup application
- Video conferencing applications (Zoom, Teams, Meet)

## Testing and Validation

### Test Checklist

#### Package Testing
- [ ] PKG opens without security warnings
- [ ] Installation completes without errors
- [ ] Application launches successfully
- [ ] Driver appears in Audio MIDI Setup
- [ ] No conflicts with existing BlackHole installation

#### Functionality Testing
- [ ] Virtual audio device selectable in System Preferences
- [ ] Audio routes correctly through virtual device
- [ ] No audio artifacts or latency issues
- [ ] Video conferencing integration works
- [ ] Uninstaller removes all components cleanly

#### Signing Validation
```bash
# Verify application signature
codesign --verify --verbose Sokuji.app

# Verify driver signature
codesign --verify --verbose /Library/Audio/Plug-Ins/HAL/SokujiVirtualAudio.driver

# Check notarization status
spctl -a -v Sokuji.app
```

### Automated Testing

```bash
# Run the test script
./test-macos-installer.sh

# This script:
# 1. Installs the package
# 2. Verifies all components
# 3. Tests audio functionality
# 4. Validates signatures
# 5. Tests uninstallation
```

## Troubleshooting

### Common Issues

#### Driver Not Loading

```bash
# Check if driver is installed
ls -la /Library/Audio/Plug-Ins/HAL/SokujiVirtualAudio.driver

# Restart CoreAudio
sudo killall coreaudiod

# Check system logs
log show --predicate 'process == "coreaudiod"' --last 1m

# Verify permissions
ls -la /Library/Audio/Plug-Ins/HAL/ | grep Sokuji
```

#### Permission Issues

```bash
# Fix driver permissions
sudo chown -R root:wheel /Library/Audio/Plug-Ins/HAL/SokujiVirtualAudio.driver
sudo chmod -R 755 /Library/Audio/Plug-Ins/HAL/SokujiVirtualAudio.driver

# Reset audio system permissions
tccutil reset Microphone com.sokuji.app
```

#### Build Failures

```bash
# Clean build artifacts
rm -rf out/ build/

# Check Xcode version
xcodebuild -version

# Verify certificates
security find-identity -v -p codesigning

# Check for conflicting processes
ps aux | grep -E "Sokuji|BlackHole"
```

#### Notarization Issues

```bash
# Check notarization log
xcrun notarytool log <submission-id> --keychain-profile "AC_PASSWORD"

# Common fixes:
# - Ensure all binaries are signed
# - Include proper entitlements
# - Use hardened runtime
# - Remove quarantine attributes
```

### Debug Mode

Enable detailed logging for troubleshooting:

```bash
# Set debug environment variable
export DEBUG=1
export VERBOSE=1

# Run build with debug output
npm run make:pkg -- --debug

# Check installation logs
sudo log show --predicate 'process == "installer"' --last 10m
```

### Diagnostic Commands

```bash
# Check driver installation
ls -la /Library/Audio/Plug-Ins/HAL/SokujiVirtualAudio.driver

# Verify CoreAudio recognition
system_profiler SPAudioDataType | grep -i sokuji

# Check driver permissions
stat -f "%Su:%Sg" /Library/Audio/Plug-Ins/HAL/SokujiVirtualAudio.driver

# View recent CoreAudio logs
log show --predicate 'process == "coreaudiod"' --last 5m | grep -i sokuji
```

## License Compliance

### BlackHole GPL-3.0 License

Since the virtual audio driver is based on BlackHole (GPL-3.0), the following requirements must be met:

1. **Source Code Availability**: Provide access to modified driver source code
2. **License Notice**: Include GPL-3.0 license in the installer
3. **Attribution**: Credit BlackHole project in documentation
4. **Distribution**: Any distribution must comply with GPL-3.0 terms

### Required Files

```
Sokuji.app/Contents/Resources/
├── LICENSE-GPL3.txt        // BlackHole license
├── NOTICE.txt              // Third-party attributions
└── driver-source/          // Modified driver source code
```

### Attribution Text

Include in installer and about dialog:

```
Virtual audio functionality powered by a modified version of BlackHole
Original project: https://github.com/ExistentialAudio/BlackHole
Licensed under GPL-3.0

Sokuji modifications:
- Custom Bundle ID for compatibility
- Optimized for voice communication
- Integrated installation process
```

## Advanced Topics

### Custom Installation Options

For enterprise deployments:

```bash
# Silent installation
installer -pkg Sokuji.pkg -target / -verboseR

# Custom installation location
installer -pkg Sokuji.pkg -target /Volumes/CustomDisk

# MDM deployment
# Create a configuration profile with:
# - Pre-authorized microphone access
# - Driver installation approval
# - Custom preferences
```

### Version Management

```bash
# Check installed version
defaults read /Applications/Sokuji.app/Contents/Info.plist CFBundleShortVersionString

# Driver version
defaults read /Library/Audio/Plug-Ins/HAL/SokujiVirtualAudio.driver/Contents/Info.plist CFBundleShortVersionString
```

### Uninstallation

Complete uninstallation script:

```bash
#!/bin/bash

# Stop application
killall Sokuji 2>/dev/null

# Remove application
rm -rf /Applications/Sokuji.app

# Remove driver
sudo rm -rf /Library/Audio/Plug-Ins/HAL/SokujiVirtualAudio.driver

# Remove preferences
rm ~/Library/Preferences/com.sokuji.app.plist

# Remove application support
rm -rf ~/Library/Application\ Support/Sokuji

# Restart CoreAudio
sudo killall coreaudiod

echo "Sokuji has been completely uninstalled"
```

## Support and Resources

### Documentation
- [Sokuji Documentation](https://github.com/user/sokuji/docs)
- [BlackHole Project](https://github.com/ExistentialAudio/BlackHole)
- [Apple Developer Documentation](https://developer.apple.com/documentation/)

### Troubleshooting Resources
- Check GitHub Issues for known problems
- Review system logs in Console.app
- Audio MIDI Setup for device configuration
- Contact support for enterprise deployments

---

This guide provides comprehensive coverage of building, packaging, and distributing Sokuji for macOS with integrated virtual audio functionality. The solution ensures users have a seamless, one-click installation experience with all necessary components included.