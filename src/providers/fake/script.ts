import type { Side, SegmentTiming, TextRange } from '../../lib/contract/adapter';
import type { ClientDiagnosticCode } from '../../lib/diagnostics/clientDiagnostics';
import { msForText } from './synth';

/** One scripted emission. `at` is relative to the block's start. */
export type ScriptStep =
  | { at: number; open: { ref: number; side: Side; origin?: string } }
  | { at: number; text: { ref: number; text: string; timing?: SegmentTiming; language?: string } }
  | { at: number; close: { ref: number; origin?: string } }
  | { at: number; audio: { ref?: number; range?: TextRange; ms: number; /** The tone's phase: samples of this stream already played, so consecutive chunks join without a click (G3). */ from?: number } }
  | { at: number; degraded: { code: ClientDiagnosticCode; message: string } }
  | { at: number; reconnecting: true }
  | { at: number; reconnected: true }
  | { at: number; failed: { message: string; code?: string } }
  | { at: number; closed: { reason: string } }
  | { at: number; loading: { stage: string; done: number; total: number } }
  | { at: number; busy: boolean }
  | { at: number; frame: { direction: 'in' | 'out'; type: string; payload?: unknown } };

/**
 * A block plays as one unit: at `startAt` under automatic turns, or on the
 * n-th `endTurn` under manual turns.
 */
export interface ScriptBlock {
  startAt: number;
  steps: ScriptStep[];
}

export interface FakeScript {
  blocks: ScriptBlock[];
  /** What `appendText` answers with. Default: the text wrapped in «». */
  translate?: (text: string) => string;
}

export interface ExchangeOptions {
  startAt: number;
  /** The source segment's ref; the translation takes `ref + 1`. */
  ref: number;
  /** Successive partials; the last one is the final text. */
  source: string[];
  translation: string;
  /** Stated on both segments when given. */
  origin?: string;
  language?: string;
  /** Milliseconds between source partials. */
  partialEvery?: number;
  /** Split the translation's audio into this many chunks with ranges. 0 = one chunk without a range. */
  audioChunks?: number;
  timing?: { source: SegmentTiming; translation: SegmentTiming };
  /** false: the translation's audio chunks carry no range (replay only, no karaoke). Default true. */
  ranged?: boolean;
}

/** Source partials → close → translation text → its audio → close. */
export function exchange(o: ExchangeOptions): ScriptBlock {
  const every = o.partialEvery ?? 200;
  const steps: ScriptStep[] = [];
  let at = 0;
  steps.push({ at, open: { ref: o.ref, side: 'source', origin: o.origin } });
  for (const partial of o.source) {
    steps.push({ at, text: { ref: o.ref, text: partial, timing: o.timing?.source, language: o.language } });
    at += every;
  }
  steps.push({ at, close: { ref: o.ref, origin: o.origin } });
  const tr = o.ref + 1;
  at += every;
  steps.push({ at, open: { ref: tr, side: 'translation', origin: o.origin } });
  steps.push({ at, text: { ref: tr, text: o.translation, timing: o.timing?.translation } });
  const chunks = o.audioChunks ?? 1;
  if (chunks <= 0) {
    steps.push({ at, audio: { ref: tr, ms: msForText(o.translation) } });
  } else {
    const len = o.translation.length;
    for (let k = 0; k < chunks; k++) {
      const start = Math.floor((len * k) / chunks);
      const end = k === chunks - 1 ? len : Math.floor((len * (k + 1)) / chunks);
      const piece = o.translation.slice(start, end);
      steps.push({ at, audio: { ref: tr, ...(o.ranged === false ? {} : { range: [start, end] as TextRange }), ms: msForText(piece) } });
      at += msForText(piece);
    }
  }
  steps.push({ at, close: { ref: tr, origin: o.origin } });
  return { startAt: o.startAt, steps };
}
