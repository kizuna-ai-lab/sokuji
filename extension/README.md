# Sokuji 浏览器扩展

这是 Sokuji 实时翻译应用的浏览器扩展版本，使用 OpenAI 的 Realtime API 提供实时同声传译功能。

## 功能特点

- 复用原有 Sokuji React 应用的大部分代码
- 在浏览器中提供与桌面应用相同的功能
- 支持实时音频处理和翻译
- 可以在任何网页中使用

## 开发环境设置

### 安装依赖

```bash
cd extension
npm install
```

### 开发模式构建

```bash
npm run dev
```

这将启动 webpack 的监视模式，当你修改代码时自动重新构建扩展。

### 生产模式构建

```bash
npm run build
```

## 在浏览器中加载扩展

### Chrome

1. 打开 Chrome 浏览器，访问 `chrome://extensions/`
2. 启用右上角的"开发者模式"
3. 点击"加载已解压的扩展程序"
4. 选择 `extension/dist` 目录

### Firefox

1. 打开 Firefox 浏览器，访问 `about:debugging#/runtime/this-firefox`
2. 点击"临时载入附加组件"
3. 选择 `extension/dist/manifest.json` 文件

## 使用方法

1. 点击浏览器工具栏中的 Sokuji 图标打开扩展弹出窗口
2. 在设置中输入你的 OpenAI API 密钥
3. 配置模型和其他设置
4. 点击"开始会话"按钮开始使用

## 在网页中使用

点击扩展图标后，你可以选择"在当前页面中打开"，这将在当前网页中注入 Sokuji 界面，可以拖动和调整位置。

## 技术细节

这个浏览器扩展使用以下技术：

- React 用于用户界面
- OpenAI Realtime API 用于实时翻译
- Web Audio API 用于音频处理
- Chrome 扩展 API 用于浏览器集成

## 与桌面版的区别

浏览器扩展版本与桌面版的主要区别：

1. 使用 Web Audio API 而不是 Electron 的音频功能
2. 使用浏览器存储而不是本地文件系统
3. 没有虚拟音频设备功能（浏览器限制）
4. 界面适应浏览器扩展的弹出窗口和网页注入模式
