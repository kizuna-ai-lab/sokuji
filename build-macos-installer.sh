#!/bin/bash

# Sokuji macOS Installer Build Script
# This script builds the complete Sokuji application with bundled virtual audio driver

set -e  # Exit on any error

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR"
BLACKHOLE_DIR="$PROJECT_DIR/BlackHole"
DRIVER_NAME="SokujiVirtualAudio"
RESOURCES_DIR="$PROJECT_DIR/resources"
BUILD_DIR="$PROJECT_DIR/build"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."

    # Check if we're on macOS
    if [[ "$OSTYPE" != "darwin"* ]]; then
        log_error "This script must be run on macOS"
        exit 1
    fi

    # Check for Xcode
    if ! command -v xcodebuild &> /dev/null; then
        log_error "Xcode command line tools are required"
        log_info "Install with: xcode-select --install"
        exit 1
    fi

    # Check for Node.js
    if ! command -v node &> /dev/null; then
        log_error "Node.js is required"
        log_info "Install from: https://nodejs.org/"
        exit 1
    fi

    # Check for npm
    if ! command -v npm &> /dev/null; then
        log_error "npm is required (usually comes with Node.js)"
        exit 1
    fi

    # Check npm dependencies
    if [ ! -d "node_modules" ]; then
        log_warning "Node modules not found, installing dependencies..."
        npm install
    fi

    log_success "All prerequisites satisfied"
}

# Function to clone and prepare BlackHole source
prepare_blackhole_source() {
    log_info "Preparing BlackHole source code..."

    if [ ! -d "$BLACKHOLE_DIR" ]; then
        log_info "Cloning BlackHole repository..."
        git clone https://github.com/ExistentialAudio/BlackHole.git "$BLACKHOLE_DIR"

        cd "$BLACKHOLE_DIR"
        # Use the latest stable version
        LATEST_TAG=$(git tag --sort=-version:refname | head -1)
        log_info "Checking out BlackHole version: $LATEST_TAG"
        git checkout "$LATEST_TAG"
        cd "$PROJECT_DIR"
    else
        log_info "BlackHole source already exists"
    fi

    log_success "BlackHole source prepared"
}

# Function to customize BlackHole configuration
customize_blackhole() {
    log_info "Customizing BlackHole configuration..."

    local source_file="$BLACKHOLE_DIR/BlackHole/BlackHole.c"
    local backup_file="$source_file.backup"

    # Create backup if it doesn't exist
    if [ ! -f "$backup_file" ]; then
        cp "$source_file" "$backup_file"
        log_info "Created backup of original BlackHole.c"
    fi

    # For newer versions of BlackHole, we need to modify the source file directly
    # or use compiler flags to override the definitions

    # Method 1: Create a custom header file that we'll inject
    local custom_config="$BLACKHOLE_DIR/BlackHole/SokujiConfig.h"
    cat > "$custom_config" << 'EOF'
//==============================================================================
//  SokujiConfig.h - Custom configuration for Sokuji Virtual Audio
//==============================================================================

#ifndef SokujiConfig_h
#define SokujiConfig_h

// Override BlackHole defaults
#undef kPlugIn_BundleID
#undef kDevice_Name
#undef kNumber_Of_Channels

// Plugin Configuration
#define kPlugIn_BundleID                         "com.sokuji.virtualaudio"

// Device Configuration
#define kDevice_Name                             "Sokuji Virtual Audio"

// Channel Configuration (2-channel only)
#define kNumber_Of_Channels                      2

#endif /* SokujiConfig_h */
EOF

    # Method 2: Modify BlackHole.c to include our custom config
    # Insert our custom config include after the existing includes
    if ! grep -q "SokujiConfig.h" "$source_file"; then
        # Find the line number after the standard includes
        local insert_line=$(grep -n "#include <CoreAudio/AudioServerPlugIn.h>" "$source_file" | cut -d: -f1)

        if [ -n "$insert_line" ]; then
            # Insert our custom include after the CoreAudio include
            insert_line=$((insert_line + 1))
            sed -i '' "${insert_line}i\\
#include \"SokujiConfig.h\"  // Sokuji custom configuration\\
" "$source_file"
            log_info "Injected custom configuration include into BlackHole.c"
        else
            log_warning "Could not find insertion point for custom config, will use compiler flags instead"
        fi
    fi

    # Also update the Info.plist to use our bundle ID
    local plist_file="$BLACKHOLE_DIR/BlackHole/BlackHole.plist"
    if [ -f "$plist_file" ]; then
        # Replace the bundle identifier
        sed -i '' 's/audio\.existential\.BlackHole[0-9]*ch/com.sokuji.virtualaudio/g' "$plist_file"
        # Replace the name
        sed -i '' 's/<string>BlackHole [0-9]*ch<\/string>/<string>Sokuji Virtual Audio<\/string>/g' "$plist_file"
        log_info "Updated Info.plist with Sokuji configuration"
    fi

    log_success "BlackHole configuration customized for Sokuji"
}

# Function to build the virtual audio driver
build_virtual_driver() {
    log_info "Building Sokuji Virtual Audio driver..."

    cd "$BLACKHOLE_DIR"

    # Clean previous builds
    if [ -d "build" ]; then
        rm -rf build
    fi

    # Build the driver with custom configuration
    # Use compiler flags as additional override method
    log_info "Compiling driver with Xcode..."

    # Try to build with custom settings, disable code signing
    xcodebuild -project BlackHole.xcodeproj \
               -target BlackHole \
               -configuration Release \
               BUILD_DIR=build \
               PRODUCT_NAME="$DRIVER_NAME" \
               PRODUCT_BUNDLE_IDENTIFIER="com.sokuji.virtualaudio" \
               CODE_SIGN_IDENTITY="" \
               CODE_SIGNING_REQUIRED="NO" \
               CODE_SIGN_ENTITLEMENTS="" \
               CODE_SIGNING_ALLOWED="NO" \
               DEVELOPMENT_TEAM="" \
               MACOSX_DEPLOYMENT_TARGET="10.15" \
               GCC_PREPROCESSOR_DEFINITIONS='kPlugIn_BundleID=\"com.sokuji.virtualaudio\" kDevice_Name=\"Sokuji\ Virtual\ Audio\" kNumber_Of_Channels=2' \
               -quiet || {
        # If the build with custom settings fails, try the standard build
        log_warning "Custom build failed, trying standard build without signing..."
        xcodebuild -project BlackHole.xcodeproj \
                   -target BlackHole \
                   -configuration Release \
                   BUILD_DIR=build \
                   CODE_SIGN_IDENTITY="" \
                   CODE_SIGNING_REQUIRED="NO" \
                   CODE_SIGN_ENTITLEMENTS="" \
                   CODE_SIGNING_ALLOWED="NO" \
                   DEVELOPMENT_TEAM="" \
                   MACOSX_DEPLOYMENT_TARGET="10.15" \
                   -quiet
    }

    # Check if driver was built
    local driver_path="build/Release/BlackHole.driver"
    if [ ! -d "$driver_path" ]; then
        # Try with the custom name
        driver_path="build/Release/$DRIVER_NAME.driver"
        if [ ! -d "$driver_path" ]; then
            log_error "Driver build failed - no driver found"
            exit 1
        fi
    else
        # Rename to Sokuji driver if needed
        if [ -d "build/Release/BlackHole.driver" ]; then
            mv "build/Release/BlackHole.driver" "build/Release/$DRIVER_NAME.driver"
        fi
    fi

    # Update the driver's Info.plist
    local driver_plist="build/Release/$DRIVER_NAME.driver/Contents/Info.plist"
    if [ -f "$driver_plist" ]; then
        # Update bundle identifier
        /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier com.sokuji.virtualaudio" "$driver_plist" 2>/dev/null || true
        # Update bundle name
        /usr/libexec/PlistBuddy -c "Set :CFBundleName 'Sokuji Virtual Audio'" "$driver_plist" 2>/dev/null || true
        log_info "Updated driver Info.plist"
    fi

    log_success "Virtual audio driver built successfully"
    cd "$PROJECT_DIR"
}

# Function to sign the driver (optional, requires developer certificate)
sign_driver() {
    local signing_identity="$1"

    if [ -z "$signing_identity" ]; then
        log_warning "No signing identity provided, skipping code signing"
        log_warning "The driver may not load on systems with strict security settings"
        return 0
    fi

    log_info "Signing virtual audio driver..."

    local driver_path="$BLACKHOLE_DIR/build/Release/$DRIVER_NAME.driver"

    # Sign the driver
    codesign --force --sign "$signing_identity" \
             --deep --strict --options=runtime \
             "$driver_path"

    if [ $? -eq 0 ]; then
        log_success "Driver signed successfully"
    else
        log_error "Driver signing failed"
        exit 1
    fi
}

# Function to copy driver to resources
copy_driver_to_resources() {
    log_info "Copying driver to project resources..."

    local source_driver="$BLACKHOLE_DIR/build/Release/$DRIVER_NAME.driver"
    local dest_driver="$RESOURCES_DIR/drivers/$DRIVER_NAME.driver"

    # Create drivers directory if it doesn't exist
    mkdir -p "$RESOURCES_DIR/drivers"

    # Remove existing driver if present
    if [ -d "$dest_driver" ]; then
        rm -rf "$dest_driver"
    fi

    # Copy the driver
    cp -r "$source_driver" "$dest_driver"

    # Verify copy
    if [ -d "$dest_driver" ]; then
        log_success "Driver copied to resources successfully"
    else
        log_error "Failed to copy driver to resources"
        exit 1
    fi
}

# Function to build the Electron application
build_electron_app() {
    log_info "Building Electron application..."

    # Ensure we're in the project directory
    cd "$PROJECT_DIR"

    # Clean previous builds
    if [ -d "out" ]; then
        rm -rf out
    fi

    # Build for macOS only
    log_info "Building Electron app for macOS..."
    npm run make -- --platform=darwin

    if [ $? -eq 0 ]; then
        log_success "Electron application built successfully"
    else
        log_error "Electron application build failed"
        exit 1
    fi
}

# Function to create PKG installer
create_pkg_installer() {
    log_info "PKG installer will be created by Electron Forge"
    log_info "Check the 'out' directory for the generated installer"

    # Find the generated PKG file
    local pkg_file=$(find out -name "*.pkg" -type f | head -1)

    if [ -n "$pkg_file" ]; then
        log_success "PKG installer created: $pkg_file"

        # Get file size
        local file_size=$(du -h "$pkg_file" | cut -f1)
        log_info "Installer size: $file_size"

        # Show final location
        log_success "Installation package ready: $(basename "$pkg_file")"
    else
        log_warning "PKG installer not found in out directory"
    fi
}

# Function to show usage information
show_usage() {
    cat << EOF
Usage: $0 [OPTIONS]

Build Sokuji macOS installer with bundled virtual audio driver.

OPTIONS:
    -s, --sign IDENTITY     Code signing identity (e.g., "Developer ID Application: Your Name")
    -c, --clean            Clean all build artifacts before building
    -h, --help             Show this help message

EXAMPLES:
    $0                     Build without code signing
    $0 --clean             Clean build from scratch
    $0 --sign "Developer ID Application: John Doe (XXXXXXXXXX)"

NOTES:
    - Requires Xcode command line tools
    - Requires Node.js and npm
    - Code signing is optional but recommended for distribution
    - The generated PKG installer will include both the app and virtual audio driver
EOF
}

# Function to clean build artifacts
clean_build() {
    log_info "Cleaning build artifacts..."

    # Remove build directories
    [ -d "out" ] && rm -rf out
    [ -d "dist-electron" ] && rm -rf dist-electron
    [ -d "$BLACKHOLE_DIR/build" ] && rm -rf "$BLACKHOLE_DIR/build"
    [ -d "$RESOURCES_DIR/drivers" ] && rm -rf "$RESOURCES_DIR/drivers"

    log_success "Build artifacts cleaned"
}

# Main build function
main_build() {
    local signing_identity="$1"

    log_info "Starting Sokuji macOS installer build process..."
    echo "========================================================"

    check_prerequisites
    prepare_blackhole_source
    customize_blackhole
    build_virtual_driver

    if [ -n "$signing_identity" ]; then
        sign_driver "$signing_identity"
    fi

    copy_driver_to_resources
    build_electron_app
    create_pkg_installer

    echo "========================================================"
    log_success "Sokuji macOS installer build completed successfully!"
    log_info "Next steps:"
    log_info "1. Test the generated PKG installer on a clean macOS system"
    log_info "2. Verify that the virtual audio driver is installed correctly"
    log_info "3. Test the application functionality with video conferencing apps"
    log_info "4. If distributing publicly, notarize the installer with Apple"
}

# Parse command line arguments
SIGNING_IDENTITY=""
CLEAN_BUILD=false

while [[ $# -gt 0 ]]; do
    case $1 in
        -s|--sign)
            SIGNING_IDENTITY="$2"
            shift 2
            ;;
        -c|--clean)
            CLEAN_BUILD=true
            shift
            ;;
        -h|--help)
            show_usage
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            show_usage
            exit 1
            ;;
    esac
done

# Execute main build process
if [ "$CLEAN_BUILD" = true ]; then
    clean_build
fi

main_build "$SIGNING_IDENTITY"