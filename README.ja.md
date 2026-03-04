<p align="center">
  <img width="200" src="https://github.com/kizuna-ai-lab/Eburon/raw/main/src/assets/logo.png" alt="Eburon Logo">
</p>

<p align="center">
  <em>OpenAI, Google Gemini, Palabra.ai, Kizuna AI, Volcengine などによるリアルタイム音声翻訳</em>
</p>

<p align="center">
  <a href="LICENSE" target="_blank">
    <img alt="AGPL-3.0 License" src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg?style=flat-square" />
  </a>
  
  <!-- Build and Release Badge -->
  <a href="https://github.com/kizuna-ai-lab/Eburon/actions/workflows/build.yml" target="_blank">
    <img alt="Build and Release" src="https://github.com/kizuna-ai-lab/Eburon/actions/workflows/build.yml/badge.svg" />
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
  <a href="https://deepwiki.com/kizuna-ai-lab/Eburon" target="_blank">
    <img alt="Ask DeepWiki" src="https://deepwiki.com/badge.svg" />
  </a>
</p>

<p align="center">
  <a href="README.md">English</a> | 日本語
</p>

# なぜEburonなのか？

Eburonは、OpenAI、Google Gemini、Palabra.ai、Kizuna AI、Volcengine ST、Doubao AST 2.0、OpenAI互換APIを使用してリアルタイム音声翻訳を提供するクロスプラットフォームデスクトップアプリケーション兼ブラウザ拡張機能です。Windows、macOS、Linuxで利用でき、音声入力をキャプチャし、高度なAIモデルで処理し、リアルタイムで翻訳された出力を配信することで、ライブ会話における言語の壁を取り除きます。

https://github.com/user-attachments/assets/1eaaa333-a7ce-4412-a295-16b7eb2310de

# ブラウザ拡張機能が利用可能！

デスクトップアプリケーションをインストールしたくない場合は、Chrome、Edge、その他のChromiumベースのブラウザ用のブラウザ拡張機能をお試しください。Google Meet、Microsoft Teams、Zoom、Discord、Slack、Gather.town、Wherebyなどの主要なビデオ会議プラットフォームとの統合により、ブラウザ内で直接同じ強力なリアルタイム音声翻訳機能を提供します。

<p>
  <a href="https://chromewebstore.google.com/detail/ppmihnhelgfpjomhjhpecobloelicnak?utm_source=item-share-cb" target="_blank">
    <img alt="Available on Chrome Web Store" src="https://github.com/kizuna-ai-lab/Eburon/raw/main/assets/chrome-web-store-badge.png" height="60" />
  </a>
  <a href="https://microsoftedge.microsoft.com/addons/detail/Eburon-aipowered-live-/dcmmcdkeibkalgdjlahlembodjhijhkm" target="_blank">
    <img alt="Available on Microsoft Edge Add-ons" src="https://github.com/kizuna-ai-lab/Eburon/raw/main/assets/edge-addons-badge.png" height="60" />
  </a>
  <a href="https://www.producthunt.com/posts/Eburon?embed=true&utm_source=badge-featured&utm_medium=badge&utm_source=badge-Eburon" target="_blank">
    <img src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=967440&theme=light&t=1748250774125" alt="Eburon - Live&#0032;speech&#0032;translation&#0032;with&#0032;real&#0045;time&#0032;AI | Product Hunt" style="width: 250px; height: 54px;" width="250" height="54" />
  </a>
</p>

## 開発者モードでのブラウザ拡張機能のインストール

ブラウザ拡張機能の最新版をインストールしたい場合：

1. [リリースページ](https://github.com/kizuna-ai-lab/Eburon/releases)から最新の`Eburon-extension.zip`をダウンロード
2. zipファイルをフォルダに解凍
3. Chrome/Chromiumを開き、`chrome://extensions/`にアクセス
4. 右上の「デベロッパーモード」を有効にする
5. 「パッケージ化されていない拡張機能を読み込む」をクリックし、解凍したフォルダを選択
6. Eburon拡張機能がインストールされ、使用準備が完了

# 機能

### AI翻訳
- **7つのAIプロバイダー**: OpenAI、Google Gemini、Palabra.ai、Kizuna AI、Volcengine ST、Doubao AST 2.0、OpenAI互換
- **サポートされているモデル**:
  - **OpenAI**: `gpt-4o-realtime-preview`, `gpt-4o-mini-realtime-preview`, `gpt-realtime`, `gpt-realtime-2025-08-28`
  - **Google Gemini**: `gemini-2.0-flash-live-001`, `gemini-2.5-flash-preview-native-audio-dialog`
  - **Palabra.ai**: WebRTCによるリアルタイム音声翻訳
  - **Kizuna AI**: バックエンド管理認証によるOpenAI互換モデル
  - **OpenAI互換**: カスタムOpenAI互換APIエンドポイントのサポート（Electronのみ）
  - **Volcengine ST**: V4署名認証によるリアルタイム音声翻訳
  - **Doubao AST 2.0**: protobuf-over-WebSocketによる音声翻訳
- **自動ターン検出** OpenAI用の複数モード（通常、セマンティック、無効）
- **プッシュトゥトークモード**: 正確な翻訳タイミングのための手動音声制御
- **WebRTCトランスポート**: OpenAIプロバイダー向けの低遅延代替トランスポート

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
- **強化ツールチップ**: @floating-uiによるインタラクティブヘルプツールチップ
- **API相互作用を追跡する包括的なログ**

### 設定
- **リアルタイムフィードバック付きAPIキー検証**
- **カスタマイズ可能なモデル設定**（温度、最大トークン）
- **ユーザー転写モデル選択**（OpenAI用: `gpt-4o-mini-transcribe`, `gpt-4o-transcribe`, `whisper-1`）
- **ノイズリダクションオプション**（OpenAI用: なし、近距離、遠距離）
- **ユーザーのホームディレクトリでの設定永続化**
- **アナリティクス**: 匿名使用状況追跡のためのPostHog統合

# はじめに

## 前提条件

- 少なくとも1つのプロバイダーのAPIキー：
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
   git clone https://github.com/kizuna-ai-lab/Eburon.git
   cd Eburon
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

[リリースページ](https://github.com/kizuna-ai-lab/Eburon/releases)からお使いのプラットフォームに適したパッケージをダウンロードしてください：

### Windows
`.exe`インストーラーをダウンロードして実行します：
```
Eburon Setup x.y.z.exe
```

### macOS
`.dmg`パッケージをダウンロードしてインストールします：
```
Eburon-x.y.z.dmg
```

### Linux (Debian/Ubuntu)
`.deb`パッケージをダウンロードしてインストールします：
```bash
sudo dpkg -i Eburon_x.y.z_amd64.deb
```

他のLinuxディストリビューションの場合は、ポータブル`.zip`パッケージをダウンロードして任意の場所に展開することもできます。

# 使い方

1. **APIキーを設定**:
   
   <p align="center">
     <img width="600" src="https://github.com/kizuna-ai-lab/Eburon/raw/main/screenshots/api-settings.png" alt="API Settings" />
   </p>
   
   - 右上の設定ボタンをクリック
   - 希望のプロバイダー（OpenAI、Gemini、Palabra、Kizuna AI、Volcengine ST、Doubao AST 2.0、またはOpenAI互換）を選択
   - ユーザー管理プロバイダーの場合：APIキーを入力し、「検証」をクリック。Palabraの場合、クライアントIDとクライアントシークレットを入力。Volcengine STの場合、アクセスキーIDとシークレットを入力。Doubao AST 2.0の場合、APP IDとアクセストークンを入力。OpenAI互換エンドポイントの場合（Electronのみ）、APIキーとカスタムエンドポイントURLの両方を設定します。
   - Kizuna AIの場合：アカウントにサインインしてバックエンド管理のAPIキーに自動アクセスします。
   - 「保存」をクリックして設定を安全に保存

2. **オーディオデバイスを設定**:
   
   <p align="center">
     <img width="600" src="https://github.com/kizuna-ai-lab/Eburon/raw/main/screenshots/audio-settings.png" alt="Audio Settings" />
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
   - ターゲットアプリケーションのマイク入力としてEburon仮想マイクを選択
   - 翻訳された音声が高度なミキシングをサポートしてそのアプリケーションに送信されます
   - 仮想オーディオデバイスソフトウェアが必要です（前提条件セクションを参照）

# オーディオアーキテクチャ

EburonはWeb Audio APIを基盤とした最新の音声処理パイプラインを使用し、クロスプラットフォームの仮想デバイス機能を提供します：

- **ModernAudioRecorder**: 高度なエコーキャンセレーション機能付きの入力キャプチャ
- **ModernAudioPlayer**: キューベースの音声管理による再生処理
- **リアルタイム処理**: チャンク再生による低遅延音声ストリーミング
- **仮想デバイスサポート**: Windows（VB-Cable）、macOS（仮想オーディオドライバー）、Linux（PulseAudio/PipeWire）で仮想オーディオデバイスを作成
- **システムオーディオキャプチャ**: `electron-audio-loopback`（Electron）またはタブキャプチャ（拡張機能）によるビデオ通話の参加者音声キャプチャ
- **WebRTCオーディオブリッジ**: 対応プロバイダー向けの低遅延代替トランスポート

## オーディオフロー

Eburonのオーディオフロー：

1. **入力キャプチャ**: エコーキャンセレーションを有効にしてマイク音声をキャプチャ
2. **システムオーディオキャプチャ**（オプション）: ビデオ通話の参加者音声を個別にキャプチャ
3. **AI処理**: 選択したAIプロバイダーに音声を送信して翻訳
4. **再生**: 翻訳された音声を選択したモニターデバイスで再生
5. **仮想デバイス出力**: 音声は他のアプリケーション用の仮想マイクにもルーティング（全プラットフォーム）
6. **オプションのパススルー**: 元の音声をリアルタイムでモニタリング可能

このアーキテクチャにより以下を実現：
- モダンなブラウザAPIを使用したより優れたエコーキャンセレーション
- 最適化されたオーディオパイプラインによる低遅延
- クロスプラットフォームのシームレスなアプリ間オーディオルーティングのための仮想デバイス統合
- ビデオ会議翻訳のためのシステムオーディオキャプチャ

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

このプロジェクトはAGPL-3.0ライセンスの下でライセンスされています。詳細は[LICENSE](LICENSE)ファイルを参照してください。

# サポート

問題が発生した場合や質問がある場合：

1. [Issues](https://github.com/kizuna-ai-lab/Eburon/issues)で既存の問題を確認
2. 新しい問題を報告
3. [Discussions](https://github.com/kizuna-ai-lab/Eburon/discussions)で質問

# 謝辞

- OpenAI - リアルタイムAPI
- Google - Gemini API
- Volcengine - 音声翻訳API
- Electron - クロスプラットフォームデスクトップアプリケーションフレームワーク
- React - ユーザーインターフェースライブラリ
- PulseAudio/PipeWire - Linuxオーディオシステム
