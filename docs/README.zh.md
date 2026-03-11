<p align="center">
  <img width="200" src="https://github.com/kizuna-ai-lab/sokuji/raw/main/src/assets/logo.png" alt="Sokuji Logo">
</p>

<p align="center">
  <em>由本地AI和云端服务商驱动的实时语音翻译 — OpenAI、Google Gemini、Palabra.ai、Kizuna AI、火山引擎等</em>
</p>

<p align="center">   
  <a href="../LICENSE" target="_blank">
    <img alt="AGPL-3.0 License" src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg?style=flat-square" />
  </a>
  
  <!-- Build and Release Badge -->
  <a href="https://github.com/kizuna-ai-lab/sokuji/actions/workflows/build.yml" target="_blank">
    <img alt="Build and Release" src="https://github.com/kizuna-ai-lab/sokuji/actions/workflows/build.yml/badge.svg" />
  </a>
  
  <!-- OpenAI Badge -->
  <img alt="OpenAI" src="https://img.shields.io/badge/-OpenAI-eee?style=flat-square&logo=openai&logoColor=412991" />
  
  <!-- Google Gemini Badge -->
  <img alt="Google Gemini" src="https://img.shields.io/badge/Google%20Gemini-4285F4?style=flat-square&logo=google-gemini&logoColor=white" />
  
  <!-- Palabra.ai Badge -->
  <img alt="Palabra.ai" src="https://img.shields.io/badge/Palabra.ai-black?style=flat-square&logo=websockets&logoColor=white" />

  <!-- Vibe Coding Badge -->
  <img alt="Vibe Coding" src="https://img.shields.io/badge/built%20with-vibe%20coding-ff69b4?style=flat-square" />
  
  <!-- DeepWiki Badge -->
  <a href="https://deepwiki.com/kizuna-ai-lab/sokuji" target="_blank">
    <img alt="Ask DeepWiki" src="https://deepwiki.com/badge.svg" />
  </a>
</p>

<p align="center">
  <a href="../README.md">English</a> | <a href="README.ja.md">日本語</a> | 中文
</p>

# 为什么选择 Sokuji？

Sokuji 是一款跨平台的实时语音翻译应用，同时支持桌面端和浏览器端。它支持**本地推理** — 通过 WASM 和 WebGPU 在设备上运行 ASR、翻译和 TTS，无需 API 密钥，完全离线，隐私完全保护。同时还集成了 OpenAI、Google Gemini、Palabra.ai、Kizuna AI、火山引擎 ST、豆包 AST 2.0 以及 OpenAI 兼容 API 等云端服务商。

https://github.com/user-attachments/assets/1eaaa333-a7ce-4412-a295-16b7eb2310de

# 浏览器扩展现已上线！

不想安装桌面应用？试试我们面向 Chrome、Edge 及其他基于 Chromium 的浏览器推出的浏览器扩展。它可直接在浏览器中提供同样强大的实时语音翻译功能，并与 Google Meet、Microsoft Teams、Zoom、Discord、Slack、Gather.town、Whereby 等主流视频会议平台无缝集成。

<p>
  <a href="https://chromewebstore.google.com/detail/ppmihnhelgfpjomhjhpecobloelicnak?utm_source=item-share-cb" target="_blank">
    <img alt="Available on Chrome Web Store" src="https://github.com/kizuna-ai-lab/sokuji/raw/main/assets/chrome-web-store-badge.png" style="height: 60px;" />
  </a>
  <a href="https://microsoftedge.microsoft.com/addons/detail/sokuji-aipowered-live-/dcmmcdkeibkalgdjlahlembodjhijhkm" target="_blank">
    <img alt="Available on Microsoft Edge Add-ons" src="https://github.com/kizuna-ai-lab/sokuji/raw/main/assets/edge-addons-badge.png" style="height: 60px;" />
  </a>
  <a href="https://www.producthunt.com/posts/sokuji?embed=true&utm_source=badge-featured&utm_medium=badge&utm_source=badge-sokuji" target="_blank">
    <img src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=967440&theme=light&t=1748250774125" alt="Sokuji - Live&#0032;speech&#0032;translation&#0032;with&#0032;real&#0045;time&#0032;AI | Product Hunt" style="height: 60px;" />
  </a>
</p>

## 以开发者模式安装浏览器扩展

如需安装最新版本的浏览器扩展：

1. 从[发布页面](https://github.com/kizuna-ai-lab/sokuji/releases)下载最新的 `sokuji-extension.zip`
2. 将压缩文件解压到某个文件夹
3. 打开 Chrome/Chromium，访问 `chrome://extensions/`
4. 在右上角启用"开发者模式"
5. 点击"加载已解压的扩展程序"并选择解压后的文件夹
6. Sokuji 扩展将安装完成并可以使用

# 功能特性

### AI 翻译
- **8 个 AI 服务商**：OpenAI、Google Gemini、Palabra.ai、Kizuna AI、火山引擎 ST、豆包 AST 2.0、OpenAI 兼容、本地推理
- **支持的模型**：
  - **OpenAI**：`gpt-realtime-mini`、`gpt-realtime-1.5`
  - **Google Gemini**：`gemini-2.0-flash-live-001`、`gemini-2.5-flash-preview-native-audio-dialog`
  - **Palabra.ai**：通过 WebRTC 进行实时语音翻译
  - **Kizuna AI**：后端托管认证的 OpenAI 兼容模型
  - **OpenAI 兼容**：支持自定义 OpenAI 兼容 API 端点（仅限 Electron）
  - **火山引擎 ST**：采用 V4 签名认证的实时语音翻译
  - **豆包 AST 2.0**：基于 protobuf-over-WebSocket 的语音翻译
  - **本地推理**：设备端 ASR、翻译和 TTS — 无需 API 密钥或网络连接
- **自动轮次检测**，支持 OpenAI 的多种模式（普通、语义、禁用）
- **一键通话模式**：手动控制语音以精确把握翻译时机
- **WebRTC 传输**：OpenAI 服务商的低延迟替代传输方案

### 本地推理（边缘 AI）
- **隐私优先**：所有处理均在设备上进行 — 音频、转录和翻译均不离开您的设备
- **无需 API 密钥**：下载开源模型，完全离线运行
- **ASR**：48 个模型（32 个离线 + 10 个流式 + 6 个 Whisper WebGPU），覆盖 99 种以上语言（sherpa-onnx WASM + Whisper WebGPU）
- **翻译**：55 个以上 Opus-MT 语言对，加上 4 个多语言 LLM（Qwen 2.5 / 3 / 3.5），支持 WebGPU
- **TTS**：53 种语言的 136 个模型（Piper、Coqui、Mimic3、Matcha 引擎），通过 sherpa-onnx WASM 提供
- **硬件灵活性**：CPU（WASM）保证通用兼容性，WebGPU 提供 GPU 加速推理
- **模型管理**：一键下载、IndexedDB 缓存、失败恢复

### 音频
- **具备双队列音频混音系统的高级虚拟麦克风**：
  - **常规音频轨道**：排队并按顺序播放
  - **即时音频轨道**：用于实时音频混音的独立队列
  - **同步播放**：混合两种轨道类型以增强音频体验
  - **分块音频支持**：高效处理大型音频流
  - **跨平台支持**：Windows（VB-Cable）、macOS（虚拟音频驱动）、Linux（PulseAudio/PipeWire）
- **系统音频捕获**：在视频通话中捕获参与者音频进行翻译（所有平台）
- **实时语音直通**：录音会话期间的实时音频监听
- **虚拟音频设备管理**，支持自动路由和设备切换（Windows、macOS、Linux）
- **音频可视化**，带波形显示

### 用户界面
- **简洁模式界面**：为非技术用户提供的精简 6 分区配置：
  - 界面语言选择
  - 翻译语言对（源语言/目标语言）
  - 带验证功能的 API 密钥管理
  - 麦克风选择（含"关闭"选项）
  - 扬声器选择（含"关闭"选项）
  - 实时会话时长显示
- **多语言支持**：完整的 30 种语言国际化，英语作为备用
- **增强型工具提示**：由 @floating-ui 驱动的交互式帮助提示，提供更好的用户引导
- **全面的日志**，用于追踪 API 交互

### 配置
- **API 密钥验证**，提供实时反馈
- **可自定义模型设置**（温度、最大令牌数）
- **用户转录模型选择**（OpenAI：`gpt-4o-mini-transcribe`、`gpt-4o-transcribe`、`whisper-1`）
- **降噪选项**（OpenAI：无、近场、远场）
- **配置持久化**，保存在用户主目录
- **分析**：PostHog 集成，用于匿名使用情况追踪

# 快速开始

## 前置条件

- 至少一个**云端**服务商的 API 密钥（或使用**本地推理**，无需 API 密钥，完全离线运行）：
  - **OpenAI**：来自 OpenAI 的 API 密钥
  - **Google Gemini**：来自 Google AI Studio 的 API 密钥
  - **Palabra.ai**：客户端 ID 和客户端密钥
  - **Kizuna AI**：登录账号即可自动获取后端托管的 API 密钥
  - **火山引擎 ST**：访问密钥 ID 和秘密访问密钥
  - **豆包 AST 2.0**：APP ID 和访问令牌
  - **OpenAI 兼容**：API 密钥和自定义端点 URL（仅限 Electron）
- （可选）用于应用间音频路由的虚拟音频设备软件：
  - Windows：VB-Cable 或类似的虚拟音频线缆
  - macOS：虚拟音频驱动
  - Linux：PulseAudio 或 PipeWire（仅限桌面应用）
- 从源码构建时：Node.js（推荐最新 LTS 版本）和 npm

## 从源码构建

1. 克隆仓库
   ```bash
   git clone https://github.com/kizuna-ai-lab/sokuji.git
   cd sokuji
   ```

2. 安装依赖
   ```bash
   npm install
   ```

3. 以开发模式启动应用
   ```bash
   npm run electron:dev
   ```

4. 为生产环境构建应用
   ```bash
   npm run electron:build
   ```

## 从安装包安装

从[发布页面](https://github.com/kizuna-ai-lab/sokuji/releases)下载适合您平台的安装包：

### Windows
下载并运行 `.exe` 安装程序：
```
Sokuji Setup x.y.z.exe
```

### macOS
下载并安装 `.dmg` 安装包：
```
Sokuji-x.y.z.dmg
```

### Linux (Debian/Ubuntu)
下载并安装 `.deb` 安装包：
```bash
sudo dpkg -i sokuji_x.y.z_amd64.deb
```

对于其他 Linux 发行版，您也可以下载便携式 `.zip` 安装包并解压到您偏好的位置。

# 使用方法

1. **配置 API 密钥**：
   
   <p align="center">
     <img width="600" src="https://github.com/kizuna-ai-lab/sokuji/raw/main/screenshots/api-settings.png" alt="API Settings" />
   </p>
   
   - 点击右上角的设置按钮
   - 选择所需的服务商（OpenAI、Gemini、Palabra、Kizuna AI、火山引擎 ST、豆包 AST 2.0 或 OpenAI 兼容）
   - 对于用户自管理服务商：输入 API 密钥并点击"验证"。Palabra 需输入客户端 ID 和客户端密钥。火山引擎 ST 需输入访问密钥 ID 和密钥。豆包 AST 2.0 需输入 APP ID 和访问令牌。OpenAI 兼容端点（仅限 Electron）需配置 API 密钥和自定义端点 URL。
   - 对于 Kizuna AI：登录账号即可自动获取后端托管的 API 密钥。
   - **对于本地推理**：选择"本地推理"作为服务商，下载所需模型（ASR + 翻译，可选 TTS），即可开始翻译 — 无需 API 密钥或网络连接。
   - 点击"保存"以安全存储您的配置

2. **配置音频设备**：
   
   <p align="center">
     <img width="600" src="https://github.com/kizuna-ai-lab/sokuji/raw/main/screenshots/audio-settings.png" alt="Audio Settings" />
   </p>
   
   - 点击音频按钮打开音频面板
   - 选择输入设备（麦克风）
   - 选择输出设备（扬声器/耳机）

3. **开始会话**：
   - 点击"开始会话"启动
   - 对着麦克风说话
   - 查看实时转录和翻译

4. **监听和控制音频**：
   - 切换监听设备以收听翻译输出
   - 启用实时语音直通进行实时监听
   - 根据需要调整直通音量

5. **与其他应用配合使用**（所有平台）：
   - 在目标应用中选择 Sokuji 虚拟麦克风作为输入
   - 翻译后的音频将通过高级混音支持发送到该应用
   - 需要虚拟音频设备软件（请参阅前置条件部分）

# 音频架构

Sokuji 使用基于 Web Audio API 构建的现代音频处理管线，具备跨平台虚拟设备能力：

- **ModernAudioRecorder**：带有高级回声消除功能的输入捕获
- **ModernAudioPlayer**：基于队列的音频管理播放处理
- **实时处理**：通过分块播放实现低延迟音频流
- **虚拟设备支持**：在 Windows（VB-Cable）、macOS（虚拟音频驱动）和 Linux（PulseAudio/PipeWire）上创建虚拟音频设备
- **系统音频捕获**：通过 `electron-audio-loopback`（Electron）或标签捕获（扩展）捕获视频通话中的参与者音频
- **WebRTC 音频桥接**：支持的服务商的低延迟替代传输

## 音频流程

Sokuji 的音频流程：

1. **输入捕获**：启用回声消除捕获麦克风音频
2. **系统音频捕获**（可选）：单独捕获视频通话中的参与者音频
3. **AI 处理**：将音频发送至所选 AI 服务商进行翻译（本地推理时，此步骤完全在设备上运行，无需网络请求）
4. **播放**：通过所选监听设备播放翻译后的音频
5. **虚拟设备输出**：音频同时路由到虚拟麦克风供其他应用使用（所有平台）
6. **可选直通**：可实时监听原始语音

此架构提供：
- 使用现代浏览器 API 的更好回声消除
- 通过优化音频管线降低延迟
- 跨平台虚拟设备集成，实现无缝应用间音频路由
- 视频会议翻译的系统音频捕获

# 架构

Sokuji 采用以核心功能为中心的简化架构：

## 后端（Cloudflare Workers）
- **简化的用户系统**：仅包含 users 和 usage_logs 表
- **实时使用情况追踪**：中继服务器直接将使用数据写入数据库
- **Better Auth**：处理所有用户认证和会话管理
- **精简 API**：仅维护必要端点（/quota、/check、/reset）

## 前端（React + TypeScript）  
- **服务工厂模式**：平台特定实现（Electron/浏览器扩展）
- **现代音频处理**：AudioWorklet，带 ScriptProcessor 回退
- **统一组件**：SimpleConfigPanel 和 SimpleMainPanel，提供精简的用户体验
- **基于 Context 的状态管理**：不依赖外部状态管理的 React Context API

## 数据库结构
```sql
-- 核心用户表
users (id, email, name, subscription, token_quota)

-- 简化的使用情况追踪（由中继写入）
usage_logs (id, user_id, session_id, model, total_tokens, input_tokens, output_tokens, created_at)
```

# 技术栈

- **运行时**：Electron 40+（Windows、macOS、Linux）/ Chrome Extension Manifest V3
- **前端**：React 18 + TypeScript
- **后端**：Cloudflare Workers + Hono + D1 Database
- **认证**：Better Auth
- **AI 服务商**：OpenAI、Google Gemini、Palabra.ai、Kizuna AI、火山引擎 ST、豆包 AST 2.0 以及 OpenAI 兼容端点
- **高级音频处理**：
  - 实时音频处理的 Web Audio API
  - 可靠音频捕获的 MediaRecorder API
  - 实时音频分析的 ScriptProcessor/AudioWorklet
  - 流畅流式传输的基于队列的播放系统
  - 低延迟传输的 WebRTC 音频桥接
  - 系统音频捕获的 electron-audio-loopback
- **本地 AI 推理**：
  - 设备端 ASR 和 TTS 的 sherpa-onnx（WASM）
  - 浏览器端翻译推理的 @huggingface/transformers
  - Whisper 和 Qwen LLM 模型的 WebGPU 加速
- **模型存储**：使用 idb 库的 IndexedDB
- **序列化**：火山引擎 AST2 协议的 protobufjs
- **分析**：匿名使用情况追踪的 posthog-js-lite
- **路由**：应用导航的 react-router-dom
- **UI 库**：
  - 高级工具提示定位的 @floating-ui/react
  - 样式的 SASS
  - 图标的 Lucide React
- **国际化**：
  - 多语言支持的 i18next
  - 30 种语言翻译

# 贡献

欢迎贡献！以下是参与方式：

1. Fork 本仓库
2. 创建功能分支（`git checkout -b feature/amazing-feature`）
3. 提交您的更改（`git commit -m 'Add some amazing feature'`）
4. 推送到分支（`git push origin feature/amazing-feature`）
5. 提交 Pull Request

## 开发指南

- 遵循 TypeScript 和 ESLint 规则
- 为新功能添加测试
- 保持提交信息清晰且具有描述性
- 更新文档

# 许可证

[AGPL-3.0](../LICENSE)

# 支持

如遇到问题或有疑问：

1. 查看 [Issues](https://github.com/kizuna-ai-lab/sokuji/issues) 中的现有问题
2. 提交新问题
3. 在 [Discussions](https://github.com/kizuna-ai-lab/sokuji/discussions) 中提问

# 致谢

- OpenAI - 实时 API
- Google - Gemini API
- 火山引擎 - 语音翻译 API
- [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) - 设备端语音识别与合成
- [Hugging Face Transformers.js](https://github.com/huggingface/transformers.js) - 浏览器端 ML 推理
- [Opus-MT](https://github.com/Helsinki-NLP/Opus-MT) - 开源机器翻译模型
- [Qwen](https://github.com/QwenLM/Qwen) - 多语言语言模型
- Electron - 跨平台桌面应用框架
- React - 用户界面库
- PulseAudio/PipeWire - Linux 音频系统
