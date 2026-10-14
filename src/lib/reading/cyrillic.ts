import type { RubyPiece } from './types';

const RUSSIAN_SOFTENERS = 'аеёиоуыэюяйъь';
/** BGN/PCGN in ASCII: the soft and hard signs are dropped, ё is written yo. */
const RUSSIAN: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n',
  о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya', ё: 'yo',
};

export function transliterateRussian(word: string): string {
  const w = word.toLowerCase();
  let out = '';
  for (let k = 0; k < w.length; k++) {
    const c = w[k];
    if (c === 'е') out += k === 0 || RUSSIAN_SOFTENERS.includes(w[k - 1]) ? 'ye' : 'e';
    else out += RUSSIAN[c] ?? c;
  }
  return out;
}

/** Ukraine's national system (Cabinet of Ministers resolution 55, 2010); the apostrophe is not written. */
const UKRAINIAN: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'h', ґ: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'y', і: 'i', к: 'k', л: 'l',
  м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch',
  ш: 'sh', щ: 'shch', ь: '', "'": '', '’': '', 'ʼ': '',
};
/** Letters written one way at the start of a word and another elsewhere. */
const UKRAINIAN_INITIAL: Record<string, [string, string]> = {
  є: ['ye', 'ie'], ї: ['yi', 'i'], й: ['y', 'i'], ю: ['yu', 'iu'], я: ['ya', 'ia'],
};

export function transliterateUkrainian(word: string): string {
  const w = word.toLowerCase();
  let out = '';
  for (let k = 0; k < w.length; k++) {
    const c = w[k];
    if (UKRAINIAN_INITIAL[c]) out += UKRAINIAN_INITIAL[c][k === 0 ? 0 : 1];
    else if (c === 'г' && w[k - 1] === 'з') out += 'gh';
    else out += UKRAINIAN[c] ?? c;
  }
  return out;
}

const CYRILLIC_WORD = /([Ѐ-ӿ]+(?:['’ʼ][Ѐ-ӿ]+)*)/;

/** One piece per Cyrillic word; everything else plain. Transliteration spells letters, not pronunciation. */
export function annotateCyrillic(text: string, lang: 'ru' | 'uk'): RubyPiece[] {
  const write = lang === 'ru' ? transliterateRussian : transliterateUkrainian;
  return text
    .split(CYRILLIC_WORD)
    .filter((part) => part !== '')
    .map((part) => (CYRILLIC_WORD.test(part) ? { text: part, reading: write(part) } : { text: part }));
}
