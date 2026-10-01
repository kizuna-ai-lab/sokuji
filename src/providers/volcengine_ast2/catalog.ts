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
