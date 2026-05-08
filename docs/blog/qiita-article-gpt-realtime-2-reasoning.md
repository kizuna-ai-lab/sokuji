---
title: 'OpenAI gpt-realtime-2 の reasoning.effort を 5 段階全部試した：xhigh の存在に気づいたか？'
tags:
  - OpenAI
  - RealtimeAPI
  - 翻訳
  - ベンチマーク
  - TypeScript
private: false
updated_at: ''
id: null
organization_url_name: null
slide: false
ignorePublish: false
---

## はじめに

OpenAI の Realtime API ファミリの中で、**`gpt-realtime-2` だけが受け付ける**パラメータがあります。`reasoning.effort` です。

通常の chat completions では既に存在していた概念ですが、Realtime API にも降りてきました。しかも段階は 5 つ：`minimal` / `low` / `medium` / `high` / **`xhigh`**。最後の `xhigh` は OpenAI のドキュメント上もあまり目立たず、API リファレンスを読み込まないと気づきにくい存在です。

本記事は、リアルタイム AI 翻訳アプリ **[Sokuji](https://github.com/kizuna-ai-lab/sokuji)** で `gpt-realtime-2` を組み込んだ際にわかった `reasoning.effort` の実装上の注意点と、**Scale AI Labs の AudioMultiChallenge ベンチマーク**に出ている定量データから、各段階の実用的な使い分け方をまとめます。

シリーズの第 2 回：

1. [gpt-realtime-translate 実装で踏んだ 4 つの罠](./qiita-article-gpt-realtime-translate.md)
2. **gpt-realtime-2 の reasoning.effort を 5 段階全部試した** ← 今回
3. 翻訳用途：gpt-realtime-translate vs gpt-realtime-2 完全比較ガイド

## reasoning.effort とは

会話モデルの思考量を制御するパラメータです。値が大きいほど、応答前にモデルが「考える」量が増え、品質は上がりますがレイテンシとコストも増えます。

Realtime API では `session.update` の `session.reasoning.effort` として渡します：

```ts
{
  type: 'session.update',
  session: {
    type: 'realtime',
    output_modalities: ['audio'],
    instructions: '...',
    reasoning: { effort: 'low' },  // ← ここ
    // ...
  }
}
```

5 段階：

| 段階 | 想定用途 | レイテンシ感 |
|------|---------|------------|
| `minimal` | 反射的応答が要る場合（ゲーム、通訳の即時性最優先） | 最速 |
| `low` | バランス型。Sokuji の default | 速い |
| `medium` | 丁寧訳、整った敬語 | 中程度 |
| `high` | 専門用語、論理一貫性が要る場面 | やや遅 |
| `xhigh` | 最高品質。リサーチ、契約書級の通訳 | 遅い |

## 罠 ①：他の realtime モデルに渡すと弾かれる

最初のハマりポイントがこれ。`reasoning.effort` を **`gpt-realtime-mini` や `gpt-realtime-1.5` に渡すと、サーバー側でセッションが reject されます**。

公式ドキュメントには「`gpt-realtime-2` のみ対応」と書いてはあるものの、エラーメッセージが直截ではないので、最初に踏むと「なぜ session.update が通らないのか」と遠回りすることになります。

実装は **モデル名で gate する**のが安全：

```ts
// ❌ NG: 全モデル一律で送ると mini/1.5 が落ちる
session.reasoning = { effort: config.reasoningEffort };

// ✅ OK: gpt-realtime-2 のみ適用
if (config.model?.startsWith('gpt-realtime-2') && config.reasoningEffort) {
  session.reasoning = { effort: config.reasoningEffort };
}
```

`startsWith` にしているのは、将来 `gpt-realtime-2-pro` のようなバリエーションが来ても自動的に拾うため。

なお **`gpt-realtime-2` は現時点で WebRTC transport には対応していません**（OpenAI 側のサーバ制限）。WebSocket transport では問題なく動作するので、reasoning.effort を使いたい場合は WebSocket 経由で接続する必要があります。Sokuji の実装でも、上記 gate は WebSocket クライアント（`OpenAIGAClient.ts`）が事実上の対象になっています（WebRTC クライアントにも同じ gate コードが入っていますが、現状 -2 では到達しません）。

## 罠 ②：GA API の session 構造は Beta から大幅に変わっている

`gpt-realtime-2` は GA API のみで利用可能で、Beta 時代の Realtime API とは session 構造が結構違います。reasoning.effort と一緒に session.update を組むときに、**GA-only の他の差分も同時に意識しておかないと弾かれます**。

主な差分：

| 項目 | Beta | GA |
|------|------|----|
| 出力モダリティ | `modalities: ['text', 'audio']`（両方可） | `output_modalities: ['text']` か `['audio']`（**単独のみ**） |
| 最大トークン | `max_response_output_tokens` | `max_output_tokens` |
| 音声フォーマット | `input_audio_format` / `output_audio_format`（フラット） | `audio.input.format` / `audio.output.format`（**ネスト**） |
| temperature | あり | **削除** |
| voice | session.update でいつでも変更可 | **接続時に固定**、output 開始後は変更不可 |
| turn_detection | フラット | `audio.input.turn_detection` にネスト |
| transcription | フラット | `audio.input.transcription` にネスト |
| noise_reduction | なし or 別 | `audio.input.noise_reduction` |

特に注意すべきは：

- **`output_modalities` の単独制約**：両方一度に欲しい（テキスト履歴を残しながら音声出力）と思っても、GA では片方だけ。テキスト＋音声欲しいなら、テキスト用と音声用で別 session を張るか、転写モデル（`audio.input.transcription`）を使うかの 2 択
- **`voice` の接続時固定**：途中で voice を切り替えるロジックを書くと no-op になる。エラーは出ないので気づきにくい
- **`temperature` の不在**：Beta で慣れてると最初に消えてて困る。GA では `reasoning.effort` でコントロールする発想に変わっている

Sokuji ではこの全差分を `OpenAIGAClient.ts` の `sendSessionUpdate` で吸収しています。

## 5 段階の実力差：Scale AI Labs の AudioMultiChallenge データ

ここからが本題。「`reasoning.effort` を上げると本当に効くのか？」「`xhigh` は実用範囲なのか？」という問いに、**Scale AI Labs の [AudioMultiChallenge leaderboard](https://labs.scale.com/leaderboard/audiomc)** が良いデータを出しています。

AudioMultiChallenge は「会話的知能（conversational intelligence）」を測る独立ベンチマークで、

- 多ターン対話の整合性
- 指示追従
- コンテキスト統合
- 自然発話のロバスト性

を Average Pass Rate（APR、すべてのルーブリックを満たした問題の割合）で評価します（評価モデルは `o4-mini`、人間とのκ ≈ 0.87）。

主要モデルのスコア（高い順）：

| 順位 | モデル | APR |
|------|--------|------|
| 1 | gemini-3-pro-preview (Thinking) | **54.65 ± 4.57** |
| **2** | **gpt-realtime-2 (xHigh)** | **48.45 ± 4.59** |
| 3 | gemini-2.5-pro (Thinking) | 46.90 ± 4.58 |
| 4 | gemini-2.5-flash (Thinking) | 40.04 ± 4.50 |
| **5** | **gpt-realtime-2（reasoning なし）** | **37.61 ± 4.45** |
| 6 | gemini-3.1-flash-live-preview (Thinking) | 36.06 ± 4.41 |
| 7 | gpt-realtime-1.5 | 34.73 ± 4.38 |

ここから読み取れる事実：

### 事実 1：xHigh は実装する価値がある（+10.84 ポイント）

`gpt-realtime-2 (xHigh)` の **48.45** vs `gpt-realtime-2 (reasoning なし)` の **37.61**。差は **+10.84 ポイント**で、両者の信頼区間（±4.59 / ±4.45）を**完全に超える有意差**です。

つまり「xhigh は誤差の範囲」では決してなく、会話的タスクでは明確に効きます。

### 事実 2：xHigh は OpenAI 系モデルを Gemini Pro 級に押し上げる

xHigh あり：**48.45**、Gemini 2.5 Pro (Thinking)：**46.90**、Gemini 3 Pro (Thinking)：**54.65**。

reasoning なしの素の `gpt-realtime-2` は Gemini 2.5 Flash よりやや低い順位ですが、xHigh を入れると Gemini 2.5 Pro を超え、Gemini 3 Pro に肉薄します。

### 事実 3：reasoning なしの -2 は -1.5 とほぼ同列

`gpt-realtime-2`（reasoning なし）：37.61、`gpt-realtime-1.5`：34.73。差は誤差範囲ぎりぎり。

つまり **「-2 を使う価値は reasoning.effort を上げてはじめて出る」**。reasoning なしで -2 を選ぶ理由はあまりない、という解釈もできます（コストが高いだけ）。

### gpt-realtime-translate がいない理由

ちなみに leaderboard には `gpt-realtime-translate` が**いません**。これは仕様で、AudioMC は会話エージェントとしての汎用知能を測るベンチマークなので、翻訳タスクに振り切った特化モデルは比較対象外です。

「翻訳目的なら -2 + xHigh と translate のどちらがいいか」の比較は、第 3 回の比較ガイドで扱います。

## 翻訳タスクでの使い分け（実用ガイド）

AudioMC は会話的知能のベンチマークなので翻訳特化ではありませんが、Sokuji を 1 ヶ月運用した実感も合わせると、翻訳でも以下のような使い分けが妥当です：

| `effort` | 適した翻訳シーン | コメント |
|----------|----------------|---------|
| `minimal` | リアルタイム配信通訳、ゲーム実況 | 訳が雑になるが追従性最優先 |
| `low`（Sokuji default） | Zoom / Meet / Teams での会議翻訳 | レイテンシ・品質・コストのスイートスポット |
| `medium` | 丁寧訳が要る商談、面接通訳 | 敬語の選択が安定する |
| `high` | 技術プレゼン、論文の口頭通訳 | 専門用語の整合性が上がる |
| `xhigh` | 契約交渉、医療通訳など最高品質要 | レイテンシ大、即時性犠牲、コストも高い |

ポイントは **「`xhigh` は遅いが品質代償がはっきり見えるので使い所がある」**ということ。Sokuji でも UI から 5 段階すべて選べるようにしてあります。

```ts
// OpenAIProviderConfig.ts
private static readonly REASONING_EFFORTS: ReasoningEffort[] = [
  'minimal', 'low', 'medium', 'high', 'xhigh',
];

defaults: {
  reasoningEffort: 'low',  // Sokuji default
  // ...
}
```

## 罠 ③：tool_choice: 'none' で翻訳役からのドリフトを止める

これは `reasoning.effort` とは直接関係ないけど、**翻訳タスクで `gpt-realtime-2` を使う時に必須の小ネタ**として書いておきます。

`gpt-realtime-2` は元々マルチモーダル汎用エージェントとして設計されており、`reasoning.effort` を上げると「役立とうとする欲求」も強くなる傾向があります。具体的には：

- 翻訳役を頼んだのに途中で「このフレーズは○○という意味です」と解説を始める
- 「翻訳してください」と instructions に書いても、ユーザー発話を質問と解釈して回答してしまう
- function call/tool 呼び出しを試みる（高 effort で顕著）

これを防ぐには **tools を空配列 + tool_choice = 'none'** で完全にロックします：

```ts
const session: any = {
  type: 'realtime',
  output_modalities: ['audio'],
  instructions: '...あなたは翻訳者です。説明やコメントは一切しないでください...',
  // 翻訳役からのドリフト防止
  tool_choice: 'none',
  tools: []
};

if (config.model?.startsWith('gpt-realtime-2') && config.reasoningEffort) {
  session.reasoning = { effort: config.reasoningEffort };
}
```

`tools: []` だけだと OpenAI 側がデフォルトの tool 呼び出し挙動を持ち込んでくることがあるので、**`tool_choice: 'none'` を明示的に併用**するのが鍵です。

## おわりに

`reasoning.effort` 5 段階を整理すると：

1. **`minimal` / `low`** → 即時性重視。Sokuji default は `low`
2. **`medium` / `high`** → 丁寧訳・専門用語に効く
3. **`xhigh`** → AudioMC で +10.84 ポイント、Gemini 2.5 Pro を上回るレベル。実用価値あり

実装上の注意点：

- ✅ `model?.startsWith('gpt-realtime-2')` で必ず gate する（mini / 1.5 だと reject）
- ✅ GA API の session 構造（output_modalities 単独、voice 固定、temperature 削除など）も同時に意識
- ✅ 翻訳役で使うときは `tool_choice: 'none'` + `tools: []` でロック

Sokuji（OSS）では UI から 5 段階すべてを切り替えられるので、自分のユースケースで体感したい方はぜひ：

- GitHub: https://github.com/kizuna-ai-lab/sokuji
- Web サイト: https://sokuji.kizuna.ai

実装の詳細は [`OpenAIGAClient.ts`](https://github.com/kizuna-ai-lab/sokuji/blob/main/src/services/clients/OpenAIGAClient.ts) を参照してください（`gpt-realtime-2` は WebSocket transport で接続）。

### 次回予告

ここまで `gpt-realtime-2` の `reasoning.effort` を見てきました。一方、前回扱った `gpt-realtime-translate` は reasoning.effort を持たず、API 設計そのものが翻訳特化です。

第 3 回では **「翻訳目的なら結局どちらを使うべきか」**を、レイテンシ / 言語サポート / コスト / カスタマイズ性 / Sokuji での実運用知見から、ユースケース別の選び方マトリクスとして整理します。

---

## 参考

- [Scale AI Labs — AudioMultiChallenge Leaderboard](https://labs.scale.com/leaderboard/audiomc)
- [OpenAI Realtime API documentation](https://platform.openai.com/docs/guides/realtime)
- [Sokuji on GitHub](https://github.com/kizuna-ai-lab/sokuji)
