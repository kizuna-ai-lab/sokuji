// Text normalization, ASR-style input variants, alignment and scoring for the
// punctuation-restoration benchmark. Pure ESM with no dependencies, so the same
// module runs under Node and inside a browser page.

/** Scored punctuation classes. Every other mark is ignored by the scorer. */
export const MARK_CLASS = new Map([
  ['。', 'period'], ['．', 'period'], ['.', 'period'], ['｡', 'period'],
  ['，', 'comma'], [',', 'comma'], ['、', 'comma'], ['､', 'comma'],
  ['？', 'question'], ['?', 'question'],
  ['！', 'exclaim'], ['!', 'exclaim'],
]);
export const TERMINAL = new Set(['period', 'question', 'exclaim']);
const RANK = { comma: 1, period: 2, question: 3, exclaim: 3 };

// Abbreviations whose trailing dot is not a sentence end.
const ABBREV = new Set(['dr', 'mr', 'mrs', 'ms', 'st', 'vs', 'jr', 'sr', 'inc', 'ltd', 'co', 'corp',
  'etc', 'e.g', 'i.e', 'u.s', 'u.k', 'a.m', 'p.m']);

const isAlnum = (ch) => /[\p{L}\p{N}]/u.test(ch);
const isDigit = (ch) => /\p{N}/u.test(ch);

/** Whether the '.' at code-point index i of `cps` ends a sentence (not a decimal or abbreviation dot). */
export function isPeriodDot(cps, i) {
  const prev = cps[i - 1] ?? '';
  const next = cps[i + 1] ?? '';
  if (isDigit(prev) && isDigit(next)) return false;
  if (next && isAlnum(next)) return false;
  let j = i;
  while (j > 0 && (isAlnum(cps[j - 1]) || cps[j - 1] === '.')) j--;
  return !ABBREV.has(cps.slice(j, i).join('').toLowerCase());
}

/**
 * Reduce text to a skeleton (letters and digits, lowercased) plus the scored
 * marks attached to skeleton positions. Position k means "after k skeleton
 * characters"; a mark before any character is dropped.
 */
export function analyze(text) {
  const cps = Array.from(text.normalize('NFKC'));
  const skel = [];
  const upper = [];
  const marks = new Map();
  for (let i = 0; i < cps.length; i++) {
    const ch = cps[i];
    if (isAlnum(ch)) {
      const lower = ch.toLowerCase();
      skel.push(lower);
      upper.push(lower !== ch);
      continue;
    }
    let cls = MARK_CLASS.get(ch);
    if (ch === '.' && !isPeriodDot(cps, i)) cls = undefined;
    if (!cls || skel.length === 0) continue;
    const prev = marks.get(skel.length);
    if (!prev || RANK[cls] > RANK[prev]) marks.set(skel.length, cls);
  }
  return { skel: skel.join(''), skelChars: skel, upper, marks };
}

/**
 * ASR-style input derived from a reference:
 * - `stripped`: every scored mark and bracket/quote removed, casing kept
 * - `lower`: `stripped`, lowercased (typical of CTC/RNNT English output)
 * - `commas`: sentence terminators removed, commas kept (GPT-Live's slow-speaker zh output)
 */
export function makeInput(ref, variant) {
  const cps = Array.from(ref);
  let out = '';
  for (let i = 0; i < cps.length; i++) {
    const ch = cps[i];
    const cls = MARK_CLASS.get(ch);
    if (ch === '.') {
      const prev = cps[i - 1] ?? '';
      const next = cps[i + 1] ?? '';
      if (isDigit(prev) && isDigit(next)) { out += ch; continue; }
      // Abbreviation and sentence dots are both dropped: ASR writes "dr smith".
      continue;
    }
    if (cls) {
      if (variant === 'commas' && cls === 'comma') out += ch;
      continue;
    }
    if (/[「」『』（）()"“”:;：；…]/u.test(ch)) continue;
    out += ch;
  }
  out = out.replace(/\s+/gu, ' ').trim();
  return variant === 'lower' ? out.toLowerCase() : out;
}

/** Map every hypothesis skeleton index to a gold index (or -1) by LCS alignment. */
export function align(goldChars, hypChars) {
  const n = goldChars.length;
  const m = hypChars.length;
  const map = new Int32Array(m).fill(-1);
  if (n === m && goldChars.every((c, i) => c === hypChars[i])) {
    for (let i = 0; i < m; i++) map[i] = i;
    return map;
  }
  const dp = new Array(n + 1);
  for (let i = 0; i <= n; i++) dp[i] = new Int32Array(m + 1);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = goldChars[i] === hypChars[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (goldChars[i] === hypChars[j]) { map[j] = i; i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return map;
}

function prf(c) {
  const p = c.tp + c.fp === 0 ? (c.fn === 0 ? 1 : 0) : c.tp / (c.tp + c.fp);
  const r = c.tp + c.fn === 0 ? 1 : c.tp / (c.tp + c.fn);
  const f = p + r === 0 ? 0 : (2 * p * r) / (p + r);
  return { p, r, f, ...c };
}

export function newCounts() {
  const z = () => ({ tp: 0, fp: 0, fn: 0 });
  return { boundary: z(), breakpoint: z(), period: z(), comma: z(), question: z(), exclaim: z(), upper: z(), finalTerm: { n: 0, ok: 0 }, items: 0, skelMismatch: 0 };
}

/**
 * What a model output claims: the scoring hypothesis, and the skeleton positions
 * of its sentence boundaries. `boundary` models return text with '\n' at cuts.
 */
export function hypothesisFor(info, out) {
  if (info.output === 'boundary') {
    const parts = out.split('\n');
    const positions = [];
    let n = 0;
    for (let i = 0; i < parts.length - 1; i++) {
      n += analyze(parts[i]).skelChars.length;
      positions.push(n);
    }
    return { hyp: { skelSource: parts.join(''), boundaries: positions }, positions };
  }
  const a = analyze(out);
  return { hyp: out, positions: [...a.marks].filter(([, c]) => TERMINAL.has(c)).map(([k]) => k) };
}

/**
 * Score one hypothesis against its reference.
 * `hyp` is either punctuated text, or `{ skelSource, boundaries }` where
 * `boundaries` are skeleton positions of `skelSource` (for segmenters that
 * insert no marks). Internal boundaries exclude the end of the passage, which
 * the VAD provides for free.
 */
export function scoreInto(counts, ref, hyp, { scoreCase = false } = {}) {
  const g = analyze(ref);
  let h;
  let hypBoundaries;
  if (typeof hyp === 'string') {
    h = analyze(hyp);
    hypBoundaries = new Set([...h.marks].filter(([, c]) => TERMINAL.has(c)).map(([k]) => k));
  } else {
    h = analyze(hyp.skelSource);
    h.marks = new Map();
    hypBoundaries = new Set(hyp.boundaries);
  }
  counts.items++;
  if (g.skel !== h.skel) counts.skelMismatch++;
  const map = align(g.skelChars, h.skelChars);
  const toGold = (k) => {
    if (k === 0) return 0;
    const gi = map[k - 1];
    return gi < 0 ? -1 : gi + 1;
  };
  const gLen = g.skelChars.length;

  const goldB = new Set([...g.marks].filter(([k, c]) => TERMINAL.has(c) && k < gLen).map(([k]) => k));
  const hypB = new Set([...hypBoundaries].map(toGold).filter((k) => k > 0 && k < gLen));
  for (const k of hypB) (goldB.has(k) ? counts.boundary.tp++ : counts.boundary.fp++);
  for (const k of goldB) if (!hypB.has(k)) counts.boundary.fn++;

  const hypMarks = new Map();
  for (const [k, c] of h.marks) {
    const gk = toGold(k);
    if (gk > 0) hypMarks.set(gk, c);
  }

  // Breakpoints: any internal position where a line may be cut — a comma or a
  // sentence end, whichever the style prefers. Chinese uses commas and periods
  // far less strictly than the other three, so this is the fairer zh measure.
  const goldAny = new Set([...g.marks.keys()].filter((k) => k < gLen));
  const hypAny = new Set([...hypMarks.keys(), ...hypB].filter((k) => k > 0 && k < gLen));
  for (const k of hypAny) (goldAny.has(k) ? counts.breakpoint.tp++ : counts.breakpoint.fp++);
  for (const k of goldAny) if (!hypAny.has(k)) counts.breakpoint.fn++;
  for (const cls of ['period', 'comma', 'question', 'exclaim']) {
    for (const [k, c] of hypMarks) if (c === cls) (g.marks.get(k) === cls ? counts[cls].tp++ : counts[cls].fp++);
    for (const [k, c] of g.marks) if (c === cls && hypMarks.get(k) !== cls) counts[cls].fn++;
  }

  const gFinal = g.marks.get(gLen);
  if (gFinal && TERMINAL.has(gFinal)) {
    counts.finalTerm.n++;
    const hf = hypMarks.get(gLen);
    if (hf && TERMINAL.has(hf)) counts.finalTerm.ok++;
  }

  if (scoreCase) {
    for (let j = 0; j < h.skelChars.length; j++) {
      const gi = map[j];
      if (gi < 0 || !/\p{L}/u.test(g.skelChars[gi])) continue;
      const gu = g.upper[gi];
      const hu = h.upper[j];
      if (gu && hu) counts.upper.tp++;
      else if (!gu && hu) counts.upper.fp++;
      else if (gu && !hu) counts.upper.fn++;
    }
  }
  return counts;
}

export function summarize(counts) {
  return {
    items: counts.items,
    skelMismatch: counts.skelMismatch,
    boundary: prf(counts.boundary),
    breakpoint: prf(counts.breakpoint),
    period: prf(counts.period),
    comma: prf(counts.comma),
    question: prf(counts.question),
    exclaim: prf(counts.exclaim),
    upper: prf(counts.upper),
    finalTerm: counts.finalTerm.n ? counts.finalTerm.ok / counts.finalTerm.n : null,
  };
}

/** Load every `*.gold.json` corpus file in a directory (Node only). */
export async function loadCorpus(dir) {
  const { readdir, readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.gold.json')).sort();
  const items = [];
  for (const f of files) {
    const data = JSON.parse(await readFile(join(dir, f), 'utf8'));
    for (const it of data.items) items.push({ ...it, source: f.replace('.gold.json', '') });
  }
  return items;
}

export const pct = (x) => (x == null ? '  -  ' : (100 * x).toFixed(1).padStart(5));
