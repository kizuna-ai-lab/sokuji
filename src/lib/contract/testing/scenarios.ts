/**
 * The conformance suite every adapter passes (D24, spec "Testing"): the
 * same scenarios over any adapter, through its harness — the few steps
 * that are this adapter's own (opening its socket, making its server say
 * something, closing it). Each returns its conformance violations and the
 * problems particular to it; an adapter's test asserts both empty.
 * Test-only.
 */
import type { Adapter, SessionContext } from '../adapter';
import type { ConformanceLog, Violation } from '../conformance';
import type { AdapterEvent } from '../events';
import { describeCause } from '../../diagnostics/describeCause';
import { driveAdapter, type DriveResult, type ScenarioStep } from './drive';

export type ScenarioName = 'open-stop' | 'speech-off' | 'abort-while-opening' | 'manual-end' | 'manual-cancel' | 'text' | 'server-close' | 'reconnect';

export interface AdapterHarness<C, K> {
  adapter: Pick<Adapter<C, K>, 'start'>;
  /** A fresh config for one scenario; `scenario` lets a harness script its server per scenario. */
  config(context: SessionContext, scenario: ScenarioName): C;
  credentials: K;
  /** What lets a start resolve: open the socket, answer the handshake. Empty for an adapter that opens at once. */
  opening(scenario: ScenarioName): readonly ScenarioStep[];
  /** Makes the provider produce one exchange: a source segment and its translation, closed. */
  exchange: readonly ScenarioStep[];
  /** Makes the server end the session unexpectedly. */
  serverClose: readonly ScenarioStep[];
  /** Answers typed text; absent when the provider takes none (`textInput: false`). */
  answerText?: readonly ScenarioStep[];
  /** Drops the transport and lets it come back; absent when the adapter does not reconnect. */
  reconnect?: readonly ScenarioStep[];
}

export interface ScenarioReport { name: ScenarioName; violations: Violation[]; problems: string[] }

const AUTO: SessionContext = { direction: { source: 'en', target: 'ja' }, speech: true, turns: 'auto' };
const ALL: readonly ScenarioName[] = ['open-stop', 'speech-off', 'abort-while-opening', 'manual-end', 'manual-cancel', 'text', 'server-close', 'reconnect'];
const CONTENT = new Set<string>(['segmentOpened', 'segmentText', 'segmentClosed', 'audio']);
const kinds = (log: ConformanceLog) => log.filter((e): e is AdapterEvent => e.kind !== 'marker').map((e) => e.kind);
/** The log up to the caller's `stop`: what the steps produced. An emission after it is a `stop-silence` violation, not an answer. */
const untilStop = (log: ConformanceLog) => {
  const at = log.findIndex((e) => e.kind === 'marker' && e.payload === 'stop');
  return at < 0 ? log : log.slice(0, at);
};

/** The scenarios this harness can run: all, less typed text and reconnecting where the adapter has neither. */
export function scenarioNames(h: Partial<Pick<AdapterHarness<unknown, unknown>, 'answerText' | 'reconnect'>>): ScenarioName[] {
  return ALL.filter((n) => (n !== 'text' || h.answerText !== undefined) && (n !== 'reconnect' || h.reconnect !== undefined));
}

export async function runScenario<C, K>(h: AdapterHarness<C, K>, name: ScenarioName): Promise<ScenarioReport> {
  const problems: string[] = [];
  const drive = (context: SessionContext, opening: readonly ScenarioStep[], steps: readonly ScenarioStep[]) =>
    driveAdapter(h.adapter, { context, config: h.config(context, name), credentials: h.credentials, opening, steps });
  const manual: SessionContext = { ...AUTO, turns: 'manual' };
  let r: DriveResult;
  switch (name) {
    case 'open-stop':
    case 'speech-off':
      r = await drive(name === 'speech-off' ? { ...AUTO, speech: false } : AUTO, h.opening(name), h.exchange);
      if (!kinds(untilStop(r.log)).includes('segmentOpened')) problems.push('the exchange steps produced no segment');
      break;
    case 'abort-while-opening':
      r = await drive(AUTO, [{ abort: true }, { flush: true }], []);
      if (r.startError === undefined) problems.push('start resolved although its signal aborted while it was opening');
      if (kinds(r.log).some((k) => CONTENT.has(k))) problems.push('content was emitted after the start was cancelled');
      break;
    case 'manual-end':
      r = await drive(manual, h.opening(name), [{ turn: 'begin' }, { audio: 600 }, { turn: 'end' }, ...h.exchange]);
      break;
    case 'manual-cancel':
      r = await drive(manual, h.opening(name), [{ turn: 'begin' }, { audio: 100 }, { turn: 'cancel' }, { advance: 5_000 }]);
      break;
    case 'text':
      if (!h.answerText) throw new Error('this harness takes no typed text');
      r = await drive(AUTO, h.opening(name), [{ text: 'typed words' }, ...h.answerText]);
      break;
    case 'server-close':
      r = await drive(AUTO, h.opening(name), [...h.exchange, ...h.serverClose]);
      if (!kinds(r.log).some((k) => k === 'closed' || k === 'failed')) problems.push('the server ended the session and the adapter did not say so (failed or closed)');
      break;
    case 'reconnect': {
      if (!h.reconnect) throw new Error('this harness does not reconnect');
      r = await drive(AUTO, h.opening(name), [...h.exchange, ...h.reconnect, ...h.exchange]);
      const k = kinds(r.log);
      const at = k.indexOf('reconnecting');
      if (at < 0 || k.indexOf('reconnected', at) < 0) problems.push('no reconnecting followed by reconnected');
      break;
    }
    default:
      // Exhaustive over ScenarioName; also what tells the compiler `r` is assigned below.
      throw new Error(`unknown scenario ${String(name)}`);
  }
  if (name !== 'abort-while-opening' && r.startError !== undefined) problems.push(`start rejected: ${describeCause(r.startError)}`);
  return { name, violations: r.violations, problems };
}
