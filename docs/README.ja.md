<p align="center">
  <img width="200" src="https://github.com/kizuna-ai-lab/sokuji/raw/main/src/assets/logo.png" alt="Sokuji Logo">
</p>

<p align="center">
  <em>オンデバイスAIとクラウドプロバイダーによるリアルタイム音声翻訳 — OpenAI, Google Gemini, Palabra.ai, Kizuna AI, Volcengine など</em>
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
  <a href="../README.md">English</a> | 日本語 | <a href="README.zh.md">中文</a>
</p>

# なぜSokujiなのか？

Sokujiは、オンデバイスAIとクラウドプロバイダーを活用したクロスプラットフォームのリアルタイム音声翻訳アプリです。デスクトップとブラウザの両方に対応しています。**ローカル推論**をサポートしており、WASMとWebGPUを使ったオンデバイスのASR・翻訳・TTSを提供します。APIキー不要、完全オフライン、プライバシーも完全に保護されます。また、OpenAI、Google Gemini、Palabra.ai、Kizuna AI、Volcengine ST、Doubao AST 2.0、OpenAI互換APIなどのクラウドプロバイダーとも統合されています。

https://github.com/user-attachments/assets/1eaaa333-a7ce-4412-a295-16b7eb2310de

# ブラウザ拡張機能が利用可能！

デスクトップアプリケーションをインストールしたくない場合は、Chrome、Edge、その他のChromiumベースのブラウザ向けのブラウザ拡張機能をお試しください。Google Meet、Microsoft Teams、Zoom、Discord、Slack、Gather.town、Wherebyなどの主要なビデオ会議プラットフォームとの統合により、ブラウザ内で直接同じ強力なリアルタイム音声翻訳機能を提供します。

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

## 開発者モードでのブラウザ拡張機能のインストール

ブラウザ拡張機能の最新版をインストールしたい場合：

1. [リリースページ](https://github.com/kizuna-ai-lab/sokuji/releases)から最新の`sokuji-extension.zip`をダウンロード
2. zipファイルをフォルダに解凍
3. Chrome/Chromiumを開き、`chrome://extensions/`にアクセス
4. 右上の「デベロッパーモード」を有効にする
5. 「パッケージ化されていない拡張機能を読み込む」をクリックし、解凍したフォルダを選択
6. Sokuji拡張機能がインストールされ、使用準備が完了

# 機能

### AI翻訳
- **8つのAIプロバイダー**: OpenAI、Google Gemini、Palabra.ai、Kizuna AI、Volcengine ST、Doubao AST 2.0、OpenAI互換、ローカル推論
- **サポートされているモデル**:
  - **OpenAI**: `gpt-4o-realtime-preview`, `gpt-4o-mini-realtime-preview`, `gpt-realtime`, `gpt-realtime-2025-08-28`
  - **Google Gemini**: `gemini-2.0-flash-live-001`, `gemini-2.5-flash-preview-native-audio-dialog`
  - **Palabra.ai**: WebRTCによるリアルタイム音声翻訳
  - **Kizuna AI**: バックエンド管理認証によるOpenAI互換モデル
  - **OpenAI互換**: カスタムOpenAI互換APIエンドポイントのサポート（Electronのみ）
  - **Volcengine ST**: V4署名認証によるリアルタイム音声翻訳
  - **Doubao AST 2.0**: protobuf-over-WebSocketによる音声翻訳
  - **ローカル推論**: オンデバイスASR、翻訳、TTS — APIキーもインターネットも不要
- **自動ターン検出** OpenAI用の複数モード（通常、セマンティック、無効）
- **プッシュトゥトークモード**: 正確な翻訳タイミングのための手動音声制御
- **WebRTCトランスポート**: OpenAIプロバイダー向けの低遅延代替トランスポート

### ローカル推論（エッジAI）
- **プライバシー最優先**: すべての処理がデバイス上で実行 — 音声、文字起こし、翻訳がデバイスの外に出ることはありません
- **APIキー不要**: オープンソースモデルをダウンロードして完全オフラインで実行
- **ASR**: 48モデル（オフライン32 + ストリーミング10 + Whisper WebGPU 6）で99以上の言語をカバー（sherpa-onnx WASM + Whisper WebGPU）
- **翻訳**: 55以上のOpus-MT言語ペア + 4つの多言語LLM（Qwen 2.5 / 3 / 3.5）WebGPU対応
- **TTS**: 53言語にわたる136モデル（Piper、Coqui、Mimic3、Matchaエンジン）sherpa-onnx WASM経由
- **ハードウェアの柔軟性**: CPU（WASM）で汎用的な互換性、WebGPUでGPUアクセラレーション推論
- **モデル管理**: ワンクリックダウンロード、IndexedDBキャッシュ、失敗時の再開

### オーディオ
- **デュアルキュー音声ミキシングシステムを備えた高度な仮想マイク**:
  - **通常音声トラック**: キューに入れられ、順次再生
  - **即時音声トラック**: リアルタイム音声ミキシング用の別キュー
  - **同時再生**: 両方のトラックタイプをミックスしてオーディオ体験を向上
  - **チャンク化音声対応**: 大規模な音声ストリームの効率的な処理
  - **クロスプラットフォーム対応**: Windows（VB-Cable）、macOS（仮想オーディオドライバー）、Linux（PulseAudio/PipeWire）
- **システムオーディオキャプチャ**: ビデオ通話中の参加者音声をキャプチャして翻訳（全プラットフォーム）
- **リアルタイム音声パススルー**: 録音セッション中のライブ音声モニタリング
- **仮想オーディオデバイス管理**: 自動ルーティングとデバイス切り替え（Windows、macOS、Linux）
- **波形表示による音声可視化**

### ユーザーインターフェース
- **シンプルモードインターフェース**: 非技術ユーザー向けの合理化された6セクション設定:
  - インターフェース言語選択
  - 翻訳言語ペア（ソース/ターゲット）
  - バリデーション付きAPIキー管理
  - 「オフ」オプション付きマイク選択
  - 「オフ」オプション付きスピーカー選択
  - リアルタイムセッション時間表示
- **多言語サポート**: 30言語の完全な国際化と英語フォールバック
- **強化ツールチップ**: よりよいユーザーガイダンスのための@floating-uiによるインタラクティブヘルプツールチップ
- **包括的なログ**: API相互作用の追跡

### 設定
- **リアルタイムフィードバック付きAPIキー検証**
- **カスタマイズ可能なモデル設定**（温度、最大トークン）
- **ユーザー転写モデル選択**（OpenAI用: `gpt-4o-mini-transcribe`, `gpt-4o-transcribe`, `whisper-1`）
- **ノイズリダクションオプション**（OpenAI用: なし、近距離、遠距離）
- **ユーザーのホームディレクトリでの設定永続化**
- **アナリティクス**: 匿名使用状況追跡のためのPostHog統合

# はじめに

## 前提条件

- 少なくとも1つの**クラウド**プロバイダーのAPIキー（または**ローカル推論**を使用してAPIキー不要で完全オフライン運用）：
  - **OpenAI**: OpenAIのAPIキー
  - **Google Gemini**: Google AI StudioのAPIキー
  - **Palabra.ai**: クライアントIDとクライアントシークレット
  - **Kizuna AI**: アカウントにサインインしてバックエンド管理のAPIキーに自動アクセス
  - **Volcengine ST**: アクセスキーIDとシークレットアクセスキー
  - **Doubao AST 2.0**: APP IDとアクセストークン
  - **OpenAI互換**: APIキーとカスタムエンドポイントURL（Electronのみ）
- （オプション）アプリ間オーディオルーティングのための仮想オーディオデバイスソフトウェア：
  - Windows: VB-Cableまたは同様の仮想オーディオケーブル
  - macOS: 仮想オーディオドライバー
  - Linux: PulseAudioまたはPipeWire（デスクトップアプリのみ）
- ソースからビルドする場合：Node.js（最新のLTSバージョンを推奨）およびnpm

## ソースから

1. リポジトリをクローン
   ```bash
   git clone https://github.com/kizuna-ai-lab/sokuji.git
   cd sokuji
   ```

2. 依存関係をインストール
   ```bash
   npm install
   ```

3. 開発モードでアプリケーションを起動
   ```bash
   npm run electron:dev
   ```

4. 本番用にアプリケーションをビルド
   ```bash
   npm run electron:build
   ```

## パッケージから

[リリースページ](https://github.com/kizuna-ai-lab/sokuji/releases)からお使いのプラットフォームに適したパッケージをダウンロードしてください：

### Windows
`.exe`インストーラーをダウンロードして実行します：
```
Sokuji Setup x.y.z.exe
```

### macOS
`.dmg`パッケージをダウンロードしてインストールします：
```
Sokuji-x.y.z.dmg
```

### Linux (Debian/Ubuntu)
`.deb`パッケージをダウンロードしてインストールします：
```bash
sudo dpkg -i sokuji_x.y.z_amd64.deb
```

他のLinuxディストリビューションの場合は、ポータブル`.zip`パッケージをダウンロードして任意の場所に展開することもできます。

# 使い方

1. **APIキーを設定**:
   
   <p align="center">
     <img width="600" src="https://github.com/kizuna-ai-lab/sokuji/raw/main/screenshots/api-settings.png" alt="API Settings" />
   </p>
   
   - 右上の設定ボタンをクリック
   - 希望のプロバイダー（OpenAI、Gemini、Palabra、Kizuna AI、Volcengine ST、Doubao AST 2.0、またはOpenAI互換）を選択
   - ユーザー管理プロバイダーの場合：APIキーを入力し、「検証」をクリック。Palabraの場合、クライアントIDとクライアントシークレットを入力。Volcengine STの場合、アクセスキーIDとシークレットを入力。Doubao AST 2.0の場合、APP IDとアクセストークンを入力。OpenAI互換エンドポイントの場合（Electronのみ）、APIキーとカスタムエンドポイントURLの両方を設定します。
   - Kizuna AIの場合：アカウントにサインインしてバックエンド管理のAPIキーに自動アクセスします。
   - **ローカル推論の場合**：プロバイダーとして「ローカル推論」を選択し、必要なモデル（ASR + 翻訳、オプションでTTS）をダウンロードして翻訳を開始 — APIキーもインターネット接続も不要です。
   - 「保存」をクリックして設定を安全に保存

2. **オーディオデバイスを設定**:
   
   <p align="center">
     <img width="600" src="https://github.com/kizuna-ai-lab/sokuji/raw/main/screenshots/audio-settings.png" alt="Audio Settings" />
   </p>
   
   - オーディオボタンをクリックしてオーディオパネルを開く
   - 入力デバイス（マイク）を選択
   - 出力デバイス（スピーカー/ヘッドフォン）を選択

3. **セッションを開始**:
   - 「セッションを開始」をクリックして開始
   - マイクに向かって話す
   - リアルタイムの文字起こしと翻訳を表示

4. **音声をモニターおよびコントロール**:
   - モニターデバイスを切り替えて翻訳された出力を聞く
   - ライブモニタリングのためのリアル音声パススルーを有効化
   - 必要に応じてパススルーボリュームを調整

5. **他のアプリケーションで使用**（全プラットフォーム）:
   - ターゲットアプリケーションのマイク入力としてSokuji仮想マイクを選択
   - 翻訳された音声が高度なミキシングをサポートしてそのアプリケーションに送信されます
   - 仮想オーディオデバイスソフトウェアが必要です（前提条件セクションを参照）

# オーディオアーキテクチャ

SokujiはWeb Audio APIを基盤とした最新の音声処理パイプラインを使用し、クロスプラットフォームの仮想デバイス機能を提供します：

- **ModernAudioRecorder**: 高度なエコーキャンセレーション機能付きの入力キャプチャ
- **ModernAudioPlayer**: キューベースの音声管理による再生処理
- **リアルタイム処理**: チャンク再生による低遅延音声ストリーミング
- **仮想デバイスサポート**: Windows（VB-Cable）、macOS（仮想オーディオドライバー）、Linux（PulseAudio/PipeWire）で仮想オーディオデバイスを作成
- **システムオーディオキャプチャ**: `electron-audio-loopback`（Electron）またはタブキャプチャ（拡張機能）によるビデオ通話の参加者音声キャプチャ
- **WebRTCオーディオブリッジ**: 対応プロバイダー向けの低遅延代替トランスポート

## オーディオフロー

Sokujiのオーディオフロー：

1. **入力キャプチャ**: エコーキャンセレーションを有効にしてマイク音声をキャプチャ
2. **システムオーディオキャプチャ**（オプション）: ビデオ通話の参加者音声を個別にキャプチャ
3. **AI処理**: 選択したAIプロバイダーに音声を送信して翻訳（ローカル推論の場合、このステップはネットワークリクエストなしで完全にデバイス上で実行）
4. **再生**: 翻訳された音声を選択したモニターデバイスで再生
5. **仮想デバイス出力**: 音声は他のアプリケーション用の仮想マイクにもルーティング（全プラットフォーム）
6. **オプションのパススルー**: 元の音声をリアルタイムでモニタリング可能

このアーキテクチャにより以下を実現：
- モダンなブラウザAPIを使用したより優れたエコーキャンセレーション
- 最適化されたオーディオパイプラインによる低遅延
- クロスプラットフォームのシームレスなアプリ間オーディオルーティングのための仮想デバイス統合
- ビデオ会議翻訳のためのシステムオーディオキャプチャ

# アーキテクチャ

Sokujiはコア機能に特化したシンプルなアーキテクチャを採用しています：

## バックエンド（Cloudflare Workers）
- **シンプル化されたユーザーシステム**: ユーザーテーブルとusage_logsテーブルのみ
- **リアルタイム使用状況追跡**: リレーサーバーが直接使用データをデータベースに書き込み
- **Better Auth**: すべてのユーザー認証とセッション管理を処理
- **合理化されたAPI**: 必要最小限のエンドポイントのみ維持 (/quota, /check, /reset)

## フロントエンド（React + TypeScript）  
- **サービスファクトリパターン**: プラットフォーム固有の実装（Electron/ブラウザ拡張機能）
- **モダン音声処理**: ScriptProcessorフォールバック付きのAudioWorklet
- **統一コンポーネント**: 合理化されたUXのためのSimpleConfigPanelとSimpleMainPanel
- **コンテキストベースのstate**: 外部state管理なしのReact Context API

## データベーススキーマ
```sql
-- コアユーザーテーブル
users (id, email, name, subscription, token_quota)

-- 合理化された使用状況追跡（リレーによる書き込み）
usage_logs (id, user_id, session_id, model, total_tokens, input_tokens, output_tokens, created_at)
```

# 使用技術

- **ランタイム**: Electron 40+ (Windows、macOS、Linux) / Chrome Extension Manifest V3
- **フロントエンド**: React 18 + TypeScript
- **バックエンド**: Cloudflare Workers + Hono + D1 Database
- **認証**: Better Auth
- **AIプロバイダー**: OpenAI、Google Gemini、Palabra.ai、Kizuna AI、Volcengine ST、Doubao AST 2.0、およびOpenAI互換エンドポイント
- **高度な音声処理**:
  - リアルタイム音声処理のためのWeb Audio API
  - 信頼性の高い音声キャプチャのためのMediaRecorder API
  - リアルタイム音声分析のためのScriptProcessor/AudioWorklet
  - スムーズなストリーミングのためのキューベース再生システム
  - 低遅延トランスポートのためのWebRTCオーディオブリッジ
  - システムオーディオキャプチャのためのelectron-audio-loopback
- **ローカルAI推論**:
  - オンデバイスASR・TTSのためのsherpa-onnx（WASM）
  - ブラウザベース翻訳推論のための@huggingface/transformers
  - WhisperおよびQwen LLMモデルのWebGPUアクセラレーション
- **モデルストレージ**: idbライブラリによるIndexedDB
- **シリアライゼーション**: Volcengine AST2プロトコルのためのprotobufjs
- **アナリティクス**: 匿名使用状況追跡のためのposthog-js-lite
- **ルーティング**: アプリケーションナビゲーションのためのreact-router-dom
- **UIライブラリ**:
  - 高度なツールチップ配置のための@floating-ui/react
  - スタイリングのためのSASS
  - アイコンのためのLucide React
- **国際化**:
  - 多言語サポートのためのi18next
  - 30言語翻訳

# 貢献

貢献を歓迎します！以下の方法で貢献できます：

1. リポジトリをフォーク
2. 機能ブランチを作成 (`git checkout -b feature/amazing-feature`)
3. 変更をコミット (`git commit -m 'Add some amazing feature'`)
4. ブランチにプッシュ (`git push origin feature/amazing-feature`)
5. プルリクエストを開く

## 開発ガイドライン

- TypeScriptとESLintの規則に従う
- 新機能にはテストを追加
- コミットメッセージは明確で説明的にする
- ドキュメントを更新

# ライセンス

[AGPL-3.0](../LICENSE)

# サポート

問題が発生した場合や質問がある場合：

1. [Issues](https://github.com/kizuna-ai-lab/sokuji/issues)で既存の問題を確認
2. 新しい問題を報告
3. [Discussions](https://github.com/kizuna-ai-lab/sokuji/discussions)で質問

# 謝辞

- OpenAI - リアルタイムAPI
- Google - Gemini API
- Volcengine - 音声翻訳API
- [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) - オンデバイス音声認識・合成
- [Hugging Face Transformers.js](https://github.com/huggingface/transformers.js) - ブラウザベースML推論
- [Opus-MT](https://github.com/Helsinki-NLP/Opus-MT) - オープンソース機械翻訳モデル
- [Qwen](https://github.com/QwenLM/Qwen) - 多言語言語モデル
- Electron - クロスプラットフォームデスクトップアプリケーションフレームワーク
- React - ユーザーインターフェースライブラリ
- PulseAudio/PipeWire - Linuxオーディオシステム
