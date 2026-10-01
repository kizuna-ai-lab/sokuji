/**
 * Joining the text of several segments. A separator is needed only between
 * segments — rows of one segment tile its text — and there it follows the
 * script (spec: "The ranges tile the segment's text"): Chinese and Japanese
 * take none. Characters are read by code point, so a Han character outside
 * the basic plane (𠮷) counts as Han.
 */

/** Han, kana, CJK symbols and punctuation, and fullwidth forms: no space beside them. */
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}　-〿＀-￯]/u;

/** The last character of `s`, a surrogate pair kept whole. */
function lastChar(s: string): string {
  const low = s.charCodeAt(s.length - 1);
  return low >= 0xdc00 && low <= 0xdfff && s.length > 1 ? s.slice(-2) : s.slice(-1);
}

/** Whether two pieces joined here need a space: only when both sides of the boundary are space-delimited script. */
export function needsSpace(before: string, after: string): boolean {
  if (before.length === 0 || after.length === 0) return false;
  const first = String.fromCodePoint(after.codePointAt(0)!);
  return !UNSPACED.test(lastChar(before)) && !UNSPACED.test(first);
}

/** Several segments' text as one: each piece trimmed, empty ones skipped, a space only where `needsSpace` says. */
export function joinSegmentTexts(texts: readonly string[]): string {
  let out = '';
  for (const text of texts) {
    const piece = text.trim();
    if (piece.length === 0) continue;
    if (needsSpace(out, piece)) out += ' ';
    out += piece;
  }
  return out;
}
