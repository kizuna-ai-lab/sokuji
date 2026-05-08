---
title: OpenAI gpt-realtime-translate で同時通訳ツールを実装した：踏んだ 4 つの罠
tags:
  - OpenAI
  - RealtimeAPI
  - WebSocket
  - 翻訳
  - TypeScript
private: false
updated_at: ''
id: null
organization_url_name: null
slide: false
ignorePublish: false
---

## はじめに

OpenAI が 2026 年に公開した **gpt-realtime-translate** は、Speech-to-Speech 翻訳に特化した Realtime モデルです。通常の `gpt-realtime` 系（`-mini` / `-1.5` / `-2`）と同じ Realtime API ファミリですが、エンドポイントもイベント体系も別物で、**翻訳タスクに振り切った設計**になっています。

本記事では、リアルタイム AI 翻訳アプリ **[Sokuji](https://github.com/kizuna-ai-lab/sokuji)**（v0.25 から対応）に gpt-realtime-translate を組み込む過程で踏んだ実装上の罠を 4 つ、コードと一緒に共有します。

OpenAI の公式 cookbook には載っていない、実装してはじめてわかる挙動を中心にまとめました。

シリーズ予定：

1. **gpt-realtime-translate 実装で踏んだ 4 つの罠** ← 今回
2. gpt-realtime-2 の reasoning.effort を 5 段階全部試す
3. 翻訳用途：gpt-realtime-translate vs gpt-realtime-2 完全比較ガイド

## 通常の Realtime API との違い

まずは全体像。`gpt-realtime-translate` は、見た目こそ Realtime API ファミリですが、通常の `gpt-realtime-mini` などとはかなり違います。

| 項目 | gpt-realtime-translate | gpt-realtime-mini / -1.5 / -2 |
|------|------------------------|-------------------------------|
| WebSocket エンドポイント | `/v1/realtime/translations` | `/v1/realtime` |
| WebRTC SDP エンドポイント | `/v1/realtime/translations/calls` | `/v1/realtime/calls`（**mini / -1.5 のみ。-2 は現時点で WebRTC 非対応**） |
| Ephemeral token エンドポイント | `/v1/realtime/translations/client_secrets` | `/v1/realtime/sessions` |
| GA / Beta | **GA only** | GA / Beta |
| `instructions` | ❌ 受け付けない | ✅ 必須レベル |
| `tools` / `tool_choice` | ❌ | ✅ |
| `turn_detection` のカスタマイズ | ❌（内蔵） | ✅ server_vad / semantic_vad |
| `voice` 選択 | ❌（自動） | ✅ alloy / verse など |
| `reasoning.effort` | ❌ | ✅ `gpt-realtime-2` のみ |
| 言語サポート | 75 src（自動検出） / 13 target | prompt 次第（任意） |
| イベント名前空間 | `session.*_transcript.*`, `session.output_audio.*` | `response.*`, `conversation.item.*` |

要するに **「翻訳のためだけにそぎ落とした API」** で、汎用 Realtime API とはほぼ別物として扱う必要があります。

## 75 / 13 の言語サポート

入力 75 言語に対して出力 13 言語と非対称です。出力対応は次の 13：

```
en, es, pt, fr, ja, ru, zh, de, ko, hi, id, vi, it
```

注意点：

- **言語コードは粗い ISO 639-1 のみ**。`zh_CN` や `pt_BR` は弾かれる。`zh` / `pt` で渡す
- 入力側の言語は **API 内部で auto-detect** される。`session.update` には流さない（実装上、UI 表示用にだけ保持しておく）
- 13 の出力対応はそのまま 75 の入力対応にも含まれているので、**双方向トリビアルに翻訳できるのは 13 言語だけ**

## 罠 ①：WebSocket subprotocol に beta タグを入れると弾かれる

通常の `gpt-realtime-mini` を WebSocket で叩くときの典型的な subprotocol は次のようになります：

```ts
// 通常の Realtime API（mini / 1.5 / 2）
new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-realtime-mini', [
  'realtime',
  'openai-beta.realtime-v1',                // ← ここがポイント
  `openai-insecure-api-key.${apiKey}`,
]);
```

そのまま流用して `gpt-realtime-translate` のエンドポイントに繋ごうとすると、サーバー側で次のように拒否されます：

> `Translation sessions are only available on the GA API.`

メッセージはエラーとして返ってきますが、**最初に見たときは何のことかわからない**。translate モデルは GA only で、`openai-beta.realtime-v1` が含まれているだけで Beta セッションとして判定されてしまうのが原因です。

正解は **beta タグを外すだけ**：

```ts
// gpt-realtime-translate（GA only）
new WebSocket('wss://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate', [
  'realtime',
  `openai-insecure-api-key.${apiKey}`,        // beta タグは入れない
]);
```

ブラウザの WebSocket コンストラクタは `Authorization` ヘッダを設定できないため、認証は OpenAI 公式の subprotocol 形式 `openai-insecure-api-key.${apiKey}` を使います。本番ではこれを使わず、後述の Ephemeral token を使います。

## session.update の最小ペイロード

接続後すぐ送る `session.update` も、translate では極端にシンプルです。`instructions` も `tools` も `voice` もありません：

```ts
{
  type: 'session.update',
  session: {
    audio: {
      output: { language: 'ja' },          // ← 13 言語のいずれか
      input: {
        transcription: { model: 'gpt-realtime-whisper' },
        noise_reduction: { type: 'near_field' },   // 'near_field' | 'far_field'
      }
    }
  }
}
```

注目点：

- **`instructions` を入れる場所がない**。プロンプトで翻訳の口調を変える芸当はできない
- 入力転写モデルは別系統 `gpt-realtime-whisper` を指定する
- ノイズ抑制は `near_field`（近接マイク）/ `far_field`（会議室）の 2 段階のみ

つまり **「会議用 / 字幕用 / 配信用などのコンテキスト調整は session.update では不可能」**。やるなら gpt-realtime-2 + instructions に切り替える必要があります（次回記事のテーマ）。

## サーバーイベント処理

通常の Realtime API は `response.audio.delta` / `conversation.item.created` 系を中心に組み立てますが、translate では完全に別の名前空間です：

```ts
switch (event.type) {
  case 'session.input_transcript.delta':   // ユーザー音声の転写（途中）
  case 'session.input_transcript.done':    // ユーザー音声の転写（完了）

  case 'session.output_transcript.delta':  // 翻訳テキスト（途中）
  case 'session.output_transcript.done':   // 翻訳テキスト（完了）

  case 'session.output_audio.delta':       // 翻訳音声（途中）
  case 'session.output_audio.done':        // 翻訳音声（完了）

  case 'session.created':
  case 'session.updated':
  case 'error':
}
```

`response.*` は来ないので、通常 Realtime 用のイベントハンドラを流用しようとすると一切 fire しません。最初これに気づかず、**接続も session.update も成功しているのに何も起きない**という現象を 1 時間ほど追いかけました。

## 罠 ②：ハートビートフレームを長さだけで判定すると壊れる

`session.output_audio.delta` で受け取る音声フレームは、実は 2 種類混在しています：

| フレーム種別 | サンプル数 (@24 kHz) | 時間 | 中身 |
|------|--------|------|------|
| **ハートビート** | 4800（観測値） | 200 ms（観測値） | ゼロ振幅（utterance 間の keep-alive） |
| **コンテンツ** | 9600（観測値） | 400 ms（観測値） | 実際の翻訳音声（rms 0.04–0.08） |

ハートビートは無音を流して WebSocket を生かしておくためのフレームです。これをそのまま再生キューに突っ込むと、翻訳の頭に無音が乗ってしまうので、**フィルタしないといけない**。

最初に書いてしまったのが「振幅閾値を切ってフレームを捨てる」でした：

```ts
// ❌ NG: しきい値の振幅判定はコンテンツ内の自然な無音を巻き込みやすい
case 'session.output_audio.delta': {
  const audio = base64ToInt16Array(event.delta);
  const rms = Math.sqrt(audio.reduce((s, v) => s + v*v, 0) / audio.length);
  if (rms < THRESHOLD) break;   // しきい値の選び方で content も削れる
  enqueue(audio);
}
```

しきい値方式は、コンテンツフレームに含まれる **発話の自然な無音区間** までフィルタしかねず、音声がブツ切れになります。

次に試したのが **長さでハートビートを識別する** ですが、これも罠でした：

```ts
// ⚠️ 部分的に正解。API がフレーム長を変えた瞬間に壊れる
const HEARTBEAT_SAMPLES = 4800;  // 200ms @ 24kHz
if (audio.length === HEARTBEAT_SAMPLES) break;
```

長さプロトコルは API 側の実装詳細であって、保証された契約ではありません。あとで紹介する「`output_transcript` が来ない問題」と組み合わさると、コンテンツ音声を取りこぼします。

最終的に落ち着いたのは **「ハートビートは純粋にゼロ振幅である」という観測事実を、フレーム単位で確認する** やり方でした：

```ts
// ✅ OK: rms === 0 を early-exit で判定（実装上は「最初の非ゼロサンプル」検出）
function isSilenceFrame(audio: Int16Array): boolean {
  for (let i = 0; i < audio.length; i++) {
    if (audio[i] !== 0) return false;  // コンテンツは即座に false で抜ける
  }
  return true;
}

case 'session.output_audio.delta': {
  if (!event.delta) break;
  const audio = base64ToInt16Array(event.delta);
  if (isSilenceFrame(audio)) break;  // 長さに依存しない

  // ↓ 詳細は次節
  const itemId = currentAssistantItemId ?? ensureAssistantItem();
  enqueue(itemId, audio);
}
```

ポイントは **しきい値ではなく完全ゼロ判定** であること。コンテンツ内の自然な無音区間は、フレーム全体で見ると必ず非ゼロサンプルが混ざるので、early-exit で content フレームは O(1) で抜けます。フレーム長プロトコルが将来変わっても、ゼロ振幅という観測事実が変わらない限り壊れません。

### コンテンツ音声に assistant item を auto-create する

最初の実装では「`output_transcript.delta` が assistant item を開く → そこに音声を attach する」という前提を置いて、

```ts
// ❌ 危険：transcript が来ない場合に音声がまるごと破棄される
if (!this.currentAssistantItemId) break;
```

と書いていました。理屈の上では「prelude（セッション開始直後の静かな立ち上がり）まで会話履歴に紛れ込むのを防ぐ」目的でしたが、実運用で **API が `output_transcript.delta` を送ってこないセッション** に当たって音声が完全に再生されなくなる事故が起きました。

正しい姿勢は **「ハートビートが除去された後に到達するフレームはコンテンツ」と信じて auto-create する** ことです：

```ts
const itemId = this.currentAssistantItemId ?? this.ensureAssistantItem();
```

`isSilenceFrame` で prelude / heartbeat は先に落ちるので、auto-create が空の assistant item を量産することはありません。「transcript が必ず音声より先に来る」というのは観測上のヒューリスティックであって、API の保証ではないことを、ここで痛感しました。

## 罠 ③：user / assistant で独立した silence timer が必要

通常の Realtime API は「ユーザー発話 → モデル応答」の turn が綺麗に交互するので、1 つの timer で会話アイテムを切り出せます。

ところが翻訳では、

- 1 入力に対して **複数の出力 utterance** が出ることがある（長文を区切って訳す）
- 翻訳出力が **入力より遅れて到着する**（lag）
- 入力と出力が **時間的にオーバーラップする**

つまり「user が話し終わった = assistant も終わり」とは限らないので、**1 つの silence timer で pair を管理すると壊れる**。

Sokuji では user 側と assistant 側で完全に独立した state machine と timer を持たせています：

```ts
class OpenAITranslateGAClient {
  private currentUserItemId: string | null = null;
  private currentAssistantItemId: string | null = null;
  private userSilenceTimer: ReturnType<typeof setTimeout> | null = null;
  private assistantSilenceTimer: ReturnType<typeof setTimeout> | null = null;

  // ユーザー側：input transcript が来たらリセット
  case 'session.input_transcript.delta': {
    const userItemId = this.ensureUserItem();
    appendUserTranscript(userItemId, event.delta);
    this.resetUserSilenceTimer();   // ← user 側のみ
    break;
  }

  // アシスタント側：output transcript / audio が来たらリセット
  case 'session.output_transcript.delta':
  case 'session.output_audio.delta': {
    const assistantItemId = this.ensureAssistantItem();
    // ...
    this.resetAssistantSilenceTimer();   // ← assistant 側のみ
    break;
  }

  // それぞれ独立に「N ms 何も来なかったら item を complete」
  private resetUserSilenceTimer() {
    clearTimeout(this.userSilenceTimer!);
    this.userSilenceTimer = setTimeout(() => this.completeUserItem(), this.userSilenceTimeoutMs);
  }
  private resetAssistantSilenceTimer() {
    clearTimeout(this.assistantSilenceTimer!);
    this.assistantSilenceTimer = setTimeout(() => this.completeAssistantItem(), this.assistantSilenceTimeoutMs);
  }
}
```

完了タイミングを user / assistant それぞれ独立に決めることで、

- ユーザーが次の発話を始めた瞬間 → 1 つ前の user item を確定（assistant はまだ翻訳中でも OK）
- 翻訳音声が鳴り終わった瞬間 → assistant item を確定（次の user item は既に始まっていても OK）

という挙動が自然に実現できます。Sokuji ではデフォルト 1500 ms、UI から 100–3000 ms の範囲で調整できるようにしています。

## 罠 ④：WebRTC 版のエンドポイントとレスポンス形状が違う

WebSocket だけでなく WebRTC でも translate を使えます。基本構造は通常の `gpt-realtime` 系の WebRTC 実装とほぼ同じですが、**エンドポイントとレスポンス形状が違う**ので注意。

### Ephemeral token のエンドポイント

```ts
// 通常の Realtime API
POST /v1/realtime/sessions
// レスポンス（nested）: { client_secret: { value: 'ek_...' } }

// Translate
POST /v1/realtime/translations/client_secrets
// レスポンス（flat）: { value: 'ek_...', expires_at: ..., session: {...} }
```

形が違うので、token を取り出すコードはこの両方をハンドルする必要があります。Sokuji では flat 形状を first-try、見つからなければ nested にフォールバックする実装にしています：

```ts
const data = await response.json();
const flatValue = typeof data.value === 'string' ? data.value : undefined;
const nestedValue = typeof data.client_secret === 'string'
  ? data.client_secret
  : data.client_secret?.value;
const secret = flatValue ?? nestedValue;
```

### SDP 交換のエンドポイント

```ts
// 通常: POST /v1/realtime/calls
// Translate: POST /v1/realtime/translations/calls
```

URL 1 文字違いでセッションがそもそも開けないので、この差は最初に踏みやすい罠です。

## パフォーマンスメモ

参考までに Sokuji v0.25 の実測値：

| 指標 | 値 |
|------|------|
| 接続〜初音声まで（WebSocket） | 約 600–900 ms |
| 接続〜初音声まで（WebRTC） | 約 800–1200 ms |
| 翻訳開始までの追加 lag | 200–400 ms |
| ハートビート間隔 | 200 ms 固定 |
| コンテンツフレーム長 | 約 400 ms |

WebRTC のほうが接続コストは高いですが、ストリーミングの jitter は安定する傾向があります。会議用途では WebRTC、CLI などサーバーレス用途では WebSocket、と使い分けています。

## おわりに

ここまで、gpt-realtime-translate の実装で踏んだ 4 つの罠を共有しました：

1. WebSocket subprotocol で `openai-beta.realtime-v1` を入れると弾かれる
2. ハートビートフレームは「振幅」ではなく「長さ」で識別する
3. user / assistant で独立した silence timer が必要
4. WebRTC ではエンドポイントとレスポンス形状が通常 Realtime と違う

これらは公式 cookbook には載っていない挙動で、すべて [Sokuji](https://github.com/kizuna-ai-lab/sokuji) の実装で実際にハマったポイントです。OSS なので、ピンポイントで実装を見たい方は [`OpenAITranslateGAClient.ts`](https://github.com/kizuna-ai-lab/sokuji/blob/main/src/services/clients/OpenAITranslateGAClient.ts) と [`OpenAITranslateWebRTCClient.ts`](https://github.com/kizuna-ai-lab/sokuji/blob/main/src/services/clients/OpenAITranslateWebRTCClient.ts) を直接読んでください。

Sokuji は Chrome 拡張 / Electron どちらでも動きます。**Zoom、Google Meet、Microsoft Teams で同時通訳が必要な方**は試してみてください：

- GitHub: https://github.com/kizuna-ai-lab/sokuji
- Web サイト: https://sokuji.kizuna.ai

### 次回予告

次回は、`gpt-realtime-translate` ではない **通常の `gpt-realtime-2` を翻訳に使う場合**の話です。`gpt-realtime-2` は「`reasoning.effort` を受け付ける唯一の Realtime モデル」で、`minimal` から `xhigh` まで 5 段階のチューニングができます。これを実際に翻訳タスクで全段階測定して、どこが現実的なスイートスポットかを検証します。

第 3 回では `gpt-realtime-translate` と `gpt-realtime-2`、翻訳用途でどちらを使うべきかの完全比較ガイドを書く予定です。
