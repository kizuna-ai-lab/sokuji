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
  description?: string | null;
  categories?: { categories: string[] | null }[] | null;
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

/**
 * Categories that tell no voice of a one-language list from another, so the
 * filter bar does not offer them (his ruling, 2026-10-02): every foreign
 * voice is 外语音色, and a language whose voices all carry its name.
 * Accents stay — 美式英语 against 英式英语, 墨西哥西语 against 西班牙语,
 * 北京口音 — and so does every scene (角色扮演, 客服场景…).
 */
const EVERY_FOREIGN_VOICE = '外语音色';
const OWN_LANGUAGE: Readonly<Partial<Record<FixedLanguage, string>>> = {
  ja: '日语', id: '印尼语', pt: '巴西葡萄牙语', fr: '法语', de: '德语', ko: '韩语',
};

/** The entry's categories for one of its languages, once each, in ListSpeakers' order. */
function categoriesFor(e: RawSpeaker, code: FixedLanguage): string[] {
  const all = (e.categories ?? []).flatMap((g) => g.categories ?? []);
  return [...new Set(all)].filter((c) => c !== EVERY_FOREIGN_VOICE && c !== OWN_LANGUAGE[code]);
}

const AGE: Readonly<Record<string, Age>> ={ 儿童: 'child', '少年/少女': 'teen', 青年: 'young', 中年: 'middle_aged', 老年: 'old' };
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

const same = (a: CatalogLanguage, b: CatalogLanguage) => JSON.stringify(a) === JSON.stringify(b);

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
    const base: CatalogLanguage = { n: e.name, a: pick(AGE, e.age, 'age', e.voice_type), p: clipPath(e), ...(e.description ? { d: e.description } : {}) };
    for (const l of e.languages ?? []) {
      const code = LANGUAGE[l.language];
      if (!code || code in voice.l) continue;
      const c = categoriesFor(e, code);
      voice.l[code] = c.length > 0 ? { ...base, c } : base;
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
