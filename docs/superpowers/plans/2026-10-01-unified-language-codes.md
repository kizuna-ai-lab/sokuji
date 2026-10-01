# Unified Language Codes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One app-wide language code (canonical BCP-47 plus `auto` and `a+b`) everywhere outside a provider, display names from CLDR in the UI language, each provider mapping app ⇄ vendor codes internally, and one global language pair.

**Architecture:** A new `src/lib/language/` module owns the code grammar (`code.ts`), display names (`label.ts`, `useLanguageLabel.ts`) and the vendor table helper (`wire.ts`). Every provider's `languages` object gains a `wire` table and offers only app codes; `LanguageOption` shrinks to `{ value }`. `providerStore` keeps one pair intent under `settings.common.sourceLanguage/targetLanguage` and derives each provider's shown pair from it without writing back.

**Tech Stack:** TypeScript (strict), React 18, Zustand, Vitest + jsdom, `Intl.DisplayNames` / `Intl.getCanonicalLocales` (ICU in Node, Electron 40's Chromium and Chrome).

**Spec:** `docs/superpowers/specs/2026-10-01-unified-language-codes-design.md` (read it first; this plan argues from it).

## Global Constraints

- App code grammar: a canonical BCP-47 tag (exactly `Intl.getCanonicalLocales(tag)[0]`, primary subtag 2–3 letters), or `auto`, or `a+b` with both sides canonical tags.
- Canonical means Intl's canonical form, aliases included: `tl` is written `fil`, `cantonese` is written `yue`, `zh_CN` is written `zh-CN`.
- A vendor code is never canonicalized blindly. Palabra `es-ch` is `es-CL` (Chile), `es-la` is `es-419` (Latin America); Doubao `sh-CN` is `wuu`, `zhen` is `zh+en`, `yue-CN` is `yue`.
- Display names follow the UI language via `Intl.DisplayNames`, first letter upper-cased with `toLocaleUpperCase(ui)`; `auto` uses the i18n key `common.autoDetect`; `a+b` renders `A ⇄ B`.
- No migration code: per-provider pairs stored under `settings.<key>.sourceLanguage/targetLanguage` are no longer read, written or deleted.
- The global pair lives at `settings.common.sourceLanguage` / `settings.common.targetLanguage`. Only a user's pick (`setPair`) writes it; switching provider, changing settings or changing the language context never writes it.
- An unsupported side takes the provider's first option (`normalizePair`); no nearest-language fallback.
- Comments and docs in English; Conventional Commits; every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Commits use explicit pathspecs (`git add <paths>`), never `git add -A`.
- Do not push; the user pushes.
- Record failures with `reportError`/`reportWarning` (`src/lib/diagnostics/report.ts`), never `console.error`/`console.warn`; this plan adds no new failure paths.

## Review Focus

1. A Palabra or Soniox server reporting a language outside our table (e.g. Palabra detects `ka` under an `auto` source): `fromWire` returns `null`, the segment carries no `language`, nothing throws. Pinned in Task 9 and Task 10.
2. A stored global pair that names a code the selected provider lacks (picked `zh+en` on Doubao, then switched to Soniox): the shown pair is the provider's first source and first target for it, storage is untouched, and switching back shows `zh+en` again. Pinned in Task 13.
3. A UI language whose i18next id uses an underscore (`zh_TW`, `pt_BR`): labels come out in that locale, not English. Pinned in Task 2.
4. Tests that mock `react-i18next` without an `i18n` object (107 files do): `useLanguageLabel` must fall back to English, not throw. Pinned in Task 2.
5. Local Inference with Cantonese selected and a Whisper-WebGPU ASR model: Whisper's table has neither `yue` nor `cantonese`, so the worker must omit the language (auto-detect) instead of throwing. Pinned in Task 4.

---

## File Structure

**Create**
- `src/lib/language/code.ts` — `LanguageCode`, `AUTO`, `parseCode`, `canonicalTag`, `pairCode`, `baseLanguage`.
- `src/lib/language/label.ts` — `uiLocale`, `languageLabel`, `englishLanguageName`, the empty `OVERRIDES` map.
- `src/lib/language/useLanguageLabel.ts` — React hook over `languageLabel` with the current i18n language.
- `src/lib/language/wire.ts` — `WireTable`, `WireRow`, `wireTable`, `identityWire`.
- `src/lib/language/index.ts` — re-exports.
- Tests beside each: `code.test.ts`, `label.test.ts`, `useLanguageLabel.test.tsx`, `wire.test.ts`.

**Modify (by task)**
- Task 4: `src/utils/languages.ts`, `src/lib/local-inference/modelManifest.ts`, `src/lib/local-inference/native/nativeCatalog.ts`, `src/lib/local-inference/workers/_shared/qwen3-asr-prompt.ts`, `src/lib/local-inference/workers/whisper-webgpu.worker.ts`, `src/lib/local-inference/workers/translategemma-translation.worker.ts`, `src/lib/local-inference/workers/hy-mt-translation.worker.ts`, `src/utils/splitSentences.ts`, `src/lib/segmentation/PunctuationRuntime.ts`, `src/providers/localInference/sentenceCut.ts`, `src/lib/edge-tts/voiceList.ts`, `src/lib/tts/previewSample.ts`, `src/lib/bing-translator/languageMap.ts`, tests that pin `cantonese`/`tl`.
- Task 5: `src/lib/provider/types.ts`, `src/lib/provider/languages.ts`, UI readers (`LanguagePairSection.tsx`, `StepLanguagePair.tsx`, `StepFinish.tsx`, `languageDefaults.ts`, `PanelFooter.tsx`, `engine/languageName.ts`, `lib/view/noticeText.ts`), `modelManifest.ts` sort.
- Tasks 6–11: one provider directory each.
- Task 12: `types.ts` (final shape), `src/utils/languages.ts`, `src/services/providers/LocalNativeProviderConfig.ts`, `src/providers/registry.test.ts`.
- Task 13: `src/stores/providerStore.ts` and its tests.
- Task 14: verification only.

---

### Task 0: Worktree setup

**Files:** none committed.

- [ ] **Step 1: Link node_modules from the main checkout**

```bash
cd /home/jiangzhuo/Desktop/kizunaai/sokuji/.claude/worktrees/unify-language-codes
ln -s ../../../node_modules node_modules
ls node_modules/.bin/vitest
```
Expected: the path prints.

- [ ] **Step 2: Baseline the suite and the type check**

```bash
npx vitest run 2>&1 | tail -5
npx tsc --noEmit -p tsconfig.json 2>&1 | tail -5
```
Expected: record the pass/fail counts and any pre-existing type errors in your notes; later tasks must not add to them.

---

### Task 1: The app code — `src/lib/language/code.ts`

**Files:**
- Create: `src/lib/language/code.ts`, `src/lib/language/index.ts`
- Test: `src/lib/language/code.test.ts`

**Interfaces:**
- Produces:
  - `type LanguageCode = string`
  - `const AUTO = 'auto'`
  - `type ParsedCode = { kind: 'auto' } | { kind: 'tag'; tag: string } | { kind: 'pair'; a: string; b: string }`
  - `parseCode(code: string): ParsedCode | null`
  - `canonicalTag(tag: string): string` (throws `RangeError` on a malformed tag)
  - `pairCode(a: string, b: string): LanguageCode`
  - `baseLanguage(code: LanguageCode): string | null`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/language/code.test.ts
import { describe, expect, it } from 'vitest';
import { AUTO, baseLanguage, canonicalTag, pairCode, parseCode } from './code';

describe('parseCode', () => {
  it('reads a canonical tag', () => {
    expect(parseCode('zh-Hant')).toEqual({ kind: 'tag', tag: 'zh-Hant' });
    expect(parseCode('zh-TW')).toEqual({ kind: 'tag', tag: 'zh-TW' });
    expect(parseCode('es-419')).toEqual({ kind: 'tag', tag: 'es-419' });
    expect(parseCode('yue')).toEqual({ kind: 'tag', tag: 'yue' });
    expect(parseCode('mul')).toEqual({ kind: 'tag', tag: 'mul' });
  });

  it('reads auto and a bidirectional pair', () => {
    expect(parseCode(AUTO)).toEqual({ kind: 'auto' });
    expect(parseCode('zh+en')).toEqual({ kind: 'pair', a: 'zh', b: 'en' });
  });

  it('refuses anything not written canonically', () => {
    for (const bad of ['', 'zh_CN', 'zh-hant', 'ZH', 'cantonese', 'tl', 'Auto', 'zh+en+ja', 'auto+en', 'zh+', '+en', 'zh+en-us']) {
      expect(parseCode(bad), bad).toBeNull();
    }
  });
});

describe('canonicalTag', () => {
  it("returns Intl's canonical form, aliases included", () => {
    expect(canonicalTag('zh-hant')).toBe('zh-Hant');
    expect(canonicalTag('en-us')).toBe('en-US');
    expect(canonicalTag('tl')).toBe('fil');
  });

  it('throws on a malformed tag', () => {
    expect(() => canonicalTag('zh_CN')).toThrow(RangeError);
    expect(() => canonicalTag('cantonese')).toThrow(RangeError);
  });
});

describe('pairCode and baseLanguage', () => {
  it('joins two tags with +', () => {
    expect(pairCode('zh', 'en')).toBe('zh+en');
  });

  it('answers the primary subtag of a tag, auto for auto, null for a pair', () => {
    expect(baseLanguage('zh-Hant-TW')).toBe('zh');
    expect(baseLanguage('yue')).toBe('yue');
    expect(baseLanguage(AUTO)).toBe(AUTO);
    expect(baseLanguage('zh+en')).toBeNull();
    expect(baseLanguage('zh_CN')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/language/code.test.ts`
Expected: FAIL, "Failed to resolve import ./code".

- [ ] **Step 3: Implement**

```ts
// src/lib/language/code.ts
/**
 * The one language code the app uses outside a provider (spec
 * `2026-10-01-unified-language-codes-design.md` §1): a canonical BCP-47 tag
 * (`zh-Hant`, `zh-TW`, `yue`, `pt-BR`, `mul`), `auto`, or `a+b` for a
 * bidirectional pair. The two extensions cannot be BCP-47 tags: a
 * four-letter primary subtag is reserved, and `+` is not a BCP-47 character.
 */
export type LanguageCode = string;

/** The source value that asks the provider to detect the language. Never a target. */
export const AUTO = 'auto';

export type ParsedCode =
  | { kind: 'auto' }
  | { kind: 'tag'; tag: string }
  | { kind: 'pair'; a: string; b: string };

/** A primary subtag of 2–3 letters, then any well-formed subtags; the rest is Intl's to judge. */
const TAG_SHAPE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/;

function canonical(tag: string): string | null {
  if (!TAG_SHAPE.test(tag)) return null;
  try {
    return Intl.getCanonicalLocales(tag)[0] ?? null;
  } catch {
    return null;
  }
}

/** Intl's canonical spelling of a BCP-47 tag, aliases replaced (`tl` → `fil`). For building tables and tests, never for reading a vendor's code. */
export function canonicalTag(tag: string): string {
  const c = canonical(tag);
  if (c === null) throw new RangeError(`Not a BCP-47 language tag: "${tag}"`);
  return c;
}

/** The code's form, or null when it is not written exactly as an app code. */
export function parseCode(code: string): ParsedCode | null {
  if (code === AUTO) return { kind: 'auto' };
  const parts = code.split('+');
  if (parts.length === 2) {
    const [a, b] = parts;
    return canonical(a) === a && canonical(b) === b ? { kind: 'pair', a, b } : null;
  }
  if (parts.length !== 1) return null;
  return canonical(code) === code ? { kind: 'tag', tag: code } : null;
}

/** A bidirectional pair's code. */
export function pairCode(a: string, b: string): LanguageCode {
  return `${a}+${b}`;
}

/** The primary language subtag (`zh-Hant-TW` → `zh`); `auto` for `auto`; null for a pair or a code that is not an app code. */
export function baseLanguage(code: LanguageCode): string | null {
  const parsed = parseCode(code);
  if (parsed === null || parsed.kind === 'pair') return null;
  if (parsed.kind === 'auto') return AUTO;
  return parsed.tag.split('-')[0];
}
```

```ts
// src/lib/language/index.ts
export * from './code';
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/lib/language/code.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/language/code.ts src/lib/language/code.test.ts src/lib/language/index.ts
git commit -m "feat(language): the app's one language code — BCP-47, auto, a+b

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Display names — `label.ts` and `useLanguageLabel`

**Files:**
- Create: `src/lib/language/label.ts`, `src/lib/language/useLanguageLabel.ts`
- Modify: `src/lib/language/index.ts`
- Test: `src/lib/language/label.test.ts`, `src/lib/language/useLanguageLabel.test.tsx`

**Interfaces:**
- Consumes: `parseCode`, `AUTO`, `LanguageCode` (Task 1).
- Produces:
  - `uiLocale(i18nLanguage: string | undefined | null): string` — i18next id → BCP-47 locale, `'en'` when absent or malformed.
  - `languageLabel(code: LanguageCode, uiLanguage: string | undefined | null, autoLabel?: string): string`
  - `englishLanguageName(code: LanguageCode): string`
  - `useLanguageLabel(): (code: LanguageCode) => string`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/language/label.test.ts
import { describe, expect, it } from 'vitest';
import { englishLanguageName, languageLabel, uiLocale } from './label';

describe('uiLocale', () => {
  it("turns an i18next id into a BCP-47 locale, English when there is none", () => {
    expect(uiLocale('zh_TW')).toBe('zh-TW');
    expect(uiLocale('pt_BR')).toBe('pt-BR');
    expect(uiLocale('ja')).toBe('ja');
    expect(uiLocale(undefined)).toBe('en');
    expect(uiLocale('cimode')).toBe('en');
  });
});

describe('languageLabel', () => {
  // Never a pinned CLDR string: ICU differs between Node and Chromium versions.
  const named = (code: string, ui: string) => {
    const label = languageLabel(code, ui);
    expect(label, `${code} in ${ui}`).not.toBe('');
    expect(label, `${code} in ${ui}`).not.toBe(code);
    return label;
  };

  it('names a tag in the UI language, script and region kept apart', () => {
    for (const ui of ['en', 'ja', 'zh_CN', 'zh_TW', 'ko', 'es']) {
      const hant = named('zh-Hant', ui);
      const tw = named('zh-TW', ui);
      expect(hant).not.toBe(tw);
      named('yue', ui);
      named('mul', ui);
    }
  });

  it('follows the UI language', () => {
    expect(languageLabel('ja', 'en')).not.toBe(languageLabel('ja', 'zh_CN'));
  });

  it('starts with a capital in the UI language', () => {
    const es = languageLabel('es', 'es');
    expect(es[0]).toBe(es[0].toLocaleUpperCase('es'));
  });

  it("names auto with the caller's words, and a pair as A ⇄ B", () => {
    expect(languageLabel('auto', 'en', 'Auto Detect')).toBe('Auto Detect');
    expect(languageLabel('zh+en', 'en')).toBe(`${languageLabel('zh', 'en')} ⇄ ${languageLabel('en', 'en')}`);
  });

  it('falls back to the code for anything it cannot name', () => {
    expect(languageLabel('zh_CN', 'en')).toBe('zh_CN');
    expect(languageLabel('', 'en')).toBe('');
  });

  it('names in English for the instructions', () => {
    expect(englishLanguageName('ja')).toBe(languageLabel('ja', 'en'));
  });
});
```

```tsx
// src/lib/language/useLanguageLabel.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const translation = vi.hoisted(() => ({ value: { t: (key: string, fallback?: string) => fallback ?? key } as Record<string, unknown> }));
vi.mock('react-i18next', () => ({ useTranslation: () => translation.value }));

import { languageLabel } from './label';
import { useLanguageLabel } from './useLanguageLabel';

describe('useLanguageLabel', () => {
  it('names in English when the mock carries no i18n object', () => {
    translation.value = { t: (key: string, fallback?: string) => fallback ?? key };
    const { result } = renderHook(() => useLanguageLabel());
    expect(result.current('ja')).toBe(languageLabel('ja', 'en'));
  });

  it("names in i18n's language, and auto with common.autoDetect", () => {
    translation.value = { t: (key: string) => (key === 'common.autoDetect' ? '自動検出' : key), i18n: { language: 'ja' } };
    const { result } = renderHook(() => useLanguageLabel());
    expect(result.current('en')).toBe(languageLabel('en', 'ja'));
    expect(result.current('auto')).toBe('自動検出');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/lib/language/label.test.ts src/lib/language/useLanguageLabel.test.tsx`
Expected: FAIL, unresolved imports.

- [ ] **Step 3: Implement**

```ts
// src/lib/language/label.ts
/**
 * Language names (spec §2): any app code named in the UI language from
 * CLDR, via `Intl.DisplayNames`. No hand-written per-provider names.
 */
import { parseCode, type LanguageCode } from './code';

/**
 * A CLDR name that is wrong for us, by tag and then UI locale (or its base
 * language). Ships empty; every entry needs a stated reason in a comment.
 */
const OVERRIDES: Readonly<Record<string, Readonly<Record<string, string>>>> = {};

const namers = new Map<string, Intl.DisplayNames | null>();

function namer(locale: string): Intl.DisplayNames | null {
  if (!namers.has(locale)) {
    try {
      namers.set(locale, new Intl.DisplayNames([locale], { type: 'language' }));
    } catch {
      namers.set(locale, null);
    }
  }
  return namers.get(locale) ?? null;
}

/** An i18next language id (`zh_TW`, `pt_BR`, `ja`) as a BCP-47 locale; English when absent or not a locale (`cimode`). */
export function uiLocale(i18nLanguage: string | undefined | null): string {
  const id = (i18nLanguage ?? '').replace(/_/g, '-');
  if (!/^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/.test(id)) return 'en';
  try {
    return Intl.getCanonicalLocales(id)[0] ?? 'en';
  } catch {
    return 'en';
  }
}

/** `code` named in `uiLanguage` (an i18next id). `auto` takes `autoLabel`; `a+b` reads `A ⇄ B`; a code it cannot name stays the code. */
export function languageLabel(code: LanguageCode, uiLanguage: string | undefined | null, autoLabel = 'Auto Detect'): string {
  const ui = uiLocale(uiLanguage);
  const parsed = parseCode(code);
  if (parsed === null) return code;
  if (parsed.kind === 'auto') return autoLabel;
  if (parsed.kind === 'pair') return `${languageLabel(parsed.a, ui)} ⇄ ${languageLabel(parsed.b, ui)}`;
  const override = OVERRIDES[parsed.tag]?.[ui] ?? OVERRIDES[parsed.tag]?.[ui.split('-')[0]];
  if (override) return override;
  let name: string | undefined;
  try {
    name = namer(ui)?.of(parsed.tag);
  } catch {
    name = undefined;
  }
  if (!name || name === parsed.tag) return code;
  // CLDR's names are mid-sentence forms ("español", "norsk"); a menu starts them capitalized.
  return name.charAt(0).toLocaleUpperCase(ui) + name.slice(1);
}

/** The code's English name, for instruction templates and logs. */
export function englishLanguageName(code: LanguageCode): string {
  return languageLabel(code, 'en');
}
```

```ts
// src/lib/language/useLanguageLabel.ts
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { LanguageCode } from './code';
import { languageLabel } from './label';

/**
 * Names codes in the language the UI is shown in. Many suites mock
 * `react-i18next` with `t` alone: no `i18n` reads as English.
 */
export function useLanguageLabel(): (code: LanguageCode) => string {
  const { t, i18n } = useTranslation() as { t: (key: string, fallback?: string) => string; i18n?: { language?: string } };
  const ui = i18n?.language ?? 'en';
  const auto = t('common.autoDetect', 'Auto Detect');
  return useCallback((code: LanguageCode) => languageLabel(code, ui, auto), [ui, auto]);
}
```

```ts
// src/lib/language/index.ts
export * from './code';
export * from './label';
export * from './useLanguageLabel';
```

- [ ] **Step 4: Run them to verify they pass**

Run: `npx vitest run src/lib/language/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/language/label.ts src/lib/language/label.test.ts src/lib/language/useLanguageLabel.ts src/lib/language/useLanguageLabel.test.tsx src/lib/language/index.ts
git commit -m "feat(language): name any code in the UI language from CLDR

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Vendor tables — `wire.ts`

**Files:**
- Create: `src/lib/language/wire.ts`
- Modify: `src/lib/language/index.ts`
- Test: `src/lib/language/wire.test.ts`

**Interfaces:**
- Consumes: `LanguageCode`, `parseCode` (Task 1).
- Produces:
  - `type WireRow = readonly [LanguageCode] | readonly [LanguageCode, string]`
  - `interface WireTable { toWire(code: LanguageCode): string; fromWire(raw: string | null | undefined): LanguageCode | null; readonly codes: readonly LanguageCode[] }`
  - `wireTable(rows: readonly WireRow[]): WireTable`
  - `identityWire(): WireTable` — for a provider that never sends a code: `toWire` returns any app code unchanged, `fromWire` returns a raw value that is an app code, else null; `codes` is empty.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/language/wire.test.ts
import { describe, expect, it } from 'vitest';
import { identityWire, wireTable } from './wire';

describe('wireTable', () => {
  const t = wireTable([['en'], ['es-CL', 'es-ch'], ['zh+en', 'zhen']]);

  it('maps app codes to vendor codes and back', () => {
    expect(t.toWire('en')).toBe('en');
    expect(t.toWire('es-CL')).toBe('es-ch');
    expect(t.toWire('zh+en')).toBe('zhen');
    expect(t.fromWire('es-ch')).toBe('es-CL');
    expect(t.codes).toEqual(['en', 'es-CL', 'zh+en']);
  });

  it('reads a vendor code whatever its case', () => {
    expect(t.fromWire('ES-CH')).toBe('es-CL');
    expect(t.fromWire('ZHEN')).toBe('zh+en');
  });

  it('answers null for a vendor code it does not know, or none', () => {
    expect(t.fromWire('ka')).toBeNull();
    expect(t.fromWire('')).toBeNull();
    expect(t.fromWire(undefined)).toBeNull();
  });

  it('throws on an app code it does not hold: a build is only handed an offered code', () => {
    expect(() => t.toWire('ja')).toThrow(RangeError);
  });

  it('refuses a table that is not one-to-one, or holds a non-app code', () => {
    expect(() => wireTable([['en'], ['en', 'en-us']])).toThrow(/Duplicate app code/);
    expect(() => wireTable([['en', 'x'], ['ja', 'X']])).toThrow(/Duplicate vendor code/);
    expect(() => wireTable([['zh_CN']])).toThrow(/Not an app code/);
  });
});

describe('identityWire', () => {
  it('sends an app code as itself and reads back only app codes', () => {
    const t = identityWire();
    expect(t.toWire('zh-TW')).toBe('zh-TW');
    expect(t.fromWire('zh-TW')).toBe('zh-TW');
    expect(t.fromWire('zh_TW')).toBeNull();
    expect(() => t.toWire('zh_TW')).toThrow(RangeError);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/language/wire.test.ts`
Expected: FAIL, unresolved import.

- [ ] **Step 3: Implement**

```ts
// src/lib/language/wire.ts
/**
 * A provider's two-way table between app codes and its vendor's codes
 * (spec §3). A row of one element means the two are the same.
 */
import { parseCode, type LanguageCode } from './code';

export type WireRow = readonly [LanguageCode] | readonly [LanguageCode, string];

export interface WireTable {
  /** The vendor's code. Throws on a code the table lacks: a build is only ever handed an offered code. */
  toWire(code: LanguageCode): string;
  /** The app code for a code the vendor reported, whatever its case; null for one the table lacks, or none. */
  fromWire(raw: string | null | undefined): LanguageCode | null;
  /** Every app code the table holds, in row order. */
  readonly codes: readonly LanguageCode[];
}

export function wireTable(rows: readonly WireRow[]): WireTable {
  const out = new Map<LanguageCode, string>();
  const back = new Map<string, LanguageCode>();
  const codes: LanguageCode[] = [];
  for (const row of rows) {
    const code = row[0];
    const wire = row.length === 2 ? row[1] : row[0];
    if (parseCode(code) === null) throw new Error(`Not an app code: "${code}"`);
    if (out.has(code)) throw new Error(`Duplicate app code: "${code}"`);
    const key = wire.toLowerCase();
    if (back.has(key)) throw new Error(`Duplicate vendor code: "${wire}"`);
    out.set(code, wire);
    back.set(key, code);
    codes.push(code);
  }
  return {
    codes,
    toWire(code) {
      const wire = out.get(code);
      if (wire === undefined) throw new RangeError(`No vendor code for "${code}"`);
      return wire;
    },
    fromWire(raw) {
      if (!raw) return null;
      return back.get(raw.toLowerCase()) ?? null;
    },
  };
}

/** For a provider that never sends a language code (OpenAI Realtime and Live, Local Inference, the fake). */
export function identityWire(): WireTable {
  return {
    codes: [],
    toWire(code) {
      if (parseCode(code) === null) throw new RangeError(`Not an app code: "${code}"`);
      return code;
    },
    fromWire(raw) {
      return raw && parseCode(raw) !== null ? raw : null;
    },
  };
}
```

Append to `src/lib/language/index.ts`:
```ts
export * from './wire';
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/lib/language/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/language/wire.ts src/lib/language/wire.test.ts src/lib/language/index.ts
git commit -m "feat(language): a provider's two-way table between app and vendor codes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Local vocabulary — `cantonese` → `yue`, `tl` → `fil`

**Files:**
- Modify: `src/utils/languages.ts:55-62,74`, `src/lib/local-inference/modelManifest.ts` (every `'cantonese'` inside a `languages` array, the comment at :3338-3343, `'tl'` at :3280 and :3310), `src/lib/local-inference/native/nativeCatalog.ts:9-22`, `src/lib/local-inference/workers/_shared/qwen3-asr-prompt.ts:80-92`, `src/lib/local-inference/workers/whisper-webgpu.worker.ts:327-330`, `src/lib/local-inference/workers/translategemma-translation.worker.ts:103-104`, `src/lib/local-inference/workers/hy-mt-translation.worker.ts:27`, `src/utils/splitSentences.ts:7-19`, `src/lib/segmentation/PunctuationRuntime.ts:53-66`, `src/providers/localInference/sentenceCut.ts:23`, `src/lib/edge-tts/voiceList.ts:14-30`, `src/lib/tts/previewSample.ts:51`, `src/lib/bing-translator/languageMap.ts:10,23`
- Test: the suites that pin either spelling (found in Step 1)

**Interfaces:**
- Produces: the local vocabulary uses `yue` and `fil`; nothing outside a worker sees `cantonese` or `tl`.

- [ ] **Step 1: Find every pinned spelling**

```bash
grep -rln "cantonese\|'tl'\|\btl:" src | sort
```
Expected: the source files listed above plus their tests. Keep the list; every file in it is edited in this task except `modelManifest.ts:2921` (`id: 'cantonese'` is a model id, not a language — leave the id).

- [ ] **Step 2: Write the failing tests**

Add to `src/lib/local-inference/workers/_shared/qwen3-asr-prompt.test.ts`, inside `describe('normalizeLangForPrefix', …)` (the file's fixture `cfg` holds only `ja` and `zh` prefixes, so this case widens it):

```ts
it('takes the app codes for Cantonese and Filipino as they are', () => {
  const withBoth = { ...cfg, language_prefix_ids: { ...cfg.language_prefix_ids, yue: [1], fil: [2] } };
  expect(normalizeLangForPrefix('yue', withBoth)).toBe('yue');
  expect(normalizeLangForPrefix('fil', withBoth)).toBe('fil');
  expect(normalizeLangForPrefix('cantonese', withBoth)).toBeUndefined();
});
```

Add to `src/lib/local-inference/native/nativeCatalog.test.ts`:

```ts
it('matches the app codes yue and fil against catalog rows directly', () => {
  expect(supportsLanguage({ languages: ['zh', 'yue'] }, 'yue')).toBe(true);
  expect(supportsLanguage({ languages: ['fil'] }, 'fil')).toBe(true);
  expect(supportsLanguage({ languages: ['zh'] }, 'yue')).toBe(false);
});
```

Add to `src/lib/segmentation/PunctuationRuntime.test.ts`:

```ts
it('routes yue to FireRedPunc', () => {
  expect(modelForLanguage('yue')).toBe('fireredpunc');
});
```

Create `src/lib/local-inference/workers/whisperLanguage.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { whisperLanguage } from './whisperLanguage';

describe('whisperLanguage', () => {
  it("passes a two-letter base language, and nothing for a code Whisper's table lacks", () => {
    expect(whisperLanguage('ja')).toBe('ja');
    expect(whisperLanguage('zh-Hant')).toBe('zh');
    expect(whisperLanguage('yue')).toBeUndefined();
    expect(whisperLanguage('fil')).toBeUndefined();
    expect(whisperLanguage('auto')).toBeUndefined();
    expect(whisperLanguage(undefined)).toBeUndefined();
  });
});
```

Add to `src/utils/languages` tests (create `src/utils/languages.test.ts` if it does not exist):

```ts
import { describe, expect, it } from 'vitest';
import { LANGUAGE_CODES, LANGUAGE_PRIORITY } from './languages';
import { parseCode } from '../lib/language/code';

describe('the local vocabulary', () => {
  it('is app codes only', () => {
    for (const code of LANGUAGE_CODES) expect(parseCode(code), code).not.toBeNull();
    for (const code of LANGUAGE_PRIORITY) expect(parseCode(code), code).not.toBeNull();
    expect(LANGUAGE_CODES).toContain('yue');
    expect(LANGUAGE_CODES).toContain('fil');
    expect(LANGUAGE_CODES).not.toContain('cantonese');
    expect(LANGUAGE_CODES).not.toContain('tl');
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run src/lib/local-inference/workers src/lib/local-inference/native/nativeCatalog.test.ts src/lib/segmentation/PunctuationRuntime.test.ts src/utils/languages.test.ts`
Expected: FAIL (`whisperLanguage` missing, `LANGUAGE_CODES` missing).

- [ ] **Step 4: Implement**

`src/utils/languages.ts` — keep the file's existing `LANGUAGE_OPTIONS` map for now (Task 12 removes it), but: rename the key `tl` to `fil` with `{ name: 'Filipino', value: 'fil', englishName: 'Filipino' }`, rename `cantonese` to `yue` with `{ name: '粵語', value: 'yue', englishName: 'Cantonese' }`, and add below the map:

```ts
/** Every code of the local vocabulary: app codes (spec §7). */
export const LANGUAGE_CODES: readonly string[] = Object.keys(LANGUAGE_OPTIONS);
```

In `LANGUAGE_PRIORITY` replace `'tl'` with `'fil'`.

`src/lib/local-inference/modelManifest.ts`:
```bash
sed -i "s/'cantonese'\]/'yue']/; s/'cantonese', /'yue', /g; s/languages: \['cantonese'\]/languages: ['yue']/" src/lib/local-inference/modelManifest.ts
sed -i "3270,3320s/'tl'/'fil'/" src/lib/local-inference/modelManifest.ts
grep -n "cantonese\|'tl'" src/lib/local-inference/modelManifest.ts
```
Expected: only the model id at :2921 (`id: 'cantonese'`), its `cdnPath`/`modelFile`, and the comment at :3338. Rewrite that comment to:
```ts
    // 'yue': ModelManifestEntry.languages uses the app's codes
    // (src/utils/languages.ts), and modelManifest.qwen3Asr.test.ts pins
    // the rule for a sibling entry in this same array.
```

`src/lib/local-inference/native/nativeCatalog.ts` — the picker now emits `yue`/`fil`, which is what catalog rows use. Replace the alias block with:
```ts
/** `jap` is an old catalog spelling of Japanese; app codes (`yue`, `fil`) need no alias. */
const LANG_ALIASES: Record<string, string> = {
  jap: 'ja',
};
```
and update the comment above it to say the picker emits app codes.

`src/lib/local-inference/workers/_shared/qwen3-asr-prompt.ts:81`:
```ts
/** Old spellings some callers still send; app codes (`yue`, `fil`) are the prefix table's own. */
const LANG_ALIASES: Record<string, string> = { jap: 'ja' };
```

Create `src/lib/local-inference/workers/whisperLanguage.ts`:
```ts
/**
 * The language to hand transformers.js's Whisper, or undefined to let it
 * detect: its table is two-letter codes (it throws "Language … is not
 * supported" on `yue`, `cantonese`, `fil`), so only a two-letter base goes.
 */
export function whisperLanguage(code: string | undefined | null): string | undefined {
  if (!code || code === 'auto') return undefined;
  const base = code.split(/[-_]/)[0].toLowerCase();
  return /^[a-z]{2}$/.test(base) ? base : undefined;
}
```
In `whisper-webgpu.worker.ts:327-330` replace the `if (currentLanguage)` block with:
```ts
    const language = whisperLanguage(currentLanguage);
    if (language) {
      options.language = language;
      options.task = 'transcribe';
    }
```
and import `whisperLanguage` from `./whisperLanguage`.

`translategemma-translation.worker.ts:103-104` — TranslateGemma's list was written with its own `tl`; keep sending exactly that:
```ts
/** TranslateGemma's own spelling where it differs from the app code (its list was written with `tl`). */
const TRANSLATEGEMMA_CODES: Record<string, string> = { fil: 'tl' };
const gemmaCode = (code: string) => TRANSLATEGEMMA_CODES[code] ?? code;
```
and pass `source_lang_code: gemmaCode(msg.sourceLang)`, `target_lang_code: gemmaCode(msg.targetLang)`.

`hy-mt-translation.worker.ts:27`: rename the key `tl: 'Filipino'` to `fil: 'Filipino'`.

`src/utils/splitSentences.ts` — app codes are BCP-47 already: delete `LOCALE_ALIASES` and make `toBcp47` return `locale.replace(/_/g, '-')`; update its comment to "App codes are BCP-47; an underscore form is still accepted from callers outside the app vocabulary."

`src/lib/segmentation/PunctuationRuntime.ts:53-66` — replace the Cantonese paragraph of the comment with "Cantonese is `yue`, the app code, and a provider's detected language uses the same tag." and the condition with `if (base === 'zh' || base === 'yue') return 'fireredpunc';`.

`src/providers/localInference/sentenceCut.ts:23`: `if (base === 'zh' || base === 'yue') return 'fireredpunc';`

`src/lib/edge-tts/voiceList.ts`: rename the `LOCALE_RULES` key `cantonese` to `yue` and change the doc comment's "our `cantonese` → `zh-HK`" to "our `yue` → `zh-HK`" and "offered under `cantonese`" to "offered under `yue`".

`src/lib/tts/previewSample.ts:51`: rename the key `tl` to `fil`.

`src/lib/bing-translator/languageMap.ts`: delete the `'cantonese': 'yue'` override line and the `'cantonese'` entry in `BING_SUPPORTED_LANGUAGES` (`yue` and `fil` are already listed).

- [ ] **Step 5: Update the tests that pinned the old spellings**

For every test file from Step 1's list, replace a language value `'cantonese'` with `'yue'` and a language value `'tl'` with `'fil'` (not the model id `'cantonese'`), and drop assertions whose only purpose was the alias (e.g. "maps cantonese to yue" cases in `qwen3-asr-prompt.test.ts`, `nativeCatalog.test.ts`, `splitSentences` tests, `languageMap.test.ts`). In `modelManifest.qwen3Asr.test.ts`, the assertion that the row uses `cantonese` becomes that it uses `yue`.

- [ ] **Step 6: Run the affected suites and the type check**

```bash
npx vitest run src/lib/local-inference src/lib/segmentation src/utils src/lib/edge-tts src/lib/tts src/lib/bing-translator src/providers/localInference
npx tsc --noEmit -p tsconfig.json
grep -rn "cantonese\|'tl'" src --include='*.ts' --include='*.tsx' | grep -v "id: 'cantonese'\|wasm-cantonese\|vits-cantonese"
```
Expected: PASS; no new type errors; the grep prints nothing.

- [ ] **Step 7: Commit**

```bash
git add src/utils/languages.ts src/utils/languages.test.ts src/utils/splitSentences.ts src/lib/local-inference src/lib/segmentation/PunctuationRuntime.ts src/lib/segmentation/PunctuationRuntime.test.ts src/providers/localInference/sentenceCut.ts src/lib/edge-tts/voiceList.ts src/lib/tts/previewSample.ts src/lib/bing-translator/languageMap.ts
git add $(git diff --name-only -- '*.test.ts' '*.test.tsx')
git commit -m "fix(local): Cantonese is yue and Filipino is fil across the local vocabulary

Whisper now gets only a two-letter language it knows, so yue no longer throws.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Names move off the options — UI readers on `languageLabel`

`LanguageOption.name`/`englishName` become optional for this and Tasks 6–11, so providers can lose them one at a time; Task 12 deletes them. Every reader stops reading them now.

**Files:**
- Modify: `src/lib/provider/types.ts:14,318-345`, `src/lib/provider/languages.ts:11`, `src/components/providers/LanguagePairSection.tsx`, `src/components/SetupWizard/steps/StepLanguagePair.tsx`, `src/components/SetupWizard/steps/StepFinish.tsx`, `src/components/SetupWizard/languageDefaults.ts:5`, `src/components/MainPanel/panel/PanelFooter.tsx:79`, `src/components/Settings/engine/languageName.ts`, `src/lib/view/noticeText.ts:9,19-22`, `src/lib/local-inference/modelManifest.ts:3397-3435`, `src/utils/languages.ts:90-97`
- Test: `src/components/providers/LanguagePairSection.test.tsx`, `src/components/MainPanel/panel/PanelFooter.test.tsx`, `src/lib/view/noticeText.test.ts`, `src/components/SetupWizard/steps/StepLanguagePair.test.tsx`

**Interfaces:**
- Consumes: `useLanguageLabel`, `languageLabel`, `englishLanguageName`, `AUTO` (Tasks 1–2), `WireTable` (Task 3).
- Produces:
  - `interface LanguageOption { value: string; name?: string; englishName?: string }` (transitional)
  - `languages.wire?: WireTable` on `Provider` (transitional, required in Task 12)
  - `AUTO` re-exported from `src/lib/provider/languages.ts` (same value, now defined in `src/lib/language/code.ts`)

- [ ] **Step 1: Write the failing tests**

In `src/components/providers/LanguagePairSection.test.tsx` add:

```tsx
it('names each option from the code, not from the option (unified language codes)', () => {
  // The file's react-i18next mock carries no i18n object: names come out in English.
  const provider = {
    ...fakeProvider,
    languages: {
      ...fakeProvider.languages,
      sources: () => [{ value: 'zh-Hant' }, { value: 'zh-TW' }],
      targets: () => [{ value: 'zh-TW' }],
    },
  } as unknown as typeof fakeProvider;
  draw({ source: 'zh-Hant', target: 'zh-TW' }, vi.fn(), { provider });
  const texts = [...document.querySelectorAll('option')].map((o) => o.textContent);
  expect(texts).toEqual([languageLabel('zh-Hant', 'en'), languageLabel('zh-TW', 'en'), languageLabel('zh-TW', 'en')]);
  expect(languageLabel('zh-Hant', 'en')).not.toBe(languageLabel('zh-TW', 'en'));
});
```
Import `languageLabel` from `'../../lib/language/label'`.

In `src/components/MainPanel/panel/PanelFooter.test.tsx:199` change the expectation to names:
```tsx
    expect(el.textContent).toBe(`${languageLabel('ja', 'en')} → ${languageLabel('en', 'en')}`);
```
and update the test title to `'%s: reads the pair by name and calls onLanguages'`; import `languageLabel`.

In `src/lib/view/noticeText.test.ts:39-42` the names come from CLDR in English (the suite never initializes i18next):
```ts
    expect(noticeText(plainT, { code: 'no_asr', message: 'x', params: { source: 'en' } })).toBe(`No speech recognition model is installed for ${languageLabel('en', 'en')}.`);
    expect(noticeText(plainT, { code: 'no_asr', message: 'x', params: { source: 'ja' } })).toBe(`No speech recognition model is installed for ${languageLabel('ja', 'en')}.`);
```
keep the `'xx'` case (it stays `xx`) and update the comment at :44 to say "not named".

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/components/providers/LanguagePairSection.test.tsx src/components/MainPanel/panel/PanelFooter.test.tsx src/lib/view/noticeText.test.ts`
Expected: FAIL (options show `undefined`/raw codes; footer shows `ja → en`; notice shows `日本語`).

- [ ] **Step 3: Implement**

`src/lib/provider/types.ts`:
```ts
import type { WireTable } from '../language/wire';
/** A language on offer: an app code (`src/lib/language/code.ts`). `name`/`englishName` are leaving (unified language codes, Task 12); nothing reads them. */
export interface LanguageOption { value: string; name?: string; englishName?: string }
```
and inside `languages: { … }` add after `reverse?`:
```ts
    /** App codes ⇄ the vendor's (spec "Unified language codes" §3). Required once every provider has one (Task 12). */
    wire?: WireTable;
```

`src/lib/provider/languages.ts:11` — replace `export const AUTO = 'auto';` with:
```ts
/** The source value that asks the provider to detect the language. Never a target. Defined with the app code. */
export { AUTO } from '../language/code';
```
and import it for local use: `import { AUTO } from '../language/code';` at the top (TypeScript needs the local binding for `reverseSupported`).

`src/components/providers/LanguagePairSection.tsx`:
- import `useLanguageLabel` from `'../../lib/language/useLanguageLabel'`; drop `AUTO` from the `languages` import.
- inside the component: `const label = useLanguageLabel();`
- `const option = (o: LanguageOption) => <option key={o.value} value={o.value}>{label(o.value)}</option>;`
- `const sourceLanguageName = label(pair.source);` and `const targetLanguageName = label(pair.target);`

`src/components/SetupWizard/steps/StepLanguagePair.tsx`:
- import `useLanguageLabel`; `const label = useLanguageLabel();`
- replace `nameOf` with `const nameOf = (v: string) => label(v);` and its call sites `nameOf(sources, x)`/`nameOf(targets, x)` with `nameOf(x)`.
- `<option …>{nameOf(o.value)}</option>` for sources and `{label(o.value)}` for targets.
- drop `AUTO` from its import if no longer used.

`src/components/SetupWizard/steps/StepFinish.tsx`:
- import `useLanguageLabel`; `const label = useLanguageLabel();`
- `const sourceName = draft.sourceLanguage ? label(draft.sourceLanguage) : '';`
- `const targetName = draft.targetLanguage ? label(draft.targetLanguage) : '';`
- delete `nameOf` and the now-unused `AUTO` import.

`src/components/SetupWizard/languageDefaults.ts:5`: import `LanguageOption` from `'../../lib/provider/types'` instead of the legacy `ProviderConfig`.

`src/components/MainPanel/panel/PanelFooter.tsx`:
- import `useLanguageLabel`; inside the component `const label = useLanguageLabel();`
- `const languagePairText = pair ? \`${label(pair.source)} → ${label(pair.target)}\` : '';`

`src/components/Settings/engine/languageName.ts` — replace the body and the long comment's last paragraph:
```ts
import i18next from 'i18next';
import { languageLabel } from '../../../lib/language/label';

/**
 * A code's name in the UI language (unified language codes): the CLDR name
 * `languageLabel` gives every surface. Reads the i18next instance's language
 * without importing `src/locales`, whose singleton breaks the suites that
 * mock `react-i18next` (ModelManagementSection.test.tsx).
 */
export function languageNameFor(code: string): string {
  return languageLabel(code, i18next.language);
}
```

`src/lib/view/noticeText.ts`: replace the `getLanguageOption` import with `import i18next from 'i18next';` and `import { languageLabel } from '../language/label';`, and in `named()` use `languageLabel(value, i18next.language)`.

`src/utils/languages.ts:90-97` (`sortLanguageOptions`): sort unlisted codes by `englishLanguageName(a.value).localeCompare(englishLanguageName(b.value))` (import `englishLanguageName` from `'../lib/language/label'`).

- [ ] **Step 4: Run them to verify they pass, then the wider suites**

```bash
npx vitest run src/components/providers src/components/MainPanel src/components/SetupWizard src/lib/view src/components/Settings
npx tsc --noEmit -p tsconfig.json
```
Expected: PASS; no new type errors. A suite that asserted a hand-written name (`'日本語'`, `'English (USA)'`) on these surfaces is updated to `languageLabel(code, 'en')` in the same way as Step 1.

- [ ] **Step 5: Commit**

```bash
git add src/lib/provider/types.ts src/lib/provider/languages.ts src/components/providers/LanguagePairSection.tsx src/components/providers/LanguagePairSection.test.tsx src/components/SetupWizard src/components/MainPanel/panel/PanelFooter.tsx src/components/MainPanel/panel/PanelFooter.test.tsx src/components/Settings/engine/languageName.ts src/lib/view/noticeText.ts src/lib/view/noticeText.test.ts src/utils/languages.ts
git add $(git diff --name-only -- '*.test.ts' '*.test.tsx')
git commit -m "feat(language): every surface names languages from the code, in the UI language

The footer shows names instead of raw codes.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: OpenAI Realtime and OpenAI Live

**Files:**
- Create (not committed): `build/plan-tools/strip-language-names.mjs`
- Modify: `src/providers/openai/settings.ts:150-233`, `src/providers/openai_live/settings.ts:68-148`
- Test: `src/providers/openai/settings.test.ts`, `src/providers/openai_live/settings.test.ts`, `src/providers/openai/config.test.ts`, `src/providers/openai_live/config.test.ts`, `src/providers/openai/testing.ts`, `src/providers/openai_live/testing.ts` (if present)

**Interfaces:**
- Consumes: `identityWire`, `englishLanguageName`, `AUTO`.
- Produces: `realtimeLanguages.wire`, `liveLanguages.wire`; app codes `en-AU en-GB en-US es-419 pt-BR pt-PT zh-CN zh-TW`; `realtimeLanguageName`/`liveLanguageName` keep their signatures.

- [ ] **Step 1: Create the rewrite tool (used again in Tasks 7, 10)**

```js
// build/plan-tools/strip-language-names.mjs
// Usage: node build/plan-tools/strip-language-names.mjs <file> '<renames json>'
// Rewrites `{ name: '…', value: 'X', englishName: '…' }` (either key order) to
// `{ value: 'Y' }`, Y = renames[X] ?? X, and `{ value: AUTO, name, englishName }` to `{ value: AUTO }`.
import { readFileSync, writeFileSync } from 'node:fs';

const [file, renamesJson = '{}'] = process.argv.slice(2);
const renames = JSON.parse(renamesJson);
const S = "'(?:[^'\\\\]|\\\\.)*'";
const rename = (v) => renames[v] ?? v;
let text = readFileSync(file, 'utf8');
let n = 0;
text = text.replace(new RegExp(`\\{ name: ${S}, value: '([^']+)', englishName: ${S} \\}`, 'g'), (_, v) => { n++; return `{ value: '${rename(v)}' }`; });
text = text.replace(new RegExp(`\\{ value: '([^']+)', name: ${S}, englishName: ${S} \\}`, 'g'), (_, v) => { n++; return `{ value: '${rename(v)}' }`; });
text = text.replace(new RegExp(`\\{ value: AUTO, name: ${S}, englishName: ${S} \\}`, 'g'), () => { n++; return '{ value: AUTO }'; });
writeFileSync(file, text);
console.log(`${file}: ${n} options rewritten`);
```

- [ ] **Step 2: Write the failing test**

Add to `src/providers/openai/settings.test.ts`:

```ts
import { parseCode } from '../../lib/language/code';

it('offers app codes only, Chinese and English variants by region (unified language codes)', () => {
  const values = REALTIME_LANGUAGES.map((o) => o.value);
  for (const v of values) expect(parseCode(v), v).not.toBeNull();
  expect(values).toEqual(expect.arrayContaining(['zh-CN', 'zh-TW', 'en-US', 'en-GB', 'en-AU', 'es-419', 'pt-BR', 'pt-PT']));
  expect(realtimeLanguages.initial?.(REALTIME_DEFAULTS)).toEqual({ source: 'en', target: 'zh-CN' });
  expect(realtimeLanguages.wire?.toWire('zh-TW')).toBe('zh-TW');
});

it("names a code in English for the instructions, auto as 'the spoken language'", () => {
  expect(realtimeLanguageName('zh-TW')).toBe(englishLanguageName('zh-TW'));
  expect(realtimeLanguageName(AUTO)).toBe('the spoken language');
});
```
(import `englishLanguageName` from `'../../lib/language/label'`, `REALTIME_DEFAULTS` from `'./settings'` and `AUTO` from `'../../lib/provider/languages'` where the file lacks them.) Add the same two cases to `src/providers/openai_live/settings.test.ts`, written with `LIVE_LANGUAGES`, `liveLanguages`, `liveLanguageName` and `LIVE_DEFAULTS` (all exported from `src/providers/openai_live/settings.ts`).

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/providers/openai/settings.test.ts src/providers/openai_live/settings.test.ts`
Expected: FAIL (`zh_CN` values, no `wire`).

- [ ] **Step 4: Implement**

```bash
R='{"en_AU":"en-AU","en_GB":"en-GB","en_US":"en-US","es_419":"es-419","pt_BR":"pt-BR","pt_PT":"pt-PT","zh_CN":"zh-CN","zh_TW":"zh-TW"}'
node build/plan-tools/strip-language-names.mjs src/providers/openai/settings.ts "$R"
node build/plan-tools/strip-language-names.mjs src/providers/openai_live/settings.ts "$R"
```
Expected: `56 options rewritten` for each (55 + `AUTO_SOURCE`).

Then in `src/providers/openai/settings.ts`:
- `initial: () => ({ source: 'en', target: 'zh-CN' }),`
- add `wire: identityWire(),` to `realtimeLanguages` with the comment `// The pair never reaches the wire: the instructions name it, and the transcription hint takes its base language.`
- `realtimeLanguageName` becomes:
```ts
export function realtimeLanguageName(code: string): string {
  if (code === AUTO) return 'the spoken language';
  return englishLanguageName(code);
}
```
- imports: `identityWire` from `'../../lib/language/wire'`, `englishLanguageName` from `'../../lib/language/label'`.

Apply the same three edits to `src/providers/openai_live/settings.ts` (`liveLanguages`, `liveLanguageName`).

`src/providers/openai/transcription.ts:55` comment: change "(`en_AU`, `zh_CN`, `es_419` are refused)" to "(`en-AU`, `zh-CN`, `es-419` are refused)"; the function already splits on `-`.

- [ ] **Step 5: Update the provider's other tests**

```bash
grep -rln "zh_CN\|zh_TW\|en_US\|en_GB\|en_AU\|es_419\|pt_BR\|pt_PT" src/providers/openai src/providers/openai_live
```
In each listed test/testing file replace the underscore code with its hyphen form. Expectations on instruction text that read `'Chinese (China)'`/`'English (USA)'` become `englishLanguageName('zh-CN')`/`englishLanguageName('en-US')`.

- [ ] **Step 6: Run the provider suites and the type check**

```bash
npx vitest run src/providers/openai src/providers/openai_live
npx tsc --noEmit -p tsconfig.json
```
Expected: PASS; no new type errors.

- [ ] **Step 7: Commit**

```bash
git add src/providers/openai src/providers/openai_live
git commit -m "refactor(openai): Realtime and Live offer app codes and name them from CLDR

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: OpenAI Translate, the fake, Local Inference

**Files:**
- Modify: `src/providers/openai_translate/settings.ts:48-152`, `src/providers/fake/provider.ts:10-26`, `src/providers/localInference/settings.ts:56-60`, `src/lib/local-inference/modelManifest.ts:3397-3435`
- Test: `src/providers/openai_translate/settings.test.ts`, `src/providers/fake/*.test.ts`, `src/providers/localInference/settings.test.ts` (create if absent)

**Interfaces:**
- Consumes: `wireTable`, `identityWire`, `AUTO`, `parseCode`.
- Produces: `translateLanguages.wire` (a `wireTable` of its targets and sources), `FAKE_LANGUAGES.wire`, `localInferenceLanguages.wire`; `getTranslationSourceLanguages()`/`getTranslationTargetLanguages()` return `{ value }` options.

- [ ] **Step 1: Write the failing tests**

`src/providers/openai_translate/settings.test.ts`:
```ts
import { parseCode } from '../../lib/language/code';

it('offers app codes only, Filipino once (unified language codes)', () => {
  const values = [...TRANSLATE_SOURCES, ...TRANSLATE_TARGETS].map((o) => o.value);
  for (const v of values) expect(parseCode(v), v).not.toBeNull();
  expect(TRANSLATE_SOURCES.filter((o) => o.value === 'fil')).toHaveLength(1);
  expect(TRANSLATE_SOURCES.map((o) => o.value)).not.toContain('tl');
  expect(translateLanguages.wire?.toWire('zh')).toBe('zh');
});
```
Update the file's count assertion for `TRANSLATE_SOURCES` from 74 to 73 (Tagalog's row goes: CLDR names `tl` and `fil` alike, and `tl` is not canonical).

`src/providers/localInference/settings.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { parseCode } from '../../lib/language/code';
import { LOCAL_INFERENCE_DEFAULTS, localInferenceLanguages } from './settings';

describe('localInferenceLanguages', () => {
  it('offers app codes only, with no names', () => {
    const sources = localInferenceLanguages.sources(LOCAL_INFERENCE_DEFAULTS);
    for (const o of sources) {
      expect(parseCode(o.value), o.value).not.toBeNull();
      expect(o).toEqual({ value: o.value });
    }
    expect(localInferenceLanguages.wire?.toWire('yue')).toBe('yue');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/providers/openai_translate src/providers/localInference/settings.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```bash
node build/plan-tools/strip-language-names.mjs src/providers/openai_translate/settings.ts '{}'
node build/plan-tools/strip-language-names.mjs src/providers/fake/provider.ts '{}'
```
Expected: `87 options rewritten` (13 + 74) and `4 options rewritten`.

`src/providers/openai_translate/settings.ts`: delete the `{ value: 'tl' }` row; update the sources comment to "The 73 languages it hears (Tagalog's row folded into Filipino: CLDR names `tl` and `fil` alike)"; add to `translateLanguages`:
```ts
  // Its codes are the app's: the target goes out as `output.language` unchanged.
  wire: wireTable([...new Set([...TRANSLATE_TARGETS, ...TRANSLATE_SOURCES].map((o) => o.value))].map((code) => [code] as const)),
```
`src/providers/openai_translate/config.ts`: in `buildTranslate`, after the guard, send `target: translateLanguages.wire!.toWire(target),` instead of `target,`.

`src/providers/fake/provider.ts`: add `wire: identityWire(),` to `FAKE_LANGUAGES`.

`src/providers/localInference/settings.ts`: add `wire: identityWire(),` with the comment `// No vendor: each engine turns the app code into its model's own form.`

`src/lib/local-inference/modelManifest.ts:3397-3435`: replace `getLanguageOption` in both functions with `(value) => ({ value })` — i.e. `return sortLanguageOptions([...codes].map((value) => ({ value })));` — and `Object.keys(LANGUAGE_OPTIONS)` with `LANGUAGE_CODES`; update the import to `import { LANGUAGE_CODES, sortLanguageOptions } from '../../utils/languages';` and `import type { LanguageOption } from '../provider/types';` — the path is `'../provider/types'` from `src/lib/local-inference/`.

`src/utils/languages.ts` `sortLanguageOptions`: its parameter type is `LanguageOption[]` from `'../lib/provider/types'` (change the import at :1).

- [ ] **Step 4: Run them to verify they pass, and the dependents**

```bash
npx vitest run src/providers/openai_translate src/providers/fake src/providers/localInference src/lib/local-inference src/components/Settings
npx tsc --noEmit -p tsconfig.json
```
Expected: PASS; no new type errors. `src/services/providers/LocalNativeProviderConfig.ts` now fails to type-check (legacy `LanguageOption` requires `name`): fix it here by mapping its list —
```ts
      languages: getTranslationSourceLanguages().map((o) => ({ value: o.value, name: englishLanguageName(o.value), englishName: englishLanguageName(o.value) })),
```
importing `englishLanguageName` from `'../../lib/language/label'` (Local Native stays on the legacy path, #578).

- [ ] **Step 5: Commit**

```bash
git add src/providers/openai_translate src/providers/fake src/providers/localInference src/lib/local-inference/modelManifest.ts src/utils/languages.ts src/services/providers/LocalNativeProviderConfig.ts
git commit -m "refactor(providers): OpenAI Translate, Local Inference and the fake offer bare app codes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Gemini

**Files:**
- Modify: `src/providers/gemini/settings.ts:98-263`, `src/providers/gemini/config.ts:85`
- Test: `src/providers/gemini/settings.test.ts`, `src/providers/gemini/provider.test.ts`

**Interfaces:**
- Consumes: `wireTable`, `englishLanguageName`.
- Produces: `geminiLanguages.wire`; no `migratePair`; `geminiLanguageName(code) === englishLanguageName(code)`.

- [ ] **Step 1: Write the failing tests**

In `src/providers/gemini/settings.test.ts`:
- In the "hold Google's documented codes exactly" case, replace the English-name order assertion (`const rest = … .englishName … sort`) with:
```ts
      expect(list[0].value).toBe('en');
      for (const o of list) expect(o).toEqual({ value: o.value });
```
- Delete the "let a stored side the offer does not hold take initial's" case (`migratePair` is gone, spec decision 6).
- Add:
```ts
it('names a code for the instructions by its CLDR English name, and sends Google its own code', () => {
  expect(geminiLanguageName('zh-Hant')).toBe(englishLanguageName('zh-Hant'));
  expect(geminiLanguages.migratePair).toBeUndefined();
  expect(geminiLanguages.wire?.toWire('zh-Hant')).toBe('zh-Hant');
});
```
In `src/providers/gemini/provider.test.ts` delete the "loads an old profile's pair … as the default pair" case (it tests the removed `migratePair`; the global pair in Task 13 owns loading).

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/providers/gemini/settings.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Rewrite the table rows from `[value, name, englishName, documented]` to `[value, documented]`:
```bash
node -e '
const fs=require("fs");const f="src/providers/gemini/settings.ts";let t=fs.readFileSync(f,"utf8");let n=0;
t=t.replace(/\[(\x27[^\x27]+\x27), \x27(?:[^\x27\\]|\\.)*\x27, \x27(?:[^\x27\\]|\\.)*\x27, (\x27(?:both|dialogue|translate)\x27)\]/g,(_,v,d)=>{n++;return `[${v}, ${d}]`});
fs.writeFileSync(f,t);console.log(n,"rows")'
```
Expected: `101 rows`.

Then:
- the table's type: `ReadonlyArray<readonly [value: string, documented: Documented]>`; update its doc comment: drop "The names are each language's own, written here (…choice 15)" and say "Named from CLDR (unified language codes)".
- `offered`: `GEMINI_LANGUAGE_TABLE.filter((row) => documented.includes(row[1])).map(([value]) => ({ value }))`
- delete `lists` and the `migratePair` member with its comment.
- add to `geminiLanguages`: `wire: wireTable(GEMINI_LANGUAGE_TABLE.map(([value]) => [value] as const)),` with the comment `// Google's codes are BCP-47 and the app's: Live Translate's targetLanguageCode is the code itself.`
- `geminiLanguageName(code)` returns `englishLanguageName(code)`; its comment: "A code's English name, CLDR's, for the instructions' template."

`src/providers/gemini/config.ts:85`: `translationTargetCode: geminiLanguages.wire!.toWire(target),`

- [ ] **Step 4: Run the provider suite and the type check**

```bash
npx vitest run src/providers/gemini
npx tsc --noEmit -p tsconfig.json
```
Expected: PASS. Instruction-text expectations that read Google's names (`'Chinese (Traditional)'`) become `englishLanguageName(code)`.

- [ ] **Step 5: Commit**

```bash
git add src/providers/gemini
git commit -m "refactor(gemini): names from CLDR, a vendor table, no migratePair

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Doubao AST 2.0

**Files:**
- Modify: `src/providers/volcengine_ast2/settings.ts:80-170`, `src/providers/volcengine_ast2/config.ts:43-50`
- Test: `src/providers/volcengine_ast2/settings.test.ts`, `src/providers/volcengine_ast2/config.test.ts`, `src/providers/volcengine_ast2/testing.ts`, any test using `'zhen'`, `'yue-CN'`, `'sh-CN'`

**Interfaces:**
- Consumes: `wireTable`, `pairCode`.
- Produces: app codes `zh+en` (exported `ZH_EN`), `yue`, `wuu`; `ast2Languages.wire` mapping them to `zhen`, `yue-CN`, `sh-CN`; `buildAst2` sends vendor codes.

- [ ] **Step 1: Write the failing tests**

`src/providers/volcengine_ast2/settings.test.ts`:
```ts
import { parseCode } from '../../lib/language/code';

it('offers app codes; the bidirectional mode is zh+en, the dialects yue and wuu (unified language codes)', () => {
  const text = ast2Languages.sources(AST2_DEFAULTS, { speech: false }).map((o) => o.value);
  for (const v of text) expect(parseCode(v), v).not.toBeNull();
  expect(text).toEqual(expect.arrayContaining(['zh+en', 'yue', 'wuu']));
  expect(ast2Languages.targets('zh+en', AST2_DEFAULTS, { speech: true }).map((o) => o.value)).toEqual(['zh+en']);
  expect(ast2Languages.wire?.toWire('zh+en')).toBe('zhen');
  expect(ast2Languages.wire?.toWire('yue')).toBe('yue-CN');
  expect(ast2Languages.wire?.toWire('wuu')).toBe('sh-CN');
});
```
`src/providers/volcengine_ast2/config.test.ts`:
```ts
it('sends Doubao its own codes', () => {
  const c = buildAst2({ direction: { source: 'zh+en', target: 'zh+en' }, speech: true, turns: 'auto' }, AST2_DEFAULTS, SHARED);
  expect(c).toMatchObject({ sourceLanguage: 'zhen', targetLanguage: 'zhen' });
  const d = buildAst2({ direction: { source: 'wuu', target: 'zh' }, speech: false, turns: 'auto' }, AST2_DEFAULTS, SHARED);
  expect(d).toMatchObject({ sourceLanguage: 'sh-CN', targetLanguage: 'zh' });
});
```
(`SHARED` is the file's own fixture at `config.test.ts:7`.)

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/providers/volcengine_ast2/settings.test.ts src/providers/volcengine_ast2/config.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `src/providers/volcengine_ast2/settings.ts`:
- `const lang = (value: string, name: string, englishName: string): LanguageOption => ({ value, name, englishName });` becomes `const code = (value: string): LanguageOption => ({ value });`, and every `lang('xx', '…', '…')` call becomes `code('xx')`:
```bash
node -e '
const fs=require("fs");const f="src/providers/volcengine_ast2/settings.ts";let t=fs.readFileSync(f,"utf8");let n=0;
t=t.replace(/lang\((\x27[^\x27]+\x27), \x27(?:[^\x27\\]|\\.)*\x27, \x27(?:[^\x27\\]|\\.)*\x27\)/g,(_,v)=>{n++;return `code(${v})`});
fs.writeFileSync(f,t);console.log(n,"calls")'
```
Expected: `23 calls`. Then fix the helper definition line by hand.
- `DIALECTS`: `code('yue'), code('wuu')`; its comment: "Two dialects, text only and as a source only (…). App codes `yue` and `wuu` (Wu, Shanghainese's language); Doubao's own `yue-CN` and `sh-CN` are the wire's."
- replace `export const ZHEN = 'zhen';` and `BIDIRECTIONAL` with:
```ts
/** Chinese↔English in one session, both sides or neither: the app code `zh+en`, Doubao's `zhen/zhen`. */
export const ZH_EN = pairCode('zh', 'en');
const BIDIRECTIONAL = code(ZH_EN);
```
and every `ZHEN` use with `ZH_EN`; `ONLY_ZHEN` → `ONLY_ZH_EN`.
- add to `ast2Languages`:
```ts
  wire: wireTable([
    ...[...SPOKEN, ...TEXT_ONLY].map((o) => [o.value] as const),
    ['yue', 'yue-CN'],
    ['wuu', 'sh-CN'],
    [ZH_EN, 'zhen'],
  ]),
```
`src/providers/volcengine_ast2/config.ts` `buildAst2` returns:
```ts
  const wire = ast2Languages.wire!;
  return { mode: context.speech ? 's2s' : 's2t', sourceLanguage: wire.toWire(source), targetLanguage: wire.toWire(target), ...(corpus ? { corpus } : {}) };
```
(import `ast2Languages`).

- [ ] **Step 4: Update the other tests, run the suite and the type check**

```bash
grep -rln "zhen\|ZHEN\|yue-CN\|sh-CN" src/providers/volcengine_ast2 src/lib src/components | grep test
```
Replace pair values `'zhen'` → `'zh+en'` (or `ZH_EN`), `'yue-CN'` → `'yue'`, `'sh-CN'` → `'wuu'` wherever they are pair values; keep them where a test asserts the request sent to Doubao. Then:
```bash
npx vitest run src/providers/volcengine_ast2
npx tsc --noEmit -p tsconfig.json
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/providers/volcengine_ast2
git commit -m "refactor(ast2): app codes zh+en, yue and wuu; Doubao's own codes on the wire

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Soniox and Kizuna Soniox

**Files:**
- Modify: `src/providers/soniox/settings.ts:130-199`, `src/providers/soniox/adapter.ts:128-137,246-262,312-316`
- Test: `src/providers/soniox/settings.test.ts`, `src/providers/soniox/adapter.test.ts` (or the adapter suite that already feeds tokens — `adapter.both.test.ts`)

**Interfaces:**
- Consumes: `wireTable`, `AUTO`.
- Produces: `sonioxLanguages.wire` (app `fil` ⇄ Soniox `tl`, every other code the same, plus `auto`); the adapter converts every token's `language`/`source_language` to app codes on arrival and every outgoing code to Soniox's.

- [ ] **Step 1: Write the failing tests**

`src/providers/soniox/settings.test.ts`:
```ts
import { parseCode } from '../../lib/language/code';

it('offers app codes; Tagalog is fil here and tl at Soniox (unified language codes)', () => {
  const values = SONIOX_LANGUAGES.map((o) => o.value);
  for (const v of values) expect(parseCode(v), v).not.toBeNull();
  expect(values).toContain('fil');
  expect(values).not.toContain('tl');
  expect(sonioxLanguages.wire?.toWire('fil')).toBe('tl');
  expect(sonioxLanguages.wire?.fromWire('tl')).toBe('fil');
});
```
In `src/providers/soniox/adapter.test.ts` (its `live()` harness, `msg`/`orig`/`tr`/`END`/`AUTO_CTX` from `./testing`), add:
```ts
describe('language codes (unified language codes)', () => {
  it("sends Filipino to Soniox as tl and reads Soniox's tl back as fil", async () => {
    const { stt, tts, of } = await live({ context: { ...AUTO_CTX, direction: { source: 'en', target: 'fil' } } });
    expect(stt().sentJson<Json>()[0]).toMatchObject({ translation: { type: 'one_way', target_language: 'tl' }, language_hints: ['en'] });
    stt().receive(msg(orig('Hello.'), tr('Kumusta.', 'tl'), END));
    const languages = of('segmentText').map((e) => e.payload.language);
    expect(languages).toContain('fil');
    expect(languages).not.toContain('tl');
    expect(tts().sentJson<Json>()).toContainEqual(expect.objectContaining({ language: 'tl' }));
  });

  it('drops a language Soniox reports outside the table', async () => {
    const { stt, of } = await live();
    stt().receive(msg({ ...orig('Hello.'), language: 'xx' }, END));
    expect(of('segmentText').length).toBeGreaterThan(0);
    for (const e of of('segmentText')) expect(e.payload).not.toHaveProperty('language');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/providers/soniox`
Expected: FAIL on the new cases.

- [ ] **Step 3: Implement**

```bash
node build/plan-tools/strip-language-names.mjs src/providers/soniox/settings.ts '{"tl":"fil"}'
```
Expected: `61 options rewritten` (60 + the inline auto source). Then in `sonioxLanguages` add:
```ts
  // Soniox's codes are ISO 639-1 and the app's but for Tagalog, which the app writes fil (CLDR's canonical form).
  wire: wireTable([[AUTO], ...SONIOX_LANGUAGES.map((o) => (o.value === 'fil' ? (['fil', 'tl'] as const) : ([o.value] as const)))]),
```
(import `wireTable`.)

`src/providers/soniox/adapter.ts`:
- add a module-level helper:
```ts
const sonioxWire = sonioxLanguages.wire!;

/** A token as the app reads it: its languages in app codes, a language outside the table dropped (unified language codes). */
function inAppCodes(token: SonioxToken): SonioxToken {
  const language = sonioxWire.fromWire(token.language);
  const sourceLanguage = sonioxWire.fromWire(token.source_language);
  const { language: _l, source_language: _s, ...rest } = token;
  return { ...rest, ...(language ? { language } : {}), ...(sourceLanguage ? { source_language: sourceLanguage } : {}) };
}
```
- `onMessage`: `const tokens = (message.tokens ?? []).map(inAppCodes);` — keep `tokenFrames(message.tokens ?? [])` on the raw tokens so the Logs show what Soniox sent:
```ts
  private onMessage(message: SonioxSttMessage): void {
    const raw = message.tokens ?? [];
    for (const f of tokenFrames(raw)) this.frame(f.direction, f.type, f.payload);
    this.utterances.message(raw.map(inAppCodes));
  }
```
- the `speak` sink: `this.leg(leg).speech?.speak(ref, text, span, sonioxWire.toWire(language))`
- `sttConfig()`: wrap each code: `language_a: sonioxWire.toWire(source)`, `language_b: sonioxWire.toWire(target)`, `target_language: sonioxWire.toWire(target)`, `languageHints: [sonioxWire.toWire(source), sonioxWire.toWire(target)]` and `[sonioxWire.toWire(source)]`.
- import `sonioxLanguages` from `'./settings'`.

`legFor` compares `token.language === source`: tokens now carry app codes, so it is right as it stands.

- [ ] **Step 4: Update the other tests, run the suite and the type check**

```bash
grep -rln "'tl'" src/providers/soniox
npx vitest run src/providers/soniox
npx tsc --noEmit -p tsconfig.json
```
Expected: PASS. A test that feeds a token language and expects it echoed unchanged keeps passing for every code but `tl`.

- [ ] **Step 5: Commit**

```bash
git add src/providers/soniox
git commit -m "refactor(soniox): app codes in, Soniox's codes out, at one place each

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Palabra

**Files:**
- Modify: `src/providers/palabraai/settings.ts:136-319`, `src/providers/palabraai/config.ts:22-30`, `src/providers/palabraai/wire.ts:189-200`
- Test: `src/providers/palabraai/settings.test.ts`, `src/providers/palabraai/config.test.ts`, `src/providers/palabraai/wire.test.ts`, `src/providers/palabraai/items.test.ts`, `src/providers/palabraai/testing.ts`

**Interfaces:**
- Consumes: `wireTable`, `AUTO`.
- Produces: rows `[app, vendor, otherApp]`; `palabraLanguages.wire` over every source and target code (and `auto`); `reverse` in app codes; `buildPalabra` sends vendor codes; `transcriptionOf` returns app codes.

- [ ] **Step 1: Write the failing tests**

`src/providers/palabraai/settings.test.ts`:
```ts
import { parseCode } from '../../lib/language/code';

it('offers app codes, Chile and Latin America by their right subtags (unified language codes)', () => {
  const targets = palabraLanguages.targets('en', PALABRA_DEFAULTS).map((o) => o.value);
  const sources = palabraLanguages.sources(PALABRA_DEFAULTS).map((o) => o.value);
  for (const v of [...sources, ...targets]) expect(parseCode(v), v).not.toBeNull();
  expect(targets).toEqual(expect.arrayContaining(['zh-Hans', 'zh-Hant', 'en-US', 'es-CL', 'es-419']));
  expect(targets).not.toContain('es-CH');
  const wire = palabraLanguages.wire!;
  expect(wire.toWire('es-CL')).toBe('es-ch');
  expect(wire.toWire('es-419')).toBe('es-la');
  expect(wire.toWire('zh-Hant')).toBe('zh-hant');
  expect(wire.fromWire('en-us')).toBe('en-US');
  expect(wire.fromWire('ka')).toBeNull();
});

it('reverses in app codes: en-US target ⇄ en source, zh source → zh-Hans target', () => {
  expect(palabraLanguages.reverse?.({ source: 'en', target: 'zh-Hant' }, PALABRA_DEFAULTS)).toEqual({ source: 'zh', target: 'en-US' });
  expect(palabraLanguages.reverse?.({ source: 'zh', target: 'en-US' }, PALABRA_DEFAULTS)).toEqual({ source: 'en', target: 'zh-Hans' });
});
```
(Both answers are today's, re-spelled: `zh-hant`'s `to_source` is `zh`, `en`'s `to_target` is `en-us`; `zh`'s documented `to_target` is the hidden `zh`, which lands on the first target whose source is `zh` — `zh-hans`. Update the file's existing reverse cases to the app spellings the same way.)

`src/providers/palabraai/wire.test.ts`:
```ts
it("reads the language Palabra reports as an app code, and drops one outside the table", () => {
  expect(transcriptionOf({ transcription: { text: 'x', language: 'zh-hant' } }).language).toBe('zh-Hant');
  expect(transcriptionOf({ transcription: { text: 'x', language: 'ka' } }).language).toBeUndefined();
});
```
`src/providers/palabraai/config.test.ts`:
```ts
it('sends Palabra its own codes', () => {
  const c = buildPalabra({ direction: { source: 'en', target: 'es-CL' }, speech: true, turns: 'auto' }, PALABRA_DEFAULTS, SHARED);
  expect(c).toMatchObject({ source: 'en', target: 'es-ch' });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/providers/palabraai`
Expected: FAIL on the new cases.

- [ ] **Step 3: Rewrite the rows**

```bash
node -e '
const fs=require("fs");const f="src/providers/palabraai/settings.ts";let t=fs.readFileSync(f,"utf8");
const fix={"es-ch":"es-CL","es-la":"es-419"};
const app=(v)=>fix[v]??v.replace(/^([a-z]{2,3})-([a-z]{4})$/,(_,l,s)=>`${l}-${s[0].toUpperCase()}${s.slice(1)}`).replace(/^([a-z]{2,3})-([a-z]{2}|\d{3})$/,(_,l,r)=>`${l}-${r.toUpperCase()}`);
const S="\x27(?:[^\x27\\\\]|\\\\.)*\x27";let n=0;
t=t.replace(new RegExp(`\\[\x27([^\x27]+)\x27, ${S}, ${S}, (?:\x27([^\x27]+)\x27|null)\\]`,"g"),(_,v,o)=>{n++;return `[\x27${app(v)}\x27, \x27${v}\x27, ${o?`\x27${app(o)}\x27`:"null"}]`});
fs.writeFileSync(f,t);console.log(n,"rows")'
```
Expected: `120 rows` (57 sources + 63 targets).

Then edit by hand:
- the `Row` type: `type Row = readonly [code: string, vendor: string, other: string | null];` and its doc comment: "each row its app code, Palabra's own code, and the app code its docs give the other way round (`to_target` for a source, `to_source` for a target; null where they give none)."
- `HIDDEN_TARGETS`: `{ zh: 'zh', 'en-AU': 'en', 'en-CA': 'en' }` (values are source app codes; the keys are the hidden targets' app codes).
- `option = ([value]: Row): LanguageOption => ({ value });`
- `SOURCES` auto entry: `{ value: AUTO }`.
- `TO_TARGET`/`TO_SOURCE` maps: `new Map(SOURCE_ROWS.map(([code, , other]) => [code, other]))` and the same for targets.
- `offeredTarget`: `TARGET_ROWS.find(([, , other]) => other === source)?.[0]`.
- add to `palabraLanguages`:
```ts
  // Every code either table holds, and `auto`, which Palabra takes as a source: Palabra's own spelling on the wire.
  wire: wireTable([
    [AUTO],
    ...[...new Map([...SOURCE_ROWS, ...TARGET_ROWS].map(([code, vendor]) => [code, vendor])).entries()].map(([code, vendor]) => (code === vendor ? ([code] as const) : ([code, vendor] as const))),
  ]),
```
(If a code appears in both tables with two different vendor spellings the `Map` keeps the last; `wireTable` would then throw on the duplicate vendor key only if two app codes share one vendor code — run the suite to confirm none do.)

`src/providers/palabraai/config.ts` in `buildPalabra`, after the guard: `source: palabraLanguages.wire!.toWire(source), target: palabraLanguages.wire!.toWire(target),` (import `palabraLanguages`).

`src/providers/palabraai/wire.ts` `transcriptionOf`: `language: palabraLanguages.wire!.fromWire(str(t.language)) ?? undefined,` — import `palabraLanguages` from `'./settings'`. Check for an import cycle first: `grep -n "from './wire'" src/providers/palabraai/settings.ts`; if `settings.ts` imports `wire.ts`, move the mapping to the two callers in `adapter.ts` instead (`const t = transcriptionOf(m.data)` sites at :345-364): `const t = inApp(transcriptionOf(m.data))` with `const inApp = (t: Transcription) => ({ ...t, language: palabraLanguages.wire!.fromWire(t.language) ?? undefined });`.

- [ ] **Step 4: Update the other tests, run the suite and the type check**

```bash
grep -rln "zh-hans\|zh-hant\|en-us\|en-gb\|pt-br\|es-ch\|es-la\|fr-ca\|ar-sa\|ar-ae\|es-mx\|es-ar\|es-co" src/providers/palabraai src/stores src/lib | grep test
```
Re-spell pair values to app codes in each; keep the vendor spelling where a test asserts the `set_task` message. Then:
```bash
npx vitest run src/providers/palabraai
npx tsc --noEmit -p tsconfig.json
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/providers/palabraai
git commit -m "refactor(palabra): app codes with Palabra's own on the wire; es-ch is Chile, es-la Latin America

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: The final shape — no names, a required table, no `migratePair`

**Files:**
- Modify: `src/lib/provider/types.ts`, `src/lib/provider/languages.ts` (doc only), `src/utils/languages.ts`, `src/providers/registry.test.ts`
- Test: `src/providers/registry.test.ts`

**Interfaces:**
- Produces: `interface LanguageOption { value: string }`; `languages.wire: WireTable` required; `languages.migratePair` removed; `LANGUAGE_OPTIONS` and `getLanguageOption` removed from `src/utils/languages.ts`.

- [ ] **Step 1: Write the failing test**

Add to `src/providers/registry.test.ts` (it imports `PROVIDERS` from `./registry`, dev-only providers included under Vitest):

```ts
import { parseCode } from '../lib/language/code';

describe('language codes (unified language codes)', () => {
  const contexts = [undefined, { speech: true }, { speech: false }] as const;
  it.each(PROVIDERS.map((p) => [p.id, p] as const))('%s offers app codes its wire table can send and read back', (_id, p) => {
    const s = p.settings.defaults;
    for (const context of contexts) {
      for (const source of p.languages.sources(s, context)) {
        expect(parseCode(source.value), `${p.id} source ${source.value}`).not.toBeNull();
        expect(Object.keys(source), `${p.id} ${source.value}`).toEqual(['value']);
        const sent = p.languages.wire.toWire(source.value);
        if (p.languages.wire.codes.length > 0) expect(p.languages.wire.fromWire(sent)).toBe(source.value);
        for (const target of p.languages.targets(source.value, s, context)) {
          expect(parseCode(target.value), `${p.id} target ${target.value}`).not.toBeNull();
          expect(() => p.languages.wire.toWire(target.value), `${p.id} target ${target.value}`).not.toThrow();
        }
      }
    }
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run src/providers/registry.test.ts`
Expected: PASS already for codes (Tasks 6–11); the type change below must keep it passing.

- [ ] **Step 3: Implement the final types**

`src/lib/provider/types.ts`:
```ts
/** A language on offer: an app code (`src/lib/language/code.ts`), named by `languageLabel` wherever it shows. */
export interface LanguageOption { value: string }
```
In `languages`: delete `migratePair` and its comment; make `wire: WireTable;` required with the comment "App codes ⇄ the vendor's: `toWire` for every code a build sends, `fromWire` for every language the vendor reports (spec 'Unified language codes' §3)."

Remove the non-null assertions added in Tasks 7–11 (`wire!` → `wire`):
```bash
grep -rln "wire!" src/providers | xargs sed -i 's/\.wire!\./.wire./g; s/\.wire!;/.wire;/g'
grep -rn "wire!" src/providers
```
Expected: the second grep prints nothing.

`src/utils/languages.ts` — replace `LANGUAGE_OPTIONS` and `getLanguageOption` with the code list (the `mul` entry stays: a universal model offers it today):
```ts
import type { LanguageOption } from '../lib/provider/types';
import { englishLanguageName } from '../lib/language/label';

/** The local vocabulary: every app code a universal local model offers (spec "Unified language codes" §7). Named by `languageLabel`. */
export const LANGUAGE_CODES: readonly string[] = [
  'af', 'ar', 'bg', 'bn', 'ca', 'cs', 'da', 'de', 'en', 'el', 'es', 'et', 'fa', 'fi', 'fr', 'gu', 'he', 'hi', 'hr', 'hu',
  'id', 'is', 'it', 'ja', 'kn', 'ko', 'lt', 'lv', 'ml', 'mr', 'mt', 'mul', 'nl', 'no', 'pa', 'pl', 'pt', 'ro', 'ru', 'sk',
  'sl', 'sr', 'sv', 'sw', 'ta', 'te', 'th', 'fil', 'tr', 'uk', 'ur', 'vi', 'xh', 'yue', 'zh', 'zu',
];
```
keep `LANGUAGE_PRIORITY` and `sortLanguageOptions` (already on `englishLanguageName` since Task 5). Delete the `LanguageOption` import from the legacy `ProviderConfig`.

Then fix every remaining importer:
```bash
grep -rn "LANGUAGE_OPTIONS\|getLanguageOption" src --include='*.ts' --include='*.tsx'
```
Each hit is either a test (switch to `LANGUAGE_CODES` / `languageLabel(code, 'en')`) or a leftover reader (switch to `languageLabel`).

Delete the `migratePair` step from `src/stores/providerStore.ts:250` now (Task 13 rewrites `load`; for this task make it `const pair = { source, target };`) and its three tests in `providerStore.test.ts` (`rewrites the stored pair before it is normalized…`, `falls back to the initial pair for a side migratePair empties`, `hands migratePair '' for a side nothing stored…`).

- [ ] **Step 4: Run everything that touches languages, and the type check**

```bash
npx tsc --noEmit -p tsconfig.json
npx vitest run src/providers src/lib src/components src/stores src/utils
```
Expected: no new type errors; PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/provider/types.ts src/utils/languages.ts src/utils/languages.test.ts src/providers src/stores/providerStore.ts src/stores/providerStore.test.ts
git add $(git diff --name-only -- '*.test.ts' '*.test.tsx')
git commit -m "refactor(language): options are codes alone, every provider has a vendor table

LanguageOption loses name and englishName; migratePair goes.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: One global pair

**Files:**
- Modify: `src/stores/providerStore.ts` (types :38-48, `ProviderStore` interface, `persistPair`, `derive`, `rederive`, `load`, `updateSettings`, `setPair`, `flush`)
- Test: `src/stores/providerStore.test.ts`

**Interfaces:**
- Consumes: `normalizePair` (unchanged).
- Produces:
  - `ProviderStore.intent: LanguagePair | null | undefined` — `undefined` until the first `load` read storage; `null` when nothing was ever picked.
  - `ProviderEntry` without `stored`.
  - `PAIR_FIELDS` keeps its value; `flush(p, PAIR_FIELDS)` now answers for the two global keys.

- [ ] **Step 1: Write the failing tests**

In `src/stores/providerStore.test.ts`:
- `beforeEach`: `useProviderStore.setState({ entries: {}, selected: null, selectionLocked: false, intent: undefined });`
- add a second provider next to `probe`:
```ts
/** Offers en and de only: a pair the probe keeps, it cannot. */
const narrow = {
  ...probe,
  id: 'narrow',
  settings: { key: 'narrow', defaults: { region: 'us', count: 1, on: false } },
  languages: {
    sources: () => [opt('en'), opt('de')],
    targets: (source: string) => [opt('en'), opt('de')].filter((o) => o.value !== source),
    wire: probe.languages.wire,
  },
} as unknown as AnyProvider;
```
and give `probe.languages` a `wire: identityWire()` (import it) and change `opt` to `({ value })`.
- replace the per-provider pair cases in `describe('load')` (`keeps a stored pair the provider offers`, `repairs a stored pair…`, `starts from the first source…`) with:
```ts
  it('reads the one pair at settings.common.*, and shows it where the provider offers it', async () => {
    stored.set('settings.common.sourceLanguage', 'ja');
    stored.set('settings.common.targetLanguage', 'en');
    await useProviderStore.getState().load(probe);
    expect(entry().pair).toEqual({ source: 'ja', target: 'en' });
    expect(getSetting).not.toHaveBeenCalledWith('settings.probe.sourceLanguage', expect.anything());
  });

  it("starts from the provider's initial, then its first options, when nothing was picked", async () => {
    await useProviderStore.getState().load(probe);
    expect(entry().pair).toEqual({ source: 'en', target: 'ja' });
    expect(useProviderStore.getState().intent).toBeNull();
  });
```
- add `describe('the global pair (unified language codes)')`:
```ts
describe('the global pair (unified language codes)', () => {
  const pairOf = (id: string) => useProviderStore.getState().entries[id].pair;

  it('keeps the pair across providers; a side one lacks takes its first option and nothing is written', async () => {
    stored.set('settings.common.sourceLanguage', 'ja');
    stored.set('settings.common.targetLanguage', 'fr');
    await useProviderStore.getState().load(probe);
    await useProviderStore.getState().load(narrow);
    setSetting.mockClear();
    expect(pairOf('probe')).toEqual({ source: 'ja', target: 'fr' });
    expect(pairOf('narrow')).toEqual({ source: 'en', target: 'de' });
    useProviderStore.getState().select('narrow', 'pick');
    useProviderStore.getState().select('probe', 'pick');
    expect(pairOf('probe')).toEqual({ source: 'ja', target: 'fr' });
    expect(setSetting).not.toHaveBeenCalledWith('settings.common.sourceLanguage', expect.anything());
    expect(setSetting).not.toHaveBeenCalledWith('settings.common.targetLanguage', expect.anything());
  });

  it('writes a pick, both sides as shown, and every loaded provider follows it', async () => {
    await useProviderStore.getState().load(probe);
    await useProviderStore.getState().load(narrow);
    useProviderStore.getState().setPair(narrow, { source: 'de', target: 'en' });
    expect(stored.get('settings.common.sourceLanguage')).toBe('de');
    expect(stored.get('settings.common.targetLanguage')).toBe('en');
    expect(pairOf('probe')).toEqual({ source: 'en', target: 'ja' });
  });

  it('writes no pair when a settings edit narrows the offer, and brings it back when the edit is undone', async () => {
    stored.set('settings.common.sourceLanguage', 'ja');
    stored.set('settings.common.targetLanguage', 'fr');
    await useProviderStore.getState().load(probe);
    setSetting.mockClear();
    useProviderStore.getState().updateSettings(probe, { on: true });
    expect(pairOf('probe')).toEqual({ source: 'ja', target: 'en' });
    expect(setSetting).not.toHaveBeenCalledWith('settings.common.targetLanguage', expect.anything());
    useProviderStore.getState().updateSettings(probe, { on: false });
    expect(pairOf('probe')).toEqual({ source: 'ja', target: 'fr' });
  });

  it('shows a stored code no provider offers as the first options, and keeps it stored', async () => {
    stored.set('settings.common.sourceLanguage', 'zh+en');
    stored.set('settings.common.targetLanguage', 'zh+en');
    await useProviderStore.getState().load(narrow);
    expect(pairOf('narrow')).toEqual({ source: 'en', target: 'de' });
    expect(useProviderStore.getState().intent).toEqual({ source: 'zh+en', target: 'zh+en' });
  });
});
```
- rewrite `describe('writes')`'s `moves the pair when new settings stop offering it, and persists only what moved` to assert no pair key is written (the case above covers the shape; delete the old one), and `saves a new pair` to expect `settings.common.sourceLanguage`/`targetLanguage`.
- in `describe('the language context …')`, the cases reading `entry().stored` assert `useProviderStore.getState().intent` instead.
- in `describe('flush')`'s `flush(p, fields) answers for those fields…`, add a refused global pair write and expect `flush(probe, PAIR_FIELDS)` to resolve `false`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/stores/providerStore.test.ts`
Expected: FAIL on the new cases (pairs still per provider).

- [ ] **Step 3: Implement**

In `src/stores/providerStore.ts`:

```ts
/** The pair persists once, for every provider (spec "Unified language codes" §5). */
const PAIR_KEYS = { source: 'settings.common.sourceLanguage', target: 'settings.common.targetLanguage' } as const;
/** The fields a pair is stored under, for a caller that flushes what it wrote: `flush(p, PAIR_FIELDS)` answers for the global keys. */
export const PAIR_FIELDS = [SOURCE, TARGET] as const;
```
`ProviderEntry`: delete `stored` and its comment; `pair`'s comment becomes "The pair the surfaces show and a run starts: the global intent, within what this provider offers in the store's language context."

`ProviderStore`: add
```ts
  /** The pair the user picked, for every provider: undefined until storage is read, null when nothing was ever picked. Only `setPair` changes it. */
  intent: LanguagePair | null | undefined;
```
and reword `setPair`'s and `setSpeech`'s docs: "derived again from the intent".

Inside the store factory:
```ts
  const persistPair = (before: LanguagePair | null | undefined, after: LanguagePair) => {
    if (after.source !== before?.source) write(PAIR_KEYS.source, after.source);
    if (after.target !== before?.target) write(PAIR_KEYS.target, after.target);
  };
  /** What a provider shows: the intent, else its initial; within its offer for the store's context. Nothing is written. */
  const derive = (p: AnyProvider, settings: unknown): LanguagePair => {
    const intent = get().intent;
    const initial = p.languages.initial?.(settings) ?? {};
    return normalizePair(p, settings, { source: intent?.source || initial.source, target: intent?.target || initial.target }, languageContext(p, get().legs, get().speech));
  };
  /** The intent or the context moved: every loaded entry's pair derived again, nothing written. */
  const rederive = () => {
    for (const [id, entry] of Object.entries(get().entries)) {
      const p = loadedProviders.get(id);
      if (!p) continue;
      const pair = derive(p, entry.settings);
      if (pair.source === entry.pair.source && pair.target === entry.pair.target) continue;
      put(p, { settings: entry.settings, credentials: entry.credentials, pair });
      // The check reads the pair: its answer was about the other one.
      forgetReadiness(p);
    }
  };
```
Initial state: `intent: undefined,`.

`load(p)`: replace the two per-provider pair reads in the `Promise.all` with `service.getSetting(PAIR_KEYS.source, '')` and `service.getSetting(PAIR_KEYS.target, '')`; after the `if (get().entries[p.id]) return;` guard:
```ts
      // The first load to land reads the intent; a pick made meanwhile is newer and stays.
      if (get().intent === undefined) set({ intent: source || target ? { source, target } : null });
      loadedProviders.set(p.id, p);
      put(p, { settings, credentials, pair: derive(p, settings) });
```
(delete the `initial`/`migratePair`/`kept` lines.)

`updateSettings`:
```ts
    updateSettings(p, patch) {
      const entry = loaded(p);
      const settings = { ...(entry.settings as Record<string, unknown>), ...patch };
      // New settings can change the languages on offer: the pair shown follows them, and the intent is not written (spec §5).
      const pair = derive(p, settings);
      put(p, { settings, credentials: entry.credentials, pair });
      for (const [field, value] of Object.entries(patch)) write(storageKey(p, field), value);
      const touched = p.checkReads === undefined || Object.keys(patch).some((field) => p.checkReads!.includes(field));
      const moved = pair.source !== entry.pair.source || pair.target !== entry.pair.target;
      if (touched || moved) forgetReadiness(p);
    },
```
`setPair`:
```ts
    setPair(p, pair) {
      const entry = loaded(p);
      // A pick is kept as picked, within this provider's widest offer — both sides as shown — and every provider derives from it.
      const kept = normalizePair(p, entry.settings, pair);
      const before = get().intent;
      set({ intent: kept });
      persistPair(before, kept);
      rederive();
      forgetReadiness(p);
    },
```
`setLegs`/`setSpeech` keep calling `rederive()`.

`flush`'s `covers`:
```ts
      const pairKey = (field: string) => (field === SOURCE ? PAIR_KEYS.source : field === TARGET ? PAIR_KEYS.target : undefined);
      const covers = (key: string) => !p || key === 'settings.common.provider'
        || (fields
          ? fields.some((field) => key === storageKey(p, field) || key === pairKey(field))
          : key.startsWith(`settings.${p.settings.key}.`) || key === PAIR_KEYS.source || key === PAIR_KEYS.target);
```
Update the module header comment: "Values persist under today's `settings.<key>.<field>` keys; the language pair once, under `settings.common.sourceLanguage/targetLanguage`."

`CLAUDE.md` (Provider Architecture bullet on `src/stores/providerStore.ts`, and the State Management line for `providerStore.ts`): say the store holds each provider's settings and credentials under `settings.<key>.*`, and **one** language pair for every provider under `settings.common.sourceLanguage/targetLanguage`, which only a pick writes. Read the bullet as it stands in the worktree before editing — it may have moved since `af329e4c`.

- [ ] **Step 4: Run the store suites, their dependents, and the type check**

```bash
npx vitest run src/stores src/components/SetupWizard src/components/providers src/lib/session src/app
npx tsc --noEmit -p tsconfig.json
```
Expected: PASS; no new type errors. A test elsewhere that seeded `settings.<provider>.sourceLanguage` to drive a pair now seeds `settings.common.sourceLanguage`.

- [ ] **Step 5: Commit**

```bash
git add src/stores/providerStore.ts src/stores/providerStore.test.ts CLAUDE.md
git add $(git diff --name-only -- '*.test.ts' '*.test.tsx')
git commit -m "feat(store): one language pair for every provider; only a pick writes it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Verification

**Files:** none changed unless a check fails.

- [ ] **Step 1: Full suite, type check, lint**

```bash
npx tsc --noEmit -p tsconfig.json
npx vitest run 2>&1 | tail -8
npm run lint 2>&1 | tail -5
```
Expected: no type errors beyond Task 0's baseline; the suite's failures no more than the baseline's; lint clean.

- [ ] **Step 2: No old spelling left outside the wire tables**

```bash
grep -rn "zh_CN\|zh_TW\|en_US\|'zhen'\|'cantonese'\|englishName\|getLanguageOption\|migratePair" src --include='*.ts' --include='*.tsx' | grep -v "\.test\.\|src/services/\|src/locales/\|LocalNative\|LanguageSection.tsx"
```
Expected: only vendor codes inside the wire tables (`'zhen'` in Doubao's table) and i18n locale ids. Anything else is a missed reader.

- [ ] **Step 3: Render the language section in a CJK and a Latin UI language**

Start the dev server (`npm run dev`, port 5173; another worktree on 5173 moves it to 5174 — read the printed port), open Settings with Gemini selected, and screenshot the language pair section with the UI language set to 简体中文 and to English (headless Chromium + CDP per the project's UI-by-rendering rule). Check: names read in the UI language, `中文（繁體）`-style names come from CLDR, no raw code, nothing clipped. Then select Palabra and check `西班牙语（智利）` / "Spanish (Chile)" appears for `es-CL`.

- [ ] **Step 4: Report**

Summarize per task what landed, the suite/type-check numbers against the baseline, and the screenshots. Do not push.

---

## Self-review notes (for the executor)

- Spec §6 badges (`ConversationList`, `SubtitleView`) need no change: `baseLang` (`sentenceEnd.ts:181`) already reduces any app code to its two-letter base.
- Spec §6 analytics and export need no change: they send the code, which is now the app code.
- Spec §1's `baseLang` re-export is not needed: `baseLang` accepts every app code as it stands.
- Departure from the spec, flagged to the user: OpenAI Translate's separate Tagalog source row is removed (Task 7), because the app code for Tagalog is `fil` and CLDR names `tl` and `fil` alike.
