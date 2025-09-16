# PKG Installer Setup with Virtual Audio Driver

This document explains how to set up the PKG installer for Sokuji with automatic virtual audio driver installation.

## Prerequisites

### 1. Code Signing Certificate

PKG installers require a valid code signing certificate. You have two options:

#### Option A: Apple Developer Certificate (Recommended for Distribution)
1. Enroll in the Apple Developer Program ($99/year)
2. Create a "Developer ID Installer" certificate in Xcode or Developer portal
3. Download and install the certificate in your Keychain

#### Option B: Self-Signed Certificate (Development/Testing Only)
```bash
# Create a self-signed certificate (development only)
security create-keypair -a rsa -s 2048 -d "Sokuji Development Certificate" \
  -k ~/Library/Keychains/login.keychain "Developer ID Installer: Sokuji Dev"

# Trust the certificate for code signing
security set-key-partition-list -S apple-tool:,apple: \
  -k ~/Library/Keychains/login.keychain "Developer ID Installer: Sokuji Dev"
```

### 2. Enable PKG Maker

In `forge.config.js`, uncomment and configure the PKG maker:

```javascript
{
  name: '@electron-forge/maker-pkg',
  config: {
    name: 'Sokuji',
    identity: 'Developer ID Installer: Your Certificate Name',
    scripts: 'build/scripts',
    installLocation: '/Applications',
    welcome: 'resources/installer-welcome.html',
    conclusion: 'resources/installer-conclusion.html'
  }
}
```

## PKG Installer Components

### Pre-installation Script (`build/scripts/preinstall`)
- Checks macOS version compatibility (10.15+)
- Verifies disk space and permissions
- Creates HAL plugin directory
- Backs up existing driver installations

### Post-installation Script (`build/scripts/postinstall`)
- Copies SokujiVirtualAudio.driver to system location
- Sets correct permissions (root:wheel)
- Restarts CoreAudio daemon
- Verifies installation success
- Creates success marker for app detection

### Installation Flow
```
User runs PKG → System requests admin password →
Preinstall checks → App installation → Postinstall driver setup →
CoreAudio restart → Ready to use
```

## Building PKG Installer

```bash
# Build PKG installer (requires code signing certificate)
npm run make -- --platform=darwin --makers=@electron-forge/maker-pkg

# The installer will be created at:
# out/make/Sokuji-[version].pkg
```

## Manual Driver Installation (Alternative)

If PKG installer is not available, users can manually install the driver:

```bash
# Copy driver to system location (requires admin password)
sudo cp -R "/Applications/Sokuji.app/Contents/Resources/resources/drivers/SokujiVirtualAudio.driver" \
  "/Library/Audio/Plug-Ins/HAL/"

# Set correct permissions
sudo chown -R root:wheel "/Library/Audio/Plug-Ins/HAL/SokujiVirtualAudio.driver"
sudo chmod -R 755 "/Library/Audio/Plug-Ins/HAL/SokujiVirtualAudio.driver"

# Restart CoreAudio
sudo killall coreaudiod
```

## Troubleshooting

### PKG Build Fails - "No identity found for signing"
- Verify certificate is installed: `security find-identity -v -p codesigning`
- Check certificate name matches `identity` field in forge.config.js
- Ensure certificate is trusted for code signing

### Driver Not Loading After Installation
- Check driver exists: `ls -la "/Library/Audio/Plug-Ins/HAL/SokujiVirtualAudio.driver"`
- Verify permissions: `ls -la "/Library/Audio/Plug-Ins/HAL/" | grep Sokuji`
- Restart CoreAudio: `sudo killall coreaudiod`
- Check system audio devices: `system_profiler SPAudioDataType | grep -i sokuji`

### Installation Permissions Denied
- Ensure PKG installer runs with admin privileges
- Check macOS Gatekeeper settings (System Preferences > Security & Privacy)
- For development builds, may need to allow "App Store and identified developers"

## Current Status

- ✅ Installation scripts created and tested
- ✅ Driver bundling configured
- ✅ Application logic updated to work with PKG installation
- ⏳ PKG maker requires code signing certificate setup
- ✅ DMG distribution available as fallback (manual driver installation required)

## Next Steps

1. Set up Apple Developer certificate or create self-signed certificate
2. Enable PKG maker in forge.config.js
3. Test PKG installer build and installation process
4. Verify virtual audio driver functionality in video conferencing apps