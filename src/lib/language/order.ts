/**
 * The app-wide display order of a language dropdown (unified language codes,
 * the owner's D + E ruling): `auto` first, common languages next in
 * LANGUAGE_PRIORITY order, the rest by CLDR English name; the variants of one
 * language sit together as peers, the one closest to the user first; and a
 * pinned block above (the current pair, the UI language). Display only: a
 * provider's own order still decides normalizePair's first option.
 */
import { LANGUAGE_PRIORITY } from '../../utils/languages';
import { AUTO, baseLanguage, type LanguageCode } from './code';
import { englishLanguageName } from './label';
import type { LanguageOption } from '../provider/types';

export interface OrderContext {
  /** The UI language (an i18next id, `zh_TW` allowed). */
  ui: string;
  /** The browser's languages, most preferred first (`navigator.languages`). */
  browser: readonly string[];
}

const maximize = (tag: string): Intl.Locale | null => {
  try {
    return new Intl.Locale(tag.replace(/_/g, '-')).maximize();
  } catch {
    return null;
  }
};

/** 3 identical, 2 same language+script+region, 1 same language+script, 0 otherwise. */
function nearness(code: LanguageCode, ref: string): number {
  if (code === ref.replace(/_/g, '-')) return 3;
  const a = maximize(code);
  const r = maximize(ref);
  if (!a || !r || a.language !== r.language) return 0;
  if (a.script === r.script && a.region === r.region) return 2;
  return a.script === r.script ? 1 : 0;
}

/** The UI language decides; the browser's languages break what it leaves tied. */
function closeness(code: LanguageCode, ctx: OrderContext): number {
  const n = ctx.browser.length;
  const byBrowser = Math.max(0, ...ctx.browser.map((l, i) => nearness(code, l) * (n - i)));
  return nearness(code, ctx.ui) * 1000 + byBrowser;
}

const groupKey = (code: LanguageCode) => baseLanguage(code) ?? code;

/** D: `auto` first, then groups — common bases in LANGUAGE_PRIORITY order, the rest by English name — each a run of peers, closest first. */
export function orderLanguages(options: readonly LanguageOption[], ctx: OrderContext): LanguageOption[] {
  const auto = options.filter((o) => o.value === AUTO);
  const groups = new Map<string, LanguageOption[]>();
  for (const o of options) {
    if (o.value === AUTO) continue;
    const key = groupKey(o.value);
    const g = groups.get(key);
    if (g) g.push(o);
    else groups.set(key, [o]);
  }
  const byPeer = (a: LanguageOption, b: LanguageOption) =>
    (closeness(b.value, ctx) - closeness(a.value, ctx)) || englishLanguageName(a.value).localeCompare(englishLanguageName(b.value), 'en');
  const runs = [...groups.entries()].map(([key, members]) => ({ key, members: [...members].sort(byPeer) }));
  const rank = (key: string) => {
    const i = LANGUAGE_PRIORITY.indexOf(key);
    return i === -1 ? Infinity : i;
  };
  runs.sort((x, y) => {
    const rx = rank(x.key);
    const ry = rank(y.key);
    if (rx !== ry) return rx - ry;
    return englishLanguageName(x.members[0].value).localeCompare(englishLanguageName(y.members[0].value), 'en');
  });
  return [...auto, ...runs.flatMap((r) => r.members)];
}

/** E: the codes to pin above the list — the pair's source and target, then the offered code closest to the UI language — offered, de-duplicated, never `auto`. */
export function pinnedLanguages(options: readonly LanguageOption[], pair: { source: string; target: string }, ctx: OrderContext): LanguageOption[] {
  const offered = new Map(options.map((o) => [o.value, o] as const));
  const uiMatch = [...options]
    .filter((o) => o.value !== AUTO && nearness(o.value, ctx.ui) > 0)
    .sort((a, b) => nearness(b.value, ctx.ui) - nearness(a.value, ctx.ui))[0];
  const picks = [pair.source, pair.target, uiMatch?.value];
  const out: LanguageOption[] = [];
  for (const code of picks) {
    if (!code || code === AUTO) continue;
    const o = offered.get(code);
    if (o && !out.includes(o)) out.push(o);
  }
  return out;
}
