# Qiita 3 篇シリーズ配套素材集

3 日連続発布（篇 1 = Sat / 篇 2 = Sun / 篇 3 = Mon）に合わせて、各 publish 当日に出す X / YouTube Short / HN 素材をまとめたもの。

---

## 全体ガイドライン

- **X 日本タイムゾーンの最適投稿時刻**：土 8:00–10:00 / 日 10:00–12:00 / 月 7:30–9:00（通勤帯）
- **HN の最適時刻**：投稿日の **米西 7:00 AM（= 日本 23:00 / 24:00）** が経験則の peak。第 1 篇のみ
- **YouTube Short**：各篇 publish と同時 upload、X からも引用埋め込み
- **ハッシュタグ運用**：`#OpenAI` `#リアルタイム翻訳` `#同時通訳` `#Qiita` `#Sokuji` を場面に応じ 2–3 個

---

## X (Twitter) スレッド：篇 1（土 AM 投稿）

### Tweet 1/5（フック + リンク + 動画）

```
OpenAI が出した翻訳専用モデル gpt-realtime-translate を Sokuji（OSS）に組み込んだ。

公式 cookbook に載ってない実装の罠を 4 つ全部書いた👇

[Qiita リンク]

#OpenAI #リアルタイム翻訳 #同時通訳

[30 秒 demo 動画 / Short A]
```

### Tweet 2/5（罠 ①）

```
罠①：WebSocket subprotocol に「openai-beta.realtime-v1」を入れると弾かれる

translate は GA only。エラー文言は

"Translation sessions are only available on the GA API."

→ subprotocol から beta タグだけ抜くのが正解
```

### Tweet 3/5（罠 ②）

```
罠②：200ms / 4800-sample ぶんのゼロ振幅フレームが流れてくる（keep-alive）

「振幅で判定」して捨てると、コンテンツ内の自然な無音まで巻き込んで音声がブツ切れに。

→ 「長さ（4800 サンプル）」で判定が正解
```

### Tweet 4/5（罠 ③）

```
罠③：user / assistant で独立した silence timer が必要

翻訳は
- 1 入力 → 複数出力 utterance
- 出力が入力より遅れて到着
- 入出力がオーバーラップ

1 つの timer で pair 管理すると壊れる。state machine 二重持ちにするのが正解
```

### Tweet 5/5（CTA）

```
4 つの罠 + WebRTC 版の差分 + 接続コード全部 → Qiita で詳細

[Qiita リンク]

実装は全部 OSS（Sokuji v0.25+）：
github.com/kizuna-ai-lab/sokuji

Chrome 拡張 / Electron どちらでも Zoom・Meet・Teams で同時通訳できます。
```

---

## X (Twitter) スレッド：篇 2（日 AM 投稿）

### Tweet 1/4（フック + 数値）

```
OpenAI gpt-realtime-2 の reasoning.effort を 5 段階全部試した。

Scale AI Labs の AudioMC ベンチマークで:
🟢 xHigh: 48.45 → Gemini 2.5 Pro 超え
🔴 reasoning なし: 37.61

差は +10.84pt、信頼区間を完全に超える有意差👇

[Qiita リンク]

[Short B 動画]
```

### Tweet 2/4（5 段階の意味）

```
5 段階の使い分け（実用ガイド）:

minimal → 配信通訳・ゲーム実況（即時性最優先）
low → 会議翻訳のスイートスポット（Sokuji default）
medium → 商談・面接（敬語の選択が安定）
high → 技術プレゼン・論文（専門用語の整合）
xhigh → 契約交渉・医療通訳（最高品質）
```

### Tweet 3/4（罠：モデル gate）

```
実装の罠：reasoning.effort を gpt-realtime-mini や 1.5 に渡すと**サーバー側で reject される**。

mode: config.model?.startsWith('gpt-realtime-2')
で gate 必須。

エラーメッセージは直截じゃないので最初に踏むと迷子になります。
```

### Tweet 4/4（CTA）

```
- GA API の session 構造の他の罠（output_modalities 単独制約、voice 接続時固定など）
- 翻訳役からのドリフト防止（tool_choice: 'none'）

詳細 + Scale AI 比較データ全部 → [Qiita リンク]

5 段階 UI から切替可能 → github.com/kizuna-ai-lab/sokuji
```

---

## X (Twitter) スレッド：篇 3（月 AM 投稿）

### Tweet 1/6（フック + マトリクス画像）

```
1 ヶ月運用してわかった「OpenAI gpt-realtime-translate vs gpt-realtime-2、翻訳でどっち使えばいいか問題」

ユースケース別の選び方マトリクスを公開しました👇

[Qiita リンク]

[Short C 動画 / マトリクス画像]

#OpenAI #リアルタイム翻訳
```

### Tweet 2/6（API 設計思想）

```
両者は「優劣」じゃなく「設計思想が違う」

translate
- 翻訳専用、極小 API、設定 3 つ
- instructions も voice も無い
- 安定・低コスト・即時性

gpt-realtime-2
- 汎用エージェント、prompt で翻訳役化
- instructions / voice / reasoning 全部触れる
- カスタマイズ性 ◎
```

### Tweet 3/6（言語サポート）

```
最大の判断基準は言語サポート

translate: 75 in / 13 out 固定
（en, es, pt, fr, ja, ru, zh, de, ko, hi, id, vi, it）

gpt-realtime-2: prompt 次第で任意（精度は学習量依存）

→ 出力先が 13 言語にあるか無いかで自動的に決まる
```

### Tweet 4/6（ユースケース上半分）

```
こういう用途は translate が良い:

✅ Zoom / Meet / Teams 社内会議
✅ Vtuber / 配信通訳
✅ 多言語ライブイベント（13 言語内）
✅ 海外旅行・雑談
✅ ゲーム配信のチャット返信

→ テンポ・コスト・運用シンプルさが効く
```

### Tweet 5/6（ユースケース下半分）

```
こういう用途は gpt-realtime-2 が良い:

✅ マイナー言語（13 言語に無い）
✅ 商談・面接（medium effort、敬語）
✅ 学会・技術プレゼン（high effort、専門用語）
✅ 契約交渉・医療（xhigh effort、最高品質）
✅ 字幕付き動画の事前生成（バッチ）

→ 触れる範囲が広い分、品質を上げ切れる
```

### Tweet 6/6（CTA）

```
両方を 1 click で切り替えながら使うアプリが欲しい方へ:

Sokuji（OSS）でこの記事の構成をそのまま実装してます。
Chrome 拡張 / Electron どちらでも動作します。

→ github.com/kizuna-ai-lab/sokuji
→ sokuji.kizuna.ai

3 篇シリーズ全話のリンクも記事末尾に。
```

---

## YouTube Short：A（篇 1 同時、土 AM）

**長さ**：30–35 秒
**形式**：縦 9:16、字幕焼き込み（音声 OFF でも見られる）

### 構成（秒数 / 内容）

```
0:00–0:02   フック：黒画面に白テキスト
            「OpenAI が出した翻訳専用モデル」
            「gpt-realtime-translate」

0:02–0:08   Sokuji 画面録画：UI を見せて provider 選択
            上字幕：「Sokuji v0.25 から対応」

0:08–0:18   実演：日本語で「会議の音声を外部 API に流したくない」
            ↓ ほぼ即時に英訳音声が流れる
            「I don't want to send meeting audio to external APIs」
            上字幕：「実測 ~600ms latency」

0:18–0:25   コードちらっと（OpenAITranslateGAClient.ts のスニペット）
            上字幕：「実装の罠 4 つを Qiita で公開」

0:25–0:30   エンドカード
            Sokuji ロゴ
            「Qiita で『gpt-realtime-translate 4 つの罠』検索」
            「github.com/kizuna-ai-lab/sokuji」
```

### 撮影 / 編集メモ

- 撮影：Sokuji を画面録画 + マイク入力
- 編集：CapCut or Davinci Resolve で 9:16 トリム
- 字幕：日本語、白文字 + 黒縁取り、画面下 1/3
- BGM：軽めの instrumental（YouTube Audio Library 内検索）

---

## YouTube Short：B（篇 2 同時、日 AM）

**長さ**：40–45 秒
**形式**：縦 9:16、字幕焼き込み

### 構成

```
0:00–0:02   フック
            「OpenAI gpt-realtime-2 の隠し機能：reasoning.effort」

0:02–0:08   テキストアニメーション
            「5 段階：minimal → low → medium → high → xhigh」
            最後の xhigh だけ赤色強調

0:08–0:32   実演（5 連続、各 5 秒）：同じ日本語入力
            「明日の会議を午後 3 時に変更してもらえますか？」
            
            毎回 effort を変えて翻訳音声を流す
            画面下に effort ラベルと latency を表示
            
            minimal: 短い直訳
            low: 標準的な翻訳
            medium: 丁寧めな表現
            high: フォーマルなビジネス英語
            xhigh: 完璧なビジネス英語 + ニュアンス補完

0:32–0:38   Scale AI Labs ベンチマーク数値表示
            「xHigh: 48.45 / no-reasoning: 37.61」
            「+10.84pt、Gemini 2.5 Pro 超え」

0:38–0:43   エンドカード
            Sokuji ロゴ
            「5 段階全部 UI から選べる」
            「github.com/kizuna-ai-lab/sokuji」
```

### 撮影メモ

- effort 切替実演：Sokuji の Settings から手動で 5 回切り替え、それぞれ録画後に編集で結合
- latency 表示は手動で焼き込み（実測値）
- ベンチマーク表は静止画 1 枚を 6 秒見せる

---

## YouTube Short：C（篇 3 同時、月 AM）

**長さ**：35–40 秒
**形式**：縦 9:16、字幕焼き込み

### 構成

```
0:00–0:02   フック
            「翻訳目的で OpenAI Realtime API どっち選ぶ？」
            分割画面：左 translate / 右 gpt-realtime-2

0:02–0:10   設計思想テキストアニメ
            translate: 「シンプル・即時・13 言語」
            gpt-realtime-2: 「カスタマイズ・任意言語・5 段階制御」

0:10–0:30   ユースケース別マトリクスの早送り表示
            7–8 シーンを各 2 秒
            - Zoom 会議 → translate
            - Vtuber 配信 → translate
            - マイナー言語 → -2
            - 商談 → -2 medium
            - 学会 → -2 high
            - 契約交渉 → -2 xhigh
            - 雑談 → translate

0:30–0:35   結論
            「Sokuji なら両方 1 click で切替」
            UI 切り替え動画（実装で）

0:35–0:40   エンドカード
            Sokuji ロゴ + URL
            「Qiita で『翻訳 比較ガイド』検索」
```

### 撮影メモ

- マトリクスの早送りは After Effects のテキストアニメで作成、1 シーンあたり 2 秒
- UI 切替は実画面録画

---

## Hacker News 投稿：篇 1 用（土 23:00 JST = 米西 7:00 AM 投稿）

過去に Show HN を複数回投稿しているので、今回は **Show HN を外し、技術記事として投稿** する方針。プロダクト launch ではなく「OpenAI の新モデルを実装してハマった点」をシェアするフレーミングにする。

### Title 候補（HN は短いほど良い、~80 文字以内）

| 案 | 文字数 | 性格 |
|---|---|---|
| **A**（推奨） | `OpenAI gpt-realtime-translate: 4 traps not in the cookbook` | 58 | 数字 + ハック寄りで HN 好み |
| B | `What I learned implementing OpenAI's gpt-realtime-translate` | 59 | ストーリー系、柔らかい |
| C | `gpt-realtime-translate quirks: heartbeats, dual timers, GA-only auth` | 70 | 中身ネタバレ系、技術寄り |

→ **A 推奨**。HN は「数字 + 中身が透ける」タイトルが上がりやすい。

### Body（推奨 = A タイトル前提）

```
OpenAI quietly shipped gpt-realtime-translate, a Realtime API model specialized for speech-to-speech translation. It has its own endpoint, its own event namespace, and very little in common with the regular gpt-realtime-* family beyond the protocol shape. The official cookbook covers the happy path but not the things that actually break in production.

While integrating it into Sokuji (an open-source real-time translation app I work on), I hit four traps worth writing down:

1. WebSocket subprotocol must NOT include `openai-beta.realtime-v1`. translate is GA-only; the rejection message ("Translation sessions are only available on the GA API") is hard to map back to the offending subprotocol tag.

2. The audio stream multiplexes 200ms zero-amplitude heartbeat frames with ~400ms content frames over the same socket. Filter by length (4800 samples at 24 kHz), not by amplitude — amplitude filtering clips the natural intra-utterance pauses inside content frames.

3. User-side and assistant-side need independent silence timers, because translation lags input and spans multiple input utterances. A single timer pairing user/assistant items breaks down quickly.

4. The WebRTC variant uses a different ephemeral token endpoint (`/v1/realtime/translations/client_secrets`) and returns a FLAT response shape (`{ value, expires_at }`) instead of the nested `{ client_secret: { value } }` shape used by the regular endpoint.

Full write-up with working code (Japanese, code is universal): [Qiita link]

Sokuji is MIT-licensed: https://github.com/kizuna-ai-lab/sokuji — implementation lives in `OpenAITranslateGAClient.ts` and `OpenAITranslateWebRTCClient.ts` under `src/services/clients/`.

Happy to answer questions about the implementation or real-time voice agent patterns generally.
```

### Notes

- **`Show HN:` プレフィックスは付けない**（過去に複数回 Show HN 済み、今回は技術記事ポジション）
- Title はファクト中心、プロダクト名（Sokuji）はタイトルから外す → Body 内で 1 回だけ自然に登場させる
- Body は 1500 字以内が読まれる目安、本案は約 1450 字
- 自分でアップボートしない / 仲間に頼まない（HN は厳しい）
- コメントへの返信は素早く（最初の 2 時間が命）
- ヒットしたら Sokuji のサイト直リンクではなく **GitHub 直リンクを優先**（HN コミュニティは商用ぽい URL より OSS リポジトリを好む）

---

## Reddit 投稿（任意・余裕があれば）

### r/OpenAI 投稿（篇 2 公開後 = 日 PM JST）

**Title**：
```
gpt-realtime-2's reasoning.effort levels benchmarked: xHigh adds +10.84pt vs no thinking (Scale AI AudioMC)
```

**Body**：篇 2 の英語要約 200–300 字 + Scale AI leaderboard へのリンク + Qiita リンク + GitHub

### r/MachineLearning 投稿（篇 3 公開後 = 月 PM JST）

**Title**：
```
[D] Comparing OpenAI's specialized translation API (gpt-realtime-translate) vs general realtime model (gpt-realtime-2 + reasoning.effort)
```

**Body**：篇 3 の比較マトリクス英訳 + Qiita リンク

---

## 公開当日の運用フロー（チェックリスト）

### 篇 1 公開日（土 AM）

- [ ] Qiita 投稿（公開）
- [ ] frontmatter Qiita 形式に変換済み確認
- [ ] § パフォーマンスメモの数値を実測値に置換済み確認
- [ ] X スレッド投稿（5 ツイート）
- [ ] YouTube Short A upload + X から引用
- [ ] HN 投稿（夜 23:00 JST）
- [ ] Sokuji README に篇 1 リンク追加
- [ ] 篇 1 Qiita URL を篇 2 / 篇 3 ドラフトのリンクに反映

### 篇 2 公開日（日 AM）

- [ ] Scale AI leaderboard 数値を最新化
- [ ] Qiita 投稿
- [ ] X スレッド投稿（4 ツイート）
- [ ] YouTube Short B upload
- [ ] r/OpenAI 投稿（PM）
- [ ] 篇 2 Qiita URL を篇 3 ドラフトに反映
- [ ] 篇 1 投稿に「次回」リンク追加（Qiita 編集）

### 篇 3 公開日（月 AM）

- [ ] Qiita 投稿
- [ ] X スレッド投稿（6 ツイート）
- [ ] YouTube Short C upload
- [ ] r/MachineLearning 投稿（PM）
- [ ] 篇 1 / 篇 2 投稿の参考リンクを更新（Qiita 編集）
- [ ] Sokuji 公式サイト / blog があれば 3 篇まとめ記事リンク追加

### 1 週間後

- [ ] 3 篇のアクセス数 / LGTM 数 / Sokuji への流入を PostHog で確認
- [ ] 各篇のコメントへの返信完了確認
- [ ] Zenn book として 3 篇まとめ公開（収益なし、SEO のため）

---

## 万一のハマり時のコンテンジェンシー

- **HN で叩かれた場合**：Show HN は批判耐性が必要。技術的な質問には全部丁寧に返信、煽り系は無視
- **Qiita で「宣伝乙」と言われた場合**：「会社で開発している OSS です」と冒頭に小さく書いてあるので問題は限定的。批判コメには「実装の詳細は GitHub で全部見られます」と返答
- **Scale AI ベンチマーク数値が変動した場合**：篇 2 の表を最新値に更新、ヘッドライン数字だけは大きくは変わらない見込み
- **どこかの公開タイミングがずれた場合**：3 日連続が崩れても問題ない。各篇は単独でも完成している
