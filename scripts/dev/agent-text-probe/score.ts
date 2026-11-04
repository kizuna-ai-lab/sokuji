/**
 * A run's `summary.json`, from its log alone (so a saved log can be scored
 * again: `probe.mts --rescore <log>`).
 *
 * Times are on the microphone's timeline (ms from its first sample), which is
 * the STT socket's audio clock: Soniox's `start_ms` / `end_ms`.
 *
 * - echoLines: finalized source utterances no person in the script said: one
 *   with less than MIN_IN_TURN of its time inside a human turn of its
 *   language (± TOLERANCE_MS), or one inside a turn that holds less than
 *   MIN_HUMAN_SHARE of the turn's reference and matches the played speech it
 *   overlaps better than that reference. A line holding at least
 *   MIN_HUMAN_SHARE of a turn's reference is the person's, echo merged into
 *   it or not: the echo shows as insertions, and the line is listed in
 *   `mergedLines` when its extra text matches the played speech.
 *   `echoTranslatedBack` counts the echo lines whose translation was spoken
 *   again (the loop).
 * - humanWer: per human turn, the utterances attributed to it, joined in time
 *   order, against the turn's reference — characters for zh/ja, words for
 *   en — with substitutions, deletions (the person's words lost) and
 *   insertions (extra text, echo leaking in) apart. A turn is talk-over when
 *   its speech overlaps the echo of any played clip (with echo off: the play
 *   window shifted by the same delay), clean otherwise.
 * - agentText: frames sent and dropped, characters, segment ends, and the
 *   lead each text had over its echo on the STT audio clock (`serverLeadMs`:
 *   the echo's first sample minus the audio position the server had when the
 *   text was sent) and over playback (`playLeadMs`).
 */
import type { TextRange } from '../../../src/lib/contract/adapter';
import type { HumanTurn } from './script';
import { coverage, editCounts, errorRate, lcs, percentiles, units, type EditCounts } from './text';

export const TOLERANCE_MS = 300;
/** A line with less of its time inside a person's turn (± TOLERANCE_MS) is not theirs. */
export const MIN_IN_TURN = 0.3;
/** A line holding at least this share of a turn's reference (in order) is the person's. */
export const MIN_HUMAN_SHARE = 0.5;

export interface LogLine {
  t: number;
  kind: string;
  d?: any;
}

interface Row {
  leg: string;
  ref: number;
  side: 'source' | 'translation';
  origin?: string;
  text: string;
  language?: string;
  timing?: { startMs: number; endMs: number };
  closed: boolean;
}

interface Chunk {
  leg: string;
  voice: string;
  ref: number;
  index: number;
  range?: TextRange;
  at: number;
  micFrom: number;
  micTo: number;
}

export interface EchoLine {
  leg: string;
  ref: number;
  origin?: string;
  language?: string;
  text: string;
  fromMs?: number;
  toMs?: number;
  reason: 'outside-human-turn' | 'matches-tts' | 'no-timing';
  /** The played speech it overlaps, in its language. */
  overlapsTts: string;
  translated: string;
  spokenBack: boolean;
}

/** A person's line that also holds echo: scored as theirs (the echo as insertions), listed here. */
export interface MergedLine {
  leg: string;
  ref: number;
  origin?: string;
  language?: string;
  text: string;
  fromMs: number;
  toMs: number;
  turn: number;
  /** Units of the line not in the person's words. */
  extraUnits: number;
  overlapsTts: string;
  translated: string;
  spokenBack: boolean;
}

export interface TurnScore {
  k: number;
  side: string;
  lang: string;
  clip: string;
  intent: string;
  kind: 'talk-over' | 'clean';
  /** How long the turn's speech overlapped echo, ms. */
  echoOverlapMs: number;
  metric: 'cer' | 'wer';
  reference: string;
  recognized: string;
  counts: EditCounts;
  rate: number;
}

export interface GroupScore {
  turns: number;
  /** Errors over all units of the group: (S + D + I) / N. */
  rate: number | null;
  meanTurnRate: number | null;
  n: number;
  s: number;
  d: number;
  i: number;
}

export interface Summary {
  run: Record<string, unknown>;
  sourceUtterances: number;
  unfinishedSourceUtterances: number;
  echoLines: EchoLine[];
  echoLineCount: number;
  echoTranslatedBack: number;
  mergedLines: MergedLine[];
  mergedLineCount: number;
  humanWer: {
    byLanguage: Record<string, { talkOver: GroupScore; clean: GroupScore }>;
    turns: TurnScore[];
  };
  agentText: {
    framesSent: number;
    framesDropped: number;
    textFrames: number;
    endFrames: number;
    chars: number;
    planner?: unknown;
    serverLeadMs: ReturnType<typeof percentiles>;
    playLeadMs: ReturnType<typeof percentiles>;
    /** Texts whose echo had already started reaching the server when they were sent. */
    lateTexts: number;
    /** Texts no played clip of their row ever spoke (never played). */
    unplayedTexts: number;
  };
  sonioxErrors: unknown[];
  sessionEvents: unknown[];
  inputTextTokens: number | null;
  /** Every number-valued field named like a token count in the final message. */
  tokenFields: Record<string, number>;
  inputTextTokensNote: string;
  levels?: unknown;
  playback: { clips: number; seconds: number };
  /** What makes this run's numbers less trustworthy: a resumed socket, lost frames, an early end. */
  warnings: string[];
}

const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

function group(ts: TurnScore[]): GroupScore {
  const sum = ts.reduce((acc, t) => ({ n: acc.n + t.counts.n, s: acc.s + t.counts.s, d: acc.d + t.counts.d, i: acc.i + t.counts.i }), { n: 0, s: 0, d: 0, i: 0 });
  const round = (x: number) => Math.round(x * 1000) / 1000;
  return {
    turns: ts.length,
    rate: ts.length ? round(errorRate(sum)) : null,
    meanTurnRate: ts.length ? round(ts.reduce((a, t) => a + t.rate, 0) / ts.length) : null,
    ...sum,
  };
}

/** Any number-valued field whose name mentions tokens, anywhere in the final message: Soniox does not document one. */
function tokenCounts(x: unknown, path = ''): Array<[string, number]> {
  if (!x || typeof x !== 'object') return [];
  return Object.entries(x as Record<string, unknown>).flatMap(([k, v]) => {
    const p = path ? `${path}.${k}` : k;
    if (typeof v === 'number' && /token/i.test(k)) return [[p, v] as [string, number]];
    return tokenCounts(v, p);
  });
}

export function score(lines: readonly LogLine[]): Summary {
  const first = (kind: string) => lines.find((l) => l.kind === kind)?.d;
  const run = (first('run') ?? {}) as Record<string, unknown>;
  const turns = ((first('script') ?? {}).turns ?? []) as HumanTurn[];

  // Rows, as the adapter last stated them.
  const rows = new Map<string, Row>();
  const rowKey = (leg: string, ref: number) => `${leg}:${ref}`;
  for (const l of lines) {
    if (l.kind !== 'seg') continue;
    const d = l.d;
    const key = rowKey(d.leg, d.ref);
    if (d.event === 'opened') rows.set(key, { leg: d.leg, ref: d.ref, side: d.side, origin: d.origin, text: '', closed: false });
    const row = rows.get(key);
    if (!row) continue;
    if (d.event === 'text') {
      row.text = d.text;
      if (d.language) row.language = d.language;
      if (d.timing) row.timing = d.timing;
    }
    if (d.event === 'closed') row.closed = true;
  }
  const translationOf = (leg: string, origin?: string) => [...rows.values()].find((r) => r.side === 'translation' && r.leg === leg && r.origin === origin);
  const rowByRef = (ref: number) => [...rows.values()].find((r) => r.ref === ref);

  // Played chunks, with their real ranges once filled in.
  const chunks: Chunk[] = lines.filter((l) => l.kind === 'audio').map((l) => ({ ...l.d }));
  for (const l of lines) {
    if (l.kind !== 'ranges') continue;
    for (const { index, range } of l.d.ranges as Array<{ index: number; range: TextRange }>) {
      const c = chunks.find((x) => x.ref === l.d.ref && x.index === index);
      if (c) c.range = range;
    }
  }
  const chunkText = (c: Chunk) => {
    const row = rowByRef(c.ref);
    return row && c.range ? row.text.slice(c.range[0], c.range[1]) : '';
  };
  const chunkLang = (c: Chunk) => rowByRef(c.ref)?.language;
  const ttsOver = (from: number, to: number, lang?: string) =>
    chunks.filter((c) => overlap(from - TOLERANCE_MS, to + TOLERANCE_MS, c.micFrom, c.micTo) > 0 && (!lang || chunkLang(c) === lang))
      .sort((a, b) => a.micFrom - b.micFrom).map(chunkText).join('');

  // Source utterances: echo, or a person's.
  const sources = [...rows.values()].filter((r) => r.side === 'source');
  const finals = sources.filter((r) => r.closed && r.text.trim() !== '');
  const echoLines: EchoLine[] = [];
  const mergedLines: MergedLine[] = [];
  const humanLines = new Map<number, Row[]>();
  for (const u of finals) {
    const lang = u.language ?? '';
    const tr = translationOf(u.leg, u.origin);
    const spokenBack = tr !== undefined && chunks.some((c) => c.ref === tr.ref);
    const echo = (reason: EchoLine['reason'], tts: string) => echoLines.push({
      leg: u.leg, ref: u.ref, origin: u.origin, language: u.language, text: u.text,
      ...(u.timing ? { fromMs: u.timing.startMs, toMs: u.timing.endMs } : {}),
      reason, overlapsTts: tts, translated: tr?.text ?? '', spokenBack,
    });
    if (!u.timing) { echo('no-timing', ''); continue; }
    const { startMs, endMs } = u.timing;
    const tts = ttsOver(startMs, endMs, lang);
    const candidates = turns
      .filter((t) => t.lang === lang && overlap(startMs, endMs, t.fromMs - TOLERANCE_MS, t.toMs + TOLERANCE_MS) > 0)
      .sort((a, b) => overlap(startMs, endMs, b.fromMs, b.toMs) - overlap(startMs, endMs, a.fromMs, a.toMs));
    const turn = candidates[0];
    const mine = (t: HumanTurn) => humanLines.set(t.k, [...(humanLines.get(t.k) ?? []), u]);
    // A fair part of what the person said is in it: theirs. Echo merged into it shows as insertions, and the line is listed as merged.
    if (turn && coverage(turn.text, u.text, lang) >= MIN_HUMAN_SHARE) {
      mine(turn);
      const lineUnits = units(u.text, lang);
      const extra = lineUnits.length - lcs(lineUnits, units(turn.text, lang));
      if (tts && extra >= 2 && lcs(lineUnits, units(tts, lang)) >= extra / 2) {
        mergedLines.push({ leg: u.leg, ref: u.ref, origin: u.origin, language: u.language, text: u.text, fromMs: startMs, toMs: endMs, turn: turn.k, extraUnits: extra, overlapsTts: tts, translated: tr?.text ?? '', spokenBack });
      }
      continue;
    }
    // Mostly outside the person's speech: what they said is not in it.
    const inTurn = turn ? overlap(startMs, endMs, turn.fromMs - TOLERANCE_MS, turn.toMs + TOLERANCE_MS) / Math.max(1, endMs - startMs) : 0;
    if (!turn || inTurn < MIN_IN_TURN) { echo('outside-human-turn', tts); continue; }
    // Inside a turn but not its words: echo when it matches the played speech better than the person's words.
    if (tts && coverage(u.text, tts, lang) > coverage(u.text, turn.text, lang)) { echo('matches-tts', tts); continue; }
    mine(turn);
  }

  // The people's turns.
  const scored: TurnScore[] = turns.map((t) => {
    const said = (humanLines.get(t.k) ?? []).sort((a, b) => (a.timing?.startMs ?? 0) - (b.timing?.startMs ?? 0));
    const recognized = said.map((r) => r.text).join(t.lang === 'en' ? ' ' : '');
    const counts = editCounts(units(t.text, t.lang), units(recognized, t.lang));
    const echoOverlapMs = chunks.reduce((a, c) => a + overlap(t.fromMs, t.toMs, c.micFrom, c.micTo), 0);
    return {
      k: t.k, side: t.side, lang: t.lang, clip: t.clip, intent: t.intent,
      kind: echoOverlapMs > 0 ? 'talk-over' : 'clean', echoOverlapMs: Math.round(echoOverlapMs),
      metric: t.lang === 'en' ? 'wer' : 'cer', reference: t.text, recognized, counts, rate: Math.round(errorRate(counts) * 1000) / 1000,
    };
  });
  const byLanguage: Summary['humanWer']['byLanguage'] = {};
  for (const lang of [...new Set(turns.map((t) => t.lang))]) {
    const mine = scored.filter((t) => t.lang === lang);
    byLanguage[lang] = { talkOver: group(mine.filter((t) => t.kind === 'talk-over')), clean: group(mine.filter((t) => t.kind === 'clean')) };
  }

  // Agent text.
  const agent = lines.filter((l) => l.kind === 'agent').map((l) => ({ t: l.t, ...l.d }));
  const sent = agent.filter((a) => a.sent);
  const texts = sent.filter((a) => !a.end);
  const serverLeads: number[] = [];
  const playLeads: number[] = [];
  let unplayedTexts = 0;
  for (const a of texts) {
    if (a.ref === undefined || !a.span) continue;
    const spoken = chunks.filter((c) => c.ref === a.ref && c.voice === a.voice && c.range && overlap(c.range[0], c.range[1], a.span[0], a.span[1]) > 0);
    if (spoken.length === 0) { unplayedTexts++; continue; }
    const echoStart = Math.min(...spoken.map((c) => c.micFrom));
    const playStart = Math.min(...spoken.map((c) => c.at));
    serverLeads.push(echoStart - a.pos);
    playLeads.push(playStart - a.t);
  }
  const final = first('stt.final');
  const tokens = tokenCounts(final);
  const inputText = tokens.filter(([k]) => /input/i.test(k) && /text/i.test(k));
  const plannerStats = lines.filter((l) => l.kind === 'planner').pop()?.d;
  const end = first('end');
  const warnings: string[] = [];
  if (!end) warnings.push('the run did not finish: no end line');
  else {
    if (end.sttSockets > 1) warnings.push(`the STT socket was opened ${end.sttSockets} times: after a resume, times are on a new audio clock and the scoring by time is off`);
    if (end.framesPushed !== end.framesSent + 1) warnings.push(`${end.framesPushed} microphone frames pushed, ${end.framesSent} sent: frames were lost and the timeline shifted`);
    if (end.broken) warnings.push('the session failed or closed before the script and its tail were over');
  }
  if (!first('tau0')) warnings.push('no audio frame was ever sent');

  return {
    run,
    sourceUtterances: finals.length,
    unfinishedSourceUtterances: sources.filter((r) => !r.closed && r.text.trim() !== '').length,
    echoLines,
    echoLineCount: echoLines.length,
    echoTranslatedBack: echoLines.filter((e) => e.spokenBack).length,
    mergedLines,
    mergedLineCount: mergedLines.length,
    humanWer: { byLanguage, turns: scored },
    agentText: {
      framesSent: sent.length,
      framesDropped: agent.length - sent.length,
      textFrames: texts.length,
      endFrames: sent.filter((a) => a.end).length,
      chars: texts.reduce((n, a) => n + [...String(a.text)].length, 0),
      ...(plannerStats ? { planner: plannerStats } : {}),
      serverLeadMs: percentiles(serverLeads),
      playLeadMs: percentiles(playLeads),
      lateTexts: serverLeads.filter((x) => x < 0).length,
      unplayedTexts,
    },
    sonioxErrors: lines.filter((l) => l.kind === 'stt.error' || (l.kind === 'tts.in' && l.d?.error)).map((l) => ({ t: l.t, kind: l.kind, ...l.d })),
    sessionEvents: lines.filter((l) => l.kind === 'event').map((l) => ({ t: l.t, ...l.d })),
    inputTextTokens: inputText.length ? inputText.reduce((n, [, v]) => n + v, 0) : null,
    tokenFields: Object.fromEntries(tokens),
    inputTextTokensNote: inputText.length
      ? `from the final message: ${inputText.map(([k, v]) => `${k}=${v}`).join(', ')}`
      : tokens.length
        ? `the final message reports tokens (${tokens.map(([k, v]) => `${k}=${v}`).join(', ')}) but none named input text: read the cost in the Soniox console`
        : final
        ? 'the final message reports no token counts: read the cost in the Soniox console (usage by key, input text tokens)'
        : 'no final message was received: read the cost in the Soniox console (usage by key, input text tokens)',
    ...(first('levels') ? { levels: first('levels') } : {}),
    playback: { clips: chunks.length, seconds: Math.round(chunks.reduce((s, c) => s + (c.micTo - c.micFrom), 0) / 100) / 10 },
    warnings,
  };
}
