import type { RubyPiece } from '../types';

/** One Lindera token: its surface, IPADIC's reading (katakana) or null, and whether the dictionary knew it. */
export interface JaToken {
  surface: string;
  reading: string | null;
  unknown: boolean;
}

const HAN_CLASS = '\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff\\u{20000}-\\u{3134f}々〆';
const HAN = new RegExp(`[${HAN_CLASS}]`, 'u');
const RUNS = new RegExp(`[${HAN_CLASS}]+|[^${HAN_CLASS}]+`, 'gu');

export function toHiragana(s: string): string {
  return s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/** Furigana for one known token: on its Han runs only, its kana left bare. */
function tokenPieces(surface: string, reading: string): RubyPiece[] {
  const kana = toHiragana(reading);
  const runs = surface.match(RUNS) ?? [surface];
  const pattern = runs
    .map((r) => (HAN.test(r) ? '(.+?)' : toHiragana(r).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('');
  const match = kana.match(new RegExp(`^${pattern}$`, 'u'));
  if (!match) return [{ text: surface, reading: kana }];
  let group = 1;
  return runs.map((r) => (HAN.test(r) ? { text: r, reading: match[group++] } : { text: r }));
}

/**
 * Furigana for a tokenized sentence. Conservative on names and slang (#545): a
 * token the dictionary does not know gets no reading, and neither does any token
 * in the same unbroken run of Han-bearing tokens, which is usually one word the
 * dictionary lacks split into pieces it half-knows (蒼汰, 𠮷野家).
 *
 * The pieces concatenate to `text`: Lindera leaves ASCII whitespace out of its
 * tokens, so each token is found in `text` and what lies before it is kept as
 * plain text (and breaks a Han run). A token not found ends the walk, the rest
 * of `text` plain.
 */
export function furigana(text: string, tokens: readonly JaToken[]): RubyPiece[] {
  const out: RubyPiece[] = [];
  const push = (piece: RubyPiece) => {
    if (!piece.text) return;
    const last = out[out.length - 1];
    if (piece.reading === undefined && last && last.reading === undefined) last.text += piece.text;
    else out.push({ ...piece });
  };
  const placed: { gap: string; token: JaToken }[] = [];
  let cursor = 0;
  for (const token of tokens) {
    const at = text.indexOf(token.surface, cursor);
    if (at < 0) break;
    placed.push({ gap: text.slice(cursor, at), token });
    cursor = at + token.surface.length;
  }
  for (let k = 0; k < placed.length;) {
    push({ text: placed[k].gap });
    if (!HAN.test(placed[k].token.surface)) {
      push({ text: placed[k].token.surface });
      k++;
      continue;
    }
    let end = k + 1;
    while (end < placed.length && !placed[end].gap && HAN.test(placed[end].token.surface)) end++;
    const run = placed.slice(k, end).map((p) => p.token);
    const bare = run.some((t) => t.unknown || !t.reading);
    for (const t of run) {
      if (bare) push({ text: t.surface });
      else for (const piece of tokenPieces(t.surface, t.reading!)) push(piece);
    }
    k = end;
  }
  push({ text: text.slice(cursor) });
  return out;
}
