# Sokuji Virtual Audio Driver for macOS

## Overview
Sokuji Virtual Audio driver 是基于 BlackHole 开源项目的自定义虚拟音频驱动。它允许 Sokuji 应用在 macOS 上创建虚拟麦克风，实现实时音频翻译功能。

## 关键修改

### 1. Bundle ID 冲突解决
- **问题**：原版 BlackHole 和 Sokuji driver 使用相同的 Bundle ID 导致冲突
- **解决**：修改为独特的 Bundle ID: `com.sokuji.virtualaudio`

### 2. 自定义配置文件
`BlackHole/BlackHole/SokujiConfig.h`:
- `kDriver_Name`: "Sokuji"
- `kPlugIn_BundleID`: "com.sokuji.virtualaudio"
- `kDevice_Name`: "Sokuji Virtual Audio"
- `kNumber_Of_Channels`: 2

### 3. 编译流程
1. 运行编译脚本：`./build-sokuji-driver.sh`
2. Driver 会被复制到 `resources/drivers/SokujiVirtualAudio.driver`
3. PKG 安装时会自动将 driver 安装到系统

## 构建和安装

### 编译 Driver
```bash
# 编译 Sokuji Virtual Audio driver
./build-sokuji-driver.sh
```

### 构建 PKG 安装包
```bash
# 构建包含 driver 的 PKG
npm run make:pkg
# 或
./build-pkg.sh
```

### 安装
```bash
# 安装 PKG（包含 driver）
./install-pkg.sh
```

## Driver 安装位置
- 系统位置：`/Library/Audio/Plug-Ins/HAL/SokujiVirtualAudio.driver`
- 应用包内：`/Applications/Sokuji.app/Contents/Resources/resources/drivers/`

## 与原版 BlackHole 的兼容性
修改后的 Sokuji driver 可以与原版 BlackHole 同时存在，因为：
1. 使用不同的 Bundle ID
2. 设备名称不同
3. 不会产生 UUID 冲突

## 故障排除

### Driver 未加载
1. 检查安装：`ls -la /Library/Audio/Plug-Ins/HAL/SokujiVirtualAudio.driver`
2. 重启 CoreAudio：`sudo killall coreaudiod`
3. 检查音频设备：`system_profiler SPAudioDataType | grep -i sokuji`

### 诊断工具
运行诊断脚本：
```bash
./diagnose-audio-driver.sh
```

### 卸载
完全卸载 Sokuji 和 driver：
```bash
./uninstall-sokuji.sh
```

## 许可
基于 BlackHole 项目（GPLv3 许可）。更多信息请访问：
https://github.com/ExistentialAudio/BlackHole