/**
 * Text measures for the agent-text probe: what a line says, reduced to the
 * units an error rate counts — characters for Chinese and Japanese, words for
 * English — and how two texts compare (edit operations, in-order coverage).
 */

/** CJK languages count characters; the rest count words. */
export const byChars = (lang: string): boolean => lang === 'zh' || lang === 'ja' || lang === 'ko';

/** NFKC, lower case, punctuation and symbols dropped. */
export function normalize(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}]/gu, ' ');
}

/** The units an error rate counts: characters (CJK, whitespace dropped) or words. */
export function units(text: string, lang: string): string[] {
  const n = normalize(text);
  return byChars(lang) ? [...n.replace(/\s+/g, '')] : n.split(/\s+/).filter(Boolean);
}

export interface EditCounts {
  /** Reference units. */
  n: number;
  s: number;
  d: number;
  i: number;
}

/** Minimum edit alignment of `hyp` against `ref`: substitutions, deletions (ref units missing), insertions (extra units). */
export function editCounts(ref: readonly string[], hyp: readonly string[]): EditCounts {
  const m = ref.length;
  const k = hyp.length;
  // dp[j]: [cost, s, d, i] for ref[0..r) vs hyp[0..j).
  let prev: Array<[number, number, number, number]> = Array.from({ length: k + 1 }, (_, j) => [j, 0, 0, j]);
  for (let r = 1; r <= m; r++) {
    const cur: Array<[number, number, number, number]> = [[r, 0, r, 0]];
    for (let j = 1; j <= k; j++) {
      const same = ref[r - 1] === hyp[j - 1];
      const diag = prev[j - 1];
      const up = prev[j];
      const left = cur[j - 1];
      const options: Array<[number, number, number, number]> = [
        [diag[0] + (same ? 0 : 1), diag[1] + (same ? 0 : 1), diag[2], diag[3]],
        [up[0] + 1, up[1], up[2] + 1, up[3]],
        [left[0] + 1, left[1], left[2], left[3] + 1],
      ];
      cur.push(options.reduce((a, b) => (b[0] < a[0] ? b : a)));
    }
    prev = cur;
  }
  const [, s, d, i] = prev[k];
  return { n: m, s, d, i };
}

export const errorRate = (c: EditCounts): number => (c.n === 0 ? (c.i > 0 ? 1 : 0) : (c.s + c.d + c.i) / c.n);

/** Longest common subsequence length. */
export function lcs(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  let prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    prev = cur;
  }
  return prev[b.length];
}

/** How much of `a` appears, in order, in `b`: 0..1 (0 when `a` is empty). */
export function coverage(a: string, b: string, lang: string): number {
  const ua = units(a, lang);
  return ua.length === 0 ? 0 : lcs(ua, units(b, lang)) / ua.length;
}

/** Percentiles of a list (nearest rank); null when empty. */
export function percentiles(xs: readonly number[]): { n: number; min: number; p10: number; p50: number; p90: number; max: number } | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const at = (p: number) => s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))];
  const r = (x: number) => Math.round(x);
  return { n: s.length, min: r(s[0]), p10: r(at(0.1)), p50: r(at(0.5)), p90: r(at(0.9)), max: r(s[s.length - 1]) };
}
