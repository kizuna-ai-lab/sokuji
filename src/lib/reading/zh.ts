import { pinyin } from 'pinyin-pro';
import type { RubyPiece } from './types';

/**
 * Pinyin with tone marks, one syllable per Han character (R10). The whole text is
 * read at once so polyphones take their context; tone sandhi (一下 yí xià) is kept
 * because readers read it aloud.
 */
export function annotateChinese(text: string): RubyPiece[] {
  const out: RubyPiece[] = [];
  for (const item of pinyin(text, { type: 'all' })) {
    if (item.isZh && item.pinyin) {
      out.push({ text: item.origin, reading: item.pinyin });
      continue;
    }
    const last = out[out.length - 1];
    if (last && last.reading === undefined) last.text += item.origin;
    else out.push({ text: item.origin });
  }
  return out;
}
