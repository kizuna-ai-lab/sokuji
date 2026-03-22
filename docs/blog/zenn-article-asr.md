---
title: "ブラウザだけで完全ローカル音声認識を実現する ― sherpa-onnx WASM + VAD の実装記録"
emoji: "🎙️"
type: "tech"
topics: ["WebAssembly", "音声認識", "sherpaonnx", "WebAudio", "JavaScript"]
published: false
---

## はじめに

「リアルタイム翻訳アプリを作りたい。でも音声認識をクラウドAPIに頼ると、レイテンシもコストも気になる ―― ブラウザだけで完全にローカルで動かせないだろうか？」

そんな疑問から始まった開発の結果、**sherpa-onnx の WASM ビルド**を使って、ブラウザ上で完全オフラインの音声認識 (ASR) を動かすことに成功しました。本記事では、その実装過程で得た知見を共有します。

https://github.com/kizuna-ai-lab/sokuji

**Sokuji** はリアルタイムAI翻訳アプリです。OpenAI や Gemini などのクラウドAPIに加え、ローカル推論モードではブラウザ内で ASR → 翻訳 → TTS のパイプライン全体をオフラインで実行できます。

本記事はシリーズの第1回です：

1. **ASR（音声認識）** ← 今回
2. 翻訳（Opus-MT / Qwen / TranslateGemma + Transformers.js）
3. TTS（音声合成 / sherpa-onnx VITS）

## sherpa-onnx とは

[sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) は、[Next-gen Kaldi](https://github.com/k2-fsa) チームが開発した音声処理フレームワークです。ONNX Runtime をバックエンドとして、ASR・TTS・VAD・話者認識など多くの音声タスクをサポートしています。

重要なのは **Emscripten による WASM ビルドが公式に提供されている** 点です。つまり、ブラウザ上でネイティブ並みの速度で音声認識を実行できます。

対応モデルも豊富です：

| エンジン | 言語 | 特徴 |
|---------|------|------|
| SenseVoice | 中/英/日/韓/広東語 | 多言語対応、高精度 |
| Moonshine | 英語 | 超軽量（45MB〜） |
| Whisper | 英語/多言語 | OpenAI Whisper 互換 |
| Paraformer | 中国語/英語 | Alibaba 製、高速 |
| NeMo | 英語 | NVIDIA 製 CTC/Transducer |
| Zipformer | 中/英 | 高精度 CTC モデル |

実際にブラウザ上で動作するデモを公開しています。以下のリンクからお試しいただけます：

https://huggingface.co/spaces/jiangzhuo9357/sherpa-onnx-asr-demos

## アーキテクチャ概要

全体の構成は以下の通りです：

```
┌─────────────────────────────────────────────────┐
│                  メインスレッド                    │
│                                                   │
│  AudioRecorder ──→ AsrEngine ──→ 認識結果コールバック │
│       ↑                ↓                          │
│   マイク入力      Web Worker へ音声データ転送        │
│                  (Transferable で zero-copy)       │
└─────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────┐
│              Classic Web Worker                  │
│                                                   │
│  importScripts() で WASM ランタイムをロード          │
│                                                   │
│  音声入力 → ダウンサンプリング(16kHz)                │
│         → CircularBuffer                          │
│         → VAD（音声区間検出）                       │
│         → OfflineRecognizer（音声認識）             │
│         → 認識結果をメインスレッドへ返送              │
└─────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────┐
│              IndexedDB                            │
│                                                   │
│  モデルファイル（.data, .onnx 等）を永続化           │
│  一度ダウンロードすれば次回以降は即座にロード          │
└─────────────────────────────────────────────────┘
```

## なぜ Classic Worker なのか？

最初は ES Modules Worker（`type: 'module'`）を使おうとしました。しかし、sherpa-onnx の WASM ビルドは **Emscripten で生成されたグルーコード** であり、`importScripts()` を使ってランタイムをロードする前提で作られています。

```javascript
// ES Module Worker では importScripts() が使えない！
// → Classic Worker を使う必要がある

// asr.worker.js（Classic Worker）
importScripts(
  runtimeBaseUrl + '/sherpa-onnx-wasm-main-vad-asr.js',  // Emscripten グルーコード
  runtimeBaseUrl + '/sherpa-onnx-vad.js',                 // VAD API
  runtimeBaseUrl + '/sherpa-onnx-asr.js'                  // ASR API
);
```

`importScripts()` 実行後、以下のグローバル変数が利用可能になります：

- `Module` — Emscripten ランタイム
- `CircularBuffer`, `Vad`, `createVad` — VAD 関連
- `OfflineRecognizer`, `OfflineStream` — ASR 関連

:::message
**ポイント**: `initOfflineRecognizer` や `fileExists` などのヘルパー関数は自動提供されません。sherpa-onnx のデモコード（`app-vad-asr.js`）を参考に、Worker 内で自前実装する必要があります。
:::

## Worker の初期化フロー

### 1. モデルファイルの受け渡し

モデルファイル（数十MB〜数百MB）は IndexedDB に保存されています。メインスレッドから Worker へは **Blob URL** 経由で渡します：

```javascript
// メインスレッド（AsrEngine.ts）
const fileUrls = await manager.getModelBlobUrls(modelId);
// { 'sherpa-onnx-wasm-main-vad-asr.data': 'blob:http://...', ... }

this.worker.postMessage({
  type: 'init',
  fileUrls,
  runtimeBaseUrl,
  asrEngine: model.asrEngine,  // 'sensevoice', 'moonshine-v2' など
  language,
});
```

### 2. Emscripten Module の設定

`importScripts()` を呼ぶ**前に** `Module` オブジェクトを設定します。これが Emscripten のファイル解決メカニズムをフックするポイントです：

```javascript
// asr.worker.js
Module = {};

// WASM や .data ファイルの場所を Emscripten に教える
Module.locateFile = (path, scriptDirectory) => {
  // IndexedDB から取得した Blob URL があればそれを使う
  if (fileUrls[path]) {
    return fileUrls[path];
  }
  // なければバンドル済みランタイムから取得
  return runtimeBaseUrl + '/' + path;
};

// WASM ランタイムの初期化完了コールバック
Module.onRuntimeInitialized = () => {
  // ここで VAD と Recognizer を生成
  vad = createVad(Module);
  recognizer = new OfflineRecognizer(recognizerConfig, Module);

  postMessage({
    type: 'ready',
    loadTimeMs: performance.now() - startTime,
  });
};

// この後に importScripts() を呼ぶ
importScripts(/* ... */);
```

### 3. モデルエンジンごとの設定分岐

sherpa-onnx は多くのモデルアーキテクチャをサポートしているため、エンジンタイプごとに設定を切り替えます：

```javascript
function buildRecognizerConfig(engine) {
  switch (engine) {
    case 'sensevoice':
      return {
        senseVoice: {
          model: './sense-voice.onnx',
          useInverseTextNormalization: 1,
        }
      };

    case 'moonshine-v2':
      return {
        moonshine: {
          preprocessor: './preprocess.ort',
          encoder: './encode.int8.ort',
          uncachedDecoder: './uncached_decode.int8.ort',
          cachedDecoder: './cached_decode.int8.ort',
        }
      };

    case 'whisper':
      return {
        whisper: {
          encoder: './tiny-encoder.onnx',
          decoder: './tiny-decoder.onnx',
        }
      };

    case 'transducer':
      return {
        transducer: {
          encoder: './encoder-epoch-99-avg-1.onnx',
          decoder: './decoder-epoch-99-avg-1.onnx',
          joiner: './joiner-epoch-99-avg-1.onnx',
        }
      };

    // ... 10種類以上のエンジンタイプに対応
  }
}
```

## 音声処理パイプライン

### ダウンサンプリング

ブラウザの `MediaRecorder` や `AudioWorklet` から取得される音声は通常 24kHz や 48kHz ですが、sherpa-onnx は **16kHz の Float32Array** を要求します：

```javascript
function downsampleInt16ToFloat32(input, inputSampleRate, outputSampleRate) {
  const ratio = inputSampleRate / outputSampleRate;
  const outputLength = Math.floor(input.length / ratio);
  const output = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const srcIndex = Math.floor(i * ratio);
    // Int16 [-32768, 32767] → Float32 [-1.0, 1.0]
    output[i] = input[srcIndex] / 32768.0;
  }

  return output;
}
```

### VAD（Voice Activity Detection）

音声区間検出は、認識精度と効率の両方に大きく影響します。sherpa-onnx の VAD は **CircularBuffer + Silero VAD** で構成されています：

```javascript
// 30秒分のリングバッファ（16kHz × 30秒 = 480,000サンプル）
const bufferSizeInSeconds = 30;

// VAD に音声を投入
const windowSize = vad.config.sileroVad.windowSize;  // 512サンプル（32ms）

while (buffer.size() >= windowSize) {
  const samples = buffer.get(buffer.head(), windowSize);
  buffer.pop(windowSize);
  vad.acceptWaveform(samples);

  // 発話が検出されたか確認
  if (vad.isDetected() && !speechStarted) {
    speechStarted = true;
    postMessage({ type: 'speechStart' });
  }
}

// 発話区間が完了したら認識を実行
while (!vad.isEmpty()) {
  const segment = vad.front();
  // segment.samples に発話区間の音声が入っている
  recognizeSegment(segment.samples);
  vad.pop();
}
```

### オフライン認識

VAD が発話区間を検出したら、`OfflineRecognizer` で認識を実行します：

```javascript
function recognizeSegment(samples) {
  const stream = recognizer.createStream();
  stream.acceptWaveform(16000, samples);
  recognizer.decode(stream);

  let text = recognizer.getResult(stream);
  stream.free();  // メモリリーク防止

  // CJK 文字間の不要なスペースを除去
  text = text.replace(
    /([\u3000-\u9fff\uF900-\uFAFF])\s+(?=[\u3000-\u9fff\uF900-\uFAFF])/g,
    '$1'
  );

  if (text.trim()) {
    postMessage({
      type: 'result',
      text: text.trim(),
      // タイミング情報も含む
    });
  }
}
```

:::message alert
**メモリ管理の注意点**: `stream.free()` を呼び忘れると WASM ヒープ上にメモリリークが発生します。必ず認識完了後に解放してください。
:::

## メインスレッドとの連携

### AsrEngine クラス

Worker を Promise ベースの API でラップします：

```typescript
// src/lib/local-inference/engine/AsrEngine.ts

class AsrEngine {
  private worker: Worker;

  // コールバック
  onResult?: (result: { text: string; timing?: object }) => void;
  onSpeechStart?: () => void;
  onSpeechEnd?: () => void;

  async init(modelId: string): Promise<{ loadTimeMs: number }> {
    // 1. モデルのメタデータを取得
    const model = getManifestEntry(modelId);

    // 2. IndexedDB からモデルファイルの Blob URL を生成
    const manager = ModelManager.getInstance();
    const fileUrls = await manager.getModelBlobUrls(modelId);

    // 3. Worker を起動して初期化
    this.worker = new Worker('./workers/asr.worker.js');

    return new Promise((resolve, reject) => {
      this.worker.onmessage = (e) => {
        switch (e.data.type) {
          case 'ready':
            // Blob URL を解放（Worker 側でコピー済み）
            manager.revokeBlobUrls(fileUrls);
            resolve({ loadTimeMs: e.data.loadTimeMs });
            break;
          case 'result':
            this.onResult?.(e.data);
            break;
          case 'speechStart':
            this.onSpeechStart?.();
            break;
        }
      };

      this.worker.postMessage({
        type: 'init',
        fileUrls,
        runtimeBaseUrl: ASR_BUNDLED_RUNTIME_PATH,
        asrEngine: model.asrEngine,
      });
    });
  }

  feedAudio(samples: Int16Array, sampleRate: number) {
    // Transferable で zero-copy 転送
    this.worker.postMessage(
      { type: 'audio', samples, sampleRate },
      [samples.buffer]
    );
  }

  flush() {
    // Push-to-Talk 解放時に未処理の音声を強制認識
    this.worker.postMessage({ type: 'flush' });
  }
}
```

### Zero-Copy 音声転送

音声データの転送には **Transferable Objects** を使用します。これにより、メインスレッドから Worker への音声バッファのコピーが不要になります：

```typescript
// Transferable: 所有権をWorkerに移譲（コピーなし）
this.worker.postMessage(
  { type: 'audio', samples, sampleRate },
  [samples.buffer]  // ← この ArrayBuffer の所有権が Worker に移る
);
// この後、メインスレッドで samples にアクセスするとエラーになる
```

通常の `postMessage` では数MB/秒の音声データを毎回コピーしますが、Transferable を使えばオーバーヘッドはほぼゼロです。

## モデル管理システム

### IndexedDB によるモデルキャッシュ

モデルファイルは数十〜数百MBあるため、毎回ダウンロードするのは現実的ではありません。IndexedDB にキャッシュすることで、2回目以降は即座にロードできます：

```typescript
// DB スキーマ
// Database: 'sokuji-models'
// ├─ Store 'files':    key = '{modelId}/{filename}' → Blob
// └─ Store 'metadata': key = modelId → ModelMetadata

interface ModelMetadata {
  modelId: string;
  status: 'not_downloaded' | 'downloading' | 'downloaded' | 'error';
  downloadedAt: number | null;
  totalSizeBytes: number;
  variant?: string;  // 選択されたバリアント（量子化タイプなど）
}
```

### ダウンロードバリデーション

CDN からのダウンロード時に、ファイルの整合性を4段階で検証します：

```typescript
async function validateDownloadedFile(blob: Blob, file: ModelFileEntry) {
  const header = new Uint8Array(await blob.slice(0, 4).arrayBuffer());

  // 1. HTML チェック — CDN が 404 ページを返していないか
  if (header[0] === 0x3C) {  // '<' = HTML の開始
    throw new Error('HTML を受信しました（404エラーの可能性）');
  }

  // 2. サイズチェック — マニフェストの期待値と ±20% 以内か
  if (Math.abs(blob.size - file.sizeBytes) / file.sizeBytes > 0.2) {
    throw new Error('ファイルサイズが期待値と一致しません');
  }

  // 3. WASM マジックナンバー — .wasm ファイルの場合
  // 0x00 0x61 0x73 0x6D = "\0asm"
  // 0x00 0x61 0x73 0x6D = "\0asm"
  if (ext === 'wasm' && header[0] !== 0x00 || header[1] !== 0x61) {
    throw new Error('無効な WASM ファイルです');
  }

  // 4. JSON パース — 設定ファイルが壊れていないか
  if (ext === 'json') {
    JSON.parse(await blob.text());
  }
}
```

### レジューム対応

ダウンロードが途中で中断された場合、次回は未取得のファイルのみを再取得します：

```typescript
for (const file of variant.files) {
  // すでに保存済みならスキップ
  if (await storage.hasFile(modelId, file.filename)) {
    continue;
  }
  // 未取得のファイルのみダウンロード
  await downloadAndStore(file);
}
```

## モデルマニフェスト

すべてのモデルのメタデータを一元管理する**マニフェスト**を定義しています：

```typescript
// modelManifest.ts
const MODEL_MANIFEST: ModelManifestEntry[] = [
  {
    id: 'sensevoice-int8',
    type: 'asr',
    name: 'SenseVoice INT8',
    languages: ['zh', 'en', 'ja', 'ko', 'yue'],
    cdnPath: 'wasm-sense-voice-zh-en-ja-ko-yue-int8',
    variants: {
      default: {
        dtype: 'default',
        files: [
          { filename: 'sherpa-onnx-wasm-main-vad-asr.data', sizeBytes: 238_338_948 },
          { filename: 'package-metadata.json', sizeBytes: 355 },
        ]
      }
    },
    asrEngine: 'sensevoice',
  },
  {
    id: 'moonshine-tiny-en-quant',
    type: 'asr',
    name: 'Moonshine Tiny EN (quantized)',
    languages: ['en'],
    cdnPath: 'wasm-moonshine-tiny-en-quant',
    variants: {
      default: {
        dtype: 'default',
        files: asrFiles(44_900_404, 355),
      }
    },
    asrEngine: 'moonshine-v2',
  },
  // ... 20以上のモデル定義
];
```

ホスティングは HuggingFace Datasets を使用しています：

```
https://huggingface.co/datasets/jiangzhuo9357/sherpa-onnx-asr-models/resolve/main/
  └── wasm-sense-voice-zh-en-ja-ko-yue-int8/
      ├── sherpa-onnx-wasm-main-vad-asr.data   (238MB)
      └── package-metadata.json
```

## パフォーマンス特性

### ロード時間

| モデル               | サイズ | ロード時間   |
|-------------------|--------|---------|
| Moonshine Tiny EN | 45MB | ~1000ms |
| SenseVoice INT8   | 238MB | ~2500ms |
| Omnilingual 300M  | 366MB | ~1650ms |

### 認識レイテンシ（ローカル実行）

モデルによって認識速度は大きく異なります。以下は 3.85秒の音声クリップに対する実測値です：

| モデル | 認識時間 | RTF |
|--------|---------|-----|
| Moonshine Tiny EN | 222ms | 0.058 |
| SenseVoice INT8 | 431ms | 0.112 |
| Omnilingual 300M | 2,079ms | 0.541 |

RTF（Real-Time Factor）は処理時間と音声長の比率で、1.0 未満であればリアルタイムより高速に処理できていることを意味します。Moonshine Tiny は RTF 0.058 と、音声の約17倍の速度で認識を完了しています。

上記は代表的なモデルの結果です。Sokuji では Whisper、Paraformer、NeMo、Zipformer など **20以上のオフラインASRモデル**に対応しています。他のモデルのパフォーマンスは、[ASR デモページ](https://huggingface.co/spaces/jiangzhuo9357/sherpa-onnx-asr-demos)や [Sokuji](https://github.com/kizuna-ai-lab/sokuji) でお手元のブラウザで実際にお試しいただけます。

- ネットワーク遅延なし、プライバシーも完全に保護

### メモリ使用量

- WASM ヒープ: モデルサイズに依存（45MB〜400MB程度）
- CircularBuffer: 約960KB（16kHz × 30秒）
- Blob URL: Worker ロード後に解放

## ハマりポイントと学び

### 1. `importScripts()` の制約

ES Modules Worker では `importScripts()` が使えないため、Emscripten 生成コードとの互換性がありません。sherpa-onnx が ES Modules ビルドを提供するまで、Classic Worker を使う必要があります。

### 2. `Module.locateFile` のタイミング

`Module` オブジェクトの設定は `importScripts()` **の前に** 行う必要があります。後から設定しても、Emscripten はすでにデフォルトのパス解決を使ってしまいます。

### 3. CJK テキストのスペース問題

一部のモデル（特に Moonshine）は、日本語や中国語のテキストを認識する際に文字間に不要なスペースを挿入します。正規表現で後処理する必要があります：

```javascript
// CJK 文字間のスペースを除去
text = text.replace(
  /([\u3000-\u9fff\uF900-\uFAFF])\s+(?=[\u3000-\u9fff\uF900-\uFAFF])/g,
  '$1'
);
```

### 4. Blob URL のメモリリーク

IndexedDB から読み出した Blob URL を Worker に渡した後、メインスレッドで `URL.revokeObjectURL()` を呼ばないとメモリリークします。Worker 側で Emscripten がファイルをヒープにコピーした後、速やかに解放します。

### 5. VAD のフラッシュ

Push-to-Talk モードでは、ボタンを離した瞬間に VAD に未処理の音声が残っている可能性があります。`flush` メッセージを送って強制的に認識させる必要があります。

## まとめ

ブラウザ上で完全ローカルの音声認識を実現するために、以下の技術を組み合わせました：

- **sherpa-onnx WASM**: Emscripten でコンパイルされた高性能音声認識エンジン
- **Classic Web Worker**: `importScripts()` による WASM ランタイムのロード
- **VAD + OfflineRecognizer**: 音声区間検出と非同期認識のパイプライン
- **IndexedDB**: 大容量モデルファイルのブラウザ内キャッシュ
- **Transferable Objects**: メインスレッド↔Worker 間の zero-copy 音声転送
- **Blob URL**: IndexedDB → Worker へのファイル受け渡し

クラウドAPIに依存しない音声認識は、**プライバシー保護**、**オフライン対応**、**低レイテンシ** の3つの面で大きなメリットがあります。

次回は、認識されたテキストをブラウザ内でリアルタイム翻訳する仕組み（Opus-MT・Qwen・TranslateGemma + Transformers.js）について解説します。

---

## Sokuji を試してみる

**Sokuji** は、本記事で解説した技術を搭載したリアルタイム AI 翻訳アプリです。Chrome 拡張機能として無料で公開しており、Google Meet や Zoom などのビデオ会議で、相手の発言をリアルタイムで翻訳・読み上げできます。

ローカル推論モードを使えば、API キー不要・完全オフラインで動作します。ぜひお試しください：

- 🌐 [Chrome Web Store からインストール](https://chromewebstore.google.com/detail/sokuji/eiodakodalhadpjkmndhfcjpjbafokga)
- 💻 [GitHub（ソースコード・Star 歓迎）](https://github.com/kizuna-ai-lab/sokuji)
- 📖 [日本語README](https://github.com/kizuna-ai-lab/sokuji/blob/main/docs/README.ja.md)

---

*この記事は3回シリーズの第1回です。次回：「ブラウザ内で機械翻訳モデルを動かす ― Opus-MT・Qwen・TranslateGemma による完全オフライン翻訳」*
