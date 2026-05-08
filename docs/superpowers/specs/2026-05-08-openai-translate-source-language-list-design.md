# OpenAI Translate Source Language List — Design

**Date**: 2026-05-08
**Status**: Approved, ready for implementation

## Overview

Tighten the OpenAI Translate provider's source-language UX:

1. Replace the inherited fine-grained OpenAI source list (with `zh_CN`/`pt_BR`/`en_US`-style regional codes, ~57 entries) with a coarse list (`zh`/`pt`/`en` with no regionals, 75 entries) that matches the cookbook's full input-language coverage.
2. Remove the "Auto detect" option for this provider — although the API auto-detects source, our UI value is still meaningful when participant translation is enabled (it becomes the participant client's translate target).
3. When participant translation is enabled and the user picks a source language outside the 13 supported target languages, render a small inline warning under the source dropdown — informational only, does not block the user or auto-toggle anything.
4. Generalize the swap-button handler so providers with a restricted `targetLanguages` list (currently only OpenAI Translate) fall back to a valid target on swap instead of producing API-invalid settings.

## Motivation

The OpenAI Translate API auto-detects source language, but Sokuji's UX requires the source value for two reasons:

- **Participant translation**: when the user enables participant mode, Sokuji opens a second realtime client that translates "their speech" → "our language". For OPENAI_TRANSLATE, "our language" comes from the speaker session's `sourceLanguage` setting. Therefore the value is not cosmetic, and "Auto detect" — which would leave the participant target undefined — is meaningless here.
- **Transcript display**: source-language captions get rendered with the language's font/RTL/direction hints.

Currently the source dropdown carries 50+ regional codes inherited from `OpenAIProviderConfig.LANGUAGES`. The translate API operates on coarse codes (no `_BR`/`_CN` distinctions), and the existing dropdown is wider than necessary while missing several languages that the model actually supports (e.g., Dzongkha, Latin, Maori, Yoruba). Aligning the dropdown with the cookbook's exact 75 input languages eliminates both inconsistencies.

## Non-Goals

- Auto-disabling participant mode when source language is unsupported as target.
- Migrating existing settings from regional codes to coarse codes — accepted that some users will see an empty/first-item dropdown on first encounter and re-pick.
- Adding the same language list to other providers — list is OPENAI_TRANSLATE-specific.

## Source Language List (75 codes)

ISO 639-1 codes mapped from the cookbook's English language names. Names use native script where appropriate (matching the existing OpenAI dropdown convention).

| code | native | English |
| ---- | ------ | ------- |
| af | Afrikaans | Afrikaans |
| ar | العربية | Arabic |
| az | Azərbaycan | Azerbaijani |
| be | Беларуская | Belarusian |
| bn | বাংলা | Bengali |
| bs | Bosanski | Bosnian |
| bg | Български | Bulgarian |
| ca | Català | Catalan |
| zh | 中文 | Chinese |
| hr | Hrvatski | Croatian |
| cs | Čeština | Czech |
| da | Dansk | Danish |
| nl | Nederlands | Dutch |
| dz | རྫོང་ཁ | Dzongkha |
| en | English | English |
| eo | Esperanto | Esperanto |
| et | Eesti | Estonian |
| eu | Euskara | Basque |
| fa | فارسی | Persian |
| fi | Suomi | Finnish |
| fil | Filipino | Filipino |
| fr | Français | French |
| gl | Galego | Galician |
| de | Deutsch | German |
| el | Ελληνικά | Greek |
| gu | ગુજરાતી | Gujarati |
| ht | Kreyòl Ayisyen | Haitian Creole |
| haw | ʻŌlelo Hawaiʻi | Hawaiian |
| he | עברית | Hebrew |
| hi | हिन्दी | Hindi |
| hu | Magyar | Hungarian |
| hy | Հայերեն | Armenian |
| id | Bahasa Indonesia | Indonesian |
| it | Italiano | Italian |
| ja | 日本語 | Japanese |
| jv | Basa Jawa | Javanese |
| ka | ქართული | Georgian |
| kk | Қазақ | Kazakh |
| ko | 한국어 | Korean |
| ku | Kurdî | Kurdish |
| la | Latine | Latin |
| lv | Latviešu | Latvian |
| lt | Lietuvių | Lithuanian |
| mk | Македонски | Macedonian |
| ms | Bahasa Melayu | Malay |
| ml | മലയാളം | Malayalam |
| mi | Māori | Maori |
| mn | Монгол | Mongolian |
| my | မြန်မာ | Burmese |
| ne | नेपाली | Nepali |
| no | Norsk | Norwegian |
| nn | Nynorsk | Nynorsk |
| pl | Polski | Polish |
| pt | Português | Portuguese |
| pa | ਪੰਜਾਬੀ | Punjabi |
| ro | Română | Romanian |
| ru | Русский | Russian |
| sr | Српски | Serbian |
| sn | ChiShona | Shona |
| sk | Slovenčina | Slovak |
| sl | Slovenščina | Slovenian |
| sq | Shqip | Albanian |
| es | Español | Spanish |
| sw | Kiswahili | Swahili |
| sv | Svenska | Swedish |
| tl | Tagalog | Tagalog |
| te | తెలుగు | Telugu |
| th | ไทย | Thai |
| tr | Türkçe | Turkish |
| uk | Українська | Ukrainian |
| uz | Oʻzbek | Uzbek |
| vi | Tiếng Việt | Vietnamese |
| cy | Cymraeg | Welsh |
| yo | Yorùbá | Yoruba |

13 of these (`en`, `es`, `pt`, `fr`, `ja`, `ru`, `zh`, `de`, `ko`, `hi`, `id`, `vi`, `it`) overlap with `TARGET_LANGUAGES`. The other 62 are source-only.

## File Changes

| Path | Change |
| ---- | ------ |
| `src/services/providers/OpenAITranslateProviderConfig.ts` | Add static `SOURCE_LANGUAGES: LanguageOption[]` (75 entries above). Replace `languages: OpenAIProviderConfig.getSourceLanguages()` with `languages: [...OpenAITranslateProviderConfig.SOURCE_LANGUAGES]`. |
| `src/components/Settings/sections/LanguageSection.tsx` | Three edits: (a) auto-detect option's `provider !== Provider.LOCAL_INFERENCE` gate becomes `provider !== Provider.LOCAL_INFERENCE && provider !== Provider.OPENAI_TRANSLATE`; (b) generalize `handleSwapLanguages` to fall back to the first valid target when the swapped value isn't in the provider's restricted target list (only triggers when `providerConfig.targetLanguages` is defined); (c) render a participant warning row beneath the source dropdown when `provider === Provider.OPENAI_TRANSLATE && isSystemAudioCaptureEnabled && !TARGET_LANGUAGES.some(t => t.value === sourceLanguage)`. |
| `src/locales/en/translation.json` | Add `settings.translateSourceParticipantWarning`. |
| `src/locales/{29 other locales}/translation.json` | Same key, translated. |

## Behavior Specification

### Source dropdown (OPENAI_TRANSLATE)

- Shows the 75 entries from `SOURCE_LANGUAGES`.
- Does NOT show "Auto detect".
- Default value remains `'en'` (already coarse, no migration).
- If a stored `sourceLanguage` value isn't in the new list (e.g., a user previously picked `zh_CN` from the inherited list), the dropdown shows it as empty/first-item — user re-picks. No automatic migration.

### Participant warning

Renders only when ALL of the following are true:
- `provider === Provider.OPENAI_TRANSLATE`
- `isSystemAudioCaptureEnabled === true` (from audioStore)
- `!TARGET_LANGUAGES.some(t => t.value === sourceLanguage)`

Visual: a single line directly below the source `<select>`, with a small `AlertTriangle` icon and the i18n message `settings.translateSourceParticipantWarning`. Suggested English copy:

> ⚠ Participant translation may not work — your selected source language is not in the 13 supported target languages.

The warning is informational. No automatic side-effects (does not toggle participant mode, does not change settings, does not block start session).

### Swap button

Generic implementation in `handleSwapLanguages` (not OPENAI_TRANSLATE-specific):

```ts
} else {
  updateSourceLanguage(tgt);
  const targetList = providerConfig.targetLanguages ?? providerConfig.languages;
  const newTarget = targetList.some(l => l.value === src)
    ? src
    : (targetList[0]?.value ?? src);
  updateTargetLanguage(newTarget);
}
```

For providers without a restricted `targetLanguages` list, `targetList === providerConfig.languages` and the source value always exists in it (since both dropdowns draw from the same array), so the fallback never fires. Behavior is preserved exactly for OpenAI / OpenAI Compatible / Kizuna AI / Gemini / Palabra / Volcengine.

For OPENAI_TRANSLATE: `targetList === TARGET_LANGUAGES` (13 entries). When `src` is in the 13, swap is symmetric. When `src` is in the 62-source-only set (e.g., `'th'`), fallback to `TARGET_LANGUAGES[0].value` (= `'en'`). Silent — no toast/banner — matching the LOCAL_INFERENCE swap pattern.

## Out of Scope

- Migration of existing fine-grained source language values to coarse codes. Per user direction, dropdown shows empty/first-item, user re-picks once.
- Auto-toggling participant mode based on source language validity.
- Adding "Auto detect" back via some explicit fallback — translate's `sourceLanguage` is a real settings field used by participant config, not a UI hint anymore.
- Restricted `targetLanguages` lists for other providers; the generalization is opportunistic but only OPENAI_TRANSLATE benefits from the new behavior.

## Risks

- **Sparse name coverage**: a few of the 75 codes (Dzongkha, Hawaiian, Latin, Yoruba) have less standardized native-script representations; we accept the picks above as best-effort.
- **Future API list expansion**: if OpenAI adds more source languages, we'd need to update the static list; users won't auto-receive new options. Acceptable since the list changes infrequently.
- **i18n drift**: 30 locales need the new warning key; sticking to the existing pattern (English authored manually, others via Python script) keeps maintenance load bounded.
