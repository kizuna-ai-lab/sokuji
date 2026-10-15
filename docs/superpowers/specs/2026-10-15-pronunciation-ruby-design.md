# Pronunciation ruby (#545)

Status: design, awaiting review.
Issue: kizuna-ai-lab/sokuji#545. Rendered candidates: https://claude.ai/artifact/3H3aMhr7434uYxEVBqKCZf (source in `.claude/worktrees/ruby-harness/`, git-ignored).

## Goal

A switch in the display settings shows how the other side's language is pronounced, as ruby above the text: kana over Japanese kanji, pinyin over Chinese characters, Latin letters over Korean and Russian or Ukrainian words. It serves three kinds of user: someone reading a translation aloud whose script they know but whose readings they do not (a Chinese speaker reading Japanese), someone who cannot read the script at all, and someone following the other side's speech. Readings are drawn by the view only: they never reach a provider, TTS, the transcript, an export or the clipboard.

## Rulings (the owner, 2026-10-15)

| # | Question | Ruling |
|---|---|---|
| R1 | How readings are drawn | Ruby above the text, not a line under it. |
| R2 | Which text | By language, not by role: every row whose language is annotated, my translation and the other side's original alike. |
| R3 | Which language | The pair's target language (the other side's), nothing to configure. The switch names it; it is hidden when the target has no scheme. |
| R4 | Japanese scheme | Kana (hiragana furigana). Romaji is phase 2, with no placeholder in the UI. |
| R5 | Where the switch lives | The display-settings popover (the gear), below the three colour rows. |
| R6 | Phase 1 surfaces | The conversation panel and the Electron subtitle view while expanded. |
| R7 | Phase 1 languages | Chinese pinyin, Japanese kana, Korean Revised Romanization, Russian and Ukrainian Latin transliteration. |
| R8 | Architecture | A view-layer module, `src/lib/reading/` (approach 1): no field on `Row` or `Segment`. |
| R9 | Ruby size | `max(50%, 10px)` of the row's font size, the text's own colour at 72% (candidate R2). |
| R10 | Chinese grouping | One pinyin syllable per character. |
| R11 | Streaming text | Annotate as the text grows, but hold back the reading of the last annotated piece until the row is final (candidate C). |
| R12 | Face-to-face | No special case: the same target-language rule, judged per row. |
| R13 | A bidirectional target (`zh+en`) | Annotate whichever of its languages has a scheme; the switch names that one. |
| R14 | Japanese engine | Lindera WASM with IPADIC, not kuromoji. |
| R15 | Where the Japanese dictionary comes from | Our own Cloudflare (sokuji.kizuna.ai), downloaded on first use. Not Hugging Face (unreachable from mainland China), not bundled into the app, not a public CDN. |
| R16 | Analytics | One event, for the switch. Nothing for the dictionary download. |

## Today (origin/main at bcb6aa1f6)

- No transliteration code or dependency exists; nothing renders `<ruby>`.
- Text flows one way: adapters speak their own text (`soniox/utterances.ts`, `localInference/adapter.ts`), replay plays stored pcm, export reads `Leg.segments` (`lib/export/transcript.ts`). Nothing reads text back from the view.
- A row is drawn by `RowBubble` (`src/components/Conversation/ConversationList.tsx:151`). Its language is `row.language || (isTranslation ? languages.target : languages.source)` (`:156`), where `row.language` is the provider's detected language and `languages` is the leg's pair frozen at Start (the participant leg's pair is reversed). It trims the row's text (`:164`) and slices it for karaoke (`:201-212`).
- A row's text is replaced wholesale, up to 20 times a second (`lib/view/conversationView.ts`), and can change after it is final (punctuation fill-in, `Conversation.ts` `markFinal`). `DisplayItem` knows whether a row ends its segment (`lib/view/filter.ts` `endsSegment`).
- The display popover (`src/components/Display/DisplaySettingsPopover.tsx`) binds one store per surface: `conversationDisplayStore` (`settings.common.conversationDisplay.*`) or `subtitleStore` (`settings.common.subtitle.*`); a row whose binding is `undefined` is not drawn.
- The Electron subtitle view's expanded mode reuses `ConversationList` (`src/components/Subtitle/SubtitleBands.tsx:68`); compact mode draws flowing bands that carry no language. In the extension, subtitle mode is the page overlay, a separate bundle that receives entries over a wire and does not hydrate the provider store.
- Model files persist in IndexedDB `sokuji-models` (`lib/local-inference/modelStorage.ts` `storeFile`/`getFile`); downloads go through `downloadRetry.ts`; HF URLs through `getModelDownloadUrl` (`modelManifest.ts`), which honours `VITE_HF_HUB_BASE`.

## Measured (2026-10-14/15, spike in a scratch folder)

- **pinyin-pro** 3.29.5 (MIT, ~325 KB minified): every polyphone in the test sentences right in context (还 hái, 重新 chóng, 长城 cháng, 重庆 chóng, 银行 háng), 一/不 tone sandhi applied (一下 yí xià); ~40 µs a sentence. Traditional characters are read poorly even with its 17 KB traditional dictionary (還要 → huán).
- **kuromoji** 0.1.2 (Apache-2.0) with IPADIC: furigana right on every test sentence (明日 あした, 何階 なんかい, 生憎 あいにく, 渋谷 しぶや). Dictionary 12 files, 17.8 MB gzip. In Node: 0.3 s to build, +324 MB RSS, ~0.1 ms a sentence. Unchanged since 2017.
- **Lindera WASM** `lindera-wasm-ipadic-*` 2.3.4 (MIT, released 2026-03), the same IPADIC: the same readings on every test sentence; one 17 MB wasm with the dictionary inside (16.5 MB gzip); in Node 0.2 s to build, +168 MB RSS, ~26 µs a sentence. Each token carries `isUnknown` and IPADIC's nine fields (the reading is the eighth). IPADIC's age shows on new words and names: 令和 → 令(リョウ)和(ワ), 蒼汰 → 蒼(アオイ) + unknown 汰, 𠮷野家 → unknown 𠮷 + 野家(ノヤ).
- Users translating into Japanese, last 90 days, by country: Japan 226, US 138, mainland China 129 (about 13%; huggingface.co is unreachable there without a VPN), Hong Kong 93, Taiwan 67.
- Bundling the dictionary would add 17 MB to every download: the extension zip 31 → 48 MB, the desktop installers about 150 → 167 MB.
- **@romanize/korean**: 13 of 20 official Revised Romanization examples; misses nasalization (종로 jongro), lateralization (별내 byeolnae), palatalization (같이 gati), aspiration after a noun (묵호 muko), n-insertion (학여울).
- **Streaming**: replaying two sentences two characters a step, each prefix annotated on its own, gave six readings that changed later (明 あきら before 明日 あした, 生 なま before 生憎, 重 zhòng before 重新 chóng, 一 yī before 一下 yí, …). All six were on the prefix's last annotated piece.
- **Ruby size**: at the 14 px default, 50% ruby is 7 px and pinyin tone marks are illegible at 1x; with a 10 px floor, a reading wider than its base spreads the base text (銀 行). At 20 px and above the two are the same.

## Design

### 1. Which rows get readings

- `readingLanguage(code)` maps an app language code to a reading language or null: `zh`, `zh-Hans`, `zh-CN`, `cmn` → `zh`; `ja*` → `ja`; `ko*` → `ko`; `ru*` → `ru`; `uk*` → `uk`. Traditional Chinese (`zh-Hant`, `zh-TW`, `zh-HK`), `yue`, `auto` and everything else → null.
- `readingTargets(target)`: the reading languages of the current pair's target, for a pair code (`zh+en`) the union of its two halves (R13). The current pair is the selected provider's entry pair (`providerStore`, as `useFaceToFace` reads it).
- A row is annotated when the switch is on for its surface and `readingLanguage(rowLanguage)` is in `readingTargets(target)`, where `rowLanguage` is `RowBubble`'s existing rule. The row's own detected language therefore wins: in face-to-face (R12), a line the other side says in my language is not annotated and a line I say in theirs is.
- The rule reads the current pair, not the leg's frozen one: what the switch names is what gets annotated, including rows left from an earlier pair.

### 2. The reading module, `src/lib/reading/`

- One output shape: `RubyPiece = { text: string; reading?: string }[]`, pieces that concatenate to the input exactly.
- One entry point, `annotate(text, lang)`: the pieces, or null while that language's annotator is not ready. Results are cached by `lang + text` (bounded, least recently used), since a row's text repeats across re-renders and churns while streaming.
- Each language's annotator loads by dynamic import the first time it is needed, so none of this is in the startup bundle; Chinese, Korean and Cyrillic then run synchronously in the main thread, and Japanese runs in a worker (section 3). A subscriber is told when an annotator becomes ready or a Japanese result arrives, so the rows waiting on it re-render.
- **Chinese**: pinyin-pro over the whole row (context decides polyphones), one piece per Han character with its tone-marked syllable (R10); neutral tone unmarked; tone sandhi kept, since readers read it aloud; anything not Han is plain text.
- **Japanese**: Lindera tokens (section 3); a token with Han characters gets furigana on its Han runs only, its kana (okurigana) left plain, by matching the token's reading against its surface with each Han run as a group (考え直す → 考(かんが)え直(なお)す); a token whose match fails gets its whole reading. Readings are hiragana. Conservative on names and slang, as #545 asks: a token the dictionary does not know (`isUnknown`, or reading `*`) gets no reading, and neither does any token in the same unbroken run of Han-bearing tokens, because such a run is usually one word the dictionary lacks, split into pieces it half-knows (蒼汰 is 蒼 as the surname あおい plus an unknown 汰; 𠮷野家 is an unknown 𠮷 plus 野家 のや). Stated limitation: IPADIC dates from 2007, so a newer word whose pieces it knows is read wrongly (令和 → りょう わ); UniDic, newer and larger, is a later option.
  - **Readings the neighbours settle** (added 2026-10-15, after the live check showed お腹が空いた read あいた). IPADIC gives each entry one reading and picks between entries of the same part of speech by a fixed cost, never by context, and it reads a numeral and its counter piece by piece. Before furigana, `readingRules.ts` corrects only what the adjacent tokens decide: a numeral (kanji up to the hundreds, or ASCII or full-width digits) directly followed by its counter becomes one token with one reading drawn over both: 人 for 1, 2, 4 (ひとり, ふたり, よにん); 日 for 2–10, 14, 20, 24 (ふつか … とおか, じゅうよっか, はつか, にじゅうよっか), and 1 as ついたち only after a word ending in 月 (一日中 stays いちにち); 日間 for the same numbers, the same reading with かん after it (三日間 みっかかん, 十四日間 じゅうよっかかん, 二十日間 はつかかん; 一日間 stays いちにちかん); 歳 for 20 (はたち); 月 for 1–12 after digits (4月 しがつ, where IPADIC says つき). A numeral that matches no rule is left whole, so 十一人 is not read from its 一. And 空く after お腹, おなか or 腹 (directly, or with が, も, は or を between) is read す, not あ.
  - Stated limitation: a reading that only the meaning settles stays IPADIC's, wrong where its cost picks the other entry: 電車が空いている (すいて, read あいて), このカレーは辛い (からい, read つらい), あの方 (かた, read ほう; その方がいい is ほう, so no rule can tell), ドアが開いた (あいた, read ひらいた), タバコを止めた (やめた, read とめた), 人気のない道 (ひとけ, read にんき), 生物 as なまもの. Larger numbers with a 4 (十四人 じゅうよにん) keep the piece-by-piece reading.
- **Korean**: our own Revised Romanization, one piece per space-separated word, lower case, with the sound changes the official rules write: liaison, nasalization, lateralization, palatalization and aspiration. Not handled, stated: n-insertion (학여울 → hagyeoul, officially Hangnyeoul), the noun aspiration exception (묵호 → muko), and personal-name conventions (김민수 → gimminsu). The library measured above is not used.
- **Russian**: BGN/PCGN, one piece per word, ASCII (the soft and hard signs are dropped, not written as ʹ ʺ). **Ukrainian**: the national system of 2010 (Cabinet of Ministers resolution 55), one piece per word. Transliteration spells letters, not pronunciation (счастливого → schastlivogo, read shchastlivava), a stated limitation.

### 3. Japanese: Lindera, its dictionary and the worker

- **Engine (R14)**: `lindera-wasm-ipadic-web` 2.3.4. Its JS glue is bundled into the worker; its wasm, which carries the IPADIC dictionary, is not: the app build must not contain it, and a check over the build output fails on any `.wasm` of that size (the glue names its wasm with `new URL(…, import.meta.url)`, which Vite would otherwise copy into the build).
- **Where it comes from (R15)**: `https://sokuji.kizuna.ai/reading/lindera-ipadic-2.3.4.wasm`, a fixed production URL (the file is versioned by name, so a development build fetches the same bytes). sokuji-backend serves it as a static asset (section 7). The extension already lists sokuji.kizuna.ai in its CSP and `host_permissions`.
- The download is checked before it is kept: its byte count and SHA-256 must match the values the app pins for that version. This matters: a path the backend does not have answers 200 with the site's `index.html` (`not_found_handling = "single-page-application"`).
- It is stored with `storeFile('reading-ja-lindera', 'lindera-ipadic-2.3.4.wasm', blob)` in `sokuji-models`, without metadata, so the Models UI does not list it; clearing local models clears it too, and it downloads again when next needed. A new version is a new file name; the old one is deleted after the new one is stored.
- A download starts when either surface's switch is on, the target includes Japanese and the file is not stored, whether that happens by a click or at launch. Both switches off, or a pair change that leaves no Japanese target, aborts it and discards what arrived. It goes through `downloadRetry.ts` (connect timeout, retries, streamed progress). Progress, failure and retry are state in one small holder with a hook; a failure is recorded once with `reportWarning('Readings', …)`.
- The worker instantiates the wasm from the stored bytes, never the network, builds a tokenizer (`embedded://ipadic`, normal mode) and answers `tokenize` requests with each token's surface and reading. It starts when a Japanese row first needs a reading and the file is stored, and is terminated when both switches are off or Japanese leaves the target, giving back its ~170 MB. Its memory is not counted in local inference's budget.
- Until the worker answers, Japanese rows draw plain text.
- A worker that stops on its own after it started (the system can end it under memory pressure) puts Japanese readings in the failed state, with Retry, and the rows draw plain text; the stored file is kept, since nothing says it is bad, and Retry starts a new worker on it. A worker that cannot start at all deletes the file instead, so Retry downloads it again.

### 4. Drawing

- `ConversationList` takes `readings`, the reading languages to annotate (absent or empty: none). MainPanel passes the conversation store's value; the Electron subtitle view passes the subtitle store's value in expanded mode; the extension overlay passes false.
- `RowBubble` asks `useReading(text, lang, { holdTail })` for pieces and renders each piece with a reading as `<ruby>text<rt aria-hidden="true">reading</rt></ruby>`, so a screen reader reads the text once. Null pieces render the text as today.
- **Streaming (R11)**: `holdTail` is true when the row is not final and ends its segment; the last piece with a reading then renders as plain text. Earlier rows of an unfinished segment end at a sentence or pause and keep their readings.
- **Karaoke**: plain text splits at the played offset as today; a piece with a reading counts as played once the offset reaches its end. Offsets are measured on the row's text, which the readings never change.
- **Style (R9)**, in `ConversationRow.scss`: `rt { font-size: max(50%, 10px); opacity: 0.72; font-style: normal; line-height: 1; user-select: none; }`, `ruby { ruby-position: over; }`. The colour is inherited, so source rows, translation rows and the karaoke colour all carry through.

### 5. The switch

- `conversationDisplayStore` and `subtitleStore` each gain `showReadings: boolean`, default false, keys `settings.common.conversationDisplay.showReadings` and `settings.common.subtitle.showReadings`, set and persisted as their other fields are.
- The popover's bindings gain `showReadings`/`setShowReadings`, and the row is drawn when they are bound, `readingTargets(target)` is not empty and the surface draws readings: the conversation popover everywhere; the subtitle popover in Electron while the view is expanded (so the row comes and goes with the compact toggle, and never appears in the extension overlay).
- The row is a `ToggleSwitch` below the colour rows, labelled with the language and scheme: "Show Japanese readings (kana)", zh_CN 「显示日语读音（假名）」. The language name comes from `languageLabel` in the UI language (CLDR), the scheme from `subtitle.settings.readingScheme.{kana,pinyin,rr,latin}`.
- Japanese only, under the switch while it is on: during a download, a thin progress bar and "Downloading the Japanese dictionary {{done}} / {{total}}", both sizes from `formatBytes`; after a failure, "Couldn't download the Japanese dictionary." and a Retry button; nothing once it is ready.
- New strings (`subtitle.settings.readings`, `readingScheme.*`, `readingsDownloading`, `readingsDownloadFailed`, `readingsRetry`) in all 30 catalogs.

### 6. Analytics (R16)

- One event, `readings_changed { surface: 'conversation' | 'subtitle', language, enabled }`, from the switch. Nothing for the dictionary download.

### 7. sokuji-backend: serving the wasm

A separate pull request in kizuna-ai-lab/sokuji-backend, merged (which deploys production) before the app release that carries this feature:

- `web/` gains `lindera-wasm-ipadic-web` 2.3.4 as a pinned dev dependency, and its build copies the package's `lindera_wasm_bg.wasm` to `dist/reading/lindera-ipadic-2.3.4.wasm`. The 17 MB binary never enters git; the lockfile's integrity hash pins it.
- `dist/reading/` also carries Lindera's MIT licence and the IPADIC licence text beside the wasm.
- A `_headers` rule for `/reading/*`: `Access-Control-Allow-Origin: *` (the Electron renderer fetches cross-origin, and static assets are served without the Worker, so the Hono CORS middleware never sees them) and `Cache-Control: public, max-age=31536000, immutable`.
- The file is 17 MB, inside Workers static assets' 25 MiB per-file limit.

## Testing

- `readingLanguage`/`readingTargets`: the code table, `zh+en` → `{zh}`, traditional and `auto` → none.
- Chinese: the polyphone sentences above and 一下 sandhi; pieces concatenate to the input; non-Han text plain.
- Japanese, against `lindera-wasm-ipadic-nodejs` in node: furigana alignment (okurigana, a Han run between kana, a failed match), readings hiragana, an unknown token bare and the Han run around it bare (蒼汰, 𠮷野家). The counter and 空く rules over real tokens, with their limits pinned as stated (電車が空いている, 辛い, その方が).
- Korean: the official RR examples it should pass, and the stated misses pinned as they are.
- Russian and Ukrainian: each system's table, including е/є after a vowel and word-initially.
- `RowBubble`: readings only on rows in the target language, both sides; the detected language wins over the leg; switch off draws today's markup; `holdTail` on an unfinished last row; karaoke over pieces.
- Popover: hidden for an English target, Chinese label for `zh+en`, hidden in the compact subtitle view and the extension overlay, the download states; a keyed `t` mock proving the label's keys are read (the suites cannot see localisation otherwise).
- Dictionary holder: start, progress, abort on switch-off, failure then retry, a wrong byte count or hash refused (the SPA's `index.html`), the file stored without metadata, an old version deleted.
- Build: the app build contains no Lindera wasm.
- A render check of the panel and the Electron subtitle view at 300 and 450 px; a live check in Electron and in the extension side panel against the deployed backend: the download, its CORS, the stored file surviving a restart.

## Out of scope (phase 2 or later)

Japanese romaji; traditional Chinese and zhuyin; Cantonese; the compact subtitle bands; the extension overlay; the LAN caption page (the host would compute pieces and send them); readings in exports; Arabic, Persian, Thai, Hindi; correcting a reading by hand.

## Order

1. The sokuji-backend pull request (section 7), merged and deployed.
2. The app: the reading module, the stores and the popover row, the drawing, the strings; then the live check against production.
