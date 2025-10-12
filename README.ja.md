<p align="center">
  <img width="200" src="https://github.com/kizuna-ai-lab/sokuji/raw/main/src/assets/logo.png" alt="Sokuji Logo">
</p>

<p align="center">
  <em>OpenAI, Google Gemini, Palabra.ai, Kizuna AI による リアルタイム音声翻訳</em>
</p>

<p align="center">
  <a href="LICENSE" target="_blank">
    <img alt="AGPL-3.0 License" src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg?style=flat-square" />
  </a>
  
  <!-- Build and Release Badge -->
  <a href="https://github.com/kizuna-ai-lab/sokuji/actions/workflows/build-and-release.yml" target="_blank">
    <img alt="Build and Release" src="https://github.com/kizuna-ai-lab/sokuji/actions/workflows/build-and-release.yml/badge.svg" />
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
  <a href="README.md">English</a> | 日本語
</p>

# なぜSokujiなのか？

SokujiはOpenAI, Google Gemini, Palabra.ai, Kizuna AI APIを使用してリアルタイム音声翻訳を提供するクロスプラットフォームデスクトップアプリケーションです。Windows、macOS、Linuxで利用でき、音声入力をキャプチャし、高度なAIモデルで処理し、リアルタイムで翻訳された出力を配信することで、ライブ会話における言語の壁を取り除きます。また、柔軟性のためにOpenAI互換のAPIエンドポイントもサポートしています。

https://github.com/user-attachments/assets/1eaaa333-a7ce-4412-a295-16b7eb2310de

# ブラウザ拡張機能が利用可能！

デスクトップアプリケーションをインストールしたくない場合は、Chrome、Edge、その他のChromiumベースのブラウザ用のブラウザ拡張機能をお試しください。Google MeetやMicrosoft Teamsとの特別な統合により、ブラウザ内で直接同じ強力なリアルタイム音声翻訳機能を提供します。

<p>
  <a href="https://chromewebstore.google.com/detail/ppmihnhelgfpjomhjhpecobloelicnak?utm_source=item-share-cb" target="_blank">
    <img alt="Available on Chrome Web Store" src="https://github.com/kizuna-ai-lab/sokuji/raw/main/assets/chrome-web-store-badge.png" height="60" />
  </a>
  <a href="https://microsoftedge.microsoft.com/addons/detail/sokuji-aipowered-live-/dcmmcdkeibkalgdjlahlembodjhijhkm" target="_blank">
    <img alt="Available on Microsoft Edge Add-ons" src="https://github.com/kizuna-ai-lab/sokuji/raw/main/assets/edge-addons-badge.png" height="60" />
  </a>
  <a href="https://www.producthunt.com/posts/sokuji?embed=true&utm_source=badge-featured&utm_medium=badge&utm_source=badge-sokuji" target="_blank">
    <img src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=967440&theme=light&t=1748250774125" alt="Sokuji - Live&#0032;speech&#0032;translation&#0032;with&#0032;real&#0045;time&#0032;AI | Product Hunt" style="width: 250px; height: 54px;" width="250" height="54" />
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

# 翻訳以上の機能

Sokujiは基本的な翻訳を超えて、仮想デバイス管理（Linuxのみ）による完全なオーディオルーティングソリューションを提供し、他のアプリケーションとのシームレスな統合を可能にします。リアルタイムオーディオ可視化と包括的なログ記録を備えた、モダンで直感的なインターフェースを提供します。

# 機能

1. **OpenAI, Google Gemini, Palabra.ai, Kizuna AI APIを使用したリアルタイム音声翻訳**
2. **マルチプロバイダーサポート**: OpenAI, Google Gemini, Palabra.ai, Kizuna AIをシームレスに切り替え
3. **サポートされているモデル**:
   - **OpenAI**: `gpt-4o-realtime-preview`, `gpt-4o-mini-realtime-preview`, `gpt-realtime`, `gpt-realtime-2025-08-28`
   - **Google Gemini**: `gemini-2.0-flash-live-001`, `gemini-2.5-flash-preview-native-audio-dialog`
   - **Palabra.ai**: WebRTCによるリアルタイム音声翻訳
   - **Kizuna AI**: バックエンド管理認証によるOpenAI互換モデル
   - **OpenAI互換**: カスタムOpenAI互換APIエンドポイントのサポート（Electronのみ）
4. **自動ターン検出** OpenAI用の複数モード（通常、セマンティック、無効）
5. **波形表示による音声可視化**
6. **デュアルキュー音声ミキシングシステムを備えた高度な仮想マイク**（Linuxのみ）:
   - **通常音声トラック**: キューに入れられ、順次再生
   - **即時音声トラック**: リアルタイム音声ミキシング用の別キュー
   - **同時再生**: 両方のトラックタイプをミックスしてオーディオ体験を向上
   - **チャンク化音声対応**: 大規模な音声ストリームの効率的な処理
7. **リアルタイム音声パススルー**: 録音セッション中のライブ音声モニタリング
8. **Linux上での仮想オーディオデバイス**の作成と管理（PulseAudio/PipeWire使用）
9. **仮想デバイス間の自動オーディオルーティング**（Linuxのみ）
10. **自動デバイス切り替えと設定の永続化**
11. **オーディオ入力・出力デバイス選択**
12. **API相互作用を追跡する包括的なログ**
13. **カスタマイズ可能なモデル設定**（温度、最大トークン）
14. **ユーザー転写モデル選択**（OpenAI用: `gpt-4o-mini-transcribe`, `gpt-4o-transcribe`, `whisper-1`）
15. **ノイズリダクションオプション**（OpenAI用: なし、近距離、遠距離）
16. **リアルタイムフィードバック付きAPIキー検証**
17. **ユーザーのホームディレクトリでの設定永続化**
18. **最適化されたAIクライアントパフォーマンス**: 一貫したID生成による会話管理の強化

# オーディオアーキテクチャ

SokujiはWeb Audio APIを基盤とした最新の音声処理パイプラインを使用し、Linux上では追加の仮想デバイス機能を提供します：

- **ModernAudioRecorder**: 高度なエコーキャンセレーション機能付きの入力キャプチャ
- **ModernAudioPlayer**: キューベースの音声管理による再生処理
- **リアルタイム処理**: チャンク再生による低遅延音声ストリーミング
- **仮想デバイスサポート**: Linux上では、アプリケーション統合のための仮想オーディオデバイスを作成

### オーディオフロー

Sokujiのオーディオフロー：

1. **入力キャプチャ**: エコーキャンセレーションを有効にしてマイク音声をキャプチャ
2. **AI処理**: 選択したAIプロバイダーに音声を送信して翻訳
3. **再生**: 翻訳された音声を選択したモニターデバイスで再生
4. **仮想デバイス出力**（Linuxのみ）: 音声は他のアプリケーション用の仮想マイクにもルーティング
5. **オプションのパススルー**: 元の音声をリアルタイムでモニタリング可能

このアーキテクチャにより以下を実現：
- モダンなブラウザAPIを使用したより優れたエコーキャンセレーション
- 最適化されたオーディオパイプラインによる低遅延
- Linuxでのシームレスなアプリ間オーディオルーティングのための仮想デバイス統合
- 優雅なデグレーデーションによるクロスプラットフォーム互換性

## 開発者ノート

### アーキテクチャの改善

**モダンなオーディオサービスアーキテクチャ**:
- `ModernAudioRecorder`: エコーキャンセレーション付きWeb Audio APIベースの録音
- `ModernAudioPlayer`: イベント駆動処理によるキューベースの再生
- ElectronとブラウザーエクステンションプラットフォームのためのUnified Audio Service

**最適化されたクライアント管理**:
- `GeminiClient`: 一貫したインスタンスIDによる改善された会話アイテム管理
- メソッド呼び出しの削減とパフォーマンスの向上
- 長時間実行セッションのためのより良いメモリ管理

**オーディオ処理の実装**:
- スムーズな再生のためのキューベースの音声チャンク管理
- 設定可能なボリュームコントロール付きリアルタイムパススルー
- CPU使用率を削減するイベント駆動の再生
- 自動デバイス切り替えと再接続

# 準備

- (必須) OpenAI, Google Gemini, Palabra.ai のAPIキー、またはKizuna AIアカウント。Palabra.aiの場合、クライアントIDとクライアントシークレットが必要です。Kizuna AIの場合、アカウントにサインインしてバックエンド管理のAPIキーに自動アクセスします。OpenAI互換エンドポイントの場合、設定でカスタムAPIエンドポイントURLを設定します（Electronのみ）。
- (オプション) 仮想オーディオデバイス機能のためのPulseAudioまたはPipeWireを搭載したLinux（デスクトップアプリのみ）

# インストール

## ソースから

### 前提条件

- Node.js（最新のLTSバージョンを推奨）
- npm
- 音声サポートはすべてのプラットフォーム（Windows、macOS、Linux）で動作します
- 仮想オーディオデバイスにはPulseAudioまたはPipeWireを搭載したLinuxが必要です（デスクトップアプリのみ）

### 手順

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
Sokuji Setup 0.9.18.exe
```

### macOS
`.dmg`パッケージをダウンロードしてインストールします：
```
Sokuji-0.9.18.dmg
```

### Linux (Debian/Ubuntu)
`.deb`パッケージをダウンロードしてインストールします：
```bash
sudo dpkg -i sokuji_0.9.18_amd64.deb
```

他のLinuxディストリビューションの場合は、ポータブル`.zip`パッケージをダウンロードして任意の場所に展開することもできます。

# 使い方

1. **APIキーを設定**:
   
   <p align="center">
     <img width="600" src="https://github.com/kizuna-ai-lab/sokuji/raw/main/screenshots/api-settings.png" alt="API Settings" />
   </p>
   
   - 右上の設定ボタンをクリック
   - 希望のプロバイダー（OpenAI, Gemini, Palabra, またはKizuna AI）を選択
   - ユーザー管理プロバイダーの場合：APIキーを入力し、「検証」をクリック。Palabraの場合、クライアントIDとクライアントシークレットを入力する必要があります。OpenAI互換エンドポイントの場合（Electronのみ）、APIキーとカスタムエンドポイントURLの両方を設定します。
   - Kizuna AIの場合：アカウントにサインインしてバックエンド管理のAPIキーに自動アクセスします。
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

5. **他のアプリケーションで使用**（Linuxのみ）:
   - ターゲットアプリケーションのマイク入力として「Sokuji_Virtual_Mic」を選択
   - 翻訳された音声が高度なミキシングをサポートしてそのアプリケーションに送信されます

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

## 最近の改善

### モダンな音声処理 (v0.9.x)

音声システムには改善されたエコーキャンセレーションと処理機能が搭載されています：

- **エコーキャンセレーション**: 最新のWeb Audio APIを使用した高度なエコー抑制
- **キューベースの再生**: インテリジェントなバッファリングによるスムーズな音声ストリーミング
- **リアルタイムパススルー**: 調整可能なボリュームコントロールで音声をモニター
- **イベント駆動アーキテクチャ**: 効率的なイベント処理によるCPU使用率の削減
- **クロスプラットフォームサポート**: すべてのプラットフォームでの統一された音声処理

### AIクライアントの最適化 (v0.8.x)

Google Geminiクライアントのパフォーマンス向上：

- **一貫したID生成**: 固定インスタンスIDによる最適化された会話アイテム管理
- **メモリ使用の改善**: 冗長なID生成呼び出しの削減
- **パフォーマンスの向上**: より速い応答時間のための合理化された会話処理

### リアルタイム音声パススルー

ライブ音声モニタリング機能：

- **リアルタイムフィードバック**: より良いユーザー体験のために録音中に自分の声を聞く
- **ボリュームコントロール**: 最適なモニタリングのための調整可能なパススルーボリューム
- **低遅延**: 最適化された音声処理による即時音声フィードバック

# 使用技術

- **ランタイム**: Electron 34+ (Windows、macOS、Linux) / Chrome Extension Manifest V3
- **フロントエンド**: React 18 + TypeScript
- **バックエンド**: Cloudflare Workers + Hono + D1 Database
- **認証**: Better Auth
- **AIプロバイダー**: OpenAI, Google Gemini, Palabra.ai, Kizuna AI, およびOpenAI互換エンドポイント
- 高度な音声処理:
  - リアルタイム音声処理のためのWeb Audio API
  - 信頼性の高い音声キャプチャのためのMediaRecorder API
  - リアルタイム音声分析のためのScriptProcessor
  - スムーズなストリーミングのためのキューベース再生システム
- スタイリングのためのSASS
- アイコンのためのLucide React

# ライセンス

このプロジェクトはAGPL-3.0ライセンスの下でライセンスされています。詳細は[LICENSE](LICENSE)ファイルを参照してください。

# サポート

問題が発生した場合や質問がある場合：

1. [Issues](https://github.com/kizuna-ai-lab/sokuji/issues)で既存の問題を確認
2. 新しい問題を報告
3. [Discussions](https://github.com/kizuna-ai-lab/sokuji/discussions)で質問

# 謝辞

- OpenAI - リアルタイムAPI
- Google - Gemini API
- Electron - クロスプラットフォームデスクトップアプリケーションフレームワーク
- React - ユーザーインターフェースライブラリ
- PulseAudio/PipeWire - Linuxオーディオシステム

---

<p align="center">
  <strong>Sokujiで作られた ❤️</strong>
</p>
