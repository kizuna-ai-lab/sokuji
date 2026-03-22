---
title: "ブラウザ内で機械翻訳モデルを動かす ― Opus-MT・Qwen・TranslateGemma で完全オフライン翻訳"
emoji: "🌐"
type: "tech"
topics: ["WebAssembly", "機械翻訳", "TransformersJs", "WebGPU", "ONNX"]
published: false
---

## はじめに

このシリーズでは、リアルタイム AI 翻訳アプリ **[Sokuji](https://github.com/kizuna-ai-lab/sokuji)** の開発を通じて、ブラウザ上で完全オフラインの音声→音声（Speech-to-Speech）翻訳パイプラインを構築しています。

[前回の記事](https://zenn.dev/shinonome_tk/articles/7b27eac0eb7ab6)では、sherpa-onnx WASM を使ってブラウザ上で完全ローカルの音声認識（ASR）を実現しました。今回は、認識されたテキストを**ブラウザ内でリアルタイム翻訳する仕組み**を解説します。クラウドAPIを一切使わずに、Transformers.js と ONNX モデルを組み合わせて、ブラウザだけで機械翻訳を動かします。

本記事はシリーズの第2回です：

1. [ASR（音声認識）](https://zenn.dev/shinonome_tk/articles/7b27eac0eb7ab6)
2. **翻訳（Opus-MT / Qwen / TranslateGemma + Transformers.js）** ← 今回
3. TTS（音声合成）

## なぜブラウザ内で翻訳するのか

クラウド翻訳API（Google Translate, DeepL など）は高品質ですが、以下の課題があります：

- **レイテンシ**: ネットワーク往復が発生する（特にリアルタイム翻訳で致命的）
- **コスト**: API呼び出しごとに課金される
- **プライバシー**: 翻訳内容がサーバーに送信される

ローカル翻訳なら、これらすべてを解決できます。

## 翻訳モデルの選択肢

ブラウザで動かせる翻訳モデルは、大きく分けて2種類あります：

### 1. 言語ペア特化モデル（Opus-MT）

[Opus-MT](https://github.com/Helsinki-NLP/Opus-MT) は、Helsinki-NLP が公開している軽量な翻訳モデル群です。日→英、英→中など、**特定の言語ペアに特化**しています。

| 特徴 | 値 |
|------|-----|
| サイズ | 約110MB / ペア |
| デバイス | WASM（CPU） |
| 品質 | 特化ペアでは高品質 |
| レイテンシ | 高速（小モデル） |
| 対応ペア | 48ペア |

### 2. 多言語モデル（LLMベース）

汎用 LLM を翻訳タスクに使う方式です。言語ペアを問わず翻訳できます。

| モデル | サイズ | 対応言語数 | デバイス |
|--------|--------|-----------|---------|
| Qwen 2.5 0.5B | 786MB | 28言語 | WebGPU |
| Qwen 3 0.6B | 569-919MB | 119+言語 | WebGPU |
| Qwen 3.5 0.8B | 646-717MB | 201+言語 | WebGPU |
| TranslateGemma 4B | 3.1GB | 51言語 | WebGPU |

:::message
**使い分けの基準**: 言語ペア特化モデルが存在する場合はそちらを優先します（高速・高品質）。存在しない言語ペア（例: 日→韓）は多言語モデルにフォールバックします。
:::

## アーキテクチャ概要

```
┌──────────────────────────────────────────────────────┐
│                   メインスレッド                       │
│                                                       │
│  TranslationEngine                                    │
│    ├─ init(sourceLang, targetLang, modelId?)          │
│    │    → ModelManager から Blob URL を取得             │
│    │    → Worker を起動                               │
│    │    → Promise<{ loadTimeMs, device }>             │
│    │                                                   │
│    └─ translate(text)                                 │
│         → Worker に推論リクエスト                       │
│         → Promise<TranslationResult>                  │
└──────────────────────┬───────────────────────────────┘
                       │ postMessage
                       ▼
┌──────────────────────────────────────────────────────┐
│              Worker（モデルタイプ別に4種類）             │
│                                                       │
│  ┌─────────────┐ ┌─────────────┐ ┌────────────────┐  │
│  │  Opus-MT    │ │   Qwen      │ │ TranslateGemma │  │
│  │  (WASM)     │ │  (WebGPU)   │ │   (WebGPU)     │  │
│  │ seq2seq翻訳 │ │ text-gen翻訳│ │ 専用翻訳モデル  │  │
│  └─────────────┘ └─────────────┘ └────────────────┘  │
│                                                       │
│  共通: Transformers.js + customCache(IndexedDB)       │
└──────────────────────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────┐
│              IndexedDB (sokuji-models)                │
│                                                       │
│  files:    '{modelId}/{filename}' → Blob              │
│  metadata: modelId → { status, variant, ... }         │
└──────────────────────────────────────────────────────┘
```

## Transformers.js とは

[Transformers.js](https://huggingface.co/docs/transformers.js) は、HuggingFace の Transformers ライブラリの JavaScript 実装です。ONNX Runtime をバックエンドとして、ブラウザ内で各種 AI モデルを実行できます。

通常、Transformers.js はモデルを HuggingFace Hub から直接ダウンロードして Cache API に保存します。しかし、私たちのアプリでは**モデルを IndexedDB で管理**しているため、カスタムキャッシュを介してモデルをロードする仕組みが必要でした。

## 核心技術：customCache ブリッジ

ここが今回の記事で最も重要な部分です。

### 問題

Transformers.js の `pipeline()` は内部的に HuggingFace Hub の URL を使ってモデルファイルを取得しようとします：

```
https://huggingface.co/Xenova/opus-mt-ja-en/resolve/main/onnx/encoder_model_quantized.onnx
```

しかし、私たちはオフライン動作のために：
1. ネットワークアクセスをブロックしたい（`allowRemoteModels = false`）
2. モデルファイルは IndexedDB にすでにダウンロード済み

### 解決策：Blob URL キャッシュブリッジ

Transformers.js の `customCache` インターフェースを実装して、HuggingFace URL を IndexedDB の Blob URL にマッピングします：

```typescript
function createBlobUrlCache(fileUrls: Record<string, string>) {
  return {
    async match(request: string | Request | undefined): Promise<Response | undefined> {
      const url = typeof request === 'string' ? request : request?.url;
      if (!url) return undefined;

      // HuggingFace URL からファイル名を抽出
      // 例: "https://huggingface.co/Xenova/opus-mt-ja-en/resolve/main/onnx/encoder.onnx"
      //   → "onnx/encoder.onnx"
      const resolveMainMarker = '/resolve/main/';
      const idx = url.indexOf(resolveMainMarker);
      if (idx === -1) return undefined;

      const filename = url.slice(idx + resolveMainMarker.length);
      const blobUrl = fileUrls[filename];
      if (!blobUrl) return undefined;

      // Blob URL を fetch して Response オブジェクトとして返す
      return fetch(blobUrl);
    },

    // キャッシュ書き込みは不要（IndexedDB で管理済み）
    async put(_request: Request, _response: Response): Promise<void> {
      // no-op
    },
  };
}
```

### env 設定

Worker の初期化時に、Transformers.js の環境設定を完全オフラインモードに切り替えます：

```typescript
import { env } from '@huggingface/transformers';

// ネットワークアクセスを完全にブロック
env.allowRemoteModels = false;

// ブラウザの Cache API は使わない（IndexedDB で管理）
env.useBrowserCache = false;

// カスタムキャッシュを有効化
env.useCustomCache = true;
env.customCache = createBlobUrlCache(fileUrls);

// ローカルモデルの読み込みを許可
env.allowLocalModels = true;
```

この設定により、Transformers.js がモデルファイルを要求するたびに：

1. `customCache.match(hfUrl)` が呼ばれる
2. URL からファイル名を抽出
3. 対応する Blob URL を `fetch()` して `Response` を返す
4. Transformers.js はネットワークからダウンロードしたと思い込む

**ネットワーク通信は一切発生しません。**

## Worker 実装の詳細

### Opus-MT Worker（WASM）

最もシンプルな実装です。Transformers.js の `pipeline('translation')` をそのまま使います：

```typescript
// translation.worker.ts（ES Module Worker）
import { pipeline, env } from '@huggingface/transformers';

let translator: any = null;

self.onmessage = async (e) => {
  const msg = e.data;

  switch (msg.type) {
    case 'init': {
      // カスタムキャッシュを設定
      env.allowRemoteModels = false;
      env.useBrowserCache = false;
      env.useCustomCache = true;
      env.customCache = createBlobUrlCache(msg.fileUrls);

      const startTime = performance.now();

      // translation パイプラインを作成
      translator = await pipeline('translation', msg.hfModelId, {
        dtype: 'q8',
        device: 'wasm',  // CPU（WASM）で実行
      });

      self.postMessage({
        type: 'ready',
        loadTimeMs: performance.now() - startTime,
        device: 'wasm',
      });
      break;
    }

    case 'translate': {
      const result = await translator(msg.text, {
        max_length: 512,
      });

      self.postMessage({
        type: 'result',
        requestId: msg.requestId,
        translatedText: result[0].translation_text,
      });
      break;
    }
  }
};
```

:::message
**なぜ Opus-MT は WASM で動かすのか？**

Opus-MT は約110MBの小さな seq2seq モデルです。WebGPU を使うと、シェーダーコンパイル・GPU バッファ確保・CPU↔GPU 転送のオーバーヘッドが発生し、小さなモデルでは WASM のほうが 2-3倍高速です。WebGPU は 800MB 以上の大きなモデルで並列処理の恩恵が出てきます。
:::

### Qwen Worker（WebGPU）

LLM を翻訳タスクに使う場合、`text-generation` パイプラインに翻訳用のシステムプロンプトを与えます：

```typescript
// qwen-translation.worker.ts
import { pipeline, env } from '@huggingface/transformers';

let generator: any = null;

// 言語コード → 言語名のマッピング
const LANG_NAMES: Record<string, string> = {
  ja: 'Japanese', zh: 'Chinese', en: 'English',
  ko: 'Korean', de: 'German', fr: 'French',
  // ... 20以上の言語
};

async function handleInit(msg: any) {
  env.allowRemoteModels = false;
  env.useBrowserCache = false;
  env.useCustomCache = true;
  env.customCache = createBlobUrlCache(msg.fileUrls);

  generator = await pipeline('text-generation', msg.hfModelId, {
    dtype: msg.dtype || 'q4',
    device: 'webgpu',
  });
}

async function handleTranslate(msg: any) {
  const srcName = LANG_NAMES[msg.sourceLang] || msg.sourceLang;
  const tgtName = LANG_NAMES[msg.targetLang] || msg.targetLang;

  // Qwen3 の場合、/no_think で推論モードを無効化
  const isQwen3 = currentModelId.toLowerCase().includes('qwen3');
  const noThink = isQwen3 ? ' /no_think' : '';

  // ASR 出力に特化したプロンプト
  const systemPrompt =
    `Translate ${srcName} → ${tgtName}. Input is ASR speech.${noThink}\n` +
    `Drop fillers (um, uh, えーと, あのー, 那个). ` +
    `Fix stuttering and repetitions.\n` +
    `Output ONLY the ${tgtName} translation. Nothing else.`;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: msg.text },
  ];

  const result = await generator(messages, {
    max_new_tokens: 256,
    do_sample: false,       // 決定論的な出力
    temperature: 0.0,
    tokenizer_encode_kwargs: { enable_thinking: false },
  });

  // <think> ブロックを除去（Qwen3 の推論トークン対策）
  let translatedText = result[0].generated_text.at(-1).content;
  translatedText = translatedText
    .replace(/<think>[\s\S]*?(<\/think>|$)/g, '')
    .trim();

  self.postMessage({
    type: 'result',
    requestId: msg.requestId,
    translatedText,
  });
}
```

### ASR 出力に特化したプロンプト設計

翻訳の入力は人間が書いたテキストではなく、**ASR（音声認識）の出力**です。そのため、以下の特殊な処理が必要です：

1. **フィラー除去**: 「えーと」「あのー」「um」「uh」などの間投詞
2. **言い直し修正**: 吃音や繰り返しの修正
3. **翻訳のみ出力**: 説明や注釈を付けない

これをシステムプロンプトに明示的に指示することで、ASR → 翻訳のパイプラインの品質を大きく向上させています。

### TranslateGemma Worker

Google が開発した**翻訳専用モデル**で、独自のメッセージフォーマットを使います：

```typescript
// translategemma-translation.worker.ts

async function handleTranslate(msg: any) {
  // TranslateGemma は言語コードを直接指定する構造化フォーマット
  const messages = [{
    role: 'user',
    content: [{
      type: 'text',
      source_lang_code: msg.sourceLang,  // 例: 'ja'
      target_lang_code: msg.targetLang,  // 例: 'en'
      text: msg.text,
    }],
  }];

  const output = await generator(messages, {
    max_new_tokens: 1024,
  });

  self.postMessage({
    type: 'result',
    requestId: msg.requestId,
    translatedText: output[0].generated_text.at(-1).content,
  });
}
```

チャットテンプレートの内部で、モデルが自動的に適切な翻訳プロンプトを構築してくれます。

## メインスレッド：TranslationEngine

Worker を Promise ベースの API でラップする `TranslationEngine` クラスです：

```typescript
class TranslationEngine {
  private worker: Worker | null = null;
  private pendingRequests = new Map<string, {
    resolve: (result: TranslationResult) => void;
    reject: (error: Error) => void;
  }>();

  async init(
    sourceLang: string,
    targetLang: string,
    modelId?: string,
  ): Promise<{ loadTimeMs: number; device: string }> {
    // 1. 最適なモデルを選択
    const model = modelId
      ? getManifestEntry(modelId)
      : getTranslationModel(sourceLang, targetLang);

    // 2. IndexedDB から Blob URL を取得
    const manager = ModelManager.getInstance();
    const fileUrls = await manager.getModelBlobUrls(model.id);

    // 3. モデルタイプに応じた Worker を起動
    switch (model.translationWorkerType) {
      case 'qwen':
        this.worker = new Worker(
          new URL('../workers/qwen-translation.worker.ts', import.meta.url),
          { type: 'module' }
        );
        break;
      case 'qwen35':
        this.worker = new Worker(
          new URL('../workers/qwen3.5-translation.worker.ts', import.meta.url),
          { type: 'module' }
        );
        break;
      case 'translategemma':
        this.worker = new Worker(
          new URL('../workers/translategemma-translation.worker.ts', import.meta.url),
          { type: 'module' }
        );
        break;
      default: // opus-mt
        this.worker = new Worker(
          new URL('../workers/translation.worker.ts', import.meta.url),
          { type: 'module' }
        );
    }

    // 4. Worker の初期化完了を待つ
    return new Promise((resolve, reject) => {
      this.worker.onmessage = (e) => {
        if (e.data.type === 'ready') {
          manager.revokeBlobUrls(fileUrls);
          resolve({
            loadTimeMs: e.data.loadTimeMs,
            device: e.data.device,
          });
        }
      };

      this.worker.postMessage({
        type: 'init',
        fileUrls,
        hfModelId: model.hfModelId,
        dtype: variantInfo.dtype,
        sourceLang,
        targetLang,
      });
    });
  }

  async translate(text: string): Promise<TranslationResult> {
    const requestId = crypto.randomUUID();

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(requestId, { resolve, reject });
      this.worker!.postMessage({
        type: 'translate',
        requestId,
        text,
      });
    });
  }
}
```

:::message
**ポイント**: 翻訳 Worker はすべて **ES Module Worker**（`type: 'module'`）です。前回の ASR Worker が `importScripts()` の制約で Classic Worker だったのとは対照的です。Transformers.js は ES Module として `import` できるため、モダンな Worker を使えます。
:::

## モデル選択ロジック

ユーザーが言語ペアを選択すると、最適なモデルが自動選択されます：

```typescript
function getTranslationModel(
  sourceLang: string,
  targetLang: string,
): ModelManifestEntry | undefined {
  // 1. 言語ペア特化モデルを優先（高品質・高速）
  const pairModel = MODEL_MANIFEST.find(
    m => m.type === 'translation'
      && m.sourceLang === sourceLang
      && m.targetLang === targetLang
  );
  if (pairModel) return pairModel;

  // 2. 多言語モデルにフォールバック
  return MODEL_MANIFEST.find(
    m => m.type === 'translation'
      && m.multilingual
      && (isUniversalMultilingual(m)
        || (m.languages.includes(sourceLang)
          && m.languages.includes(targetLang)))
  );
}
```

**選択の優先順位:**
1. `ja → en` → `opus-mt-ja-en`（ペア特化、110MB、WASM）
2. `ja → ko`（ペア特化モデルなし）→ `qwen2.5-0.5b-translation`（多言語、786MB、WebGPU）
3. WebGPU 非対応デバイス → ペア特化モデルのみ使用可能

## GPU バリアント選択

WebGPU デバイスの機能に応じて、最適な量子化バリアントを自動選択します：

```typescript
function selectVariant(
  entry: ModelManifestEntry,
  deviceFeatures: string[],
): string {
  // 互換性のあるバリアントをフィルタ
  const compatible = Object.entries(entry.variants).filter(([_, v]) =>
    !v.requiredFeatures
    || v.requiredFeatures.every(f => deviceFeatures.includes(f))
  );

  // 機能が多いほど最適化されている → 優先
  compatible.sort((a, b) =>
    (b[1].requiredFeatures?.length ?? 0)
    - (a[1].requiredFeatures?.length ?? 0)
  );

  return compatible[0][0];
}
```

例えば Qwen 3 の場合：
- `shader-f16` 対応 GPU → `q4f16`（569MB、高速）
- 非対応 GPU → `q4`（919MB、汎用）

## IndexedDB から Worker へのファイル受け渡し

前回の ASR 記事で紹介した仕組みと同じですが、翻訳モデルではファイル数が多いため、より多くのマッピングが必要です：

```typescript
// Opus-MT の場合、6ファイルの Blob URL マップ
{
  'config.json':                           'blob:http://localhost:5173/abc...',
  'generation_config.json':                'blob:http://localhost:5173/def...',
  'tokenizer.json':                        'blob:http://localhost:5173/ghi...',
  'tokenizer_config.json':                 'blob:http://localhost:5173/jkl...',
  'onnx/encoder_model_quantized.onnx':     'blob:http://localhost:5173/mno...',
  'onnx/decoder_model_merged_quantized.onnx': 'blob:http://localhost:5173/pqr...',
}
```

Worker 内の `customCache.match()` が HuggingFace URL からファイル名を抽出し、対応する Blob URL を返します。Transformers.js は通常通りモデルをロードでき、**ネットワーク通信は一切発生しません**。

## パフォーマンス特性

### モデルロード時間

| モデル | サイズ | ロード時間   |
|--------|--------|---------|
| Opus-MT | ~110MB | ~1500ms |
| Qwen 2.5 0.5B | 786MB | ~4100ms |
| Qwen 3 0.6B (q4f16) | 569MB | ~3800ms |
| TranslateGemma 4B | 3.1GB | ~4700ms |

### 翻訳レイテンシ（モデルロード後）

| モデル | 短文（19文字） | 中文（76文字） |
|--------|----------|----------|
| Opus-MT (WASM) | ~500ms    | ~1400ms   |
| Qwen 2.5 (WebGPU) | ~800ms    | ~2000ms   |
| Qwen 3 (WebGPU) | ~340ms    | ~1000ms   |
| TranslateGemma (WebGPU) | ~700ms    | ~1400ms   |

:::message
上記は Linux 上の Chrome での実測値です。Linux の WebGPU サポートは Windows や macOS に比べて成熟度が低いため、他の OS ではより高いパフォーマンスが期待できます。実際のパフォーマンスはデバイスの GPU 性能やモデルの量子化タイプにも大きく依存します。
:::

## ハマりポイントと学び

### 1. customCache の match() シグネチャ

Transformers.js の `customCache.match()` は `Request` オブジェクトまたは文字列 URL のどちらも受け取る可能性があります。両方のケースを正しくハンドリングする必要があります：

```typescript
async match(request: string | Request | undefined) {
  // string と Request の両方に対応
  const url = typeof request === 'string' ? request : request?.url;
  if (!url) return undefined;
  // ...
}
```

### 2. Blob URL の MIME タイプ

IndexedDB から取得した Blob をそのまま `URL.createObjectURL()` に渡すと、MIME タイプが正しく設定されないことがあります。特に `.wasm` ファイルは `application/wasm` を明示的に指定する必要があります：

```typescript
// MIME タイプを明示的に設定
const typedBlob = new Blob([originalBlob], {
  type: 'application/wasm'
});
const blobUrl = URL.createObjectURL(typedBlob);
```

### 3. Qwen3 の `<think>` トークン

Qwen3 には推論モード（thinking mode）があり、翻訳結果に `<think>...</think>` ブロックが含まれることがあります。`/no_think` プロンプトと正規表現による後処理の両方が必要です：

```typescript
// プロンプトで抑制
const noThink = isQwen3 ? ' /no_think' : '';

// 出力から除去（念のため）
text = text.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').trim();
```

### 4. WebGPU の q4f16 バリアントの互換性

`q4f16`（半精度浮動小数点）は一部のプラットフォームで問題を引き起こします。例えば TranslateGemma の `q4f16` は Windows の WebGPU で出力が壊れるため、無効化しています：

```typescript
variants: {
  'q4': { dtype: 'q4', files: translateGemmaQ4Files() },
  // q4f16 は Windows WebGPU で不正な出力を生成するため無効化
}
```

### 5. ES Module Worker と Classic Worker の使い分け

| | ES Module Worker | Classic Worker |
|---|---|---|
| 使用場面 | Transformers.js（翻訳） | sherpa-onnx WASM（ASR/TTS） |
| モジュール | `import` 文が使える | `importScripts()` のみ |
| 理由 | Transformers.js は ESM | Emscripten が `importScripts()` 前提 |
| Worker 作成 | `new Worker(url, { type: 'module' })` | `new Worker(url)` |

同じアプリ内で両方のパターンを使い分ける必要があるのは、ライブラリの制約によるものです。

## リアルタイム翻訳パイプラインでの位置づけ

翻訳エンジンは ASR と TTS の間に位置し、認識されたテキストをリアルタイムで翻訳します：

```
マイク入力 (Int16 @ 24kHz)
    ↓
AsrEngine（前回の記事）
    ↓ 認識テキスト
TranslationEngine（今回の記事）
    ↓ 翻訳テキスト
TtsEngine（次回の記事）
    ↓ 合成音声
スピーカー出力
```

ASR が発話を認識するたびに `translate()` が呼ばれ、結果は即座に UI に表示されます。ローカル実行のためネットワーク遅延がなく、リアルタイムの会話翻訳に十分な速度です。

## まとめ

ブラウザ内で完全ローカルの機械翻訳を実現するために、以下の技術を組み合わせました：

- **Transformers.js**: HuggingFace の推論ライブラリの JS 実装
- **customCache ブリッジ**: IndexedDB → Blob URL → Transformers.js への透過的なモデル提供
- **4種類の Worker**: モデルアーキテクチャごとに最適化された推論実装
- **自動モデル選択**: 言語ペア特化モデルを優先、多言語モデルにフォールバック
- **GPU バリアント選択**: デバイス機能に応じた最適な量子化タイプの自動選択

特に **customCache ブリッジ** は、Transformers.js を完全オフラインで使うための鍵となる技術です。HuggingFace Hub への依存を完全に断ち切りつつ、Transformers.js の高レベル API をそのまま活用できます。

次回は、翻訳されたテキストをブラウザ内で音声合成する仕組み（sherpa-onnx TTS / VITS）について解説します。

---

## Sokuji を試してみる

**Sokuji** は、本シリーズで解説している技術を搭載したリアルタイム AI 翻訳アプリです。Chrome 拡張機能として無料で公開しており、Google Meet や Zoom などのビデオ会議で、相手の発言をリアルタイムで翻訳・読み上げできます。

ローカル推論モードを使えば、API キー不要・完全オフラインで動作します。ぜひお試しください：

- 🌐 [Chrome Web Store からインストール](https://chromewebstore.google.com/detail/sokuji/eiodakodalhadpjkmndhfcjpjbafokga)
- 💻 [GitHub（ソースコード・Star 歓迎）](https://github.com/kizuna-ai-lab/sokuji)
- 📖 [日本語README](https://github.com/kizuna-ai-lab/sokuji/blob/main/docs/README.ja.md)

---

*この記事は3回シリーズの第2回です。次回：「ブラウザ内で音声合成を実現する ― sherpa-onnx TTS + VITS」*
