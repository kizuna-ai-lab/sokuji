# Sokuji Virtual Audio Driver Build Instructions

## 概述

本文档说明如何基于BlackHole源码构建定制的Sokuji虚拟音频驱动。

## 前置要求

1. **Xcode** - 最新版本，支持macOS 10.15+开发
2. **Apple Developer Account** - 用于代码签名
3. **Git** - 用于获取BlackHole源码

## 构建步骤

### 1. 获取BlackHole源码

```bash
# 克隆BlackHole仓库
git clone https://github.com/ExistentialAudio/BlackHole.git
cd BlackHole

# 检查最新稳定版本
git tag --sort=-version:refname | head -5
git checkout v0.5.0  # 使用最新稳定版本
```

### 2. 定制配置

编辑 `BlackHole/BlackHole/BlackHole_Configuration.h`:

```c
// 定制设备名称
#define kPlugIn_BundleID                         "com.sokuji.virtualaudio"
#define kPlugIn_Name                             "Sokuji Virtual Audio"

// 设备配置
#define kDevice_Name                             "Sokuji Virtual Audio"
#define kDevice_ManufacturerName                 "Sokuji"
#define kDevice_ModelUID                         "SokujiVirtualAudioModelUID"

// 只启用2通道版本
#define kNumber_Of_Channels                      2

// 输入/输出流名称
#define kInputStream_Name                        "Sokuji Virtual Input"
#define kOutputStream_Name                       "Sokuji Virtual Output"
```

### 3. 更新项目配置

在Xcode中：

1. 打开 `BlackHole.xcodeproj`
2. 选择 "BlackHole" target
3. 更新 Build Settings:
   - **Product Name**: `SokujiVirtualAudio`
   - **Bundle Identifier**: `com.sokuji.virtualaudio`
   - **Code Signing Identity**: 你的Developer ID Application证书
4. 更新 Info.plist:
   - **CFBundleName**: `Sokuji Virtual Audio`
   - **CFBundleIdentifier**: `com.sokuji.virtualaudio`

### 4. 构建驱动

```bash
# 构建Release版本
xcodebuild -project BlackHole.xcodeproj \
           -target BlackHole \
           -configuration Release \
           BUILD_DIR=build

# 生成的驱动位置
# build/Release/BlackHole.driver
```

### 5. 重命名和复制

```bash
# 重命名为Sokuji驱动
mv build/Release/BlackHole.driver build/Release/SokujiVirtualAudio.driver

# 复制到项目资源目录
cp -r build/Release/SokujiVirtualAudio.driver \
      ../sokuji/resources/drivers/
```

### 6. 代码签名

```bash
# 签名驱动包
codesign --force --sign "Developer ID Application: Your Name (XXXXXXXXXX)" \
         --deep --strict --options=runtime \
         ../sokuji/resources/drivers/SokujiVirtualAudio.driver
```

## 自动化构建脚本

创建 `build_driver.sh` 脚本自动化构建过程：

```bash
#!/bin/bash

# Sokuji Virtual Audio Driver Build Script

set -e

# 配置
BLACKHOLE_DIR="BlackHole"
SOKUJI_DIR="../sokuji"
DRIVER_NAME="SokujiVirtualAudio"
SIGNING_IDENTITY="Developer ID Application: Your Name (XXXXXXXXXX)"

echo "Building Sokuji Virtual Audio Driver..."

# 检查BlackHole源码
if [ ! -d "$BLACKHOLE_DIR" ]; then
    echo "Cloning BlackHole repository..."
    git clone https://github.com/ExistentialAudio/BlackHole.git
    cd $BLACKHOLE_DIR
    git checkout v0.5.0
    cd ..
fi

# 构建驱动
echo "Building driver..."
cd $BLACKHOLE_DIR
xcodebuild -project BlackHole.xcodeproj \
           -target BlackHole \
           -configuration Release \
           BUILD_DIR=build \
           -quiet

# 重命名
mv build/Release/BlackHole.driver build/Release/${DRIVER_NAME}.driver

# 签名
echo "Signing driver..."
codesign --force --sign "$SIGNING_IDENTITY" \
         --deep --strict --options=runtime \
         build/Release/${DRIVER_NAME}.driver

# 复制到Sokuji项目
echo "Copying to Sokuji project..."
rm -rf ${SOKUJI_DIR}/resources/drivers/${DRIVER_NAME}.driver
cp -r build/Release/${DRIVER_NAME}.driver \
      ${SOKUJI_DIR}/resources/drivers/

echo "Sokuji Virtual Audio Driver build completed!"
```

## 许可证注意事项

- BlackHole使用GPL-3.0许可证
- 定制版本必须保持相同许可证
- 确保在应用中包含GPL-3.0许可证声明
- 如需商业许可，联系ExistentialAudio

## 测试

构建完成后，可以手动测试驱动：

```bash
# 手动安装测试
sudo cp -r resources/drivers/SokujiVirtualAudio.driver \
           /Library/Audio/Plug-Ins/HAL/

# 重启CoreAudio
sudo killall coreaudiod

# 检查是否加载
system_profiler SPAudioDataType | grep -i sokuji
```

## 故障排除

1. **构建失败**: 检查Xcode版本和macOS SDK
2. **签名失败**: 验证证书有效性
3. **驱动未加载**: 检查Info.plist配置和权限
4. **设备不显示**: 重启CoreAudio或重启系统