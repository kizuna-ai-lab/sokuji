/**
 * The viewer page's words (spec 2026-10-04 §5.7): the `viewer` subtree of
 * each app catalog, compiled in from `strings.generated.ts`. Importing the
 * catalogs themselves does not work: the main app imports them whole, so the
 * build shares every catalog, all subtrees, with this page
 * (`scripts/check-viewer-bundle.mjs` checks a build). A small lookup instead
 * of i18next keeps the page light.
 */
import { VIEWER_WORDS } from './strings.generated';

export type Words = { [key: string]: string | Words };
export type T = (key: string, params?: Record<string, string | number>) => string;

/** Catalog id (`zh_CN`) → its viewer words. */
export const VIEWER_CATALOGS: Readonly<Record<string, Words>> = VIEWER_WORDS as Record<string, Words>;

const ALIASES: Readonly<Record<string, string>> = { iw: 'he', in: 'id', tl: 'fil' };

/** The first of the browser's languages (BCP-47, or a catalog id such as `zh_CN`) a catalog exists for; English otherwise. */
export function pickCatalog(languages: readonly string[], available: readonly string[]): string {
  const have = new Set(available);
  for (const raw of languages) {
    const [base, ...rest] = raw.toLowerCase().split(/[-_]/);
    let id: string;
    if (base === 'zh') id = rest.some((p) => p === 'hant' || p === 'tw' || p === 'hk' || p === 'mo') ? 'zh_TW' : 'zh_CN';
    else if (base === 'pt') id = rest.includes('br') ? 'pt_BR' : 'pt_PT';
    else id = ALIASES[base] ?? base;
    if (have.has(id)) return id;
  }
  return 'en';
}

function lookup(words: Words | undefined, key: string): string | undefined {
  let node: string | Words | undefined = words;
  for (const part of key.split('.')) {
    if (node === undefined || typeof node === 'string') return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
}

/** `key` is the full key (`viewer.status.live`); the catalogs hold the `viewer` subtree. */
export function makeT(words: Words | undefined, fallback: Words | undefined): T {
  return (key, params) => {
    const local = key.startsWith('viewer.') ? key.slice('viewer.'.length) : key;
    const text = lookup(words, local) ?? lookup(fallback, local) ?? key;
    if (!params) return text;
    return text.replace(/\{\{(\w+)\}\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
  };
}

export function viewerT(languages: readonly string[]): { t: T; catalog: string } {
  const catalog = pickCatalog(languages, Object.keys(VIEWER_CATALOGS));
  return { t: makeT(VIEWER_CATALOGS[catalog], VIEWER_CATALOGS.en), catalog };
}
