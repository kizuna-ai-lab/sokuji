/**
 * The Gemini probe's `multi` mode (`gemini.mts multi`): three or more
 * different sentences at real-time pace, for the two automatic-turn failure
 * modes the Gemini hold plan (`docs/superpowers/plans/2026-09-29-client-contract-stage2-gemini-hold.md`)
 * could not probe with two utterances, and for the participant leg's lag:
 *
 * - (a) speech that starts just after the server's turn close, before the
 *   hold begins: its onset reaches the server live and can barge into the
 *   answer as it starts generating;
 * - (b) a released burst that itself holds a turn close: utterance k's end,
 *   a pause, and utterance k+1's onset, all inside one hold, read at once;
 * - the lag behind each utterance's end, against the plan's
 *   L(n+1) ≈ max(L(n) + A(n) − P − U(n+1), c) + f.
 *
 * The sentences are cut from the repository's three recordings, never
 * repeated (a model collapses repeats: batch 2f). Each is kept from 60 ms
 * before its speech onset to 100 ms after its speech end, and the silence
 * between two is set so the speech pause is exactly the one asked for.
 */
import path from 'node:path';
import { CLIPS, REPO, concat, readWav, silence } from './common.mts';
import { cutClass, speechBounds, type Entry, type HoldRecord, type SentAudio, type Utterance } from './gemini-hold.mts';

export interface Sentence {
  /** Where it is cut from, and its speech span there (ms; the first and last 10 ms frame above a tenth of the file's loudest). */
  file: string;
  from: number;
  to: number;
  text: string;
  /** Its words in the input transcription, and in an English translation: all must match for "whole". */
  heard: readonly RegExp[];
  said: readonly RegExp[];
}

const BENCH = path.join(REPO, 'benchmark/test-speech-silence-speech.wav');

/**
 * The sentences, and where each comes from. `classic-ja.wav` (6.16 s) holds
 * two sentences split by a 0.32 s pause; `classic-zh.wav` (4.64 s) one
 * sentence whose comma is a 0.59 s pause; the benchmark's
 * `test-speech-silence-speech.wav` (9.69 s) the same English sentence twice,
 * of which only the first copy is used, split at its comma (a 0.17 s pause).
 * `zh1` means what `ja1` means, so no script holds both.
 */
export const SENTENCES: Record<string, Sentence> = {
  ja: { file: CLIPS.ja, from: 610, to: 5800, text: 'リアルタイム翻訳へようこそ。自然な会話をお手伝いします。', heard: [/ようこそ/g, /手伝い/g], said: [/welcome/gi, /conversation/gi] },
  ja1: { file: CLIPS.ja, from: 610, to: 2990, text: 'リアルタイム翻訳へようこそ。', heard: [/ようこそ/g], said: [/welcome/gi] },
  ja2: { file: CLIPS.ja, from: 3310, to: 5800, text: '自然な会話をお手伝いします。', heard: [/手伝い/g], said: [/conversation/gi] },
  zh1: { file: CLIPS.zh, from: 140, to: 1380, text: '欢迎使用实时翻译，', heard: [/欢迎|歡迎|歓迎/g], said: [/welcome/gi] },
  zh2: { file: CLIPS.zh, from: 1970, to: 4520, text: '希望这个声音能让交流变得轻松自然。', heard: [/希望/g], said: [/hope/gi] },
  en1: { file: BENCH, from: 60, to: 1900, text: 'Ask not what your country can do for you,', heard: [/ask not|don'?t ask|do not ask/gi, /do for you(?!r)/gi], said: [/ask not|don'?t ask|do not ask/gi, /do for you(?!r)/gi] },
  en2: { file: BENCH, from: 2070, to: 3730, text: 'ask what you can do for your country.', heard: [/ask what you/gi, /for your country/gi], said: [/ask what you/gi, /for your country/gi] },
};

/** Two scripts: `seq` — a long first sentence, a short second (shorter than the first's answer), a third; `mono` — five sentences in a row, the participant leg's monologue. */
export const SCRIPTS = {
  seq: ['ja', 'en1', 'zh2'],
  mono: ['ja1', 'en1', 'zh2', 'en2', 'ja2'],
} as const;
export type Script = keyof typeof SCRIPTS;

const LEAD_MS = 60;
const TAIL_MS = 100;

export function cutSentence(id: string, rate: number): Int16Array {
  const s = SENTENCES[id];
  if (!s) throw new Error(`no sentence ${id}; known: ${Object.keys(SENTENCES).join(', ')}`);
  const all = readWav(s.file, rate);
  const at = (ms: number) => Math.min(all.length, Math.max(0, Math.round((rate * ms) / 1000)));
  return all.subarray(at(s.from - LEAD_MS), at(s.to + TAIL_MS));
}

/**
 * `--seq-pauses` / `--mono-pauses`: commas sweep (one session per value),
 * slashes make one session's pattern, used in turn and cycled:
 * `800,1050` → two sessions; `800/1200/1000` → one.
 */
export function parsePauses(spec: string): number[][] {
  return spec.split(',').map((p) => p.split('/').map(Number)).filter((p) => p.length && p.every((n) => Number.isFinite(n) && n >= 0));
}

/**
 * The capture timeline: each sentence in turn, the silence between two set so
 * the speech pause (speech end → next speech onset) is the one asked for,
 * then `tailMs` of silence. Automatic turns only.
 */
export function sequence(ids: readonly string[], pauses: readonly number[], rate: number, chunkMs: number, tailMs: number): {
  entries: Entry[]; utterances: Utterance[]; endPos: number; clips: Array<{ id: string; ms: number; onset: number; end: number }>;
} {
  const ms = (n: number) => (1000 * n) / rate;
  const clips = ids.map((id) => ({ id, pcm: cutSentence(id, rate) }));
  const bounds = clips.map((c) => speechBounds(c.pcm, rate));
  const parts: Int16Array[] = [];
  const utterances: Utterance[] = [];
  let pos = 0;
  clips.forEach((c, i) => {
    if (i > 0) {
      const want = pauses[(i - 1) % pauses.length];
      const gap = Math.max(0, want - (ms(clips[i - 1].pcm.length) - bounds[i - 1].end) - bounds[i].onset);
      parts.push(silence(gap, rate));
      pos += gap;
    }
    utterances.push({ k: i + 1, id: c.id, start: pos, onset: pos + bounds[i].onset, end: pos + bounds[i].end, stop: pos + ms(c.pcm.length), reps: 1 });
    parts.push(c.pcm);
    pos += ms(c.pcm.length);
  });
  const all = concat(...parts, silence(tailMs, rate));
  const step = Math.round((rate * chunkMs) / 1000);
  const entries: Entry[] = [];
  for (let off = 0; off < all.length; off += step) {
    const piece = all.subarray(off, off + step);
    entries.push({ kind: 'audio', pos: ms(off), ms: ms(piece.length), pcm: piece });
  }
  return { entries, utterances, endPos: ms(all.length), clips: clips.map((c, i) => ({ id: c.id, ms: ms(c.pcm.length), ...bounds[i] })) };
}

// ---------- the report ----------

interface ReportTurn {
  index: number;
  text: string;
  events: Array<{ t: number; kind: 'audio' | 'text'; samples?: number }>;
  rate: number;
}
export interface MultiReportInput {
  script: string;
  policy: string;
  pausesLabel: string;
  utterances: readonly Utterance[];
  clips: ReadonlyArray<{ id: string; ms: number; onset: number; end: number }>;
  /** Run time the capture stream began: a stream position plus this is a run time. */
  streamT0: number;
  holds: readonly HoldRecord[];
  sent: readonly SentAudio[];
  inputs: ReadonlyArray<{ t: number; text: string; vaOpen: boolean }>;
  turns: readonly ReportTurn[];
  ends: ReadonlyArray<{ t: number; flag: string; open: boolean }>;
  va: ReadonlyArray<{ t: number; type?: string; offsetMs?: number }>;
}

const sec = (ms: number | undefined | null) => (ms === undefined || ms === null ? '-' : `${(ms / 1000).toFixed(2)} s`);
const signed = (ms: number) => `${ms >= 0 ? '+' : '−'}${(Math.abs(ms) / 1000).toFixed(2)} s`;
const hits = (text: string, res: readonly RegExp[]) => res.map((re) => (text.match(re) ?? []).length);
const verdictOf = (c: number[]) => (c.every((n) => n > 0) ? 'whole' : c.some((n) => n > 0) ? 'partial' : 'none');

/** One `interrupted`, classified by the plan's live-test item 10. */
export interface Interrupt {
  t: number;
  kind: '(a)' | '(a), before its hold began' | '(b)' | '(b), before its hold began' | 'barge-in, no hold' | 'unclassified';
  cut: 'true' | 'simulated';
  hold?: number;
  line: string;
}

export function multiReport(r: MultiReportInput): { text: string; interrupts: Interrupt[] } {
  const us = r.utterances;
  const lines: string[] = [];
  const u = (k: number) => us[k - 1];
  const idOf = (x: Utterance) => x.id ?? `U${x.k}`;

  // Where each piece of audio went: live, or in which hold's release.
  const entryAt = (pos: number) => r.sent.find((s) => pos >= s.pos && pos < s.pos + s.ms);
  const sendAt = (pos: number) => {
    const e = entryAt(pos);
    return e ? e.at + (e.held ? 0 : pos - e.pos) : undefined;
  };
  const utteranceNear = (pos: number, which: 'onset' | 'end') =>
    [...us].sort((x, y) => Math.abs(x[which] - pos) - Math.abs(y[which] - pos))[0];
  const starts = r.va.filter((v) => v.type === 'ACTIVITY_START' && v.offsetMs !== undefined);
  const endsVa = r.va.filter((v) => v.type === 'ACTIVITY_END' && v.offsetMs !== undefined);
  /** The server's close of utterance k: the ACTIVITY_END whose offset follows its speech end most closely (within 3 s). */
  const closeOf = (x: Utterance) => endsVa.find((v) => v.offsetMs! >= x.end && v.offsetMs! - x.end < 3000 && utteranceNear(v.offsetMs!, 'end') === x);
  const holdOf = (n: number | undefined) => r.holds.find((h) => h.n === n);
  const holdAt = (t: number) => r.holds.find((h) => h.t <= t && (h.released === undefined || t <= h.released));
  const spans = (h: HoldRecord) => {
    const to = h.releasedPos ?? Infinity;
    const inside: string[] = [];
    for (const x of us) {
      if (x.end >= h.pos && x.end < to) inside.push(`U${x.k}'s end`);
      if (x.onset >= h.pos && x.onset < to) inside.push(`U${x.k}'s onset`);
    }
    return inside;
  };

  lines.push(`**Multi** — script \`${r.script}\` (${us.map(idOf).join(', ')}); policy \`${r.policy}\`${r.policy === 'turn' ? ' (the plan\'s hold: begins on ACTIVITY_END, else the first output; lets go at turnComplete or waitingForInput; cap 2 s past the computed playback end, 10 s with no model audio)' : ' (today: barge-in, no hold)'}; pauses ${r.pausesLabel} ms`);
  lines.push('');
  for (const x of us) {
    const c = r.clips[x.k - 1];
    const s = SENTENCES[c.id];
    lines.push(`- U${x.k} \`${c.id}\` “${s.text}” from \`${path.basename(s.file)}\` ${sec(s.from)}–${sec(s.to)}: speech ${sec(c.onset)}–${sec(c.end)} of its ${sec(c.ms)} clip (${sec(c.end - c.onset)}); stream ${sec(x.onset)}–${sec(x.end)}${x.k > 1 ? `, pause before it ${sec(x.onset - u(x.k - 1).end)}` : ''}`);
  }

  // Each pause: the server's close of the utterance before it, the hold's begin, and where the next onset fell.
  lines.push('');
  lines.push('**Pauses** (stream positions; the close is the ACTIVITY_END\'s audioOffset)');
  lines.push('');
  for (const x of us.slice(1)) {
    const prev = u(x.k - 1);
    const close = closeOf(prev);
    const h = r.holds.find((y) => y.pos >= prev.end && y.pos < x.end + 3000 && (close === undefined || y.t >= close.t - 1));
    const parts = [`U${prev.k}→U${x.k}: pause ${sec(x.onset - prev.end)}`];
    parts.push(close ? `U${prev.k}'s close at ${signed(close.offsetMs! - prev.end)} after its speech end` : `no ACTIVITY_END in this pause (U${prev.k} and U${x.k} one turn to the server, or none was sent)`);
    if (h) parts.push(`hold ${h.n} began at stream ${sec(h.pos)}${close ? ` (${signed(h.pos - close.offsetMs!)} after the close)` : ''}; U${x.k}'s onset ${x.onset >= h.pos ? `held (${sec(x.onset - h.pos)} after the hold began)` : `**sent live ${sec(h.pos - x.onset)} before the hold began**`}`);
    else if (r.policy === 'turn') parts.push('no hold began in this pause');
    const e = entryAt(x.onset);
    if (e?.held) parts.push(`U${x.k}'s onset went up in hold ${e.hold}'s release`);
    lines.push(`- ${parts.join('; ')}`);
  }

  // Holds.
  lines.push('');
  lines.push('**Holds**');
  lines.push('');
  if (!r.holds.length) lines.push(`- none${r.policy === 'none' ? ' (policy none)' : ''}`);
  // A hold begun just after a model turn ended waits for a turn that will not come: nothing lets it go but the cap.
  const lateHold = (h: HoldRecord) => {
    const ended = [...r.ends].reverse().find((e) => e.flag === 'turnComplete' && e.t <= h.t && h.t - e.t < 1000);
    return ended && (h.reason === 'idle' || h.reason === 'cap') ? ended : undefined;
  };
  for (const h of r.holds) {
    const inside = spans(h);
    const late = lateHold(h);
    lines.push(`- hold ${h.n}: stream ${sec(h.pos)} → ${sec(h.releasedPos)} (began on \`${h.cause}\`, let go on \`${h.reason ?? 'never'}\`); held ${sec(h.heldMs)}, ${sec(h.audioMs)} of audio${inside.length ? `, holding ${inside.join(', ')}` : ''}; playbackEndMs ${h.playbackEndMs ?? 'null'}${late ? `; **began ${sec(h.t - late.t)} after a turnComplete: the turn it waited for had already ended, and the speech it held could not close a new one**` : ''}`);
  }

  // What each model turn answered, and its cut.
  const saidBy = (text: string) => us.filter((x) => SENTENCES[x.id!]?.said.some((re) => (text.match(re) ?? []).length > 0));
  const interrupts = r.ends.filter((e) => e.flag === 'interrupted');
  lines.push('');
  lines.push('**Model turns** (cut: true = `interrupted` before `generationComplete`; simulated = after it)');
  lines.push('');
  r.turns.forEach((tr, i) => {
    const first = tr.events[0]?.t ?? Infinity;
    const next = r.turns[i + 1]?.events[0]?.t ?? Infinity;
    const cut = interrupts.find((e) => e.t >= first && e.t < next && e.open);
    const cls = cut ? cutClass(r.ends, cut.t) : 'none';
    const answered = saidBy(tr.text);
    lines.push(`- turn ${tr.index}: answers ${answered.map((x) => `U${x.k}`).join('+') || 'nothing recognised'}; cut **${cls}** — “${tr.text.trim()}”`);
  });
  for (const e of interrupts.filter((x) => !x.open)) {
    lines.push(`- an interrupt at ${sec(e.t)} with no model output in flight: cut **${cutClass(r.ends, e.t)}** (an answer cut before its first output)`);
  }

  // Every interrupted, classified.
  lines.push('');
  lines.push('**Interrupts** (the plan\'s live-test item 10)');
  lines.push('');
  const classified: Interrupt[] = [];
  for (const i of interrupts) {
    const h = holdAt(i.t);
    const start = [...starts].reverse().find((v) => v.t <= i.t);
    const off = start?.offsetMs;
    const entry = off === undefined ? undefined : entryAt(off);
    const who = off === undefined ? undefined : utteranceNear(off, 'onset');
    const cut = cutClass(r.ends, i.t);
    const tail = `${cut === 'true' ? `no generationComplete before it: a **true** cut${i.open ? '' : ', with no output in flight'}` : 'after generationComplete: a simulated cut'}`;
    const startText = start ? `ACTIVITY_START audioOffset ${sec(off)}${who ? ` (U${who.k}'s onset ${sec(who.onset)})` : ''}` : 'no ACTIVITY_START before it';
    let kind: Interrupt['kind'];
    let why: string;
    if (!h) {
      const next = r.holds.find((y) => y.t > i.t && y.t - i.t < 1000);
      const late = next ? `; hold ${next.n} began ${sec(next.t - i.t)} after the interrupt, at stream ${sec(next.pos)}, so after the model turn it would wait for had ended${next.reason === 'idle' || next.reason === 'cap' ? ` — it let go only on \`${next.reason}\`, ${sec(next.heldMs)} later` : ''}` : '';
      if (entry && entry.held && entry.hold !== undefined) {
        // The plan's (b), in the other order: the burst's close and the next onset were read at once, and the
        // interrupt (and its turnComplete) came before the ACTIVITY_END that begins the next hold.
        kind = '(b), before its hold began';
        const p = holdOf(entry.hold)!;
        const inside = spans(p);
        why = `${startText} lies in hold ${p.n}'s burst (held stream ${sec(p.pos)}–${sec(p.releasedPos)}, ${sec(p.audioMs)}${inside.length ? `, holding ${inside.join(', ')}` : ''}), let go ${sec(i.t - p.released!)} before the interrupt${late}`;
      } else if (next && entry && !entry.held && entry.at < next.t) {
        kind = '(a), before its hold began';
        why = `${startText} lies in audio sent live${late}`;
      } else {
        kind = 'barge-in, no hold';
        why = `${startText}, sent ${entry?.held ? `in hold ${entry.hold}'s release` : 'live'}; no hold was on`;
      }
    } else if (entry && !entry.held && entry.at < h.t) {
      kind = '(a)';
      const prevEnd = [...r.holds].reverse().find((y) => y.released !== undefined && y.released <= h.t);
      const gap = prevEnd ? h.t - prevEnd.released! : undefined;
      const prev = who && who.k > 1 ? u(who.k - 1) : undefined;
      const close = prev ? closeOf(prev) : undefined;
      why = `${startText} lies in audio sent live before hold ${h.n} began (at stream ${sec(h.pos)}${who ? `: ${sec(h.pos - who.onset)} of U${who.k}'s speech went up first` : ''}); ${gap === undefined || gap > 1000 ? 'no turn.hold_end in the second before the hold' : `a hold ended ${sec(gap)} before it`}${prev ? `; pause U${prev.k}→U${who!.k} ${sec(who!.onset - prev.end)}` : ''}${close ? `, U${prev!.k}'s close ${signed(close.offsetMs! - prev!.end)} after its speech end, the hold ${signed(h.pos - close.offsetMs!)} after the close` : ''}`;
    } else if (entry && entry.held && entry.hold !== undefined && entry.hold < h.n) {
      kind = '(b)';
      const p = holdOf(entry.hold)!;
      const inside = spans(p);
      const prev = who && who.k > 1 ? u(who.k - 1) : undefined;
      why = `${startText} lies in hold ${p.n}'s burst (held stream ${sec(p.pos)}–${sec(p.releasedPos)}, ${sec(p.audioMs)}${inside.length ? `, holding ${inside.join(', ')}` : ''}), let go ${sec(h.t - p.released!)} before hold ${h.n} began${prev ? `; the pause U${prev.k}→U${who!.k} ${sec(who!.onset - prev.end)} was inside that burst` : ''}`;
    } else {
      kind = 'unclassified';
      why = `${startText}; ${entry ? (entry.held ? `sent in hold ${entry.hold}'s release` : 'sent live after the hold began') : 'not in any audio sent'}`;
    }
    const line = `- interrupted at ${sec(i.t)}${h ? ` inside hold ${h.n}` : ''}: **${kind}** — ${why}; ${tail}`;
    classified.push({ t: i.t, kind, cut, hold: h?.n, line });
    lines.push(line);
  }
  if (!interrupts.length) lines.push('- none');

  // Utterances, by their own words.
  const heardText = r.inputs.map((p) => p.text).join(' ');
  const saidText = r.turns.map((tr) => tr.text).join(' ');
  lines.push('');
  lines.push('**Utterances**');
  lines.push('');
  const per = us.map((x) => {
    const s = SENTENCES[x.id!];
    const h = verdictOf(hits(heardText, s.heard));
    const t = verdictOf(hits(saidText, s.said));
    const answer = r.turns.find((tr) => s.said.some((re) => (tr.text.match(re) ?? []).length > 0));
    lines.push(`- U${x.k} \`${x.id}\`: heard **${h}**, translated **${t}**${answer ? ` (turn ${answer.index})` : ''}`);
    return { x, h, t, answer };
  });
  const mergedTurns = r.turns.filter((tr) => saidBy(tr.text).length > 1).map((tr) => saidBy(tr.text).map((x) => `U${x.k}`).join('+'));
  const mergedInputs = r.inputs.filter((p) => us.filter((x) => SENTENCES[x.id!].heard.some((re) => (p.text.match(re) ?? []).length > 0)).length > 1);
  lines.push(`- merged: ${mergedTurns.length ? `one answer for ${mergedTurns.join(', ')}` : mergedInputs.length ? 'one transcription held two utterances' : 'no'}`);
  lines.push(`- transcripts heard: ${r.inputs.map((p) => `“${p.text.trim()}”`).join(' ') || '-'}`);

  // Lag.
  const audioMs = (tr: ReportTurn) => (1000 * tr.events.reduce((n, e) => n + (e.kind === 'audio' ? e.samples ?? 0 : 0), 0)) / tr.rate;
  const firstAudio = (tr: ReportTurn | undefined) => tr?.events.find((e) => e.kind === 'audio')?.t;
  const lags = per.map((p) => {
    const f = firstAudio(p.answer);
    return f === undefined ? undefined : f - (r.streamT0 + p.x.end);
  });
  lines.push('');
  lines.push('**Lag** (utterance speech end → its answer\'s first audio; predicted: L(k) ≈ max(L(k−1) + A(k−1) − P − U(k), c) + f, with this run\'s own c and f)');
  lines.push('');
  // An utterance whose answer also answers the next one waits for the next to end: only the last of such a group counts in the trend.
  const merges = (i: number) => per[i + 1] !== undefined && per[i + 1].answer !== undefined && per[i + 1].answer === per[i].answer;
  per.forEach((p, i) => {
    const L = lags[i];
    if (L === undefined) { lines.push(`- U${p.x.k}: no answer recognised`); return; }
    if (merges(i)) { lines.push(`- U${p.x.k}: ${sec(L)}, one answer with U${p.x.k + 1}: not counted in the trend`); return; }
    const A = p.answer ? audioMs(p.answer) : 0;
    let pred = '';
    if (i > 0 && r.policy === 'turn') {
      const prev = per[i - 1];
      const Lp = lags[i - 1];
      const close = closeOf(p.x);
      const closeWall = close ? sendAt(close.offsetMs!) ?? close.t : undefined;
      const f = closeWall !== undefined ? firstAudio(p.answer)! - closeWall : undefined;
      const c = close ? close.offsetMs! - p.x.end : undefined;
      if (prev.answer === p.answer) pred = '; one answer with the utterance before it (merged)';
      else if (Lp !== undefined && prev.answer && c !== undefined && f !== undefined) {
        const P = p.x.onset - prev.x.end;
        const U = p.x.end - p.x.onset;
        const value = Math.max(Lp + audioMs(prev.answer) - P - U, c) + f;
        pred = `; predicted ${sec(value)} (A(k−1) ${sec(audioMs(prev.answer))}, P ${sec(P)}, U ${sec(U)}, c ${sec(c)}, f ${sec(f)})`;
      }
    }
    lines.push(`- U${p.x.k}: **${sec(L)}**; answer audio ${sec(A)}${pred}`);
  });
  const known = lags.filter((l, i): l is number => l !== undefined && !merges(i));
  const delta = known.length > 1 ? known[known.length - 1] - known[0] : undefined;
  const trend = delta === undefined ? 'n/a' : delta >= 500 ? `**grows** (${signed(delta)} first → last)` : delta <= -500 ? `shrinks (${signed(delta)})` : `stable (${signed(delta)})`;
  lines.push(`- trend: ${trend}`);

  // Verdict.
  const a = classified.filter((x) => x.kind.startsWith('(a)')).length;
  const b = classified.filter((x) => x.kind.startsWith('(b)')).length;
  const barge = classified.filter((x) => x.kind === 'barge-in, no hold').length;
  const trueCuts = classified.filter((x) => x.cut === 'true').length;
  const lost = per.filter((p) => p.t !== 'whole').map((p) => `U${p.x.k} translated ${p.t}`);
  const deaf = per.filter((p) => p.h !== 'whole').map((p) => `U${p.x.k} heard ${p.h}`);
  const lates = r.holds.filter((h) => lateHold(h)).length;
  const capped = r.holds.filter((h) => h.reason === 'idle' || h.reason === 'cap').length;
  const pass = !lost.length && !deaf.length && trueCuts === 0;
  const why = [
    a ? `(a) ×${a}` : '', b ? `(b) ×${b}` : '', barge ? `barge-in cuts ×${barge}` : '',
    trueCuts ? `true cuts ×${trueCuts}` : '', ...deaf, ...lost,
    capped ? `holds let go on the cap ×${capped}${lates ? ` (${lates} begun after their turn had ended)` : ''}` : '',
  ].filter(Boolean);
  lines.push('');
  lines.push(`**Multi verdict: ${pass ? 'PASS' : 'FAIL'}**${pass && mergedTurns.length ? ' (merged)' : ''} — ${why.length ? why.join('; ') : 'every utterance heard and translated whole, no true cut'}; lag ${known.map((l) => sec(l)).join(' → ') || '-'} (${trend.replace(/\*\*/g, '')})`);
  return { text: lines.join('\n'), interrupts: classified };
}
