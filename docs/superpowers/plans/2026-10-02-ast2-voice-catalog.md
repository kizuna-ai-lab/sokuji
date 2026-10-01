# Doubao AST 2.0 Voice Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Doubao AST 2.0 speaking run use any of 506 public TTS voices — chosen per target language in the shared, filterable, auditionable voice library — with cloning a peer entry shown only where the cloning model runs the pair.

**Architecture:** A maintainer-run script turns a `ListSpeakers` dump into a compact `voices.json` committed under the provider. `catalog.ts` reads it; `voice.ts` decides which pairs cloning runs and which voice a pair speaks in; `settings.ts` stores one voice per target and offers languages that no longer depend on the voice; `config.ts` puts the chosen voice in the session; the settings view swaps its dropdown for `VoiceLibrarySection` with a CDN-backed preview.

**Tech Stack:** TypeScript, React, Vitest, `tsx` for the build script, Volcengine's Python SDK (maintainer-only, throwaway venv) for refreshes.

**Spec:** `docs/superpowers/specs/2026-10-02-ast2-voice-catalog-design.md`

## Global Constraints

- English only in code, comments and commit messages; conventional commits, each ending `Refs #577` and the `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` line.
- No new repo dependency. The Python SDK lives only in a throwaway venv.
- No key is ever committed or written into the repo; CI runs neither script.
- No one-time migration code: `96feb2ef`'s `voice` field never shipped and simply disappears.
- Record failures with `reportError` from `src/lib/diagnostics/report.ts`, never `console.error`/`console.warn`.
- Every locale change lands in all thirty `src/locales/*/translation.json` files.
- `voices.json` is written by `build.ts` only, one voice per line; never hand-edited.
- Cloning and text-only legs must send the exact StartSession bytes they send today.
- Catalog order is `ListSpeakers` order (R6); no voice is promoted.
- A voice speaks only its documented languages, narrowed by measured failures (R1, R2).

## Review Focus

- **A `voices` value of the wrong type in storage** (a string, an array, a number from a hand-edited or corrupted store) must read as no choices, never throw — pinned in Task 3.
- **Picking a voice after the target language changed** must write the new target's slot and leave the old target's choice alone — pinned in Task 5.
- **A refresh removing a voice someone chose** must fall back (clone where it runs, else the target's first voice) rather than send an unknown `speaker_id`, which the server would silently clone with — pinned in Tasks 3 and 4.
- **An audition the user stops mid-download** must not be reported as a failure — pinned in Task 5.
- **The participant leg** runs the reversed pair and must speak its own target's voice, not the speaker's — pinned in Task 4.

---

## File Structure

| File | Responsibility |
|---|---|
| `scripts/doubao-voices/fetch.py` (create) | Maintainer-only: pull `ListSpeakers` with the SDK into a raw dump. |
| `scripts/doubao-voices/build.ts` (create) | Pure `buildCatalog` + `formatCatalog`; CLI writes `voices.json`. |
| `scripts/doubao-voices/build.test.ts` (create) | Rules of `buildCatalog` on a fixture. |
| `src/providers/volcengine_ast2/catalogShape.ts` (create) | The JSON's types and the nine fixed-voice languages; imported by both script and app. |
| `src/providers/volcengine_ast2/voices.json` (create, generated) | The snapshot. |
| `src/providers/volcengine_ast2/catalog.ts` (+ test) (create) | Lookups over the snapshot. |
| `src/providers/volcengine_ast2/voice.ts` (+ test) (create) | `CLONE`, `clonable`, `effectiveVoice`. |
| `src/providers/volcengine_ast2/settings.ts` (+ test) (modify) | `voices` field, its migration, languages without the voice. |
| `src/providers/volcengine_ast2/config.ts` (+ test) (modify) | The session's voice. |
| `src/providers/volcengine_ast2/adapter.test.ts` (modify) | The fixed-voice start test's patch. |
| `src/providers/volcengine_ast2/preview.ts` (+ test) (create) | Fetch and decode a voice's sample. |
| `src/providers/volcengine_ast2/Ast2Settings.tsx` (+ test) (modify) | The voice library in the settings view. |
| `src/locales/*/translation.json` (modify ×30) | Strings. |
| `extension/manifest.json`, `extension/manifest.consistency.test.ts` (modify) | The CDN in `connect-src`. |

Work in the worktree `/home/jiangzhuo/Desktop/kizunaai/sokuji/.claude/worktrees/ast2-fixed-voice` (branch `worktree-ast2-fixed-voice`). Run every command from there. The raw dump of the 2026-10-02 pull is `/home/jiangzhuo/.claude/jobs/c1940130/tmp/speakers.json`; if it is gone, regenerate it with Task 1's `fetch.py`.

---

### Task 1: The catalog builder and the snapshot

**Files:**
- Create: `src/providers/volcengine_ast2/catalogShape.ts`
- Create: `scripts/doubao-voices/build.ts`
- Create: `scripts/doubao-voices/build.test.ts`
- Create: `scripts/doubao-voices/fetch.py`
- Create (generated): `src/providers/volcengine_ast2/voices.json`

**Interfaces:**
- Produces: `catalogShape.ts` exports `FIXED_LANGUAGES` (`readonly ['zh','en','ja','id','es','pt','de','fr','ko']`), `type FixedLanguage`, `type Age`, `interface CatalogLanguage { n?: string; a?: Age; p?: string }`, `interface CatalogVoice { id: string; r: 1 | 2; g: 'male' | 'female'; l: Record<string, CatalogLanguage> }`, `interface Catalog { v: 1; fetched: string; prefix: string; voices: CatalogVoice[] }`. `build.ts` exports `RawSpeaker`, `PREFIX`, `ONE_WAY_ONLY`, `LANGUAGE`, `AST_DOCUMENTED`, `buildCatalog(entries, fetched): Catalog`, `formatCatalog(catalog): string`.

- [ ] **Step 1: Write `catalogShape.ts`**

```ts
/**
 * The shape of `voices.json` (#577 catalog spec §1.2), shared by the script
 * that writes it (`scripts/doubao-voices/build.ts`) and the module that reads
 * it (`catalog.ts`). Kept free of the JSON import so the script can use it.
 */

/** The targets a fixed voice speaks in AST 2.0, in the S2S list's order then Korean (spec §1.1 rule 3). */
export const FIXED_LANGUAGES = ['zh', 'en', 'ja', 'id', 'es', 'pt', 'de', 'fr', 'ko'] as const;
export type FixedLanguage = (typeof FIXED_LANGUAGES)[number];

/** ListSpeakers' 儿童 / 少年/少女 / 青年 / 中年 / 老年; the last three are the voice library's existing values. */
export type Age = 'child' | 'teen' | 'young' | 'middle_aged' | 'old';

/** One language of a voice: its persona name, age and sample clip path under `Catalog.prefix`. `{}` reads as the voice's first language. */
export interface CatalogLanguage {
  n?: string;
  a?: Age;
  p?: string;
}

export interface CatalogVoice {
  /** The `speaker_id`. */
  id: string;
  /** The `tts_resource_id`: 1 → seed-tts-1.0, 2 → seed-tts-2.0. */
  r: 1 | 2;
  g: 'male' | 'female';
  /** Keyed by app language code, in the order ListSpeakers listed them. */
  l: Record<string, CatalogLanguage>;
}

export interface Catalog {
  v: 1;
  /** The day the ListSpeakers dump was taken. */
  fetched: string;
  prefix: string;
  voices: CatalogVoice[];
}
```

- [ ] **Step 2: Write the failing test `scripts/doubao-voices/build.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { buildCatalog, formatCatalog, PREFIX, type RawSpeaker } from './build';

const raw = (o: Partial<RawSpeaker> & Pick<RawSpeaker, 'voice_type'>): RawSpeaker => ({
  resource_id: 'seed-tts-2.0',
  name: o.voice_type,
  gender: '女',
  age: '青年',
  languages: [{ language: 'zh-cn' }],
  short_trial_url: `${PREFIX}portal/bigtts/short_trial_url/${o.voice_type}.mp3`,
  trial_url: `${PREFIX}portal/bigtts/${o.voice_type}.wav`,
  ...o,
});

describe('buildCatalog (#577 catalog spec §1.1)', () => {
  it('drops the voice list\'s one-way-only voices, which fail in a bidirectional stream', () => {
    const c = buildCatalog([raw({ voice_type: 'ja_female_minimi_uranus_bigtts', languages: [{ language: 'ja' }] }), raw({ voice_type: 'a' })], '2026-10-02');
    expect(c.voices.map((v) => v.id)).toEqual(['a']);
  });

  it('maps ListSpeakers languages to app codes and keeps only the nine a fixed voice speaks', () => {
    const c = buildCatalog([
      raw({ voice_type: 'es', languages: [{ language: 'es-mx' }] }),
      raw({ voice_type: 'mx', languages: [{ language: 'mx' }] }),
      raw({ voice_type: 'pt', languages: [{ language: 'pt-br' }] }),
      raw({ voice_type: 'ko', languages: [{ language: 'ko' }] }),
      raw({ voice_type: 'th', languages: [{ language: 'th' }] }),
      raw({ voice_type: 'fil', languages: [{ language: 'fil' }] }),
    ], '2026-10-02');
    expect(c.voices.map((v) => [v.id, Object.keys(v.l)])).toEqual([['es', ['es']], ['mx', ['es']], ['pt', ['pt']], ['ko', ['ko']]]);
  });

  it('merges one id split over several entries, each language keeping its own persona, age and clip', () => {
    const c = buildCatalog([
      raw({ voice_type: 'zh_male_jingqiangkanye_moon_bigtts', resource_id: 'seed-tts-1.0', gender: '男', name: 'Harmony', age: '青年', languages: [{ language: 'en' }], short_trial_url: `${PREFIX}portal/bigtts/short_trial_url/Harmony.mp3` }),
      raw({ voice_type: 'zh_male_jingqiangkanye_moon_bigtts', resource_id: 'seed-tts-1.0', gender: '男', name: '京腔侃爷', age: '中年', languages: [{ language: 'zh-cn' }], short_trial_url: `${PREFIX}portal/bigtts/short_trial_url/京腔侃爷.mp3` }),
    ], '2026-10-02');
    expect(c.voices).toEqual([{
      id: 'zh_male_jingqiangkanye_moon_bigtts', r: 1, g: 'male',
      l: {
        en: { n: 'Harmony', a: 'young', p: 'portal/bigtts/short_trial_url/Harmony.mp3' },
        zh: { n: '京腔侃爷', a: 'middle_aged', p: 'portal/bigtts/short_trial_url/京腔侃爷.mp3' },
      },
    }]);
  });

  it('stores a language equal to the first as {}, and adds zh and en to the two voices the AST document names', () => {
    const c = buildCatalog([
      raw({ voice_type: 'zh_female_vv_uranus_bigtts', name: 'Vivi 2.0', languages: [{ language: 'zh-cn' }, { language: 'ja' }, { language: 'id' }, { language: 'es-mx' }], short_trial_url: null }),
      raw({ voice_type: 'zh_male_jingqiangkanye_emo_mars_bigtts', resource_id: 'seed-tts-1.0', gender: '男', name: '京腔侃爷', age: '中年' }),
    ], '2026-10-02');
    expect(c.voices[0]).toEqual({
      id: 'zh_female_vv_uranus_bigtts', r: 2, g: 'female',
      // No short trial: the long one.
      l: { zh: { n: 'Vivi 2.0', a: 'young', p: 'portal/bigtts/zh_female_vv_uranus_bigtts.wav' }, ja: {}, id: {}, es: {}, en: {} },
    });
    expect(Object.keys(c.voices[1].l)).toEqual(['zh', 'en']);
    expect(c.voices[1].l.en).toEqual({});
  });

  it('keeps ListSpeakers order', () => {
    const c = buildCatalog(['c', 'a', 'b'].map((id) => raw({ voice_type: id })), '2026-10-02');
    expect(c.voices.map((v) => v.id)).toEqual(['c', 'a', 'b']);
  });

  it('fails loudly on a value its tables do not know, so a refresh cannot ship a guess', () => {
    expect(() => buildCatalog([raw({ voice_type: 'x', age: '婴儿' })], 'd')).toThrow(/x: unknown age "婴儿"/);
    expect(() => buildCatalog([raw({ voice_type: 'x', gender: '?' })], 'd')).toThrow(/x: unknown gender/);
    expect(() => buildCatalog([raw({ voice_type: 'x', resource_id: 'seed-icl-2.0' })], 'd')).toThrow(/x: unknown resource/);
    expect(() => buildCatalog([raw({ voice_type: 'x', short_trial_url: 'https://elsewhere/x.mp3' })], 'd')).toThrow(/x: sample clip outside/);
    expect(() => buildCatalog([raw({ voice_type: 'x' }), raw({ voice_type: 'x', resource_id: 'seed-tts-1.0', languages: [{ language: 'en' }] })], 'd')).toThrow(/x: its entries disagree/);
  });
});

describe('formatCatalog', () => {
  it('writes valid JSON with one voice per line, so a refresh diffs voice by voice', () => {
    const c = buildCatalog([raw({ voice_type: 'a' }), raw({ voice_type: 'b' })], '2026-10-02');
    const text = formatCatalog(c);
    expect(JSON.parse(text)).toEqual(c);
    expect(text.split('\n')).toHaveLength(5);
    expect(text.endsWith('\n')).toBe(true);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run scripts/doubao-voices/build.test.ts`
Expected: FAIL — `Failed to resolve import "./build"`.

- [ ] **Step 4: Write `scripts/doubao-voices/build.ts`**

```ts
#!/usr/bin/env -S npx tsx
// Build src/providers/volcengine_ast2/voices.json from a ListSpeakers dump.
//
// Doubao's voice list is the speech_saas_prod OpenAPI ListSpeakers, signed with
// an account AK/SK: no user credential can call it and no key may ship, so the
// app reads a snapshot (#577 catalog spec §1). Refresh, in a throwaway venv:
//
//   pip install volcengine-python-sdk
//   VOLC_AK=... VOLC_SK=... python scripts/doubao-voices/fetch.py /tmp/speakers.json
//   npx tsx scripts/doubao-voices/build.ts /tmp/speakers.json 2026-10-02
//
// The dump is not committed; the diff of voices.json is the review.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Age, Catalog, CatalogLanguage, CatalogVoice, FixedLanguage } from '../../src/providers/volcengine_ast2/catalogShape';

/** One ListSpeakers entry as the Python SDK's `to_dict()` writes it (`fetch.py`); only the fields read. */
export interface RawSpeaker {
  voice_type: string;
  resource_id: string;
  name: string;
  gender: string;
  age: string;
  languages: { language: string }[] | null;
  short_trial_url: string | null;
  trial_url: string | null;
}

/** Every sample clip lives under this CDN path (public, `Access-Control-Allow-Origin: *`). */
export const PREFIX = 'https://lf3-static.bytednsdoc.com/obj/eden-cn/lm_hz_ihsph/ljhwZthlaukjlkulzlp/';

/**
 * The voice list's one-way-only voices (docs 6561/1257544, remark
 * "仅限单向流使用，不支持双向流，双向流调用会直接报错"). AST 2.0 is a bidirectional
 * stream, so each starts and then fails at its first sentence
 * (`ja_female_minimi_uranus_bigtts`, measured 2026-10-02). The page's note
 * announces 16; its table marks these 15.
 */
export const ONE_WAY_ONLY: ReadonlySet<string> = new Set([
  'de_male_sven_uranus_bigtts',
  'en_male_bill_jones_corey_uranus_bigtts',
  'en_female_brittney_pimintel_uranus_bigtts',
  'en_male_cowboy_john_b_uranus_bigtts',
  'en_male_josh_coery_uranus_bigtts',
  'en_male_michael_kevin_uranus_bigtts',
  'en_female_myra_cmb_uranus_bigtts',
  'en_female_natasha_uranus_bigtts',
  'en_male_valentino_corey_uranus_bigtts',
  'fr_male_usseau_uranus_bigtts',
  'ja_female_minimi_uranus_bigtts',
  'ko_male_shane_uranus_bigtts',
  'mx_male_felipe_uranus_bigtts',
  'pt_male_martins_uranus_bigtts',
  'it_male_enzo_uranus_bigtts',
]);

/**
 * ListSpeakers' language codes → app codes, for the targets a fixed voice
 * speaks in AST 2.0 (measured 2026-10-02): zh, en, ja, es, id, pt, fr, de,
 * ko. th, vi, ru, ar and ms fail with "unsupported speaker id" whatever the
 * voice; fil has no AST code; it and tr have no voice left. A code missing
 * here is dropped.
 */
export const LANGUAGE: Readonly<Record<string, FixedLanguage>> = {
  'zh-cn': 'zh', zh: 'zh', en: 'en', ja: 'ja', id: 'id',
  'es-mx': 'es', mx: 'es', es: 'es', 'pt-br': 'pt', pt: 'pt',
  de: 'de', fr: 'fr', ko: 'ko',
};

/**
 * The two voices the AST 2.0 document names for Chinese and English targets
 * ("可选2个音色"): that document is their documentation for AST (R1), so they
 * speak zh and en on top of what ListSpeakers lists.
 */
export const AST_DOCUMENTED = ['zh_female_vv_uranus_bigtts', 'zh_male_jingqiangkanye_emo_mars_bigtts'] as const;

const AGE: Readonly<Record<string, Age>> = { 儿童: 'child', '少年/少女': 'teen', 青年: 'young', 中年: 'middle_aged', 老年: 'old' };
const GENDER: Readonly<Record<string, 'male' | 'female'>> = { 男: 'male', 女: 'female' };
const RESOURCE: Readonly<Record<string, 1 | 2>> = { 'seed-tts-1.0': 1, 'seed-tts-2.0': 2 };

function pick<T>(table: Readonly<Record<string, T>>, value: string, what: string, id: string): T {
  const v = table[value];
  if (v === undefined) throw new Error(`${id}: unknown ${what} "${value}" — extend build.ts's table`);
  return v;
}

/** The short sample when there is one, else the long one, as a path under `PREFIX`. */
function clipPath(e: RawSpeaker): string {
  const url = e.short_trial_url || e.trial_url;
  if (!url) throw new Error(`${e.voice_type}: no sample clip`);
  if (!url.startsWith(PREFIX)) throw new Error(`${e.voice_type}: sample clip outside ${PREFIX}: ${url}`);
  return url.slice(PREFIX.length);
}

const same = (a: CatalogLanguage, b: CatalogLanguage) => a.n === b.n && a.a === b.a && a.p === b.p;

/** A language equal to the voice's first is stored as `{}` (Vivi's five are one persona). */
function dedupe(v: CatalogVoice): CatalogVoice {
  const [first, ...rest] = Object.entries(v.l);
  return { ...v, l: Object.fromEntries([first, ...rest.map(([k, x]) => [k, same(x, first[1]) ? {} : x] as const)]) };
}

export function buildCatalog(entries: readonly RawSpeaker[], fetched: string): Catalog {
  const byId = new Map<string, CatalogVoice>();
  for (const e of entries) {
    if (ONE_WAY_ONLY.has(e.voice_type)) continue;
    const r = pick(RESOURCE, e.resource_id, 'resource', e.voice_type);
    const g = pick(GENDER, e.gender, 'gender', e.voice_type);
    let voice = byId.get(e.voice_type);
    if (!voice) {
      voice = { id: e.voice_type, r, g, l: {} };
      byId.set(e.voice_type, voice);
    } else if (voice.r !== r || voice.g !== g) {
      throw new Error(`${e.voice_type}: its entries disagree on resource or gender`);
    }
    const language: CatalogLanguage = { n: e.name, a: pick(AGE, e.age, 'age', e.voice_type), p: clipPath(e) };
    for (const l of e.languages ?? []) {
      const code = LANGUAGE[l.language];
      if (code && !(code in voice.l)) voice.l[code] = language;
    }
  }
  for (const id of AST_DOCUMENTED) {
    const voice = byId.get(id);
    const first = voice && Object.values(voice.l)[0];
    if (!voice || !first) continue;
    for (const code of ['zh', 'en'] as const) if (!(code in voice.l)) voice.l[code] = first;
  }
  const voices = [...byId.values()].filter((v) => Object.keys(v.l).length > 0).map(dedupe);
  return { v: 1, fetched, prefix: PREFIX, voices };
}

/** Valid JSON, one voice per line. */
export function formatCatalog(c: Catalog): string {
  const head = JSON.stringify({ v: c.v, fetched: c.fetched, prefix: c.prefix });
  return `${head.slice(0, -1)},"voices":[\n${c.voices.map((v) => JSON.stringify(v)).join(',\n')}\n]}\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [input, fetched = new Date().toISOString().slice(0, 10)] = process.argv.slice(2);
  if (!input) {
    console.error('usage: npx tsx scripts/doubao-voices/build.ts <ListSpeakers dump.json> [YYYY-MM-DD]');
    process.exit(1);
  }
  const catalog = buildCatalog(JSON.parse(readFileSync(input, 'utf8')) as RawSpeaker[], fetched);
  const out = join(process.cwd(), 'src', 'providers', 'volcengine_ast2', 'voices.json');
  writeFileSync(out, formatCatalog(catalog));
  console.log(`${catalog.voices.length} voices → ${out}`);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run scripts/doubao-voices/build.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Write `scripts/doubao-voices/fetch.py`** (the script that made the 2026-10-02 pull, taking its keys from the environment)

```python
"""Pull Doubao's public TTS voice list (ListSpeakers) as a raw dump for build.ts.

Maintainer-only (#577 catalog spec §1.1). Needs an account AK/SK allowed
speech_saas_prod:ListSpeakers — a sub-user's — and Volcengine's SDK in a
throwaway venv; neither the SDK nor any key belongs in the repo:

    python3 -m venv /tmp/volc && /tmp/volc/bin/pip install volcengine-python-sdk
    VOLC_AK=... VOLC_SK=... /tmp/volc/bin/python scripts/doubao-voices/fetch.py /tmp/speakers.json
"""
import json
import os
import sys

import volcenginesdkcore
import volcenginesdkspeechsaasprod as m
from volcenginesdkcore.rest import ApiException

if len(sys.argv) != 2:
    sys.exit('usage: fetch.py <out.json>')
ak, sk = os.environ.get('VOLC_AK'), os.environ.get('VOLC_SK')
if not ak or not sk:
    sys.exit('VOLC_AK and VOLC_SK are required')

cfg = volcenginesdkcore.Configuration()
cfg.ak, cfg.sk, cfg.region = ak, sk, 'cn-beijing'
volcenginesdkcore.Configuration.set_default(cfg)
api = m.SPEECHSAASPRODApi()

speakers, page = [], 1
while True:
    try:
        # Page alone: passing Limit is answered 400 InvalidParameter (2026-10-02); pages hold 10.
        r = api.list_speakers(m.ListSpeakersRequest(page=page))
    except ApiException as e:
        sys.exit(f'ListSpeakers failed on page {page}: {e.status} {e.body}')
    batch = [s.to_dict() for s in (r.speakers or [])]
    speakers += batch
    if not batch or len(speakers) >= (r.total or 0):
        break
    page += 1

with open(sys.argv[1], 'w') as f:
    json.dump(speakers, f, ensure_ascii=False, indent=1)
print(f'{len(speakers)} entries -> {sys.argv[1]}')
```

- [ ] **Step 7: Generate the snapshot from the 2026-10-02 dump**

Run: `npx tsx scripts/doubao-voices/build.ts /home/jiangzhuo/.claude/jobs/c1940130/tmp/speakers.json 2026-10-02`
Expected: `506 voices → …/src/providers/volcengine_ast2/voices.json`. Then `wc -c src/providers/volcengine_ast2/voices.json` reads well under 90000 bytes, and `head -c 300` shows `{"v":1,"fetched":"2026-10-02","prefix":"https://lf3-static…","voices":[` followed by Vivi's line.

- [ ] **Step 8: Commit**

```bash
git add scripts/doubao-voices src/providers/volcengine_ast2/catalogShape.ts src/providers/volcengine_ast2/voices.json
git commit -m "feat(volcengine_ast2): a 506-voice catalog snapshot built from ListSpeakers

build.ts turns a ListSpeakers dump into voices.json: one-way-only voices
dropped, languages mapped to app codes and kept to the nine a fixed voice
speaks, split entries merged per voice, the AST document's two voices given
zh and en, ListSpeakers order kept. fetch.py is the SDK pull that made the
2026-10-02 dump, for refreshes; no key or SDK enters the repo.

Refs #577

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Catalog lookups

**Files:**
- Create: `src/providers/volcengine_ast2/catalog.ts`
- Test: `src/providers/volcengine_ast2/catalog.test.ts`

**Interfaces:**
- Consumes: `voices.json`, `catalogShape.ts` (Task 1).
- Produces: `type FixedTarget = FixedLanguage | 'zh+en'`; `isFixedTarget(v: string): v is FixedTarget`; `interface CatalogEntry { id: string; resource: 'seed-tts-1.0' | 'seed-tts-2.0'; gender: 'male' | 'female'; age: Age; name: string; previewUrl: string }`; `voicesFor(target: string): readonly CatalogEntry[]`; `speaks(id: string, target: string): boolean`; `defaultVoice(target: string): CatalogEntry | undefined`; `resourceOf(id: string): CatalogEntry['resource'] | undefined`.

- [ ] **Step 1: Write the failing test `catalog.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import raw from './voices.json';
import { pairCode } from '../../lib/language/code';
import { FIXED_LANGUAGES, type Catalog } from './catalogShape';
import { defaultVoice, isFixedTarget, resourceOf, speaks, voicesFor } from './catalog';
import { ONE_WAY_ONLY } from '../../../scripts/doubao-voices/build';

const catalog = raw as Catalog;
const VIVI = 'zh_female_vv_uranus_bigtts';

describe("the snapshot's invariants (#577 catalog spec §1.3)", () => {
  it('holds unique voices, each with a resource, a gender and at least one of the nine languages', () => {
    const ids = catalog.voices.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const v of catalog.voices) {
      expect([1, 2], v.id).toContain(v.r);
      expect(['male', 'female'], v.id).toContain(v.g);
      expect(Object.keys(v.l).length, v.id).toBeGreaterThan(0);
      for (const code of Object.keys(v.l)) expect(FIXED_LANGUAGES, `${v.id} ${code}`).toContain(code);
      const first = Object.values(v.l)[0];
      expect(first.n && first.a && first.p, v.id).toBeTruthy();
    }
  });

  it('holds no one-way-only voice', () => {
    for (const v of catalog.voices) expect(ONE_WAY_ONLY.has(v.id), v.id).toBe(false);
  });

  it('counts the 2026-10-02 pull (a refresh updates these numbers in its own diff)', () => {
    expect(catalog.voices).toHaveLength(506);
    expect(Object.fromEntries(FIXED_LANGUAGES.map((c) => [c, voicesFor(c).length]))).toEqual({ zh: 362, en: 95, ja: 16, id: 14, es: 21, pt: 12, de: 1, fr: 3, ko: 3 });
    expect(voicesFor('zh+en')).toHaveLength(12);
  });
});

describe("the catalog's lookups", () => {
  it("names zh+en as the app's bidirectional code", () => {
    expect(pairCode('zh', 'en')).toBe('zh+en');
    expect(isFixedTarget('zh+en')).toBe(true);
    expect(isFixedTarget('ko')).toBe(true);
    expect(isFixedTarget('th')).toBe(false);
  });

  it('lists the voices of a target in ListSpeakers order, each named and sampled in that language', () => {
    const en = voicesFor('en');
    const harmony = en.find((v) => v.id === 'zh_male_jingqiangkanye_moon_bigtts')!;
    expect(harmony).toEqual({
      id: 'zh_male_jingqiangkanye_moon_bigtts', resource: 'seed-tts-1.0', gender: 'male', age: 'young', name: 'Harmony',
      previewUrl: `${catalog.prefix}portal/bigtts/short_trial_url/Harmony.mp3`,
    });
    expect(voicesFor('zh').find((v) => v.id === harmony.id)!.name).toBe('京腔侃爷');
    expect(en.map((v) => v.id)).toEqual(catalog.voices.filter((v) => 'en' in v.l).map((v) => v.id));
  });

  it('reads a {} language as the voice\'s first', () => {
    const ja = voicesFor('ja').find((v) => v.id === VIVI)!;
    const zh = voicesFor('zh').find((v) => v.id === VIVI)!;
    expect(ja).toEqual(zh);
  });

  it('lists for zh+en the voices that speak both, named in Chinese', () => {
    for (const v of voicesFor('zh+en')) expect(speaks(v.id, 'zh') && speaks(v.id, 'en'), v.id).toBe(true);
    expect(voicesFor('zh+en').find((v) => v.id === 'zh_male_jingqiangkanye_moon_bigtts')!.name).toBe('京腔侃爷');
  });

  it('answers whether a voice speaks a target, and its resource', () => {
    expect(speaks(VIVI, 'ja')).toBe(true);
    expect(speaks(VIVI, 'ko')).toBe(false);
    expect(speaks('en_male_alex_uranus_bigtts', 'zh')).toBe(false);
    expect(speaks('nope_bigtts', 'zh')).toBe(false);
    expect(resourceOf(VIVI)).toBe('seed-tts-2.0');
    expect(resourceOf('zh_male_jingqiangkanye_emo_mars_bigtts')).toBe('seed-tts-1.0');
    expect(resourceOf('nope_bigtts')).toBeUndefined();
  });

  it("takes a target's first voice as its default", () => {
    for (const code of ['zh', 'en', 'ja', 'es', 'id', 'zh+en']) expect(defaultVoice(code)!.id, code).toBe(VIVI);
    expect(defaultVoice('ko')!.id).toBe('ko_male_m03_uranus_bigtts');
    expect(defaultVoice('th')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/providers/volcengine_ast2/catalog.test.ts`
Expected: FAIL — `Failed to resolve import "./catalog"`.

- [ ] **Step 3: Write `catalog.ts`**

```ts
/**
 * Doubao's public TTS voices, as AST 2.0 can speak them (#577 catalog spec
 * §1.3): lookups over the `voices.json` snapshot that
 * `scripts/doubao-voices/build.ts` writes. Pure and synchronous.
 */
import raw from './voices.json';
import { FIXED_LANGUAGES, type Age, type Catalog, type CatalogLanguage, type CatalogVoice, type FixedLanguage } from './catalogShape';

const catalog = raw as Catalog;

/** A target a voice is chosen for: one of the nine languages, or Chinese↔English (`pairCode('zh', 'en')`). */
export type FixedTarget = FixedLanguage | 'zh+en';
const BOTH = 'zh+en';

export function isFixedTarget(v: string): v is FixedTarget {
  return v === BOTH || (FIXED_LANGUAGES as readonly string[]).includes(v);
}

/** A voice as one target shows it. */
export interface CatalogEntry {
  id: string;
  resource: 'seed-tts-1.0' | 'seed-tts-2.0';
  gender: 'male' | 'female';
  age: Age;
  name: string;
  previewUrl: string;
}

const byId = new Map(catalog.voices.map((v) => [v.id, v]));

/** A voice's language entry; `{}` (or a missing one) reads as its first. */
function language(v: CatalogVoice, code: string): Required<CatalogLanguage> {
  const own = v.l[code];
  return (own?.n !== undefined ? own : Object.values(v.l)[0]) as Required<CatalogLanguage>;
}

function entry(v: CatalogVoice, code: string): CatalogEntry {
  const l = language(v, code);
  return { id: v.id, resource: v.r === 1 ? 'seed-tts-1.0' : 'seed-tts-2.0', gender: v.g, age: l.a, name: l.n, previewUrl: catalog.prefix + l.p };
}

/** Whether a voice speaks a target; for zh+en, both Chinese and English. */
export function speaks(id: string, target: string): boolean {
  const v = byId.get(id);
  if (!v) return false;
  return target === BOTH ? 'zh' in v.l && 'en' in v.l : target in v.l;
}

const lists = new Map<string, readonly CatalogEntry[]>();

/** The voices of a target in catalog order, named and sampled in it (zh+en: in Chinese). */
export function voicesFor(target: string): readonly CatalogEntry[] {
  let list = lists.get(target);
  if (!list) {
    const code = target === BOTH ? 'zh' : target;
    list = catalog.voices.filter((v) => speaks(v.id, target)).map((v) => entry(v, code));
    lists.set(target, list);
  }
  return list;
}

export function defaultVoice(target: string): CatalogEntry | undefined {
  return voicesFor(target)[0];
}

export function resourceOf(id: string): CatalogEntry['resource'] | undefined {
  const v = byId.get(id);
  return v && (v.r === 1 ? 'seed-tts-1.0' : 'seed-tts-2.0');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/providers/volcengine_ast2/catalog.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/providers/volcengine_ast2/catalog.ts src/providers/volcengine_ast2/catalog.test.ts
git commit -m "feat(volcengine_ast2): look up the voices a target speaks in

voicesFor lists a target's voices in catalog order, named and sampled in
that language (zh+en: the twelve that speak both, in Chinese); speaks,
defaultVoice and resourceOf answer the rest. A test pins the snapshot's
invariants and the 2026-10-02 counts.

Refs #577

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Settings, languages and the effective voice

**Files:**
- Create: `src/providers/volcengine_ast2/voice.ts`
- Create: `src/providers/volcengine_ast2/voice.test.ts`
- Modify: `src/providers/volcengine_ast2/settings.ts`
- Modify: `src/providers/volcengine_ast2/settings.test.ts`

**Interfaces:**
- Consumes: `isFixedTarget`, `speaks`, `defaultVoice`, `FixedTarget` (Task 2).
- Produces: in `settings.ts`: `Ast2Settings.voices: Ast2Voices`, `type Ast2Voices = Partial<Record<FixedTarget, string>>`, `CLONING_LANGUAGES: ReadonlySet<string>`, and `ZH_EN`, `ast2Languages`, `ast2Offers(direction, s, context)` as before. In `voice.ts`: `CLONE = 'clone'`, `clonable(pair: LanguagePair): boolean`, `effectiveVoice(pair: LanguagePair, s: Pick<Ast2Settings, 'voices'>): string | undefined`. Removed: `AST2_VOICES`, `Ast2FixedVoice`, `Ast2Voice`, `fixedVoice`, the `voice` field.

- [ ] **Step 1: Rewrite the settings tests**

In `settings.test.ts`:

1. Replace the import of `./settings` with:

```ts
import { AST2_DEFAULTS, ast2Credentials, ast2Languages, ast2Offers, migrateAst2Settings, ZH_EN, type Ast2Settings } from './settings';
```

2. Delete the `FEMALE`, `MALE`, `FIXED`, `EVERY_VOICE` constants, the `describe("Doubao AST 2.0's fixed voices (#577)", …)` block, the `it('keep a fixed voice once chosen, …')` test, and the whole `describe("Doubao AST 2.0's languages with a fixed voice (#577; #576 §3)", …)` block.

3. Change the defaults test's expectation to:

```ts
expect(AST2_DEFAULTS).toEqual({ authMode: 'app', hotWordTableId: '', replacementTableId: '', glossaryTableId: '', voices: {} });
```

4. After `it('read a wrong-typed field as its default, …')`, add:

```ts
  it('keep the voices chosen per target, and drop a key, a value or a voice that does not hold (#577 catalog §2.4)', () => {
    const kept = { en: 'clone', ja: 'ja_female_bv024_uranus_bigtts', 'zh+en': 'zh_female_vv_uranus_bigtts' };
    expect(migrateAst2Settings({ ...AST2_DEFAULTS, voices: kept }).voices).toEqual(kept);
    // th is no fixed target; bv024 speaks Japanese, not English; a refresh removed nope; 3 is no voice.
    expect(migrateAst2Settings({ voices: { th: 'clone', en: 'ja_female_bv024_uranus_bigtts', ja: 'nope_bigtts', de: 3, ko: 'clone' } }).voices).toEqual({ ko: 'clone' });
  });

  it('read a voices value of the wrong type as no choice (Review Focus)', () => {
    for (const voices of ['{"en":"clone"}', ['clone'], 7, null]) expect(migrateAst2Settings({ voices }).voices, String(voices)).toEqual({});
    expect(migrateAst2Settings({ hotWordTableId: 'hot-1' }).voices).toEqual({});
  });
```

5. Replace the whole `describe("Doubao AST 2.0's languages (ruling 3; choice 1)", …)` block with:

```ts
const NINE = ['zh', 'en', 'ja', 'id', 'es', 'pt', 'de', 'fr', 'ko'];
const ALL_SOURCES = [...SPOKEN, ...TEXT_ONLY, ...DIALECTS, ZH_EN];

describe("Doubao AST 2.0's languages (#577 catalog §2.1)", () => {
  it('offer the twenty languages, the two dialects and zh+en as sources whether or not the run speaks', () => {
    for (const context of [SPEAKING, TEXT, undefined]) expect(values(ast2Languages.sources(AST2_DEFAULTS, context))).toEqual(ALL_SOURCES);
    expect(ast2Languages.initial?.(AST2_DEFAULTS)).toEqual({ source: 'zh', target: 'en' });
  });

  it('speak from Chinese or English into the nine languages a voice speaks, Korean included', () => {
    expect(values(ast2Languages.targets('zh', AST2_DEFAULTS, SPEAKING))).toEqual(NINE.filter((v) => v !== 'zh'));
    expect(values(ast2Languages.targets('en', AST2_DEFAULTS, SPEAKING))).toEqual(NINE.filter((v) => v !== 'en'));
  });

  it('translate from Chinese or English into all twenty as text', () => {
    expect(values(ast2Languages.targets('en', AST2_DEFAULTS, TEXT))).toEqual([...SPOKEN, ...TEXT_ONLY].filter((v) => v !== 'en'));
    for (const source of values(ast2Languages.sources(AST2_DEFAULTS, TEXT))) {
      expect(values(ast2Languages.targets(source, AST2_DEFAULTS)), source).toEqual(values(ast2Languages.targets(source, AST2_DEFAULTS, TEXT)));
    }
  });

  it('reach English or Chinese, English first, from any other source', () => {
    for (const context of [SPEAKING, TEXT]) {
      for (const source of ['ja', 'fr', 'ko', 'ru', 'it', 'yue', 'wuu']) expect(values(ast2Languages.targets(source, AST2_DEFAULTS, context)), source).toEqual(['en', 'zh']);
    }
  });

  it('pair zh+en only with itself', () => {
    for (const context of [SPEAKING, TEXT]) {
      expect(values(ast2Languages.targets(ZH_EN, AST2_DEFAULTS, context))).toEqual([ZH_EN]);
      for (const source of ALL_SOURCES.filter((v) => v !== ZH_EN)) expect(values(ast2Languages.targets(source, AST2_DEFAULTS, context)), source).not.toContain(ZH_EN);
    }
  });

  it('never offer a dialect as a target, nor a source as its own target', () => {
    for (const context of [SPEAKING, TEXT]) {
      for (const source of ALL_SOURCES) {
        const targets = values(ast2Languages.targets(source, AST2_DEFAULTS, context));
        for (const dialect of DIALECTS) expect(targets, source).not.toContain(dialect);
        if (source !== ZH_EN) expect(targets, source).not.toContain(source);
      }
    }
  });

  it("keep the speaking offer within the text-only one (the registry's invariant)", () => {
    const textSources = values(ast2Languages.sources(AST2_DEFAULTS, TEXT));
    for (const source of values(ast2Languages.sources(AST2_DEFAULTS, SPEAKING))) {
      expect(textSources, source).toContain(source);
      const textTargets = values(ast2Languages.targets(source, AST2_DEFAULTS, TEXT));
      for (const target of values(ast2Languages.targets(source, AST2_DEFAULTS, SPEAKING))) expect(textTargets, `${source} → ${target}`).toContain(target);
    }
  });

  it('offer every pair cloning runs when the run speaks, so no pair a user runs today disappears', () => {
    for (const source of SPOKEN) {
      for (const target of SPOKEN) {
        if (source === target || !(['zh', 'en'].includes(source) || ['zh', 'en'].includes(target))) continue;
        expect(ast2Offers({ source, target }, AST2_DEFAULTS, SPEAKING), `${source} → ${target}`).toBe(true);
      }
    }
    expect(ast2Offers({ source: ZH_EN, target: ZH_EN }, AST2_DEFAULTS, SPEAKING)).toBe(true);
  });

  it('do not depend on the voices chosen (R7)', () => {
    const chosen: Ast2Settings = { ...AST2_DEFAULTS, voices: { en: 'en_male_alex_uranus_bigtts', ja: 'clone' } };
    for (const context of [SPEAKING, TEXT]) {
      expect(ast2Languages.sources(chosen, context)).toEqual(ast2Languages.sources(AST2_DEFAULTS, context));
      for (const source of ALL_SOURCES) expect(ast2Languages.targets(source, chosen, context), source).toEqual(ast2Languages.targets(source, AST2_DEFAULTS, context));
    }
  });

  it('offer app codes; Doubao gets its own on the wire', () => {
    for (const v of ALL_SOURCES) expect(parseCode(v), v).not.toBeNull();
    expect(ast2Languages.wire?.toWire('zh+en')).toBe('zhen');
    expect(ast2Languages.wire?.toWire('yue')).toBe('yue-CN');
    expect(ast2Languages.wire?.toWire('wuu')).toBe('sh-CN');
    expect(ast2Languages.wire?.toWire('ko')).toBe('ko');
  });

  it('reverse an offered pair (D20) when its source is a target of the mode: never a dialect, and when speaking only the nine and zh+en', () => {
    for (const context of [SPEAKING, TEXT]) {
      const speakingTarget = (v: string) => v === ZH_EN || NINE.includes(v);
      for (const source of values(ast2Languages.sources(AST2_DEFAULTS, context))) {
        for (const target of values(ast2Languages.targets(source, AST2_DEFAULTS, context))) {
          const expected = !DIALECTS.includes(source) && (context === TEXT || speakingTarget(source));
          expect(reverseSupported(p, AST2_DEFAULTS, { source, target }, context), `${source} → ${target}`).toBe(expected);
        }
      }
    }
    // ru → en speaks; en → ru does not: Russian is text only as a target.
    expect(reverseSupported(p, AST2_DEFAULTS, { source: 'ru', target: 'en' }, SPEAKING)).toBe(false);
    expect(swapped(p, AST2_DEFAULTS, { source: ZH_EN, target: ZH_EN }, SPEAKING)).toBeNull();
  });

  it("keep what they can of a pair, by normalizePair (the spec's rule)", () => {
    // Now spoken: Korean, the dialects, Korean as a target.
    expect(normalizePair(p, AST2_DEFAULTS, { source: 'ko', target: 'zh' }, SPEAKING)).toEqual({ source: 'ko', target: 'zh' });
    expect(normalizePair(p, AST2_DEFAULTS, { source: 'zh', target: 'ko' }, SPEAKING)).toEqual({ source: 'zh', target: 'ko' });
    expect(normalizePair(p, AST2_DEFAULTS, { source: 'yue', target: 'en' }, SPEAKING)).toEqual({ source: 'yue', target: 'en' });
    // Russian is text only as a target: the first target of the source.
    expect(normalizePair(p, AST2_DEFAULTS, { source: 'zh', target: 'ru' }, SPEAKING)).toEqual({ source: 'zh', target: 'en' });
    expect(normalizePair(p, AST2_DEFAULTS, { source: 'zh', target: 'ru' }, TEXT)).toEqual({ source: 'zh', target: 'ru' });
  });

  it("repair the old UI's pairs: zhen with anything becomes zhen/zhen, a pair with neither Chinese nor English gets English (the old rules R1, R3)", () => {
    expect(normalizePair(p, AST2_DEFAULTS, { source: ZH_EN, target: 'en' })).toEqual({ source: ZH_EN, target: ZH_EN });
    expect(normalizePair(p, AST2_DEFAULTS, { source: 'en', target: ZH_EN })).toEqual({ source: 'en', target: 'zh' });
    expect(normalizePair(p, AST2_DEFAULTS, { source: 'ja', target: 'de' })).toEqual({ source: 'ja', target: 'en' });
    expect(normalizePair(p, AST2_DEFAULTS, { source: ZH_EN, target: 'ja' }, SPEAKING)).toEqual({ source: ZH_EN, target: ZH_EN });
    expect(normalizePair(p, AST2_DEFAULTS, { source: 'fr', target: ZH_EN }, SPEAKING)).toEqual({ source: 'fr', target: 'en' });
  });

  it("say whether Doubao runs a direction in a mode: build's guard", () => {
    expect(ast2Offers({ source: 'ja', target: 'zh' }, AST2_DEFAULTS, SPEAKING)).toBe(true);
    expect(ast2Offers({ source: 'ko', target: 'zh' }, AST2_DEFAULTS, SPEAKING)).toBe(true);
    expect(ast2Offers({ source: 'zh', target: 'ru' }, AST2_DEFAULTS, SPEAKING)).toBe(false);
    expect(ast2Offers({ source: 'zh', target: 'ru' }, AST2_DEFAULTS, TEXT)).toBe(true);
    expect(ast2Offers({ source: 'ja', target: 'de' }, AST2_DEFAULTS, TEXT)).toBe(false);
    expect(ast2Offers({ source: 'en', target: 'yue' }, AST2_DEFAULTS, TEXT)).toBe(false);
  });
});
```

- [ ] **Step 2: Write the failing test `voice.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { AST2_DEFAULTS } from './settings';
import { CLONE, clonable, effectiveVoice } from './voice';

const VIVI = 'zh_female_vv_uranus_bigtts';
const ALEX = 'en_male_alex_uranus_bigtts';
const pair = (source: string, target: string) => ({ source, target });
const withVoices = (voices: Record<string, string>) => ({ ...AST2_DEFAULTS, voices });

describe('clonable (#577 catalog §2.2)', () => {
  it('is the cloning model: lang_8 both sides with Chinese or English on one, or zh+en with itself', () => {
    for (const [s, t] of [['zh', 'en'], ['en', 'zh'], ['ja', 'zh'], ['en', 'fr'], ['zh', 'pt'], ['zh+en', 'zh+en']]) expect(clonable(pair(s, t)), `${s} → ${t}`).toBe(true);
  });

  it('is false where the server answers "group model … not found" (#576), and for nonsense pairs', () => {
    for (const [s, t] of [['ko', 'en'], ['zh', 'ko'], ['yue', 'zh'], ['ru', 'en'], ['ja', 'de'], ['zh', 'zh'], ['zh+en', 'en'], ['en', 'zh+en']]) expect(clonable(pair(s, t)), `${s} → ${t}`).toBe(false);
  });
});

describe('effectiveVoice (#577 catalog §2.4)', () => {
  it('clones a pair cloning runs when nothing is chosen, as every profile before the catalog did', () => {
    expect(effectiveVoice(pair('zh', 'en'), AST2_DEFAULTS)).toBe(CLONE);
    expect(effectiveVoice(pair('zh+en', 'zh+en'), AST2_DEFAULTS)).toBe(CLONE);
  });

  it("speaks the target's first voice on a pair cloning does not run", () => {
    expect(effectiveVoice(pair('ko', 'en'), AST2_DEFAULTS)).toBe(VIVI);
    expect(effectiveVoice(pair('zh', 'ko'), AST2_DEFAULTS)).toBe('ko_male_m03_uranus_bigtts');
  });

  it('speaks the voice chosen for the target', () => {
    expect(effectiveVoice(pair('zh', 'en'), withVoices({ en: ALEX }))).toBe(ALEX);
    expect(effectiveVoice(pair('ko', 'en'), withVoices({ en: ALEX }))).toBe(ALEX);
    expect(effectiveVoice(pair('zh+en', 'zh+en'), withVoices({ 'zh+en': 'zh_female_shuangkuaisisi_moon_bigtts' }))).toBe('zh_female_shuangkuaisisi_moon_bigtts');
  });

  it("keeps a stored clone for a pair it cannot run, without overwriting it, and applies it again where it can", () => {
    const s = withVoices({ en: CLONE });
    expect(effectiveVoice(pair('ko', 'en'), s)).toBe(VIVI);
    expect(effectiveVoice(pair('zh', 'en'), s)).toBe(CLONE);
    expect(s.voices).toEqual({ en: CLONE });
  });

  it('falls back when the chosen voice cannot speak the target or is gone (Review Focus)', () => {
    expect(effectiveVoice(pair('zh', 'en'), withVoices({ en: 'ja_female_bv024_uranus_bigtts' }))).toBe(CLONE);
    expect(effectiveVoice(pair('ko', 'en'), withVoices({ en: 'nope_bigtts' }))).toBe(VIVI);
  });

  it('reads only the slot of the target', () => {
    expect(effectiveVoice(pair('zh', 'ja'), withVoices({ en: ALEX }))).toBe(CLONE);
  });
});
```

- [ ] **Step 3: Run both to verify they fail**

Run: `npx vitest run src/providers/volcengine_ast2/settings.test.ts src/providers/volcengine_ast2/voice.test.ts`
Expected: FAIL — `voice.test.ts`: `Failed to resolve import "./voice"`; `settings.test.ts`: the defaults test (no `voices`), the sources test (speaking still offers eight), the Korean and normalizePair tests.

- [ ] **Step 4: Change `settings.ts`**

1. Replace the import block's last line and add the catalog import:

```ts
import type { CredentialField, CredentialsMissing, LanguageContext, LanguageOption, Provider } from '../../lib/provider/types';
import { isFixedTarget, speaks, type FixedTarget } from './catalog';
```

2. Replace the `voice` field, everything from `/** The fixed voices the AST 2.0 document lists` through `const VOICES: readonly unknown[] = …;` and `AST2_DEFAULTS` with:

```ts
  /** The voice chosen per target language (#577 catalog §2.4): `'clone'` or a catalog voice id. Absent: the effective voice's fallbacks (`voice.ts`). */
  voices: Ast2Voices;
}

export type Ast2Voices = Partial<Record<FixedTarget, string>>;

export const AST2_DEFAULTS: Ast2Settings = {
  authMode: 'app',
  hotWordTableId: '',
  replacementTableId: '',
  glossaryTableId: '',
  voices: {},
};

const AUTH_MODES: readonly unknown[] = ['app', 'apiKey'];

/**
 * The stored choices that still hold: a fixed target's slot naming `'clone'`
 * or a catalog voice that speaks it. A voice a refresh removed, or anything
 * that is not a plain object, is dropped; nothing is written back.
 */
function readVoices(stored: unknown): Ast2Voices {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
  const voices: Ast2Voices = {};
  for (const [target, id] of Object.entries(stored)) {
    if (isFixedTarget(target) && typeof id === 'string' && (id === 'clone' || speaks(id, target))) voices[target] = id;
  }
  return voices;
}
```

3. In `migrateAst2Settings`, replace the two `voice` lines with:

```ts
    voices: readVoices(stored.voices),
```

4. Replace everything from `const SPOKEN_SOURCES` through the end of `ast2Languages`'s `targets:` line with:

```ts
const TEXT_SOURCES: readonly LanguageOption[] = [...SPOKEN, ...TEXT_ONLY, ...DIALECTS, BIDIRECTIONAL];
const ZH_OR_EN = new Set(['zh', 'en']);
const ONLY_ZH_EN: readonly LanguageOption[] = [BIDIRECTIONAL];
/** English first, so leaving `zh+en` on the source lands on English, as the old rule R3 did. */
const TO_EN_OR_ZH: readonly LanguageOption[] = [SPOKEN[1], SPOKEN[0]];
/** The targets a speaking leg reaches from Chinese or English: the nine some catalog voice speaks (catalog spec §1.1 rule 3). */
const SPOKEN_TARGETS: readonly LanguageOption[] = [...SPOKEN, code('ko')];

/** The eight languages the cloning model speaks ("声音复刻模式": lang_8), for `voice.ts`'s `clonable`. */
export const CLONING_LANGUAGES: ReadonlySet<string> = new Set(SPOKEN.map((o) => o.value));

/**
 * The targets of a source (ruling 3; #577 catalog §2.1). `zh+en` pairs only
 * with itself. Every other pair has Chinese or English on one side — S2T's
 * rule ("源语种或目标语种必须是中英") and, measured, the speaking one's
 * (ja→ko: "unsupported source or target language"). Speaking reaches the
 * nine languages a catalog voice speaks; cloning's eight are among them, so
 * the offer does not depend on the voice (R7). A dialect is never a target.
 */
function targetsOf(source: string, speech: boolean): readonly LanguageOption[] {
  if (source === ZH_EN) return ONLY_ZH_EN;
  if (!ZH_OR_EN.has(source)) return TO_EN_OR_ZH;
  return (speech ? SPOKEN_TARGETS : [...SPOKEN, ...TEXT_ONLY]).filter((o) => o.value !== source);
}

/**
 * Doubao's languages (ruling 3; #577 catalog §2.1): the twenty, the two
 * dialects and zh+en as sources in every context — a fixed voice takes them
 * all ("指定音色模式: 源语种 lang_20、方言") — and the targets `targetsOf` gives.
 * Without a context, the widest offer, text only's.
 */
export const ast2Languages: Provider<Ast2Settings, never, never>['languages'] = {
  sources: () => TEXT_SOURCES,
  targets: (source, _s, context?: LanguageContext) => targetsOf(source, context?.speech === true),
```

(Leave `initial`, `wire` and `ast2Offers` exactly as they are.)

5. Update the module comment's last sentence to: `Stored under \`settings.volcengineAST2.*\` as before. Nothing here imports \`src/services\`.` (unchanged) — and confirm no reference to `fixedVoice`, `AST2_VOICES`, `Ast2Voice` or `modeOf` remains: `grep -n "fixedVoice\|AST2_VOICES\|Ast2Voice\b\|modeOf" src/providers/volcengine_ast2/settings.ts` prints nothing.

- [ ] **Step 5: Write `voice.ts`**

```ts
/**
 * Which voice a Doubao AST 2.0 pair speaks in (#577 catalog §2.2–2.4).
 * Cloning is a peer of the catalog's voices, not a mode: it runs only the
 * pairs the cloning model has ("声音复刻模式"), and every other speaking pair
 * takes a catalog voice. Pure; nothing here writes a setting.
 */
import type { LanguagePair } from '../../lib/provider/types';
import { defaultVoice, isFixedTarget, speaks } from './catalog';
import { CLONING_LANGUAGES, ZH_EN, type Ast2Settings } from './settings';

/** The voice-list entry, and the stored value, for the speaker's own voice. */
export const CLONE = 'clone';

const zhOrEn = (v: string) => v === 'zh' || v === 'en';

/**
 * Whether the cloning model runs a pair: lang_8 on both sides with Chinese or
 * English on one, or zh+en with itself. Elsewhere the server answers "group
 * model:volc_tob-<src>2<tgt>-s2s not found" (#576; ko→en, yue→zh, zh→ko).
 */
export function clonable({ source, target }: LanguagePair): boolean {
  if (source === ZH_EN || target === ZH_EN) return source === ZH_EN && target === ZH_EN;
  if (source === target) return false;
  return CLONING_LANGUAGES.has(source) && CLONING_LANGUAGES.has(target) && (zhOrEn(source) || zhOrEn(target));
}

/**
 * The voice a pair speaks in: the one chosen for its target when it can run
 * the pair; else cloning where cloning runs it, so a profile from before the
 * catalog keeps cloning; else the target's first catalog voice. A fallback
 * never writes: a stored choice outlives a pair it cannot apply to.
 * Undefined only for a target no voice speaks, which no offered pair has.
 */
export function effectiveVoice(pair: LanguagePair, s: Pick<Ast2Settings, 'voices'>): string | undefined {
  const chosen = isFixedTarget(pair.target) ? s.voices[pair.target] : undefined;
  if (chosen === CLONE ? clonable(pair) : chosen !== undefined && speaks(chosen, pair.target)) return chosen;
  if (clonable(pair)) return CLONE;
  return defaultVoice(pair.target)?.id;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/providers/volcengine_ast2/settings.test.ts src/providers/volcengine_ast2/voice.test.ts`
Expected: PASS. (`config.test.ts` and `adapter.test.ts` still fail until Task 4; do not run the folder yet.)

- [ ] **Step 7: Commit**

```bash
git add src/providers/volcengine_ast2/settings.ts src/providers/volcengine_ast2/settings.test.ts src/providers/volcengine_ast2/voice.ts src/providers/volcengine_ast2/voice.test.ts
git commit -m "feat(volcengine_ast2): one voice per target, languages that do not depend on it

The two-voice field gives way to voices, one choice per target language,
'clone' or a catalog voice; a stored choice that no longer holds is dropped
on read. Cloning becomes a peer of the catalog's voices: clonable says
which pairs the cloning model runs, and effectiveVoice falls back from the
chosen voice to cloning to the target's first voice without writing. A
speaking leg now takes the twenty languages, the dialects and Korean as a
target, since some voice speaks each; every pair cloning runs stays.

Refs #577

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The session's voice

**Files:**
- Modify: `src/providers/volcengine_ast2/config.ts`
- Modify: `src/providers/volcengine_ast2/config.test.ts`
- Modify: `src/providers/volcengine_ast2/adapter.test.ts`

**Interfaces:**
- Consumes: `CLONE`, `effectiveVoice` (Task 3); `resourceOf` (Task 2).
- Produces: `buildAst2` puts `voice: { speakerId, ttsResourceId }` in `Ast2Config` for a speaking leg on a catalog voice (unchanged `Ast2VoiceConfig` type).

- [ ] **Step 1: Rewrite the config tests**

In `config.test.ts`, replace the three tests `96feb2ef` added (`'speaks a fixed voice with the resource it runs on, …'`, `'names no voice for a leg that does not speak, whatever is chosen'`, `"runs, in a fixed voice, what only that mode offers, …"`) and the existing `"refuses a direction its mode does not run — …"` test with:

```ts
  it('clones a pair cloning runs when no voice is chosen, naming no voice (#577 catalog §2.5)', () => {
    expect(build()).toEqual({ mode: 's2s', sourceLanguage: 'zh', targetLanguage: 'en' });
    expect(build({ voices: { en: 'clone' } })).toEqual({ mode: 's2s', sourceLanguage: 'zh', targetLanguage: 'en' });
  });

  it('speaks the voice chosen for the target, on the resource it runs on', () => {
    expect(build({ voices: { en: 'zh_male_jingqiangkanye_emo_mars_bigtts' } }).voice).toEqual({ speakerId: 'zh_male_jingqiangkanye_emo_mars_bigtts', ttsResourceId: 'seed-tts-1.0' });
    expect(build({ voices: { en: 'en_male_alex_uranus_bigtts' } }).voice).toEqual({ speakerId: 'en_male_alex_uranus_bigtts', ttsResourceId: 'seed-tts-2.0' });
  });

  it("speaks the target's first voice on a pair cloning does not run", () => {
    const at = (source: string, target: string): SessionContext => ({ direction: { source, target }, speech: true, turns: 'auto' });
    expect(build({}, at('ko', 'en'))).toMatchObject({ mode: 's2s', sourceLanguage: 'ko', voice: { speakerId: 'zh_female_vv_uranus_bigtts', ttsResourceId: 'seed-tts-2.0' } });
    expect(build({}, at('zh', 'ko')).voice).toEqual({ speakerId: 'ko_male_m03_uranus_bigtts', ttsResourceId: 'seed-tts-2.0' });
    expect(build({}, at('yue', 'zh'))).toMatchObject({ sourceLanguage: 'yue-CN', voice: { speakerId: 'zh_female_vv_uranus_bigtts' } });
    // A stored clone for English cannot run ko → en: the first voice, and the slot is left alone.
    expect(build({ voices: { en: 'clone' } }, at('ko', 'en')).voice?.speakerId).toBe('zh_female_vv_uranus_bigtts');
  });

  it('never sends a voice a refresh removed: the fallback runs instead (Review Focus)', () => {
    expect(build({ voices: { en: 'nope_bigtts' } })).not.toHaveProperty('voice');
  });

  it('names no voice for a leg that does not speak, whatever is chosen', () => {
    expect(build({ voices: { en: 'en_male_alex_uranus_bigtts' } }, { ...SPEAKER, speech: false })).toEqual({ mode: 's2t', sourceLanguage: 'zh', targetLanguage: 'en' });
  });

  it("speaks the participant leg's own target's voice (Review Focus)", () => {
    const voices = { en: 'en_male_alex_uranus_bigtts', zh: 'zh_male_jingqiangkanye_emo_mars_bigtts' };
    const participant: SessionContext = { direction: { source: 'en', target: 'zh' }, speech: true, turns: 'auto' };
    expect(build({ voices }).voice?.speakerId).toBe('en_male_alex_uranus_bigtts');
    expect(build({ voices }, participant).voice?.speakerId).toBe('zh_male_jingqiangkanye_emo_mars_bigtts');
  });

  it('refuses a direction its mode does not run, as a guard', () => {
    expect(buildAst2({ direction: { source: 'zh', target: 'ru' }, speech: true, turns: 'auto' }, AST2_DEFAULTS, SHARED)).toEqual({ refused: 'Doubao AST 2.0 does not speak zh → ru.' });
    expect(buildAst2({ direction: { source: 'ja', target: 'de' }, speech: false, turns: 'auto' }, AST2_DEFAULTS, SHARED)).toEqual({ refused: 'Doubao AST 2.0 does not translate ja → de.' });
    expect(build({}, { direction: { source: 'zh', target: 'ru' }, speech: false, turns: 'auto' })).toEqual({ mode: 's2t', sourceLanguage: 'zh', targetLanguage: 'ru' });
    expect(build({}, { direction: { source: 'zh+en', target: 'zh+en' }, speech: true, turns: 'manual' })).toEqual({ mode: 's2s', sourceLanguage: 'zhen', targetLanguage: 'zhen' });
  });
```

- [ ] **Step 2: Update the adapter test's patch**

In `adapter.test.ts`, in `it('starts its session in the chosen fixed voice, …')`, replace

```ts
    const h = startAst2({ patch: { voice: 'zh_female_vv_uranus_bigtts' } });
```

with

```ts
    const h = startAst2({ patch: { voices: { en: 'zh_female_vv_uranus_bigtts' } } });
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run src/providers/volcengine_ast2/config.test.ts src/providers/volcengine_ast2/adapter.test.ts`
Expected: FAIL — `config.ts` still imports `fixedVoice` from `./settings` (no longer exported), so both files fail to load.

- [ ] **Step 4: Change `config.ts`**

Replace the settings import with:

```ts
import { resourceOf } from './catalog';
import { ast2Languages, ast2Offers, type Ast2Settings } from './settings';
import { CLONE, effectiveVoice } from './voice';
```

Replace the body of `buildAst2` from `const corpus = buildCorpus(s);` to its closing `};` with:

```ts
  const corpus = buildCorpus(s);
  // The same libraries on both legs (parity): the build cannot tell the legs of a `zh+en` pair apart (choice 6).
  const wire = ast2Languages.wire;
  // A speaking leg's voice for its own direction (#577 catalog §2.5); a text-only leg has none, and cloning is no field at all.
  const voice = context.speech ? effectiveVoice(context.direction, s) : undefined;
  if (context.speech && voice === undefined) return { refused: `Doubao AST 2.0 has no voice that speaks ${target}.` };
  const ttsResourceId = voice !== undefined && voice !== CLONE ? resourceOf(voice) : undefined;
  return {
    mode: context.speech ? 's2s' : 's2t',
    sourceLanguage: wire.toWire(source),
    targetLanguage: wire.toWire(target),
    ...(corpus ? { corpus } : {}),
    ...(voice && ttsResourceId ? { voice: { speakerId: voice, ttsResourceId } } : {}),
  };
```

- [ ] **Step 5: Run the whole provider folder**

Run: `npx vitest run src/providers/volcengine_ast2`
Expected: every file passes except `Ast2Settings.test.tsx`, which still imports `AST2_VOICES` through `Ast2Settings.tsx`; Task 5 replaces that view. Confirm it is the only failing file.

- [ ] **Step 6: Commit**

```bash
git add src/providers/volcengine_ast2/config.ts src/providers/volcengine_ast2/config.test.ts src/providers/volcengine_ast2/adapter.test.ts
git commit -m "feat(volcengine_ast2): a speaking leg runs in its target's effective voice

buildAst2 resolves the leg's own direction: a catalog voice adds speaker_id
and the tts_resource_id it runs on, cloning adds nothing, so cloning and
text-only legs send the frame they always did. The participant leg speaks
its own target's voice; a removed voice is never sent.

Refs #577

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The voice library in the settings view, with preview and strings

**Files:**
- Create: `src/providers/volcengine_ast2/preview.ts`
- Create: `src/providers/volcengine_ast2/preview.test.ts`
- Modify: `src/providers/volcengine_ast2/Ast2Settings.tsx`
- Modify: `src/providers/volcengine_ast2/Ast2Settings.test.tsx`
- Modify: `src/locales/*/translation.json` (all 30)

**Interfaces:**
- Consumes: `voicesFor` (Task 2); `CLONE`, `clonable`, `effectiveVoice` (Task 3); `VoiceLibrarySection`, `VoiceEntry` (`src/components/Settings/sections/VoiceLibrarySection.tsx`); `VoiceLibraryCapability` (`src/types/VoiceLibrary.ts`); `VoicePreviewContext` (`src/components/providers/VoicePreviewContext`).
- Produces: `previewVoice(id: string, target: string, signal?: AbortSignal, deps?: PreviewDeps): Promise<{ audio: Float32Array; sampleRate: number } | null>`.

- [ ] **Step 1: Write the failing test `preview.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { reportError } = vi.hoisted(() => ({ reportError: vi.fn() }));
vi.mock('../../lib/diagnostics/report', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/diagnostics/report')>()),
  reportError,
}));

import { previewVoice, type PreviewDeps } from './preview';
import { voicesFor } from './catalog';

const HARMONY = 'zh_male_jingqiangkanye_moon_bigtts';
const samples = new Float32Array([0.1, -0.2, 0.3]);
const decoded = { sampleRate: 24000, getChannelData: () => samples } as unknown as AudioBuffer;

function deps(response: Partial<Response> | Error): PreviewDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    fetch: (async (url: string) => {
      calls.push(url);
      if (response instanceof Error) throw response;
      return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8), ...response } as Response;
    }) as unknown as typeof fetch,
    decode: async () => decoded,
  };
}

beforeEach(() => reportError.mockClear());

describe('previewVoice (#577 catalog §4)', () => {
  it("fetches the voice's sample for the target's persona and returns its samples", async () => {
    const d = deps({});
    const clip = await previewVoice(HARMONY, 'en', undefined, d);
    expect(d.calls).toEqual([voicesFor('en').find((v) => v.id === HARMONY)!.previewUrl]);
    expect(d.calls[0]).toMatch(/\/Harmony\.mp3$/);
    expect(clip).toEqual({ audio: samples, sampleRate: 24000 });
    expect(clip!.audio).not.toBe(samples);
  });

  it('returns null without fetching for a voice the target does not list', async () => {
    const d = deps({});
    expect(await previewVoice('nope_bigtts', 'en', undefined, d)).toBeNull();
    expect(d.calls).toEqual([]);
  });

  it('reports a failed download once and returns null, since the library swallows a rejection', async () => {
    expect(await previewVoice(HARMONY, 'en', undefined, deps({ ok: false, status: 404 }))).toBeNull();
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError.mock.calls[0][1]).toMatch(/Harmony.*HTTP 404/);
  });

  it('does not report a preview the user stopped (Review Focus)', async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await previewVoice(HARMONY, 'en', controller.signal, deps(Object.assign(new Error('aborted'), { name: 'AbortError' })))).toBeNull();
    expect(reportError).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rewrite `Ast2Settings.test.tsx`'s voice tests**

Replace the `"offers cloning first, then the two fixed voices, …"` test and the `"locks the voice and the three fields while disabled"` test with:

```tsx
  it('lists cloning first, then the voices of the target in their own language, and writes the choice to the target (#577 catalog §3)', () => {
    const update = vi.fn();
    render(<Ast2SettingsView settings={AST2_DEFAULTS} update={update} pair={{ source: 'zh', target: 'en' }} />);
    expect(screen.getByRole('heading', { name: 'settings.voiceSettings' })).toBeInTheDocument();
    const props = libraryProps();
    expect(props.voices[0]).toMatchObject({ id: 'clone', label: 'providers.volcengine_ast2.voiceClone', group: 'builtin', removable: false });
    expect(props.voices.slice(1).map((v) => v.id)).toEqual(voicesFor('en').map((v) => v.id));
    expect(props.voices.find((v) => v.id === 'zh_male_jingqiangkanye_moon_bigtts')).toMatchObject({ label: 'Harmony', previewable: true, meta: { facets: { gender: 'male', age: 'young' } } });
    expect(props.selectedId).toBe('clone');
    expect(props.capability).toEqual({ importModes: [], facetFilter: true });
    expect(props.manageNote).toBe('providers.volcengine_ast2.voiceHint');
    props.onSelect('en_male_alex_uranus_bigtts');
    expect(update).toHaveBeenCalledWith({ voices: { en: 'en_male_alex_uranus_bigtts' } });
  });

  it('lists no cloning entry for a pair cloning does not run, and selects the effective voice', () => {
    render(<Ast2SettingsView settings={AST2_DEFAULTS} update={vi.fn()} pair={{ source: 'ko', target: 'en' }} />);
    const props = libraryProps();
    expect(props.voices.map((v) => v.id)).not.toContain('clone');
    expect(props.selectedId).toBe('zh_female_vv_uranus_bigtts');
  });

  it("writes the new target's slot after the target changed, leaving the old one (Review Focus)", () => {
    const update = vi.fn();
    const settings = { ...AST2_DEFAULTS, voices: { en: 'en_male_alex_uranus_bigtts' } };
    render(<Ast2SettingsView settings={settings} update={update} pair={{ source: 'zh', target: 'ja' }} />);
    libraryProps().onSelect('ja_female_bv024_uranus_bigtts');
    expect(update).toHaveBeenCalledWith({ voices: { en: 'en_male_alex_uranus_bigtts', ja: 'ja_female_bv024_uranus_bigtts' } });
  });

  it('auditions through previewVoice for the shown target, and locks the library while disabled', async () => {
    render(<Ast2SettingsView settings={AST2_DEFAULTS} update={vi.fn()} pair={{ source: 'zh', target: 'ja' }} disabled />);
    const props = libraryProps();
    expect(props.isSessionActive).toBe(true);
    await props.onPreview!('ja_female_bv024_uranus_bigtts');
    expect(previewVoice).toHaveBeenCalledWith('ja_female_bv024_uranus_bigtts', 'ja', undefined);
  });

  it('locks the three library-id fields while disabled', () => {
    render(<Ast2SettingsView settings={AST2_DEFAULTS} update={vi.fn()} disabled />);
    for (const label of ['settings.volcengineAST2HotWordLibraryId', 'settings.volcengineAST2ReplacementLibraryId', 'settings.volcengineAST2GlossaryLibraryId']) {
      expect(screen.getByLabelText(label)).toBeDisabled();
    }
  });
```

And add, after the existing `vi.mock('../../utils/openExternalUrl', …)` line:

```tsx
import type { VoiceLibrarySectionProps } from '../../components/Settings/sections/VoiceLibrarySection';
const { library, previewVoice } = vi.hoisted(() => ({ library: [] as VoiceLibrarySectionProps[], previewVoice: vi.fn(async () => null) }));
vi.mock('../../components/Settings/sections/VoiceLibrarySection', () => ({
  default: (props: VoiceLibrarySectionProps) => { library.push(props); return null; },
}));
vi.mock('./preview', () => ({ previewVoice }));
const libraryProps = () => library[library.length - 1];
```

add `import { voicesFor } from './catalog';` after the `./settings` import, and add `library.length = 0; previewVoice.mockClear();` to the `beforeEach`.

- [ ] **Step 3: Run both to verify they fail**

Run: `npx vitest run src/providers/volcengine_ast2/preview.test.ts src/providers/volcengine_ast2/Ast2Settings.test.tsx`
Expected: FAIL — `Failed to resolve import "./preview"`; `Ast2Settings.tsx` imports `AST2_VOICES`, which `settings.ts` no longer exports.

- [ ] **Step 4: Write `preview.ts`**

```ts
/**
 * A Doubao voice's sample, for the settings view's audition (#577 catalog
 * §4): Volcengine's own clip for the target's persona, fetched from its CDN
 * and decoded. The voice library swallows a rejected preview, so a failure is
 * reported here, once; a preview the user stopped is no failure.
 */
import { describeCause, reportError } from '../../lib/diagnostics/report';
import { voicesFor } from './catalog';

export interface PreviewDeps {
  fetch: typeof fetch;
  decode(bytes: ArrayBuffer): Promise<AudioBuffer>;
}

const live: PreviewDeps = {
  fetch: (input, init) => fetch(input, init),
  decode: async (bytes) => {
    const ctx = new AudioContext();
    try {
      return await ctx.decodeAudioData(bytes);
    } finally {
      void ctx.close();
    }
  },
};

export async function previewVoice(id: string, target: string, signal?: AbortSignal, deps: PreviewDeps = live): Promise<{ audio: Float32Array; sampleRate: number } | null> {
  const voice = voicesFor(target).find((v) => v.id === id);
  if (!voice) return null;
  try {
    const response = await deps.fetch(voice.previewUrl, { signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = await deps.decode(await response.arrayBuffer());
    // The first channel: Volcengine's samples are mono.
    return { audio: buffer.getChannelData(0).slice(), sampleRate: buffer.sampleRate };
  } catch (error) {
    if (signal?.aborted) return null;
    reportError('Ast2Preview', `Could not play the sample of ${voice.name}: ${describeCause(error)}`, { cause: error });
    return null;
  }
}
```

- [ ] **Step 5: Rewrite `Ast2Settings.tsx`'s voice part**

Replace the imports with:

```tsx
import { Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { TextField } from '../../components/providers/fields/TextField';
import { VoicePreviewContext } from '../../components/providers/VoicePreviewContext';
import VoiceLibrarySection, { type VoiceEntry } from '../../components/Settings/sections/VoiceLibrarySection';
import type { SettingsProps } from '../../lib/provider/types';
import type { VoiceLibraryCapability } from '../../types/VoiceLibrary';
import { voicesFor } from './catalog';
import { previewVoice } from './preview';
import type { Ast2Settings as S } from './settings';
import { CLONE, clonable, effectiveVoice } from './voice';
```

Above the component, add:

```tsx
/** Doubao has no voice of the user's own to add, rename or delete; 500 voices need the search and facets (R3: gender and age; the target fixes the language, R4). */
const CAPABILITY: VoiceLibraryCapability = { importModes: [], facetFilter: true };
const NO_DELETE = async () => {};
```

Replace the component's doc comment's last two sentences (`The voice (#577) shows whether … says it only applies to speech.`) with: `The voice (#577 catalog §3) is the shared voice library, listing the run's target's voices; picking one writes that target's slot only.`

Replace the component's signature, the `voices` array and the `<VoiceField … />` element with:

```tsx
export function Ast2SettingsView({ settings, update, disabled = false, pair, preview }: SettingsProps<S>) {
  const { t } = useTranslation();
  // Every host passes the shown pair; only a component's own test omits it.
  const shown = pair ?? { source: 'zh', target: 'en' };
  const voices: VoiceEntry[] = [
    ...(clonable(shown) ? [{ id: CLONE, label: t('providers.volcengine_ast2.voiceClone', "Clone the speaker's voice"), group: 'builtin' as const, removable: false }] : []),
    ...voicesFor(shown.target).map((v): VoiceEntry => ({
      id: v.id,
      label: v.name,
      group: 'builtin',
      removable: false,
      previewable: true,
      meta: { gender: v.gender === 'male' ? 'M' : 'F', facets: { gender: v.gender, age: v.age } },
    })),
  ];
  return (
    <>
      <VoicePreviewContext.Provider value={preview ?? null}>
        <div className="settings-section" id="volcengine-ast2-voice-section">
          <h2>{t('settings.voiceSettings', 'Voice Settings')}</h2>
          <VoiceLibrarySection
            voices={voices}
            selectedId={effectiveVoice(shown, settings) ?? ''}
            onSelect={(id) => update({ voices: { ...settings.voices, [shown.target]: id } })}
            onDelete={NO_DELETE}
            onPreview={(id, signal) => previewVoice(id, shown.target, signal)}
            manageNote={t('providers.volcengine_ast2.voiceHint', 'Used only when the translation is spoken.')}
            capability={CAPABILITY}
            isSessionActive={disabled}
          />
        </div>
      </VoicePreviewContext.Provider>
```

(The rest of the component — the Custom Vocabulary and Info sections and the closing `</>` — stays as it is. `VoiceField` is no longer imported here; its `hint` prop stays in the shared component.)

- [ ] **Step 6: Update the locales**

Write `/home/jiangzhuo/.claude/jobs/c1940130/tmp/locale_catalog.py`:

```python
import json, os

HINT = {
 'en': 'Used only when the translation is spoken.',
 'ar': 'يُستخدم فقط عند نطق الترجمة.',
 'bn': 'শুধু অনুবাদ উচ্চারিত হলে ব্যবহৃত হয়।',
 'de': 'Wird nur verwendet, wenn die Übersetzung gesprochen wird.',
 'es': 'Solo se usa cuando la traducción se reproduce en voz.',
 'fa': 'فقط زمانی استفاده می‌شود که ترجمه به‌صورت گفتاری پخش شود.',
 'fi': 'Käytetään vain, kun käännös puhutaan.',
 'fil': 'Ginagamit lang kapag binibigkas ang salin.',
 'fr': 'Utilisé uniquement lorsque la traduction est lue à voix haute.',
 'he': 'בשימוש רק כשהתרגום מושמע.',
 'hi': 'केवल तब उपयोग होता है जब अनुवाद बोला जाता है।',
 'id': 'Hanya dipakai saat terjemahan diucapkan.',
 'it': 'Usata solo quando la traduzione viene pronunciata.',
 'ja': '翻訳を音声で再生するときだけ使われます。',
 'ko': '번역을 음성으로 출력할 때만 사용됩니다.',
 'ms': 'Hanya digunakan apabila terjemahan dituturkan.',
 'nl': 'Wordt alleen gebruikt als de vertaling wordt uitgesproken.',
 'pl': 'Używane tylko wtedy, gdy tłumaczenie jest wypowiadane.',
 'pt_BR': 'Usado apenas quando a tradução é falada.',
 'pt_PT': 'Utilizado apenas quando a tradução é falada.',
 'ru': 'Используется, только когда перевод озвучивается.',
 'sv': 'Används bara när översättningen läses upp.',
 'ta': 'மொழிபெயர்ப்பு பேசப்படும்போது மட்டுமே பயன்படுத்தப்படும்.',
 'te': 'అనువాదం మాట్లాడినప్పుడు మాత్రమే ఉపయోగిస్తారు.',
 'th': 'ใช้เฉพาะเมื่อพูดคำแปลออกเสียง',
 'tr': 'Yalnızca çeviri seslendirildiğinde kullanılır.',
 'uk': 'Використовується лише тоді, коли переклад озвучується.',
 'vi': 'Chỉ dùng khi bản dịch được đọc thành tiếng.',
 'zh_CN': '仅在译文以语音播放时生效。',
 'zh_TW': '僅在譯文以語音播放時生效。',
}
# The age vocabulary is translated only where young/middle_aged/old already are; elsewhere it stays English, as they do.
AGE = {
 'ja': ('子ども', '10代'),
 'ko': ('어린이', '청소년'),
 'zh_CN': ('儿童', '少年'),
 'zh_TW': ('兒童', '少年'),
}
root = 'src/locales'
present = sorted(l for l in os.listdir(root) if os.path.isfile(f'{root}/{l}/translation.json'))
assert present == sorted(HINT), set(present) ^ set(HINT)
for l in present:
    p = f'{root}/{l}/translation.json'
    d = json.load(open(p, encoding='utf-8'))
    slot = d['providers']['volcengine_ast2']
    slot.pop('voiceFemale'); slot.pop('voiceMale')
    slot['voiceHint'] = HINT[l]
    age = d['voiceLibrary']['filter']['age']
    child, teen = AGE.get(l, ('Child', 'Teen'))
    d['voiceLibrary']['filter']['age'] = {'child': child, 'teen': teen, **age}
    open(p, 'w', encoding='utf-8').write(json.dumps(d, ensure_ascii=False, indent=2) + '\n')
print('updated', len(present))
```

Run: `python3 /home/jiangzhuo/.claude/jobs/c1940130/tmp/locale_catalog.py`
Expected: `updated 30`. Then `git diff --stat -- src/locales | tail -1` shows 30 files, and `grep -c '"teen"' src/locales/*/translation.json | grep -c ':1'` prints `30`.

- [ ] **Step 7: Run the folder, the components and the locales**

Run: `npx vitest run src/providers/volcengine_ast2 src/components src/locales`
Expected: PASS, every file.

- [ ] **Step 8: Commit**

```bash
git add src/providers/volcengine_ast2/preview.ts src/providers/volcengine_ast2/preview.test.ts src/providers/volcengine_ast2/Ast2Settings.tsx src/providers/volcengine_ast2/Ast2Settings.test.tsx src/locales
git commit -m "feat(volcengine_ast2): pick and audition the voice in the shared voice library

Doubao's settings list the run's target's voices in the voice library Soniox
uses: cloning first where the cloning model runs the pair, then the catalog's
voices under their persona for that language, filterable by gender and age.
Picking writes the target's own slot. A preview plays Volcengine's sample
clip from its CDN; a failed one is reported once, a stopped one not at all.
Two age values join the facet vocabulary; the two voice-name strings go and
the hint says only that the voice applies to speech.

Refs #577

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The extension may fetch the samples

**Files:**
- Modify: `extension/manifest.json`
- Modify: `extension/manifest.consistency.test.ts`

- [ ] **Step 1: Write the failing test**

In `manifest.consistency.test.ts`, after the `it('CSP connect-src allows the Soniox TTS REST host', …)` test, add:

```ts
  it("CSP connect-src allows Doubao's voice-sample CDN (the AST 2.0 voice preview)", () => {
    const origins = manifest.content_security_policy.extension_pages.split(/[ ;]+/);
    expect(origins).toContain('https://lf3-static.bytednsdoc.com');
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run extension/manifest.consistency.test.ts`
Expected: FAIL — `expected [...] to include 'https://lf3-static.bytednsdoc.com'`.

- [ ] **Step 3: Add the origin**

In `extension/manifest.json`'s `content_security_policy.extension_pages`, replace `wss://openspeech.bytedance.com` with `wss://openspeech.bytedance.com https://lf3-static.bytednsdoc.com`.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run extension/manifest.consistency.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extension/manifest.json extension/manifest.consistency.test.ts
git commit -m "feat(extension): connect to Doubao's voice-sample CDN

The Doubao AST 2.0 voice preview fetches Volcengine's sample clips from
lf3-static.bytednsdoc.com, which answers Access-Control-Allow-Origin: *.

Refs #577

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Verification

**Files:** none committed (the live script lives in the job tmp).

- [ ] **Step 1: Nothing still names the two-voice cut**

Run: `grep -rn "AST2_VOICES\|fixedVoice\|voiceFemale\|voiceMale\|Ast2Voice\b" src extension scripts`
Expected: no output.

- [ ] **Step 2: The full suite and the build**

Run: `npx vitest run 2>&1 | grep -E "Test Files|Tests "` — Expected: every file passes (the 2 skipped files as before).
Run: `npx vite build 2>&1 | grep -E "error|built in"` — Expected: `built in …`, no error.

- [ ] **Step 3: Live run with the branch's own frames**

Write `/home/jiangzhuo/.claude/jobs/c1940130/tmp/live-catalog.mts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import WebSocket from '/home/jiangzhuo/Desktop/kizunaai/sokuji/node_modules/ws/wrapper.mjs';
const W = '/home/jiangzhuo/Desktop/kizunaai/sokuji/.claude/worktrees/ast2-fixed-voice/src/providers/volcengine_ast2';
const { buildAst2 } = await import(`${W}/config.ts`);
const { AST2_DEFAULTS } = await import(`${W}/settings.ts`);
const { ast2Url, startSessionFrame, audioFrame, finishSessionFrame, decodeResponse, EventType } = await import(`${W}/wire.ts`);
const D = '/home/jiangzhuo/.claude/jobs/c1940130/tmp';
const env = Object.fromEntries(fs.readFileSync(path.join(D, 'creds.env'), 'utf8').trim().split('\n').map((l) => l.split('=') as [string, string]));
const creds = { kind: 'app' as const, appKey: env.AST2_APP, accessKey: env.AST2_TOKEN };
const SHARED = { pauses: { sourceSeconds: 1, translationSeconds: 1 }, reversed: () => false, segmentation: { mode: 'off', sentencesPerRow: 0 }, models: [] };

function run(name: string, voices: Record<string, string>, source: string, target: string, audioFile: string) {
  const config = buildAst2({ direction: { source, target }, speech: true, turns: 'auto' }, { ...AST2_DEFAULTS, voices }, SHARED);
  if ('refused' in config) return Promise.resolve({ name, refused: config.refused });
  return new Promise<Record<string, unknown>>((resolve) => {
    const ws = new WebSocket(ast2Url(creds));
    ws.binaryType = 'arraybuffer';
    const ids = { session: crypto.randomUUID(), connection: crypto.randomUUID() };
    let seq = 1; let bytes = 0; let tr = ''; const errors: string[] = [];
    const done = (end: string) => { clearTimeout(t); try { ws.close(); } catch { /* closed */ } resolve({ name, end, voice: config.voice ?? 'clone', audioBytes: bytes, tr: tr.slice(0, 40), errors }); };
    const t = setTimeout(() => done('timeout'), 45000);
    ws.on('open', () => ws.send(startSessionFrame({ ids, sequence: 0, mode: config.mode, source: config.sourceLanguage, target: config.targetLanguage, ...(config.voice ? { voice: config.voice } : {}), appKey: creds.appKey })));
    ws.on('message', async (data: ArrayBuffer) => {
      const r = decodeResponse(data);
      const s = r.responseMeta?.StatusCode;
      if (s && s !== 20000000) errors.push(`${EventType[r.event]} ${s} ${r.responseMeta?.Message}`);
      if (r.event === EventType.TranslationSubtitleEnd) tr += r.text + ' | ';
      if (r.event === EventType.TTSResponse) bytes += r.data.length;
      if (r.event === EventType.SessionStarted) {
        const pcm = fs.readFileSync(path.join(D, `${audioFile}.pcm`));
        for (let i = 0; i < pcm.length; i += 3200) {
          if (ws.readyState !== 1) return;
          ws.send(audioFrame(ids, seq++, new Int16Array(pcm.buffer.slice(pcm.byteOffset + i, pcm.byteOffset + Math.min(i + 3200, pcm.length)))));
          await new Promise((s2) => setTimeout(s2, 50));
        }
        if (ws.readyState === 1) ws.send(finishSessionFrame(ids, seq++));
      }
      if ([EventType.SessionFinished, EventType.SessionFailed].includes(r.event)) done(EventType[r.event]);
    });
    ws.on('error', (e) => { errors.push(String(e)); done('socket-error'); });
  });
}

for (const c of [
  ['zh→en clone', {}, 'zh', 'en', 'zh'],
  ['zh→en Vivi', { en: 'zh_female_vv_uranus_bigtts' }, 'zh', 'en', 'zh'],
  ['zh→ja bv024', { ja: 'ja_female_bv024_uranus_bigtts' }, 'zh', 'ja', 'zh'],
  ['zh→ko default', {}, 'zh', 'ko', 'zh'],
  ['ja→en stored clone', { en: 'clone' }, 'ja', 'en', 'ja'],
  ['ko→en stored clone falls back', { en: 'clone' }, 'ko', 'en', 'ja'],
] as const) console.log(JSON.stringify(await run(c[0], c[1], c[2], c[3], c[4])));
```

Run: `npx tsx /home/jiangzhuo/.claude/jobs/c1940130/tmp/live-catalog.mts`
Expected: every case `SessionFinished`, no `errors`, `audioBytes` above 30000; `zh→en clone` and `ja→en stored clone` with `voice: "clone"`; `zh→en Vivi` with `seed-tts-2.0`; `zh→ja bv024`; `zh→ko default` with `ko_male_m03_uranus_bigtts`; `ko→en stored clone falls back` with `zh_female_vv_uranus_bigtts` (the Japanese clip stands in for Korean speech: the check is that the session runs in the fallback voice, not the transcript).

- [ ] **Step 4: Report** the counts, the live table, and anything that diverged, before any push or PR (both need the user's go: push to `kizuna-ai-lab/sokuji` branch `worktree-ast2-fixed-voice`, PR into `main`).
