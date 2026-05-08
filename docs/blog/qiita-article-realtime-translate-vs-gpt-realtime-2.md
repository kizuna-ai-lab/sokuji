---
title: '翻訳用途：OpenAI gpt-realtime-translate vs gpt-realtime-2 完全比較ガイド'
tags:
  - OpenAI
  - RealtimeAPI
  - 翻訳
  - 比較
  - TypeScript
private: false
updated_at: ''
id: null
organization_url_name: null
slide: false
ignorePublish: false
---

## はじめに

OpenAI が提供する Realtime API ファミリの中で、**Speech-to-Speech 翻訳に使えるのは 2 系統**あります：

1. **`gpt-realtime-translate`** — 翻訳に特化した専用モデル
2. **`gpt-realtime-2`**（+ `reasoning.effort`） — 汎用 Realtime モデルを翻訳役にプロンプトする方式

リアルタイム AI 翻訳アプリ **[Sokuji](https://github.com/kizuna-ai-lab/sokuji)** ではこの両方を実装し、ユーザーが UI から切り替えられるようにしています。本記事は、1 ヶ月以上両方を本番で使い分けてわかった**「結局どちらを使うべきか」**の判断材料を、ユースケース別マトリクスとして整理します。

シリーズの第 3 回（最終回）：

1. [gpt-realtime-translate 実装で踏んだ 4 つの罠](./qiita-article-gpt-realtime-translate.md)
2. [gpt-realtime-2 の reasoning.effort を 5 段階全部試した](./qiita-article-gpt-realtime-2-reasoning.md)
3. **翻訳用途：gpt-realtime-translate vs gpt-realtime-2 完全比較ガイド** ← 今回

## 全体比較マトリクス

| 項目 | `gpt-realtime-translate` | `gpt-realtime-2` |
|------|--------------------------|-------------------|
| 設計思想 | **翻訳専用、極小 API** | **汎用エージェント、prompt で翻訳役化** |
| WebSocket | `/v1/realtime/translations` ✅ | `/v1/realtime` ✅ |
| WebRTC | `/v1/realtime/translations/calls` ✅ | **❌ 現時点で非対応**（mini / -1.5 のみ対応） |
| GA / Beta | **GA only** | GA / Beta |
| 入力言語 | 75 言語（auto-detect） | prompt 次第（任意） |
| 出力言語 | **13 言語固定** | prompt 次第（任意、精度は学習量依存） |
| `instructions` | ❌ | ✅ |
| `tools` / `tool_choice` | ❌ | ✅ |
| `voice` 選択 | ❌（自動） | ✅ alloy / verse など |
| `turn_detection` カスタマイズ | ❌（内蔵） | ✅ server_vad / semantic_vad |
| `reasoning.effort` | ❌ | ✅ minimal / low / medium / high / xhigh |
| 転写モデル | `gpt-realtime-whisper` 固定 | gpt-4o-transcribe など選択可 |
| ノイズ抑制 | near_field / far_field | near_field / far_field |
| 接続〜初音声 | 約 600–900 ms（WS）/ 800–1200 ms（WebRTC）※実測値で要差し替え | 約 600–900 ms（**WS のみ**、WebRTC 非対応） |
| ハートビート処理 | **必要**（200ms 4800-sample frame） | 不要 |
| 価格レンジ（公式） | OpenAI [pricing](https://openai.com/api/pricing/) 参照 | 同左、reasoning.effort で実コスト変動 |

## API 設計思想の違い

両者は単に「機能数の多寡」ではなく、**設計思想がそもそも違う API** です。

### `gpt-realtime-translate` ＝ 翻訳専門ピペライン

`session.update` で送れるのは output 言語と入力転写モデル、ノイズ抑制くらい。`instructions` も `tools` も `voice` も無い：

```ts
{
  type: 'session.update',
  session: {
    audio: {
      output: { language: 'ja' },                              // 13 のいずれか
      input: {
        transcription: { model: 'gpt-realtime-whisper' },
        noise_reduction: { type: 'near_field' },
      }
    }
  }
}
```

「Sokuji 用の翻訳口調を作りたい」「ですます調を強制したい」「専門用語を辞書化したい」**といった調整はそもそも API として受け付けない**。

代わりに翻訳の精度・レイテンシは内部で最適化済みで、開発側がチューニングしなくてもそこそこの品質が出る、という設計。

### `gpt-realtime-2` ＝ 汎用 Realtime エージェント

汎用エージェントなので翻訳役にするには `instructions` で「あなたは翻訳者です。原文を○○語に訳してください。説明はしないでください」のように書きます。

その代わり、**触れるところは多い**：

- `instructions` で口調・敬語レベル・専門ドメインの指示
- `voice` でアシスタントの声を変える
- `turn_detection` で発話区切りの感度調整（threshold / prefix_padding / silence_duration）
- `reasoning.effort` で思考量チューニング（minimal → xhigh）
- `temperature` ならぬ `reasoning.effort` で間接的にランダム性制御

**「シンプルに動かしたいなら translate、細かく制御したいなら -2」** が一行サマリ。

## 言語サポート比較

ここが**最大の判断ポイント**。

### translate：75 in / 13 out 固定

入力 75 言語（auto-detect）、出力 13 言語：

```
en, es, pt, fr, ja, ru, zh, de, ko, hi, id, vi, it
```

- 言語コードは **粗い ISO 639-1 のみ**（zh_CN や pt_BR は不可）
- 出力 13 にない言語へ訳したい場合（例：日本語 → タイ語、日本語 → アラビア語）は**そもそもできない**
- 双方向トリビアルに通訳できるのは 13 言語間のみ

### gpt-realtime-2：prompt 次第で任意

`instructions` に「タイ語に訳してください」と書けば原則動きます。ただし：

- 学習量の少ない言語は精度が下がる
- 出力音声の音質も言語依存（メジャー言語ほど自然）
- 訳出言語のスペル / 正書法の安定性は translate のほうが安心

**判断ルール**：

> 出力先が 13 言語に含まれる → translate を選ぶのが普通
> 出力先が 13 言語にない → gpt-realtime-2 一択

Sokuji もこの基準で UI を出し分けています（translate 選択時は出力 dropdown が 13 言語）。

## レイテンシ・スループット

`reasoning.effort` を上げない `gpt-realtime-2` と、`gpt-realtime-translate` の素のレイテンシは**ほぼ拮抗**します（Sokuji 内での体感）。差が顕著に出るのは：

- `gpt-realtime-2` で `reasoning.effort` を `medium` 以上に上げた時 → 数百 ms から秒単位で遅くなる
- `gpt-realtime-translate` のハートビート構造（200ms 単位の規則的な keep-alive）→ ジッタが安定し、UI 上の「翻訳中…」表示が安定する

会議・配信のように **「テンポ命」のシナリオでは translate のジッタの安定性が効く**、というのが Sokuji を運用しての実感です。

## 翻訳品質

ここは公開された第三者ベンチマークが少なく、評価が難しいゾーンです。前回記事で参照した [Scale AI Labs の AudioMultiChallenge](https://labs.scale.com/leaderboard/audiomc) は会話的知能の指標で、翻訳精度そのものではないですが、参考にはなります：

- `gpt-realtime-2 (xHigh)`：48.45（Gemini 2.5 Pro 超え）
- `gpt-realtime-2`（reasoning なし）：37.61
- `gpt-realtime-translate`：leaderboard には不在

translate が leaderboard にいないのは、評価軸が「会話エージェントとしての汎用知能」だから。翻訳特化モデルを汎用知能で測るのはフェアでない、という運営側の判断とみられます。

実運用での主観的観察（Sokuji ユーザーフィードバック含む）：

| 観点 | translate | gpt-realtime-2（low） | gpt-realtime-2（xhigh） |
|------|-----------|----------------------|-----------------------|
| 直訳の正確さ | ◎ 安定 | ○ | ◎ |
| 敬語・口調 | △ 一律 | ○ 指示で変えられる | ◎ 指示が効く |
| 専門用語 | ○ | △ | ◎ |
| 自然な意訳 | ○ | △ | ◎ |
| 訳抜け / 補完 | △ 訳抜けあり | ○ | ○ |
| ハルシネーション | ◎ ほぼなし | △ instructions で抑制必要 | △ 高 effort で増えがち |

「直訳の正確さ」だけ見ると translate が安定、「丁寧さ・口調制御」では -2 + 高 effort が勝ち、というのが大まかな図式です。

## コスト

OpenAI の [Pricing](https://openai.com/api/pricing/) を参照ください。一般論として：

- **`gpt-realtime-translate`** は単価が安い傾向（翻訳特化なので推論量が少なく済む）
- **`gpt-realtime-2`** は単価が高い + `reasoning.effort` を上げると tokens 消費が増えて**実質コストがさらに上がる**

長時間の会議翻訳（1 時間以上）を継続的に運用する場合、コスト差は無視できません。Sokuji ではユーザーが「自分の API キー」で使う前提なので、UI に reasoning.effort のラベルを置きつつ「上げると遅くなる + 高くなる」と注意書きを出しています。

## カスタマイズ性

| 触りたいもの | translate | gpt-realtime-2 |
|----------|-----------|-----------------|
| 翻訳口調（敬語 / カジュアル） | ❌ | ✅ instructions |
| 専門用語辞書 | ❌ | ✅ instructions に列挙 |
| 出力声優の選択 | ❌ | ✅ voice |
| 発話区切りの厳しさ | ❌ | ✅ turn_detection |
| 思考時間の調整 | ❌ | ✅ reasoning.effort |
| 速度・音程 | ❌ | ❌ |

「触れる範囲」だけ見ると -2 が圧勝。ただし**触る量が増えると安定運用のチューニングコストも増える**ので、ここはトレードオフ。

## ユースケース別おすすめマトリクス

ここまでの整理を踏まえた選び方ガイド：

| シーン | 推奨 | 理由 |
|--------|------|------|
| Zoom / Meet / Teams の社内会議翻訳 | **translate** | テンポ重視、出力は主要 13 言語で足りる、運用が楽 |
| 配信通訳（Vtuber、ライブイベント） | **translate** | 即時性最優先、ジッタが安定 |
| 多言語イベント（13 言語に含まれる） | **translate** | 言語追加コスト 0 |
| 出力先が日中英以外のマイナー言語 | **gpt-realtime-2** | translate に対応がない |
| 商談・面接（敬語が重要） | **gpt-realtime-2 + medium** | 口調を instructions で制御 |
| 技術プレゼン / 学会 | **gpt-realtime-2 + high or xhigh** | 専門用語の整合性が要る |
| 契約交渉 / 法律 / 医療 | **gpt-realtime-2 + xhigh** | 最高品質要、レイテンシ犠牲 OK |
| 字幕付き動画の事前生成（バッチ） | **gpt-realtime-2 + xhigh** | リアルタイム性不要、品質最優先 |
| 個人の即時通訳（雑談、海外旅行） | **translate** | コスト・テンポ・運用シンプル |
| ゲーム配信のチャット返信通訳 | **translate** または **-2 minimal** | 即時性最優先 |

**ざっくりした原則**：
1. 出力 13 言語で足りる + 即時性優先 → **translate**
2. 出力言語のカバレッジが足りない or 制御したい → **gpt-realtime-2**
3. 品質最優先（レイテンシ・コスト犠牲 OK）→ **gpt-realtime-2 + xhigh**

## Sokuji での使い分け実装

Sokuji ではユーザーが UI 上で provider を切り替えられるよう、両者を `IClient` インタフェース配下で抽象化しています：

```
src/services/clients/
├── OpenAIGAClient.ts                # gpt-realtime-mini / -1.5 / -2 (WebSocket)
├── OpenAIWebRTCClient.ts            # gpt-realtime-mini / -1.5 (WebRTC)  ※-2 は WebRTC 非対応
├── OpenAITranslateGAClient.ts       # gpt-realtime-translate (WebSocket)
└── OpenAITranslateWebRTCClient.ts   # gpt-realtime-translate (WebRTC)
```

UI から見た時の差は `ProviderConfig.capabilities` の flag で吸収します：

```ts
// OpenAIProviderConfig.ts (gpt-realtime-2)
capabilities: {
  hasReasoningEffort: true,
  hasTurnDetection: true,
  hasVoiceSettings: true,
  // ...
}

// OpenAITranslateProviderConfig.ts (gpt-realtime-translate)
capabilities: {
  hasReasoningEffort: false,
  hasTurnDetection: false,
  hasVoiceSettings: false,
  hasSilenceDuration: true,  // translate 専用：UI 側で発話セグメンテーションの閾値だけ調整
  // ...
}
```

Settings UI 側はこの capability を見て、reasoning.effort スライダや voice ドロップダウンを出し分けています。**「同じ会話履歴 UI で両モデルを使い回せる」**のがユーザー体験上のキモです。

## おわりに

ここまで見てきた通り、両者は「優劣」ではなく **「設計思想が違う API」** で、ユースケース次第で正解が変わります。

迷ったら最初は **`gpt-realtime-translate`** から試すのが無難です。理由：

1. 設定が極小（言語と転写モデルだけ）で踏むハマりが少ない
2. 安定したジッタで会議・配信に強い
3. コストが低めで気軽に長時間運用できる

それで物足りなくなったら（出力言語が足りない / 口調を変えたい / 専門用語が崩れる）、`gpt-realtime-2` に切り替えて `reasoning.effort` を `low` → `medium` → `high` と段階的に上げていく、というルートが Sokuji ユーザーの実際の遷移パターンに近いです。

**両方を 1 click で切り替えながら使い分けたい方へ**：Sokuji は OSS で、本記事の比較構成をそのまま実装しています。Chrome 拡張 / Electron どちらでも動作します：

- GitHub: https://github.com/kizuna-ai-lab/sokuji
- Web サイト: https://sokuji.kizuna.ai

---

## 参考

- 第 1 回：[gpt-realtime-translate 実装で踏んだ 4 つの罠](./qiita-article-gpt-realtime-translate.md)
- 第 2 回：[gpt-realtime-2 の reasoning.effort を 5 段階全部試した](./qiita-article-gpt-realtime-2-reasoning.md)
- [Scale AI Labs — AudioMultiChallenge Leaderboard](https://labs.scale.com/leaderboard/audiomc)
- [OpenAI Realtime API documentation](https://platform.openai.com/docs/guides/realtime)
- [OpenAI Pricing](https://openai.com/api/pricing/)
- [Sokuji on GitHub](https://github.com/kizuna-ai-lab/sokuji)
