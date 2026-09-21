// @vitest-environment node
/**
 * Replay the recorded GPT-Live delta streams through the real `SentenceStream`
 * and measure what the spec's underived constants actually do.
 *
 * Off by default, because it is a measurement rather than a check:
 * `SOKUJI_SWEEP=1 npx vitest run benchmark/punctuation-restoration/tools/threshold-sweep.test.ts`.
 *
 * The corpus holds 140 items; 58 carry a real delta sequence (ja 26, zh 22,
 * en 10) and all 58 carry `delta_arrival_ms` — when each delta reached the
 * client, which is what commit lag is measured against. 35 also carry
 * `delta_timeline_ms` (the media clock), used for seals per minute.
 *
 * The model is an oracle: it answers with the corpus's own `reference_text`,
 * aligned to whatever window the stream asks about. That is deliberate. A real
 * model's quality is measured elsewhere (app-parity.test.ts); what a threshold
 * sweep must isolate is the gating and sealing behaviour, which an imperfect
 * model would only add noise to.
 */
import { describe, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { SentenceStream } from '../../../src/lib/segmentation/SentenceStream';
import { skeleton, sentenceEnds, breakpoints } from '../../../src/lib/segmentation/sentenceEnd';
import type { PunctuationResult, SegmentationRuntime } from '../../../src/lib/segmentation/SegmentationRuntime';

const here = dirname(fileURLToPath(import.meta.url));
const CORPUS = join(here, '..', 'corpus', 'gpt-live-log-extract.json');

interface CorpusItem {
  group: string;
  direction: string;
  lang: string;
  deltas?: string[];
  final: string;
  reference_text?: string;
  delta_timeline_ms?: [number, number][];
  delta_arrival_ms?: number[];
}

/** An offset in `text`'s skeleton -> the offset in `text` just past that character. */
function skeletonIndex(text: string): number[] {
  const marks: number[] = [];
  let offset = 0;
  for (const ch of text) {
    offset += ch.length;
    if (skeleton(ch).length > 0) marks.push(offset);
  }
  return marks;
}

/**
 * A runtime that answers with the reference text's own punctuation.
 *
 * The window it is asked about is located inside the reference by skeleton, so
 * the answer carries exactly the input's letters and digits — the invariant
 * `SentenceStream` discards an answer for failing.
 */
function oracleRuntime(reference: string): SegmentationRuntime & { calls: number } {
  const refSkeleton = skeleton(reference);
  const index = skeletonIndex(reference);
  const state = {
    enabled: true,
    calls: 0,
    async punctuate(_lang: string, text: string): Promise<PunctuationResult | null> {
      state.calls++;
      const want = skeleton(text);
      if (want.length === 0) return null;
      const at = refSkeleton.indexOf(want);
      if (at < 0) return null;
      const from = at === 0 ? 0 : index[at - 1];
      let to = index[at + want.length - 1];
      // Marks that follow the window's last letter belong to it: they are the
      // sentence end the stream is asking about.
      while (to < reference.length && skeleton(reference[to]).length === 0 && !/\s/.test(reference[to])) to++;
      const marked = reference.slice(from, to);
      return {
        text: marked,
        sentenceEnds: sentenceEnds(marked),
        breakpoints: breakpoints(marked),
        model: 'sat-3l-sm',
      };
    },
  };
  return state;
}

interface Seal {
  text: string;
  reason: string;
  /** Index of the delta that was being fed when the seal landed. */
  atDelta: number;
  /** Index of the delta that completed the sealed text. */
  readyAtDelta: number;
}

/** The marks an ASR that does not punctuate would never have emitted. Applied
 *  to the deltas only: the reference keeps them, so the oracle still knows
 *  where the sentences are. This is the case the feature exists for, and the
 *  only one in which the gate and fallback constants do anything at all. */
const MARKS = /[.!?,;:。．！？，、；：…]/g;

/** Feed one item's deltas through a stream and collect what it sealed. */
async function replay(item: CorpusItem, strip: boolean): Promise<{ seals: Seal[]; calls: number }> {
  const deltas = (item.deltas ?? []).map((d) => (strip ? d.replace(MARKS, '') : d));
  const runtime = oracleRuntime(item.reference_text ?? item.final);
  const seals: Seal[] = [];
  let current = 0;
  let consumed = 0;
  let pending = '';

  const stream = new SentenceStream({
    lang: item.lang,
    runtime,
    sentencesPerChunk: 3,
    onSeal: (chunk) => {
      // Which delta completed this text: walk the prefix lengths until the
      // sealed characters are covered.
      const end = consumed + chunk.text.length;
      let covered = 0;
      let readyAt = 0;
      for (let i = 0; i < deltas.length; i++) {
        covered += deltas[i].length;
        if (covered >= end) { readyAt = i; break; }
      }
      consumed = end;
      seals.push({ text: chunk.text, reason: chunk.reason, atDelta: current, readyAtDelta: readyAt });
    },
    onPending: (text) => { pending = text; },
  });

  for (let i = 0; i < deltas.length; i++) {
    current = i;
    stream.update(pending + deltas[i]);
    // Let the oracle's microtask land before the next delta, the way a real
    // answer would arrive between two of them.
    await Promise.resolve();
    await Promise.resolve();
  }
  current = deltas.length - 1;
  stream.end();
  await Promise.resolve();
  stream.dispose();
  return { seals, calls: runtime.calls };
}

/** A cut that lands where the reference has no boundary, i.e. mid-sentence. */
function landsOffBoundary(sealText: string, reference: string): boolean {
  const cut = skeleton(sealText).length;
  if (cut === 0) return false;
  const index = skeletonIndex(reference);
  const at = index[cut - 1];
  if (at === undefined) return false;
  const after = reference.slice(at).trimStart();
  // A boundary in the reference is a terminal or a comma right after the cut.
  return !/^[.!?,;:。．！？，、；：…]/.test(after) && after.length > 0;
}

describe.skipIf(process.env.SOKUJI_SWEEP !== '1')('threshold sweep on recorded deltas', () => {
  it('reports seals, lag and off-boundary cuts per language', async () => {
    const corpus = JSON.parse(readFileSync(CORPUS, 'utf8')) as { items: CorpusItem[] };
    const items = corpus.items.filter((i) => (i.deltas?.length ?? 0) > 0);

    const byLang = new Map<string, { items: number; seals: number; off: number; lagMs: number[]; secs: number; calls: number; byReason: Record<string, number> }>();
    const strip = process.env.SOKUJI_SWEEP_STRIP === '1';

    for (const item of items) {
      const { seals, calls } = await replay(item, strip);
      const arrival = item.delta_arrival_ms ?? [];
      const timeline = item.delta_timeline_ms ?? [];
      const row = byLang.get(item.lang) ?? { items: 0, seals: 0, off: 0, lagMs: [], secs: 0, calls: 0, byReason: {} as Record<string, number> };
      row.items++;
      row.seals += seals.length;
      row.calls += calls;
      const reference = item.reference_text ?? item.final;
      for (const seal of seals) {
        row.byReason[seal.reason] = (row.byReason[seal.reason] ?? 0) + 1;
        // The last seal of an utterance lands wherever the recording stopped,
        // which is mid-sentence in a clip — not a cut the thresholds chose.
        if (seal.reason !== 'end' && landsOffBoundary(seal.text, reference)) row.off++;
        const ready = arrival[seal.readyAtDelta];
        const landed = arrival[seal.atDelta];
        if (ready !== undefined && landed !== undefined) row.lagMs.push(landed - ready);
      }
      if (timeline.length > 0) {
        const last = timeline[timeline.length - 1];
        row.secs += (last?.[1] ?? 0) / 1000;
      }
      byLang.set(item.lang, row);
    }

    const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
    const lines = [...byLang.entries()].map(([lang, r]) =>
      `${lang}\titems=${r.items}\tseals=${r.seals}\toff-boundary=${r.off}`
      + `\tmean-lag=${Math.round(mean(r.lagMs))}ms\tmodel-calls=${r.calls}`
      + `\tseals/min=${r.secs > 0 ? (r.seals / (r.secs / 60)).toFixed(1) : 'n/a'}`
      + `\treasons=${JSON.stringify(r.byReason)}`);
    const out = `mode=${strip ? 'marks stripped from the deltas' : 'as recorded'}\n${lines.join('\n')}\n`;
    writeFileSync(join(here, `threshold-sweep.${strip ? 'stripped' : 'recorded'}.out.txt`), out);
    console.info(`\n${out}`);
  }, 120_000);

  it('reports what each right-context setting costs in latency', async () => {
    // RIGHT_CONTEXT_CHARS delays a seal until R more letters have arrived, so
    // a boundary cannot be sealed on text the ASR may still revise. On an
    // append-only stream like GPT-Live's nothing is ever revised, so R is pure
    // latency — this is how much of it, measured on the recorded arrival times
    // rather than argued from characters per second.
    const corpus = JSON.parse(readFileSync(CORPUS, 'utf8')) as { items: CorpusItem[] };
    const items = corpus.items.filter((i) => (i.deltas?.length ?? 0) > 0 && (i.delta_arrival_ms?.length ?? 0) > 0);
    const costs = new Map<string, Record<number, number[]>>();

    for (const item of items) {
      const deltas = item.deltas ?? [];
      const arrival = item.delta_arrival_ms ?? [];
      // Skeleton characters delivered by the end of each delta.
      const cum: number[] = [];
      let seen = 0;
      for (const d of deltas) { seen += skeleton(d).length; cum.push(seen); }
      const whole = deltas.join('');
      const perLang = costs.get(item.lang) ?? { 4: [], 8: [], 16: [] };

      for (const end of sentenceEnds(whole)) {
        const at = skeleton(whole.slice(0, end)).length;
        const arrivedAt = cum.findIndex((c) => c >= at);
        if (arrivedAt < 0) continue;
        for (const r of [4, 8, 16]) {
          const ready = cum.findIndex((c) => c >= at + r);
          // A boundary the recording never covers with R more letters would be
          // sealed by end() instead; it costs the rest of the utterance.
          const landed = ready < 0 ? arrival[arrival.length - 1] : arrival[ready];
          if (landed !== undefined && arrival[arrivedAt] !== undefined) {
            perLang[r].push(landed - arrival[arrivedAt]);
          }
        }
      }
      costs.set(item.lang, perLang);
    }

    const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
    const lines = [...costs.entries()].map(([lang, r]) =>
      `${lang}\tboundaries=${r[8].length}\tR=4 ${Math.round(mean(r[4]))}ms\tR=8 ${Math.round(mean(r[8]))}ms\tR=16 ${Math.round(mean(r[16]))}ms`);
    const out = `right-context cost, mean added latency per boundary\n${lines.join('\n')}\n`;
    writeFileSync(join(here, 'right-context-cost.out.txt'), out);
    console.info(`\n${out}`);
  }, 120_000);
});
