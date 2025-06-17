<p align="center">
  <img width="200" src="https://github.com/kizuna-ai-lab/sokuji/raw/main/src/assets/logo.png" alt="Sokuji Logo">
</p>

<p align="center">
  <em>OpenAI & Google Gemini による リアルタイム音声翻訳</em>
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
  
  <!-- Vibe Coding Badge -->
  <img alt="Vibe Coding" src="https://img.shields.io/badge/built%20with-vibe%20coding-ff69b4?style=flat-square" />
  
  <!-- DeepWiki Badge -->
  <a href="https://deepwiki.com/kizuna-ai-lab/sokuji" target="_blank">
    <img alt="Ask DeepWiki" src="https://deepwiki.com/badge.svg" />
  </a>
</p>

## 言語 / Languages

- [English](README.md)
- [日本語](README.ja.md)

# なぜSokujiなのか？

SokujiはOpenAIとGoogle Gemini APIを使用してリアルタイム音声翻訳を提供するデスクトップアプリケーションです。音声入力をキャプチャし、高度なAIモデルで処理し、リアルタイムで翻訳された出力を配信することで、ライブ会話における言語の壁を取り除きます。

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

Sokujiは基本的な翻訳を超えて、仮想デバイス管理による完全なオーディオルーティングソリューションを提供し、他のアプリケーションとのシームレスな統合を可能にします。リアルタイムオーディオ可視化と包括的なログ記録を備えた、モダンで直感的なインターフェースを提供します。

# 機能

1. **OpenAIとGoogle Gemini APIを使用したリアルタイム音声翻訳**
2. **マルチプロバイダーサポート**: OpenAIとGoogle Geminiをシームレスに切り替え
3. **サポートされているモデル**:
   - **OpenAI**: `gpt-4o-realtime-preview`, `gpt-4o-mini-realtime-preview`
   - **Google Gemini**: `gemini-2.0-flash-live-001`, `gemini-2.5-flash-preview-native-audio-dialog`
4. **自動ターン検出** OpenAI用の複数モード（通常、セマンティック、無効）
5. **波形表示による音声可視化**
6. **Linux上での仮想オーディオデバイス**の作成と管理（PulseAudio/PipeWire使用）
7. **仮想デバイス間の自動オーディオルーティング**
8. **オーディオ入力・出力デバイス選択**
9. **API相互作用を追跡する包括的なログ**
10. **カスタマイズ可能なモデル設定**（温度、最大トークン）
11. **ユーザー転写モデル選択**（OpenAI用: `gpt-4o-mini-transcribe`, `gpt-4o-transcribe`, `whisper-1`）
12. **ノイズリダクションオプション**（OpenAI用: なし、近距離、遠距離）
13. **リアルタイムフィードバック付きAPIキー検証**
14. **ユーザーのホームディレクトリでの設定永続化**

# オーディオルーティング

<p align="center">
  <img width="600" src="https://github.com/kizuna-ai-lab/sokuji/raw/main/screenshots/audio-routing.png" alt="Audio Routing Diagram" />
</p>

Sokujiはシームレスなオーディオルーティングを促進するために仮想オーディオデバイスを作成します：

- **Sokuji_Virtual_Speaker**: アプリケーションからオーディオを受信する仮想出力シンク
- **Sokuji_Virtual_Mic**: 他のアプリケーションで入力として選択できる仮想マイク
- PipeWireの`pw-link`ツールを使用したこれらのデバイス間の自動接続

# インストール

## 前提条件

### Linux (Ubuntu/Debian)
```bash
sudo apt update
sudo apt install pulseaudio pipewire pipewire-pulse wireplumber
```

### macOS
macOSでは追加の依存関係は必要ありません。

### Windows
Windowsでは追加の依存関係は必要ありません。

## プリビルドバイナリ

[リリースページ](https://github.com/kizuna-ai-lab/sokuji/releases)から最新のプリビルドバイナリをダウンロードしてください：

- **Linux**: `sokuji-linux-x64.tar.gz`
- **macOS**: `sokuji-macos-x64.dmg`
- **Windows**: `sokuji-windows-x64.exe`

## ソースからのビルド

### 前提条件
- Node.js 18以上
- npm または yarn

### ステップ

1. リポジトリをクローン:
```bash
git clone https://github.com/kizuna-ai-lab/sokuji.git
cd sokuji
```

2. 依存関係をインストール:
```bash
npm install
```

3. アプリケーションをビルド:
```bash
npm run build
```

4. アプリケーションを起動:
```bash
npm start
```

または、開発モードで実行:
```bash
npm run dev
```

# 使用方法

## 初期設定

1. Sokujiを起動
2. 設定タブに移動
3. OpenAIまたはGoogle GeminiのAPIキーを入力
4. 希望するAIモデルを選択
5. 入力・出力オーディオデバイスを設定

## 基本的な使用方法

1. **開始**ボタンをクリックして翻訳セッションを開始
2. マイクに向かって話す
3. リアルタイムで翻訳された音声を聞く
4. **停止**ボタンをクリックしてセッションを終了

## 高度な機能

### 仮想オーディオデバイス（Linux）
Linuxでは、Sokujiは自動的に仮想オーディオデバイスを作成し、他のアプリケーションとの統合を可能にします。

### ログとデバッグ
包括的なログがアプリケーション内で利用可能で、API相互作用とオーディオ処理をデバッグできます。

# 設定

設定は以下の場所に保存されます：
- **Linux**: `~/.config/sokuji/`
- **macOS**: `~/Library/Application Support/sokuji/`
- **Windows**: `%APPDATA%\sokuji\`

# トラブルシューティング

## 一般的な問題

### オーディオデバイスが検出されない
- オーディオドライバが最新であることを確認
- アプリケーションを再起動
- システムのオーディオ設定を確認

### API接続の問題
- インターネット接続を確認
- APIキーが有効で正しく入力されていることを確認
- APIクォータと使用制限を確認

### Linux特有の問題
- PulseAudioまたはPipeWireが実行されていることを確認
- 必要な権限でアプリケーションが実行されていることを確認

## ログ

詳細なログは以下で利用可能です：
- アプリケーション内のログタブ
- 設定ディレクトリ内のログファイル

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
