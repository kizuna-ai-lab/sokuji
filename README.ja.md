<p align="center">
  <img width="200" src="https://github.com/kizuna-ai-lab/sokuji/raw/main/src/assets/logo.png" alt="Sokuji Logo">
</p>

<p align="center">
  <em>OpenAI, Google Gemini, Palabra.ai による リアルタイム音声翻訳</em>
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

SokujiはOpenAI, Google Gemini, Palabra.ai APIを使用してリアルタイム音声翻訳を提供するデスクトップアプリケーションです。音声入力をキャプチャし、高度なAIモデルで処理し、リアルタイムで翻訳された出力を配信することで、ライブ会話における言語の壁を取り除きます。

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

1. **OpenAI, Google Gemini, Palabra.ai APIを使用したリアルタイム音声翻訳**
2. **マルチプロバイダーサポート**: OpenAI, Google Gemini, Palabra.aiをシームレスに切り替え
3. **サポートされているモデル**:
   - **OpenAI**: `gpt-4o-realtime-preview`, `gpt-4o-mini-realtime-preview`
   - **Google Gemini**: `gemini-2.0-flash-live-001`, `gemini-2.5-flash-preview-native-audio-dialog`
   - **Palabra.ai**: WebRTCによるリアルタイム音声翻訳
4. **自動ターン検出** OpenAI用の複数モード（通常、セマンティック、無効）
5. **波形表示による音声可視化**
6. **デュアルキュー音声ミキシングシステムを備えた高度な仮想マイク**:
   - **通常音声トラック**: キューに入れられ、順次再生
   - **即時音声トラック**: リアルタイム音声ミキシング用の別キュー
   - **同時再生**: 両方のトラックタイプをミックスしてオーディオ体験を向上
   - **チャンク化音声対応**: 大規模な音声ストリームの効率的な処理
7. **リアルタイム音声パススルー**: 録音セッション中のライブ音声モニタリング
8. **Linux上での仮想オーディオデバイス**の作成と管理（PulseAudio/PipeWire使用）
9. **仮想デバイス間の自動オーディオルーティング**
10. **オーディオ入力・出力デバイス選択**
11. **API相互作用を追跡する包括的なログ**
12. **カスタマイズ可能なモデル設定**（温度、最大トークン）
13. **ユーザー転写モデル選択**（OpenAI用: `gpt-4o-mini-transcribe`, `gpt-4o-transcribe`, `whisper-1`）
14. **ノイズリダクションオプション**（OpenAI用: なし、近距離、遠距離）
15. **リアルタイムフィードバック付きAPIキー検証**
16. **ユーザーのホームディレクトリでの設定永続化**
17. **最適化されたAIクライアントパフォーマンス**: 一貫したID生成による会話管理の強化

# オーディオルーティング

<p align="center">
  <img width="600" src="https://github.com/kizuna-ai-lab/sokuji/raw/main/screenshots/audio-routing.png" alt="Audio Routing Diagram" />
</p>

Sokujiはシームレスなオーディオルーティングを促進するために仮想オーディオデバイスを作成します：

- **Sokuji_Virtual_Speaker**: アプリケーションからオーディオを受信する仮想出力シンク
- **Sokuji_Virtual_Mic**: 他のアプリケーションで入力として選択できる仮想マイク
- PipeWireの`pw-link`ツールを使用したこれらのデバイス間の自動接続
- マルチチャネル対応（ステレオ音声）
- アプリケーション終了時の仮想デバイスの適切なクリーンアップ

### オーディオルーティング図の理解

上の図は、Sokujiと他のアプリケーション間のオーディオの流れを示しています：

- **Chromium**: Sokujiアプリケーション自体を表します
- **Google Chrome**: Google Meet、Microsoft Teams、Zoomなどの会議アプリケーションがChromeで実行されていることを表します
- **Sokuji_Virtual_Speaker**: Sokujiによって作成された仮想スピーカー
- **Sokuji_Virtual_Mic**: Sokujiによって作成された高度なミキシング機能を備えた仮想マイク
- **HyperX 7.1 Audio**: 物理的なオーディオデバイスを表します

図中の番号付き接続は以下を表します：

**接続 ①**: Sokujiの音声出力は常に仮想スピーカーに送られます（変更不可）
**接続 ②**: Sokujiの音声は高度なミキシングをサポートする仮想マイクにルーティングされます（変更不可）
**接続 ③**: Sokujiのオーディオ設定で選択されたモニタリングデバイスで、翻訳された音声を再生するために使用されます
**接続 ④**: Google Meet/Microsoft Teamsで選択された音声出力デバイス（設定で構成）
**接続 ⑤**: Google Meet/Microsoft Teamsで入力として選択された仮想マイク（設定で構成）
**接続 ⑥**: Sokujiのオーディオ設定で選択された入力デバイス

このルーティングシステムにより、Sokujiは選択した入力デバイスから音声をキャプチャし、選択したAIプロバイダーを介して処理し、翻訳された音声をローカルスピーカーと仮想マイクを介して他のアプリケーションに高度なオーディオミキシング機能付きで出力できます。

## 強化された仮想マイク機能

仮想マイクは高度な音声処理をサポートするようになりました：

- **デュアルキューシステム**: 通常音声トラックと即時音声トラック用の別々のキュー
- **オーディオミキシング**: 複数の音声ストリームの同時再生
- **ソフトクリッピング**: ミキシング中の音声歪みを防止
- **チャンク化音声対応**: 大きな音声ファイルの効率的な処理
- **リアルタイム処理**: 即時音声トラックは通常のキューをバイパスして低遅延再生を実現
- **デバイスエミュレーター統合**: シームレスな仮想デバイス登録

## 開発者ノート

### アーキテクチャの改善

**強化されたオーディオサービスアーキテクチャ**:
- `EnhancedWavStreamPlayer`: PCMデータの自動ルーティングを備えた拡張WavStreamPlayer
- 仮想マイク統合のための自動タブ通信
- コンポーネント間の合理化されたオーディオデータフロー

**最適化されたクライアント管理**:
- `GeminiClient`: 一貫したインスタンスIDによる改善された会話アイテム管理
- メソッド呼び出しの削減とパフォーマンスの向上
- 長時間実行セッションのためのより良いメモリ管理

**仮想マイクの実装**:
- 通常音声トラックと即時音声トラック用のデュアルキューシステム
- ソフトクリッピングによるリアルタイムオーディオミキシング
- 大容量ファイル用のチャンク化音声処理
- シームレスな仮想デバイス管理のためのデバイスエミュレーター統合

# 準備

- (必須) OpenAI, Google Gemini, または Palabra.ai のAPIキー。Palabra.aiの場合、クライアントIDとクライアントシークレットが必要です。
- (必須) 仮想オーディオデバイスをサポートするPulseAudioまたはPipeWireを搭載したLinux（デスクトップアプリのみ）

# インストール

## ソースから

### 前提条件

- Node.js（最新のLTSバージョンを推奨）
- npm
- Linuxの仮想オーディオデバイスサポート:
  - PulseAudioまたはPipeWire
  - PipeWireツール (`pw-link`)

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

### Debian パッケージ

[リリースページ](https://github.com/kizuna-ai-lab/sokuji/releases)から最新のDebianパッケージをダウンロードしてインストールします：

```bash
sudo dpkg -i sokuji_*.deb
```

# 使い方

1. **APIキーを設定**:
   
   <p align="center">
     <img width="600" src="https://github.com/kizuna-ai-lab/sokuji/raw/main/screenshots/api-settings.png" alt="API Settings" />
   </p>
   
   - 右上の設定ボタンをクリック
   - 希望のプロバイダー（OpenAI, Gemini, またはPalabra）を選択
   - 選択したプロバイダーのAPIキーを入力し、「検証」をクリック。Palabraの場合、クライアントIDとクライアントシークレットを入力する必要があります。
   - 「保存」をクリックしてAPIキーを安全に保存

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

4. **他のアプリケーションで使用**:
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
