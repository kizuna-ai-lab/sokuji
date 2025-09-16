# Sokuji macOS 安装程序指南

## 🎯 概述

Sokuji现在支持将虚拟音频驱动直接打包到macOS安装程序中，用户只需要一次安装即可获得完整功能，无需在运行时下载和安装BlackHole。

## 🏗️ 架构设计

### 安装包组件

```
Sokuji.pkg
├── Sokuji.app                              // 主应用程序
├── SokujiVirtualAudio.driver              // 定制虚拟音频驱动
├── preinstall脚本                         // 安装前检查
├── postinstall脚本                        // 驱动安装
└── 安装界面                               // 欢迎页和结论页
```

### 驱动定制方案

基于BlackHole (GPL-3.0) 源码，定制为：
- **驱动名称**: Sokuji Virtual Audio
- **Bundle ID**: com.sokuji.virtualaudio
- **设备名称**: "Sokuji Virtual Audio"
- **通道配置**: 2通道立体声
- **采样率**: 44.1kHz, 48kHz支持

## 🚀 使用方法

### 快速构建

```bash
# 基础构建（无代码签名）
./build-macos-installer.sh

# 清理后重新构建
./build-macos-installer.sh --clean

# 带代码签名的构建（推荐用于分发）
./build-macos-installer.sh --sign "Developer ID Application: Your Name (XXXXXXXXXX)"
```

### 详细构建过程

1. **准备阶段**
   ```bash
   # 检查系统要求
   # - macOS 10.15+
   # - Xcode命令行工具
   # - Node.js和npm
   ```

2. **驱动构建**
   ```bash
   # 自动克隆BlackHole源码
   # 应用Sokuji定制配置
   # 编译生成SokujiVirtualAudio.driver
   ```

3. **应用打包**
   ```bash
   # 构建Electron应用
   # 打包为PKG安装程序
   # 包含预/后安装脚本
   ```

## 📁 项目结构

### 新增文件

```
sokuji/
├── build/
│   └── scripts/
│       ├── preinstall                     // 安装前检查脚本
│       └── postinstall                    // 驱动安装脚本
├── resources/
│   ├── drivers/
│   │   ├── SokujiVirtualAudio.driver/     // 驱动包目录
│   │   └── BUILD_INSTRUCTIONS.md          // 驱动构建指南
│   ├── installer-welcome.html             // 安装欢迎页
│   └── installer-conclusion.html          // 安装完成页
├── build-macos-installer.sh               // 自动化构建脚本
└── MACOS_INSTALLER_README.md              // 本文档
```

### 修改文件

```
├── forge.config.js                        // 添加PKG maker配置
├── vite.config.ts                         // 添加macOS音频模块
├── electron/
│   ├── main.js                            // 支持macOS平台检测
│   ├── macos-audio-utils.js               // macOS音频工具类
│   └── preload.js                         // 添加macOS IPC通道
```

## 🔧 配置说明

### Electron Forge PKG配置

```javascript
{
  name: '@electron-forge/maker-pkg',
  config: {
    name: 'Sokuji',
    identity: 'Developer ID Installer: Your Name (XXXXXXXXXX)',
    scripts: 'build/scripts',
    installLocation: '/Applications',
    welcome: 'resources/installer-welcome.html',
    conclusion: 'resources/installer-conclusion.html'
  }
}
```

### 虚拟音频驱动配置

```c
// BlackHole_Configuration.h
#define kPlugIn_BundleID                "com.sokuji.virtualaudio"
#define kPlugIn_Name                    "Sokuji Virtual Audio"
#define kDevice_Name                    "Sokuji Virtual Audio"
#define kNumber_Of_Channels             2
```

## 🔐 代码签名和分发

### 开发者证书要求

1. **Developer ID Application**: 签名应用程序
2. **Developer ID Installer**: 签名PKG安装包

### 签名流程

```bash
# 签名驱动
codesign --force --sign "Developer ID Application: Your Name" \
         --deep --strict --options=runtime \
         SokujiVirtualAudio.driver

# PKG会由Electron Forge自动签名
```

### 公证（Notarization）

对于公开分发，需要通过Apple公证：

```bash
# 上传到Apple进行公证
xcrun notarytool submit Sokuji.pkg \
         --keychain-profile "AC_PASSWORD" \
         --wait

# 装订公证票据
xcrun stapler staple Sokuji.pkg
```

## 📋 安装流程

### 用户安装体验

1. **下载**: 用户下载Sokuji.pkg
2. **启动安装**: 双击PKG文件
3. **欢迎界面**: 显示功能介绍和系统要求
4. **权限请求**: 请求管理员权限
5. **预安装检查**: 验证系统兼容性和磁盘空间
6. **主安装**: 安装应用到/Applications
7. **后安装**: 安装虚拟音频驱动，重启CoreAudio
8. **完成界面**: 显示使用说明和下一步操作

### 安装结果

- **应用程序**: `/Applications/Sokuji.app`
- **虚拟音频驱动**: `/Library/Audio/Plug-Ins/HAL/SokujiVirtualAudio.driver`
- **音频设备**: 系统偏好设置中显示"Sokuji Virtual Audio"

## 🧪 测试指南

### 本地测试

```bash
# 构建安装包
./build-macos-installer.sh --clean

# 在虚拟机或测试机上安装
# 验证以下功能：
# 1. 应用程序正常启动
# 2. 虚拟音频设备在系统设置中可见
# 3. 音频路由工作正常
# 4. 与视频会议应用集成正常
```

### 验证清单

- [ ] PKG安装包能正常打开
- [ ] 安装过程中没有错误
- [ ] 应用程序安装到正确位置
- [ ] 虚拟音频驱动正确安装
- [ ] CoreAudio识别新设备
- [ ] 系统偏好设置显示"Sokuji Virtual Audio"
- [ ] 视频会议应用可以选择虚拟设备
- [ ] 音频实时传输工作正常
- [ ] 卸载功能正常工作

## 🐛 故障排除

### 常见问题

1. **驱动未加载**
   ```bash
   # 检查驱动是否存在
   ls -la /Library/Audio/Plug-Ins/HAL/SokujiVirtualAudio.driver

   # 重启CoreAudio
   sudo killall coreaudiod

   # 检查系统日志
   log show --predicate 'process == "coreaudiod"' --last 1m
   ```

2. **权限问题**
   ```bash
   # 检查驱动权限
   ls -la /Library/Audio/Plug-Ins/HAL/

   # 修复权限（如需要）
   sudo chown -R root:wheel /Library/Audio/Plug-Ins/HAL/SokujiVirtualAudio.driver
   sudo chmod -R 755 /Library/Audio/Plug-Ins/HAL/SokujiVirtualAudio.driver
   ```

3. **构建失败**
   ```bash
   # 清理并重试
   ./build-macos-installer.sh --clean

   # 检查Xcode版本
   xcodebuild -version

   # 检查证书
   security find-identity -v -p codesigning
   ```

### 调试模式

```bash
# 启用详细日志
export DEBUG=1
./build-macos-installer.sh

# 查看安装日志
sudo log show --predicate 'process == "installer"' --last 10m
```

## 📄 许可证合规

### BlackHole GPL-3.0

- 基于BlackHole (GPL-3.0)的定制驱动必须保持开源
- 在安装界面和应用关于页面显示GPL-3.0许可证
- 提供源代码访问链接

### 许可证文件

确保包含以下文件：
- `LICENSE-GPL3.txt` - BlackHole驱动许可证
- `NOTICE.txt` - 第三方组件声明
- `COPYRIGHT.txt` - 版权声明

## 🚀 高级功能

### 自定义安装选项

可以扩展安装程序支持：
- 选择性安装组件
- 自定义安装路径
- 安装后配置向导

### 企业分发

对于企业用户：
- MDM（移动设备管理）支持
- 静默安装选项
- 企业证书签名

### 版本更新

支持应用内更新：
- 检测新版本
- 增量更新驱动
- 保持用户配置

## 📞 支持联系

如遇到问题：

1. 查看本文档的故障排除部分
2. 检查GitHub Issues
3. 联系技术支持团队

---

**注意**: 本方案将虚拟音频驱动完全集成到安装包中，为用户提供一键安装体验，避免运行时下载和复杂配置，显著提升用户体验。