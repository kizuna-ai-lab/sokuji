---
title: "ブラウザ内で音声合成を実現する ― sherpa-onnx TTS で完全オフライン翻訳パイプラインを完成させる"
emoji: "🔊"
type: "tech"
topics: ["WebAssembly", "音声合成", "sherpaonnx", "WebAudio", "TTS"]
published: false
---

## はじめに

このシリーズでは、リアルタイム AI 翻訳アプリ **[Sokuji](https://github.com/kizuna-ai-lab/sokuji)** の開発を通じて、ブラウザ上で**完全オフラインの音声→音声（Speech-to-Speech）翻訳パイプライン**を構築してきました。

1. [第1回：ASR（音声認識）](https://zenn.dev/shinonome_tk/articles/7b27eac0eb7ab6) — sherpa-onnx WASM + VAD
2. [第2回：翻訳](https://zenn.dev/shinonome_tk/articles/1415377d126772) — Opus-MT / Qwen / TranslateGemma + Transformers.js
3. **第3回：TTS（音声合成）** ← 今回

今回は最後のピース ―― 翻訳されたテキストをブラウザ内で音声に変換する TTS エンジンの実装を解説します。これにより **ASR → 翻訳 → TTS** のパイプライン全体がブラウザ内で完結し、ネットワーク不要のリアルタイム音声翻訳が実現します。

```
🎙️ マイク入力
  ↓  AsrEngine（第1回）
📝 認識テキスト「今日はいい天気ですね」
  ↓  TranslationEngine（第2回）
🌐 翻訳テキスト「It's nice weather today」
  ↓  TtsEngine（今回）
🔊 合成音声で読み上げ
```

## sherpa-onnx の TTS 機能

[第1回](https://zenn.dev/shinonome_tk/articles/7b27eac0eb7ab6)で紹介した sherpa-onnx は、ASR だけでなく **TTS（Text-to-Speech）** もサポートしています。WASM ビルドが提供されているため、ブラウザ上でもネイティブ並みの速度で音声合成を実行できます。

対応する TTS エンジンは多岐にわたります：

| エンジン | 特徴 | モデル数 | サイズ目安 |
|---------|------|---------|----------|
| **Piper** | 軽量 VITS、多言語 | 60+ | 38-81MB |
| **Matcha** | 2段階合成（音響+ボコーダ） | 3 | ~145MB |
| **Coqui** | グラフェームベース VITS | 20+ | 71-114MB |
| **MMS** | Meta 多言語 | 20+ | 100-114MB |
| **Kokoro** | 54ボイス多言語（準備中） | 1 | ~189MB |
| **VITS** | 高度なカスタム設定対応 | 5+ | 可変 |

合計 **136モデル、53言語**に対応しています。

ブラウザ上で動作する TTS デモを公開しています。以下のリンクからお試しいただけます：

https://huggingface.co/spaces/jiangzhuo9357/sherpa-onnx-tts-demos

## アーキテクチャ概要

TTS の基本構成は第1回の ASR と同じパターンです。Classic Web Worker + Emscripten WASM + IndexedDB モデルキャッシュの組み合わせです。

```
┌──────────────────────────────────────────────────┐
│                  メインスレッド                    │
│                                                   │
│  TtsEngine                                        │
│    ├─ init(modelId)                               │
│    │    → IndexedDB から Blob URL 取得             │
│    │    → Worker 起動 + WASM 初期化                │
│    │    → Promise<{ loadTimeMs, numSpeakers }>    │
│    │                                               │
│    └─ generate(text, speakerId, speed)            │
│         → Worker で推論実行                        │
│         → Promise<{ samples, sampleRate }>        │
│                                                   │
│  ModernAudioPlayer                                │
│    └─ Int16 → WAV Blob → HTMLAudioElement 再生    │
└──────────────────────┬───────────────────────────┘
                       │ postMessage
                       ▼
┌──────────────────────────────────────────────────┐
│              Classic Web Worker                   │
│                                                   │
│  importScripts() で WASM ランタイムをロード         │
│                                                   │
│  テキスト入力 → エンジン別設定                      │
│              → createOfflineTts(Module)            │
│              → tts.generate({ text, sid, speed }) │
│              → Float32Array + sampleRate 返却      │
└──────────────────────────────────────────────────┘
```

## Worker の実装

### WASM ランタイムのロード

ASR Worker と同様に、`importScripts()` の前に `Module` オブジェクトを設定します：

```javascript
// tts.worker.js（Classic Worker）
let Module = {};
let tts = null;

self.onmessage = function(e) {
  if (e.data.type === 'init') {
    const { fileUrls, runtimeBaseUrl, dataPackageMetadata,
            modelFile, engine, ttsConfig } = e.data;
    const startTime = performance.now();

    // Emscripten のファイル解決をフック
    Module.locateFile = (path, scriptDirectory) => {
      if (fileUrls[path]) return fileUrls[path];  // IndexedDB の Blob URL
      return runtimeBaseUrl + '/' + path;          // バンドル済みランタイム
    };

    // package-metadata.json の内容を注入
    // Emscripten の loadPackage がファイルシステムを構築するのに必要
    Module._dataPackageMetadata = dataPackageMetadata;

    Module.onRuntimeInitialized = () => {
      // エンジン別の設定を構築
      const config = buildEngineConfig(engine, ttsConfig, modelFile);

      // TTS エンジンを生成
      tts = createOfflineTts(Module);

      postMessage({
        type: 'ready',
        loadTimeMs: performance.now() - startTime,
        numSpeakers: tts.numSpeakers,
        sampleRate: tts.sampleRate,
      });
    };

    // WASM ランタイムをロード
    importScripts(
      runtimeBaseUrl + '/sherpa-onnx-wasm-main-tts.js',  // Emscripten グルーコード
      runtimeBaseUrl + '/sherpa-onnx-tts.js'              // TTS API
    );
  }
};
```

:::message
**ASR との違い**: ASR Worker は3つのスクリプト（グルーコード + VAD + ASR）をロードしますが、TTS Worker は2つ（グルーコード + TTS）です。VAD は不要なためです。
:::

### エンジン別の設定構築

sherpa-onnx TTS は複数のモデルアーキテクチャをサポートしているため、エンジンタイプに応じて設定を切り替えます：

```javascript
function buildEngineConfig(engine, ttsConfig, modelFile) {
  switch (engine) {
    case 'piper':
      // 単一段階 VITS — espeak-ng による音素変換
      return {
        offlineTtsVitsModelConfig: {
          model: modelFile || './model.onnx',
          tokens: './tokens.txt',
          dataDir: './espeak-ng-data',
          noiseScale: 0.667,
          noiseScaleW: 0.8,
          lengthScale: 1.0,
        }
      };

    case 'matcha':
      // 2段階合成 — 音響モデル + ボコーダ
      return {
        offlineTtsMatchaModelConfig: {
          acousticModel: ttsConfig.acousticModel || './model-steps-3.onnx',
          vocoder: ttsConfig.vocoder || './vocos-22khz-univ.onnx',
          tokens: './tokens.txt',
          dataDir: ttsConfig.dataDir || '',
          noiseScale: 0.667,
          lengthScale: 1.0,
        }
      };

    case 'kokoro':
      // 多言語マルチスピーカー（54ボイス）
      return {
        offlineTtsKokoroModelConfig: {
          model: modelFile || './model.int8.onnx',
          voices: './voices.bin',
          tokens: './tokens.txt',
          dataDir: './espeak-ng-data',
          lengthScale: 1.0,
        }
      };

    // coqui, mimic3, mms, vits なども同様にサポート
  }
}
```

### 音声合成の実行

設定が完了したら、`tts.generate()` で音声を合成します：

```javascript
// generate メッセージの処理
if (e.data.type === 'generate') {
  const { text, sid, speed } = e.data;
  const startTime = performance.now();

  // 音声合成を実行
  const result = tts.generate({
    text: text,
    sid: sid,      // スピーカーID（マルチスピーカーモデル用）
    speed: speed,  // 速度倍率（1.0 = 通常）
  });

  // result.samples: Float32Array [-1.0, 1.0]
  // result.sampleRate: モデル固有のサンプルレート

  postMessage(
    {
      type: 'result',
      samples: result.samples,
      sampleRate: result.sampleRate || tts.sampleRate,
      generationTimeMs: performance.now() - startTime,
    },
    [result.samples.buffer]  // Transferable で zero-copy 転送
  );
}
```

## メインスレッド：TtsEngine クラス

Worker を Promise ベースの API でラップします：

```typescript
// src/lib/local-inference/engine/TtsEngine.ts

export class TtsEngine {
  private worker: Worker | null = null;
  private _numSpeakers = 0;
  private _sampleRate = 0;

  async init(modelId: string): Promise<{
    loadTimeMs: number;
    numSpeakers: number;
    sampleRate: number;
  }> {
    const model = getManifestEntry(modelId);
    const manager = ModelManager.getInstance();
    const fileUrls = await manager.getModelBlobUrls(modelId);

    // package-metadata.json を取得
    // Emscripten がファイルシステムを構築するのに必要なメタデータ
    const metadataBlobUrl = fileUrls['package-metadata.json'];
    const metadataResponse = await fetch(metadataBlobUrl);
    const dataPackageMetadata = await metadataResponse.json();

    this.worker = new Worker('./workers/tts.worker.js');

    return new Promise((resolve, reject) => {
      this.worker!.onmessage = (e) => {
        if (e.data.type === 'ready') {
          manager.revokeBlobUrls(fileUrls);
          this._numSpeakers = e.data.numSpeakers;
          this._sampleRate = e.data.sampleRate;
          resolve(e.data);
        }
      };

      this.worker!.postMessage({
        type: 'init',
        modelFile: model.modelFile || '',
        engine: model.engine || '',
        ttsConfig: model.ttsConfig || {},
        runtimeBaseUrl: TTS_BUNDLED_RUNTIME_PATH,
        dataPackageMetadata,
        fileUrls: dataFileUrls,
      });
    });
  }

  async generate(
    text: string,
    sid = 0,
    speed = 1.0,
  ): Promise<TtsResult> {
    // 絵文字を除去（モデルが対応していないため）
    const sanitizedText = TtsEngine.stripEmoji(text);

    return new Promise((resolve, reject) => {
      this.pendingGenerate = { resolve, reject };
      this.worker!.postMessage({
        type: 'generate',
        text: sanitizedText,
        sid,
        speed,
      });
    });
  }

  // 絵文字を除去する前処理
  private static stripEmoji(text: string): string {
    return text
      .replace(/\p{Emoji_Presentation}|\p{Extended_Pictographic}/gu, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }
}
```

:::message alert
**絵文字の除去が必要な理由**: 現在の TTS モデルは絵文字を処理できず、Unicode コードポイント名を読み上げたり、ノイズを出力したりします。`stripEmoji()` で事前に除去する必要があります。
:::

## 音声再生：WAV Blob ストリーミング

TTS が生成した Float32Array をスピーカーから再生するまでの流れです。

### なぜ WAV Blob + HTMLAudioElement を使うのか

Web Audio API の `AudioBufferSourceNode` を使う方法もありますが、Sokuji では **WAV Blob → HTMLAudioElement** のアプローチを採用しています：

| | WAV Blob + Audio | AudioBufferSourceNode |
|---|---|---|
| エコーキャンセル | ブラウザ標準で対応 | 追加実装が必要 |
| キュー管理 | `onended` イベントで簡単 | 手動タイミング管理 |
| ブラウザ互換性 | 非常に高い | 一部制限あり |
| 実装の簡潔さ | シンプル | 複雑 |

リアルタイム翻訳では**エコーキャンセル**が必須です。翻訳音声がマイクに回り込んで再度認識されるフィードバックループを防ぐ必要があります。HTMLAudioElement はブラウザのエコーキャンセル機構と自然に連携します。

### 再生パイプライン

```typescript
// ModernAudioPlayer.js

class ModernAudioPlayer {
  constructor({ sampleRate = 24000 } = {}) {
    this.sampleRate = sampleRate;
    this.context = new AudioContext({ sampleRate });
    this.analyser = this.context.createAnalyser();
    this.trackQueues = new Map();  // トラックごとのキュー
  }

  playAudio(trackId, buffer, volume = 1.0) {
    // 1. Int16 PCM → WAV コンテナを構築
    const wavBlob = this.createWavBlob(buffer);
    const audioUrl = URL.createObjectURL(wavBlob);

    // 2. HTMLAudioElement で再生
    const audio = new Audio();
    audio.src = audioUrl;
    audio.volume = volume;

    // 3. Web Audio API に接続（波形分析用）
    const source = this.context.createMediaElementSource(audio);
    const gainNode = this.context.createGain();
    gainNode.gain.value = this.globalVolumeMultiplier;

    source.connect(this.analyser);
    source.connect(gainNode);
    gainNode.connect(this.context.destination);

    // 4. イベント駆動のキュー処理
    audio.onended = () => {
      URL.revokeObjectURL(audioUrl);  // メモリ解放
      this.processQueue(trackId);     // 次のチャンクを再生
    };

    audio.play();
  }

  // WAV ヘッダの構築（44バイト）
  createWavBlob(pcmData) {
    const header = new ArrayBuffer(44);
    const view = new DataView(header);

    // RIFF チャンク
    view.setUint32(0, 0x52494646, false);   // "RIFF"
    view.setUint32(4, 36 + pcmData.byteLength, true);
    view.setUint32(8, 0x57415645, false);   // "WAVE"

    // fmt チャンク
    view.setUint32(12, 0x666d7420, false);  // "fmt "
    view.setUint32(16, 16, true);           // チャンクサイズ
    view.setUint16(20, 1, true);            // PCM フォーマット
    view.setUint16(22, 1, true);            // モノラル
    view.setUint32(24, this.sampleRate, true);
    view.setUint32(28, this.sampleRate * 2, true);
    view.setUint16(32, 2, true);            // ブロックサイズ
    view.setUint16(34, 16, true);           // ビット深度

    // data チャンク
    view.setUint32(36, 0x64617461, false);  // "data"
    view.setUint32(40, pcmData.byteLength, true);

    return new Blob(
      [new Uint8Array(header), pcmData],
      { type: 'audio/wav' }
    );
  }
}
```

## 文単位ストリーミング

リアルタイム翻訳では、翻訳テキスト全体を一度に合成するのではなく、**文単位でストリーミング再生**します。これにより、最初の音声が再生されるまでの待ち時間（Time-to-First-Audio）を大幅に短縮できます。

```typescript
// LocalInferenceClient.ts — パイプラインの統合部分

async function processTts(translatedText: string) {
  // 翻訳テキストを文に分割
  const sentences = splitSentences(translatedText, targetLanguage);

  for (const sentence of sentences) {
    // 文ごとに音声を合成
    const ttsResult = await ttsEngine.generate(
      sentence,
      speakerId,
      ttsSpeed,
    );

    // モデルのサンプルレート → 24kHz にリサンプル
    const resampled = resampleFloat32(
      ttsResult.samples,
      ttsResult.sampleRate,
      24000,
    );

    // Float32 → Int16 に変換
    const int16Audio = float32ToInt16(resampled);

    // 音声チャンクを即座にプレーヤーに送信
    // → 最初の文の合成が終わった時点で再生開始
    onAudioDelta(int16Audio);
  }
}
```

この仕組みにより、例えば3文の翻訳テキストの場合：

- **一括合成**: 3文すべての合成完了を待ってから再生 → 遅い
- **文単位ストリーミング**: 1文目の合成が終わった時点で再生開始、残りはバックグラウンドで合成 → 体感レイテンシ大幅短縮

## 音声テキストマッピング（カラオケ機能）

文単位のストリーミングでは、**どの音声がどのテキスト部分に対応するか**を追跡しています。これにより、音声再生位置に応じてテキストをハイライト表示する「カラオケ」的な機能が実現できます：

```typescript
// 各音声チャンクにテキスト位置情報を付与
assistantItem.formatted!.audioSegments!.push({
  textEnd: audioTextEnd,       // この音声が対応するテキストの終了位置
  audioEnd: cumulativeAudioDuration,  // 累積再生時間
});
```

## モデルマニフェストの設計

TTS モデルのメタデータは ASR・翻訳と同じマニフェストシステムで一元管理します：

```typescript
// modelManifest.ts

// Piper — 軽量 VITS エンジン
{
  id: 'piper-en',
  type: 'tts',
  name: 'Piper (English, multi-speaker)',
  languages: ['en'],
  cdnPath: 'wasm-piper-en',
  engine: 'piper',
  modelFile: 'en_US-libritts_r-medium.onnx',
  numSpeakers: 18,  // 18人のスピーカーから選択可能
  variants: {
    default: {
      dtype: 'default',
      files: [
        { filename: 'sherpa-onnx-wasm-main-tts.data', sizeBytes: 81_234_567 },
        { filename: 'package-metadata.json', sizeBytes: 26_614 },
      ]
    }
  },
}

// Matcha — 2段階合成（音響モデル + ボコーダ）
{
  id: 'matcha-zh-baker',
  type: 'tts',
  name: 'Matcha Baker (Chinese, female)',
  languages: ['zh'],
  cdnPath: 'wasm-matcha-zh-baker',
  engine: 'matcha',
  ttsConfig: {
    acousticModel: './model-steps-3.onnx',
    vocoder: './vocos-22khz-univ.onnx',
    lexicon: './lexicon.txt',
    ruleFsts: './date.fst,./phone.fst',  // 日付・電話番号の正規化ルール
  },
  numSpeakers: 1,
  variants: {
    default: {
      dtype: 'default',
      files: ttsFiles(145_676_954, 1_280),
    }
  },
}
```

### ランタイムとモデルデータの分離

TTS では、**WASM ランタイム**（JS + WASM ファイル）と**モデルデータ**（.data ファイル）が分離されています：

```
public/wasm/sherpa-onnx-tts/          ← バンドル済み（全モデル共通）
  ├── sherpa-onnx-wasm-main-tts.js    （Emscripten グルーコード）
  ├── sherpa-onnx-wasm-main-tts.wasm  （WASM バイナリ）
  └── sherpa-onnx-tts.js              （TTS API ラッパー）

IndexedDB (sokuji-models)             ← モデル別にダウンロード
  ├── piper-en/sherpa-onnx-wasm-main-tts.data      (81MB)
  ├── piper-en/package-metadata.json
  ├── matcha-zh-baker/sherpa-onnx-wasm-main-tts.data (145MB)
  └── matcha-zh-baker/package-metadata.json
```

この設計により：
- **ランタイムはアプリに同梱**: 初回ロード時のダウンロードが不要
- **モデルデータのみオンデマンドダウンロード**: ユーザーが必要な言語のモデルだけダウンロード
- **複数モデルでランタイムを共有**: ディスクと帯域を節約

### package-metadata.json の役割

Emscripten は `.data` ファイルの中身を仮想ファイルシステムに展開します。`package-metadata.json` には、`.data` ファイル内の各ファイルのオフセットとサイズが記録されています：

```json
{
  "files": [
    { "filename": "/model.onnx", "start": 0, "end": 45123456 },
    { "filename": "/tokens.txt", "start": 45123456, "end": 45234567 },
    { "filename": "/espeak-ng-data/...", "start": 45234567, "end": 81234567 }
  ]
}
```

Worker の初期化時に `Module._dataPackageMetadata` として注入することで、Emscripten が `.data` ファイルを正しく展開できます。

## パフォーマンス特性

### モデルロード時間

TTS モデルは ASR や翻訳モデルと比べて小さく（38〜145MB）、ロード時間は概ね1秒前後です。

### 合成速度

以下は 19 単語の英文テキストに対する実測値です：

| モデル | 生成音声 | 合成時間 | RTF |
|--------|---------|---------|-----|
| Piper | 5.07秒 | 1,485ms | 0.293 |
| Matcha | 6.61秒 | 1,067ms | 0.161 |
| Coqui | 5.58秒 | 7,501ms | 1.344 |

RTF が 1.0 未満であればリアルタイムより高速です。Matcha は RTF 0.161 と高速で、Piper も十分なパフォーマンスです。Coqui は RTF 1.344 とリアルタイムを超えるため、長文の合成には注意が必要です。

なお、上記は代表的なエンジンの結果です。Sokuji では 136 以上の TTS モデルを搭載しており、モデルサイズが 30MB 以下の軽量モデルではリアルタイムの **9倍以上** の速度で合成できるものもあります。

:::message
合成速度はテキストの長さとデバイスの CPU 性能に大きく依存します。文単位ストリーミングにより、体感レイテンシは最初の文の合成時間で決まります。
:::

## ハマりポイントと学び

### 1. package-metadata.json の注入タイミング

Emscripten の `loadPackage()` は `Module.onRuntimeInitialized` の前に実行されます。`_dataPackageMetadata` の注入は `importScripts()` の**前**に行う必要があります：

```javascript
// ✅ 正しい順序
Module._dataPackageMetadata = dataPackageMetadata;
Module.locateFile = (path) => { /* ... */ };
Module.onRuntimeInitialized = () => { /* ... */ };
importScripts(/* ... */);

// ❌ 誤った順序（importScripts の後に設定しても遅い）
importScripts(/* ... */);
Module._dataPackageMetadata = dataPackageMetadata;  // 効果なし
```

### 2. エンジン別の設定構造

sherpa-onnx の TTS 設定は、**すべてのエンジンの設定フィールドを同時に渡す**必要があります。使わないエンジンのフィールドは空の設定で埋めます：

```javascript
// Matcha を使う場合でも、VITS と Kokoro の空設定が必要
const config = {
  offlineTtsVitsModelConfig: {
    model: '', tokens: '', dataDir: '',
    // ... 空の設定
  },
  offlineTtsMatchaModelConfig: {
    acousticModel: './model-steps-3.onnx',
    vocoder: './vocos-22khz-univ.onnx',
    // ... 実際の設定
  },
  offlineTtsKokoroModelConfig: {
    model: '', voices: '', tokens: '',
    // ... 空の設定
  },
};
```

### 3. サンプルレートの不一致

TTS モデルのサンプルレートはモデルによって異なります（16kHz, 22kHz, 24kHz など）。しかし、再生パイプラインは 24kHz で統一されているため、リサンプリングが必要です：

```typescript
// モデルが 22kHz で出力 → 24kHz にリサンプル
const resampled = resampleFloat32(
  ttsResult.samples,    // Float32Array @ 22kHz
  ttsResult.sampleRate, // 22050
  24000,                // ターゲット: 24kHz
);
```

### 4. ruleFsts による正規化

中国語の Matcha モデルでは、日付や電話番号を正しく読み上げるために **有限状態トランスデューサ（FST）** によるテキスト正規化が使われています：

```typescript
ttsConfig: {
  ruleFsts: './date.fst,./phone.fst',
  // "2024年3月22日" → "二〇二四年三月二十二日"
  // "090-1234-5678" → "ゼロキューゼロ いち に さん よん ..."
}
```

### 5. マルチスピーカーモデルの活用

Piper EN など一部のモデルは複数のスピーカーを含んでいます。`sid`（Speaker ID）を変えることで、同じモデルで異なる声を使い分けられます：

```typescript
// スピーカー 0（デフォルト）
await ttsEngine.generate("Hello", 0, 1.0);

// スピーカー 5（別の声）
await ttsEngine.generate("Hello", 5, 1.0);

// 速度 1.5倍
await ttsEngine.generate("Hello", 0, 1.5);
```

`tts.numSpeakers` でスピーカー数を取得できるため、UI でスピーカー選択を提供できます。

## 完全パイプラインの統合

3回のシリーズで解説してきた要素を統合すると、以下のパイプラインが完成します：

```
🎙️ マイク入力 (Int16 @ 24kHz)
    │
    ▼
┌─────────────────────────────────────┐
│  AsrEngine（Classic Worker + WASM）  │
│  ダウンサンプル → VAD → 認識          │
│  [第1回で解説]                       │
└─────────────┬───────────────────────┘
              │ テキスト「今日はいい天気ですね」
              ▼
┌─────────────────────────────────────┐
│  TranslationEngine（ES Module Worker）│
│  customCache → Transformers.js 推論   │
│  [第2回で解説]                        │
└─────────────┬───────────────────────┘
              │ テキスト「It's nice weather today」
              ▼
┌─────────────────────────────────────┐
│  TtsEngine（Classic Worker + WASM）   │
│  文分割 → 合成 → リサンプル → 再生     │
│  [今回解説]                           │
└─────────────┬───────────────────────┘
              │ Int16 @ 24kHz
              ▼
🔊 スピーカー出力
```

**すべてブラウザ内で完結。ネットワーク通信ゼロ。**

### パイプライン全体のレイテンシ

| 処理段階 | 典型的なレイテンシ |
|---------|-----------------|
| ASR（VAD + 認識） | ~222-431ms |
| 翻訳（Opus-MT） | ~500ms |
| TTS（最初の文、Matcha） | ~1,067ms（全文）|
| **合計** | **約1.8-2.0秒** |

上記の TTS レイテンシは 19 単語の全文を合成した場合の値です。文単位ストリーミングでは最初の短い文（数単語）のみ合成すれば再生を開始できるため、実際の体感レイテンシはこれより大幅に短くなります。

また、Matcha（RTF 0.161）や Piper（RTF 0.293）は合成速度が実際の発話速度よりも大幅に速いため、最初の文以降は遅延が蓄積せず、むしろ合成が再生に追いつき・追い越します。つまり、**聞き手が遅延を感じるのは最初の文だけ**で、長い会話でも遅延は増えません。

## まとめ

このシリーズでは、ブラウザ上で完全オフラインのリアルタイム音声翻訳パイプラインを構築しました：

| コンポーネント | 技術 | Worker タイプ |
|--------------|------|-------------|
| ASR | sherpa-onnx WASM + VAD | Classic Worker |
| 翻訳 | Transformers.js + ONNX | ES Module Worker |
| TTS | sherpa-onnx WASM + VITS/Matcha | Classic Worker |

### 共通するパターン

3つのコンポーネントに共通する設計パターンがあります：

1. **IndexedDB モデルキャッシュ**: 大容量モデルのブラウザ内永続化
2. **Blob URL によるファイル受け渡し**: メインスレッド → Worker 間のファイル転送
3. **Promise ベースの Engine クラス**: Worker の非同期 API を使いやすくラップ
4. **Transferable Objects**: zero-copy 音声データ転送
5. **統一マニフェスト**: すべてのモデルのメタデータを一元管理

### ブラウザ内ローカル推論の可能性

WebAssembly と WebGPU の進化により、かつてはサーバーサイドでしか動かせなかった AI モデルがブラウザで実行可能になりつつあります。

- **プライバシー**: データがデバイスから出ない
- **オフライン対応**: インターネット接続不要
- **コスト**: API 課金なし
- **レイテンシ**: ネットワーク往復なし

Sokuji のローカル推論モードは、この可能性を実際のプロダクトで実現した一例です。

---

## Sokuji を試してみる

**Sokuji** は、本シリーズで解説した ASR → 翻訳 → TTS のパイプラインを搭載したリアルタイム AI 翻訳アプリです。Chrome 拡張機能として無料で公開しており、Google Meet や Zoom などのビデオ会議で、相手の発言をリアルタイムで翻訳・読み上げできます。

ローカル推論モードを使えば、API キー不要・完全オフラインで動作します。ぜひお試しください：

- 🌐 [Chrome Web Store からインストール](https://chromewebstore.google.com/detail/sokuji/eiodakodalhadpjkmndhfcjpjbafokga)
- 💻 [GitHub（ソースコード・Star 歓迎）](https://github.com/kizuna-ai-lab/sokuji)
- 📖 [日本語README](https://github.com/kizuna-ai-lab/sokuji/blob/main/docs/README.ja.md)
