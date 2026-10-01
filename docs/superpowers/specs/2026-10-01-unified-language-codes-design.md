# Unified Language Codes — Design

**Date**: 2026-10-01
**Status**: Draft — brainstormed with the user 2026-09-29 → 2026-10-01, awaiting review of this file
**Base**: `main` at `af329e4c` (client contract Stage 1 + Stage 2 merged, #570/#571)
**Scope**: sokuji only. Local Native (still on the legacy path, #578) is out of scope except where it
shares a module that changes (§7).
**Related**: issue #558 (Traditional Chinese / Taiwanese Mandarin); client contract spec
`2026-09-22-client-contract-design.md` (the `languages` interface this changes).

## Summary

Every provider today invents its own language values and its own display names: Gemini stores
Google's BCP-47 (`zh-Hant`), OpenAI Realtime/Live store an underscore locale of our own making
(`zh_TW`), Palabra lowercase pseudo-BCP-47 (`zh-hant`, `es-la`), Doubao its own (`yue-CN`, `sh-CN`,
`zhen`), Local Inference an app vocabulary with `cantonese`. Each table hand-writes a native `name`
and an `englishName`, so the same language reads differently per provider ("中文 (繁體)",
"繁體中文", "中文 (台灣)", "中文"), never follows the UI language, and every consumer outside a
provider (segmentation, subtitle badges, the footer, analytics) sees whichever spelling the
current provider happens to use.

This design gives the app **one language code** — a canonical BCP-47 tag, extended with two values
that cannot collide with BCP-47 — used everywhere outside a provider. Each provider keeps its
vendor's spelling inside itself, behind an explicit two-way table. Display names stop being data:
one function renders any code in the **UI language** from CLDR via `Intl.DisplayNames`. The
language pair is stored **once, globally**, so switching provider keeps it; a provider that cannot
run one side shows its first option for that side without writing anything back.

## Findings that shaped this (verified 2026-09-29 → 2026-10-01)

- **Vendor conventions differ and are documented differently.**
  - Gemini Live API and Live Translate: table header "BCP-47 Code"; `zh-Hans`/`zh-Hant`,
    `pt-BR`/`pt-PT`, `fil`, `ceb`.
  - Microsoft Translator (Bing): BCP-47, 138 languages from its live `/languages` endpoint; Chinese
    only as `zh-Hans`, `zh-Hant`, `yue`, `lzh` — no bare `zh`.
  - OpenAI: the transcription `language` is "ISO-639-1 (e.g. `en`)" (SDK 6.39.1 doc comments);
    Realtime/Live translation takes no language code at all, only the instructions' English names;
    Translate's `output.language` is an undocumented `string` (we send 13 probed bare codes).
  - Soniox: table header "ISO Code", two letters, Chinese only `zh`.
  - Palabra: its docs state no standard; our table is read from the `models-map` its language page
    loads. Lowercase, and two codes misuse region subtags: `es-ch` is **Chile** (CH is
    Switzerland), `es-la` is **Latin America** (LA is Laos).
  - Doubao AST 2.0: its own values, including `sh-CN` for Shanghainese (`sh` is the deprecated
    Serbo-Croatian code; CLDR renders it "Serbian (Latin)") and `zhen` for the bidirectional mode.
  - Hugging Face model cards: `language:` metadata says "ISO 639-1 code", is a Hub search tag, and is
    never read at inference. Local models each take their own form (Whisper `<|zh|>`, Qwen3-ASR an
    ISO key plus a language-name prefix, LLM translators an English name in the prompt, sherpa
    models nothing).
- **CLDR already names codes the way we want, in every UI language.** `Intl.DisplayNames` (Node ICU
  78 / CLDR 48; present in Electron 40's Chromium and in the extension) keeps a script tag and a
  region tag literally distinct: `zh-Hant` → 繁体中文 / 繁體中文 / 繁体中国語 / Traditional
  Chinese; `zh-TW` → 中文（台湾） / 中文（台灣） / 中国語 (台湾) / Chinese (Taiwan); `yue` → 粤语 /
  粵語 / 広東語 / Cantonese; `mul` → 多语种 / Multiple languages. `und` renders "root" in every
  locale, so it cannot stand for auto-detect.
- **The store already separates intent from effect.** `providerStore` keeps, per entry, `stored`
  (what the user left) and `pair` (that normalized to the current context), writing only on
  `setPair` and `updateSettings`. The global pair is that `stored`, lifted out of the entries.
- **The pair is stored per provider** under `settings.<key>.sourceLanguage/targetLanguage`;
  `select` carries nothing across, and Kizuna Soniox stores a pair apart from Soniox's though both
  use `sonioxLanguages`. `settings.common.sourceLanguage`/`targetLanguage` have never existed in
  the repository's history, so a new global key reads nothing stale.
- **Raw codes reach the UI and analytics.** `PanelFooter.tsx:79` prints `${source} → ${target}`
  verbatim (`zh_CN → en`); the conversation badge (`ConversationList.tsx:123`) and the subtitle badge
  (`SubtitleView.tsx:45`) print a two-letter base; `language_changed` and the session events send
  raw codes.
- **Cantonese is misrouted today** wherever the app vocabulary's `cantonese` reaches a component that
  expects `yue`: the sidecar's ASR catalog (`yue`), the translators' prompts (the literal string
  "cantonese"), and probably Whisper-WebGPU (unverified).

## Decisions (the user's, 2026-09-29 → 2026-10-01)

1. **Display names follow the UI language**, from CLDR via `Intl.DisplayNames`. No hand-written
   per-provider names.
2. **One app code everywhere outside a provider** (the user's "B"): a stored pair, a `LanguageOption`
   value, a segment's language and every non-provider consumer use it. A provider's vendor
   spelling lives only inside that provider.
3. **The app code is BCP-47 plus two extensions**, chosen so they can never be a BCP-47 tag:
   `auto` (a four-letter primary subtag is reserved in BCP-47) and `a+b` for a bidirectional pair
   (`+` is not a BCP-47 character).
4. **The pair is stored once, globally.** Switching provider keeps it.
5. **An unsupported side takes the provider's first option** — no "nearest language" fallback
   (`zh-Hant` never silently becomes `zh`), and the correction is **not written back**. Only a pick
   the user makes writes, and it writes both sides as shown.
6. **No migration.** Per-provider pairs stored before this change are not read; every user starts
   from the selected provider's `initial` until they pick (a second reset after Stage 2's Gemini
   reset, accepted).
7. **Lands after Stage 2 shipped**, from `main`.

## Architecture

```
            ┌──────────────────── outside every provider: app codes only ────────────────────┐
 storage ── settings.common.sourceLanguage/targetLanguage ── providerStore.stored (global intent)
            │                                                   │ normalizePair per provider/context
            │                                                   ▼
            │   LanguagePairSection / wizard / footer ── languageLabel(code, ui) ── Intl.DisplayNames
            │   segmentation, subtitle, export, analytics ── baseLanguage(code) / the code itself
            └──────────────────────────────────────────────┬────────────────────────────────────┘
                                                            │ app code
            provider: options {value: app code} ── toWire(code) ──► vendor request
                                                ◄─ fromWire(raw) ── vendor's reported language
```

## 1. The app code — `src/lib/language/code.ts`

```ts
/** A canonical BCP-47 tag ('zh-Hant', 'zh-TW', 'yue', 'pt-BR', 'mul'), 'auto', or 'a+b'. */
export type LanguageCode = string;
export const AUTO = 'auto';

export type ParsedCode =
  | { kind: 'auto' }
  | { kind: 'tag'; tag: string }                 // canonical BCP-47
  | { kind: 'pair'; a: string; b: string };     // two canonical tags

export function parseCode(code: string): ParsedCode | null;   // null: not a valid app code
export function canonicalTag(tag: string): string;            // Intl.getCanonicalLocales(tag)[0]
export function pairCode(a: string, b: string): LanguageCode;  // `${a}+${b}`
/** The primary language subtag: 'zh-Hant-TW' → 'zh'; 'auto' → 'auto'; 'zh+en' → null. */
export function baseLanguage(code: LanguageCode): string | null;
```

- `AUTO` moves here from `src/lib/provider/languages.ts`, which re-exports it so no import breaks.
- `canonicalTag` is for tests and for building tables, not for reading a vendor's code: a vendor
  value is never canonicalized blindly (Palabra's `es-ch` canonicalizes to Switzerland).
- `baseLanguage` replaces the ad-hoc base extraction in `sentenceEnd.ts:181-184` (`baseLang`), which
  also lowercases and maps `cmn` → `zh`; those two behaviours are no longer needed once every
  incoming code is an app code, and `baseLang` becomes a re-export until its callers move.

## 2. Display names — `src/lib/language/label.ts`

```ts
/** `code` named in `uiLanguage` (an i18next language). */
export function languageLabel(code: LanguageCode, uiLanguage: string): string;
/** The same name in English, for instruction templates and logs. */
export function englishLanguageName(code: LanguageCode): string;  // languageLabel(code, 'en')
/** React: the current UI language from react-i18next. */
export function useLanguageLabel(): (code: LanguageCode) => string;
```

- `tag` → `new Intl.DisplayNames([ui], { type: 'language' }).of(tag)`, first letter upper-cased with
  `toLocaleUpperCase(ui)` (CLDR's names are mid-sentence forms: "español", "norsk"; a menu starts
  them capitalized).
- `auto` → the existing i18n key `common.autoDetect`.
- `a+b` → `${label(a)} ⇄ ${label(b)}` ("中文 ⇄ 英语", "Chinese ⇄ English").
- A tag CLDR cannot name (`of()` returns the code itself) falls back to the code — never an empty
  string.
- An `OVERRIDES` map (`code → ui → name`) exists for a CLDR name that is wrong for us. It ships
  **empty**; an entry needs a stated reason.
- `DisplayNames` instances are cached per UI language.
- i18next language ids (`zh_CN`, `zh_TW`, `pt_BR`, … in `src/locales`) are mapped to a BCP-47 locale
  (`_` → `-`) before reaching `Intl`.

## 3. `LanguageOption` and the `languages` interface

```ts
// src/lib/provider/types.ts
export interface LanguageOption { value: LanguageCode }
```

- `name` and `englishName` are **removed**. Every reader moves to `languageLabel` /
  `englishLanguageName`.
- `sources` / `targets` / `initial` / `reverse` keep their signatures; every value they return or
  take is an app code.
- `migratePair` is **removed** from the interface: with no per-provider pair to read and no
  migration (decision 6), nothing remains for it to rewrite. Gemini's (the only one) goes.
- New, required: `wire: { toWire(code: LanguageCode): string; fromWire(raw: string): LanguageCode | null }`,
  built from the provider's table by one helper:

```ts
// src/lib/language/wire.ts
/** Rows of [app code, vendor code]; a row of one element means the two are equal. */
export function wireTable(rows: readonly (readonly [LanguageCode] | readonly [LanguageCode, string])[]): {
  toWire(code: LanguageCode): string;              // throws on a code the table lacks
  fromWire(raw: string): LanguageCode | null;      // case-insensitive; null for an unknown vendor code
  codes: readonly LanguageCode[];
};
```

  `toWire` throws because a build is only ever handed an offered code (the runner normalizes first);
  a throw there is a programming error, caught by the provider's `build` tests. `fromWire` returns
  `null` for a code the vendor reports outside the table (Soniox and Palabra detect languages we do
  not offer); the caller treats it as "no language", as an absent field is treated today.

## 4. Provider by provider

Option order is unchanged: each table keeps its declared order (most are already in English-name
order); Local Inference keeps `LANGUAGE_PRIORITY` then English name (§7).

| Provider | App codes that differ from the vendor's | Outbound (`toWire`) | Inbound (`fromWire`) |
|---|---|---|---|
| Gemini | none | Live Translate `targetLanguageCode` (`config.ts:85`); dialogue models only the instructions' names | — |
| OpenAI Realtime | `en-AU` `en-GB` `en-US` `es-419` `pt-BR` `pt-PT` `zh-CN` `zh-TW` (vendor: our old `en_AU` … `zh_TW`) | instructions' English names; `buildTranscriptionHint` keeps reducing to the ISO-639-1 base | — |
| OpenAI Live | same as Realtime | instructions' English names | — |
| OpenAI Translate | none | `output.language` (`wire.ts:61`) | — |
| Soniox / Kizuna Soniox | none | `two_way`/`one_way`, `language_hints`, TTS `language` | `token.language`, `token.source_language` (`adapter.ts:224-225`), `utterances.ts:101-113` |
| Palabra | targets: `zh-Hans` `zh-Hant` `en-US` `en-GB` `en-AU`/`en-CA` (hidden) `pt-BR` `fr-CA` `ar-SA` `ar-AE` `es-AR` `es-CO` `es-MX`, **`es-CL` ← `es-ch`**, **`es-419` ← `es-la`** | `source_language`, `target_language` (`wire.ts:112,118`) | `transcription.language` (`wire.ts:182,195` → `items.ts`) |
| Doubao AST 2.0 | `yue` ← `yue-CN`, **`wuu` ← `sh-CN`**, **`zh+en` ← `zhen`** | `sourceLanguage`/`targetLanguage` (`wire.ts:82`), `zh+en` sent as `zhen`/`zhen` | — |
| Local Inference | `yue` ← `cantonese` (§7) | each engine converts internally, as today | ASR-detected languages, where an engine reports one |
| Fake | none | — | — |

- OpenAI Realtime and Live never send a pair code; their `toWire` is the identity over app codes and
  exists only so every provider has the same shape. Their instructions read `englishLanguageName`:
  `zh-TW` → "Chinese (Taiwan)", `en-US` → "American English".
- Palabra's `reverse` keeps its documented to_source/to_target maps, rewritten in app codes
  (`en-US` target ⇄ `en` source).
- Doubao's `targetsOf` branches on `zh+en` and on the base language instead of `zhen` and its
  `ZH_OR_EN` set.
- Every provider's instruction template and every `*LanguageName` helper
  (`realtimeLanguageName`, `liveLanguageName`, `geminiLanguageName`) becomes
  `englishLanguageName`. `realtimeLanguageName`'s `auto` → "the spoken language" stays a special
  case in the template.
- The English names in instructions change wording (Google's "Chinese (Traditional)" → CLDR's
  "Traditional Chinese"). The model is told the same language.

## 5. The global pair — `providerStore`

- One persisted pair: `settings.common.sourceLanguage` / `settings.common.targetLanguage`, read once
  in the store's initialization, held as `stored: LanguagePair | null` at store level (null: never
  picked). The per-entry `stored` field goes.
- An entry's `pair` is derived: `normalizePair(p, settings, stored ?? initial(p), context)` —
  exactly today's `derive`, fed from the global intent. When nothing is stored, each provider shows
  its own `initial`, as today.
- **Writes**: only `setPair` (a pick in Settings or the wizard), and it writes **both sides as shown**
  — the normalized pair the user saw and changed, so a stored pair is always one some provider
  offered. `updateSettings` no longer persists a pair: a settings change that narrows the offer (a
  Gemini model switch) re-derives like a provider switch and writes nothing, and the next provider
  that offers the old pair shows it again.
- `select` (provider switch) writes nothing new; every loaded entry already derives from the global
  intent. `rederive` on `setLegs`/`setSpeech` is unchanged.
- Soniox and Kizuna Soniox, which today keep two pairs over the same `sonioxLanguages`, now share
  the one pair like every other provider.
- The old per-provider keys (`settings.<key>.sourceLanguage/targetLanguage`) are no longer read or
  written. They are left in storage, not deleted (deleting is a one-time migration step too).
- Readiness: a pair change already forgets the readiness of the provider it changed; it now forgets
  every loaded entry whose derived pair moved.

## 6. UI consumers

- `LanguagePairSection.tsx`, `StepLanguagePair.tsx`, `StepFinish.tsx`: `<option>` text and the
  mirror sentence via `useLanguageLabel()`; the `AUTO` special case moves into `languageLabel`.
- `PanelFooter.tsx:79`: `${label(source)} → ${label(target)}` instead of raw codes.
- Conversation and subtitle badges keep a two-letter base (`baseLanguage(code).slice(0, 2)`
  upper-cased): `zh-Hans`, `zh-Hant`, `zh-TW` all read `ZH`. `yue` reads `YU`. Unchanged in spirit;
  a fuller badge is not part of this change.
- Engine page and model cards (`engine/languageName.ts`, `LanguageTags.tsx`,
  `ModelManagementSection.tsx`, `NativeModelManagementSection.tsx`) and `lib/view/noticeText.ts`:
  `getLanguageOption(code).name` → `languageLabel(code, ui)`.
- `SetupWizard/languageDefaults.ts`: matching `i18n.language` against provider codes becomes
  matching the UI locale's BCP-47 base against app codes (`baseLanguage`).
- Analytics and transcript export keep sending the code; it is now the app code (`zh-CN`, not
  `zh_CN`). Dashboards keyed on old values see the new spelling from this release.

## 7. Local Inference and the shared vocabulary

- `src/utils/languages.ts`: `LANGUAGE_OPTIONS` (61 entries with hand-written names) becomes a list of
  app codes; `cantonese` → `yue`. `LANGUAGE_PRIORITY` stays (with `yue`), `sortLanguageOptions`
  sorts unlisted codes by `englishLanguageName`, `getLanguageOption` is deleted (its readers move to
  `languageLabel`). Its import of the legacy `ProviderConfig.LanguageOption` goes.
- `modelManifest.ts`: every `languages` entry `cantonese` → `yue` (and the comment pinning
  `cantonese` at :3338). `multilingual` stays: it is a capability marker, not a language.
- Places that alias `cantonese` → `yue` drop the alias: `qwen3-asr-prompt.ts:81-91`,
  `nativeCatalog.ts` `LANG_ALIASES`, `splitSentences.ts:10-19`; places keyed on `cantonese` move to
  `yue`: `edge-tts/voiceList.ts` `LOCALE_RULES`, `PunctuationRuntime.ts:58-65`,
  `sentenceCut.ts:21-23`, `SentenceStream.ts` (already lists `yue`).
- Whisper-WebGPU with `yue`: transformers.js's language table may lack it. Verified during
  implementation; if it throws, the worker passes no language (auto-detect) for a code its table
  lacks, which is what the sidecar already does.
- Local Native still reads `LANGUAGE_OPTIONS` and the manifest. It follows the vocabulary change:
  its stored `cantonese`, if any, is no longer offered and normalizes to its first option. Its own
  pair stays in `settingsStore` until #578 moves it onto the contract.
- **Not in scope**: splitting Local Inference's `zh` into `zh-Hans`/`zh-Hant` (#558's third point).
  That follows each model's own list and is its own change; this one only makes it expressible.
  `prompts.ts` `LANG_NAMES`/`NATIVE_NAMES` (local LLM prompt wording) are unchanged.

## 8. Segmentation and other code that branches on a language

`sentenceEnd.ts`, `SentenceStream.ts`, `PunctuationRuntime.ts`, `sentenceCut.ts`, Gemini's
`turns.ts:40-41`, `previewSample.ts` and `edge-tts/voiceList.ts` compare on `baseLanguage(code)`.
Each comparison is audited; the rule is that a script or region subtag never changes behaviour
(`zh-Hant`, `zh-TW` behave as `zh`), and `yue` keeps its own entries where they exist today.

## 9. Testing

- `code.test.ts`: `parseCode` for a tag, `auto`, `a+b`, and rejects (`''`, `zh_CN`, `a+b+c`,
  `auto+en`); `baseLanguage`; `canonicalTag`.
- `label.test.ts`: every code any provider offers, in every UI locale under `src/locales`, has a
  label that is non-empty and is not the code itself (`mul` and the pair included). No assertion
  pins a CLDR string; ICU differs between Node and Chromium versions.
- `wire.test.ts`: `wireTable` round-trips, case-insensitive `fromWire`, `toWire` throws on an absent
  code.
- Registry invariant (`registry.test.ts`): every option of every provider, in every context, parses
  as an app code; `fromWire(toWire(x)) === x` for each; no provider defines `name`/`englishName`.
- Per provider: `build` sends the vendor spelling (`zh_TW` nowhere outbound for Realtime; Palabra
  `es-CL` → `es-ch`; Doubao `zh+en` → `zhen`/`zhen`, `wuu` → `sh-CN`); Soniox and Palabra map an
  inbound vendor language to the app code, and an unknown one to none.
- `providerStore`: the pair survives a provider switch; a side the new provider lacks shows its first
  option and nothing is written; switching back shows the original; `setPair` writes both sides as
  shown; `updateSettings` writes no pair; nothing stored → each provider's `initial`.
- Local: `yue` reaches the sidecar ASR card, Qwen3-ASR's prefix and the punctuation model.
- UI: one rendering check of the language section in a CJK and a Latin UI language (settle by
  rendering, per the project's UI rule) — not an assertion on names.

## 10. Rollout

Order, each step green on its own:

1. `src/lib/language/` (`code`, `label`, `wire`) with tests; no consumer yet.
2. Local vocabulary: `cantonese` → `yue` across `utils/languages.ts`, the manifest, workers, aliases
   and segmentation (§7, §8). Fixes Cantonese routing on its own.
3. Providers and UI together (the `LanguageOption` type change forces it): every table in app codes
   with `wireTable`, inbound mapping, instructions on `englishLanguageName`, every reader on
   `languageLabel`, `migratePair` removed, footer labels.
4. Global pair in `providerStore` (§5).

## 11. Out of scope and follow-ups

- Local Native's language handling (#578).
- Local Inference offering `zh-Hans`/`zh-Hant` per model, and Bing receiving them (#558's third
  point).
- Bing's `sr` and `tlh`, which Microsoft lists only as `sr-Cyrl`/`sr-Latn` and `tlh-Latn`/`tlh-Piqd`:
  verify against the live endpoint, then fix in `languageMap.ts`.
- Whether Doubao accepts the `sh-CN` it is sent today — unchanged here, only renamed inside.
- Richer conversation/subtitle badges than a two-letter base.

## Known limitations

- CLDR names can differ slightly between the Chromium in Electron, the user's Chrome (extension) and
  Node (tests). Labels may change wording across browser updates; the override map is the escape
  hatch.
- A user who had Traditional Chinese on Palabra and switches to Soniox sees Soniox's first target,
  not Chinese: no nearest-language fallback, by decision 5.
- Every user's pair resets once more (decision 6).
