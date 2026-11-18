// src/lib/notes/live/loop.ts
//
// The live notes' loop (spec §6.1): every 20 seconds, if a sentence arrived since the last update, one update with
// the new sentences. One at a time: when the next is due and the last has not answered, the last is given up and its
// sentences go with the next. Timeout 20 s. A failed or given-up update changes nothing on screen; three failures in
// a row show one hint, gone with the next success. At Stop one last update with what remains, then nothing.
import type { WordEntry } from '../../words/list';
import type { Clock } from '../../contract/clock';
import type { ChatPort } from '../chat';
import { ChatError, type NotesUsage } from '../chat';
import { livePrompt } from '../prompts';
import { activePrompts } from '../promptSource';
import type { NotesLanguage } from '../runner';
import { applyLive, emptyLive, livePayload, type LiveSentence, type LiveState } from './state';

export const LIVE_INTERVAL_MS = 20_000;
export const LIVE_TIMEOUT_MS = 20_000;
export const LIVE_HINT_AFTER = 3;
const LIVE_TOKENS = 2_500;

export interface LiveNotesDeps {
  chat: ChatPort;
  clock: Clock;
  language: NotesLanguage;
  speakerLabel(s: LiveSentence): string;
  /** The word list at the session's start: spellings each update asks the notes to prefer (stage 5). */
  names?: readonly WordEntry[];
  onState(state: LiveState): void;
  onHint(shown: boolean): void;
  /** One line per update, for the measurement on live recognition (§12). */
  log?(line: Record<string, unknown>): void;
  /** Kizuna AI refused for the account (no balance, a daily limit, signed out…): the loop has stopped for good. */
  onStopped?(why: string): void;
  /** What an update used, as the service reports it (Kizuna AI's relay does). */
  onUsage?(usage: NotesUsage): void;
  /** Notes to go on from (live notes turned on again in the same session): their sentences are context, not new. */
  from?: { state: LiveState; seen: readonly LiveSentence[] };
}

export interface LiveNotes {
  /** Sentences as the record numbers them; each once. */
  sentences(list: readonly LiveSentence[]): void;
  /** The session is stopping: no update on its own any more; sentences are still taken, for the last one at Stop. */
  quiet(): void;
  /** One last update with what remains, then nothing. */
  stop(): Promise<void>;
  /** Stops at once: an open request is aborted and nothing more is said. */
  dispose(): void;
}

interface Update {
  controller: AbortController;
  fresh: LiveSentence[];
  /** How many of the sentences seen it covers. */
  upTo: number;
  startedAt: number;
  givenUp: boolean;
  done: boolean;
  cancelTimeout(): void;
  promise: Promise<void>;
}

/** Kizuna AI's refusals that the next update would get as well (relayChat's codes). */
const STOPPING_CODES: ReadonlySet<string> = new Set(['no-balance', 'daily-limit', 'wallet-frozen', 'sign-in', 'not-member', 'update-required', 'unavailable']);

const unstableCount = (s: LiveState) => s.topics.reduce((sum, t) => sum + t.points.filter((p) => p.unstable).length, 0);

export function createLiveNotes(d: LiveNotesDeps): LiveNotes {
  // The live prompt in use when the loop starts, for the whole session.
  const prompts = activePrompts().live;
  let state = d.from?.state ?? emptyLive();
  const seen: LiveSentence[] = [...(d.from?.seen ?? [])];
  const known = new Set<number>(seen.map((x) => x.n));
  /** Sentences folded into the notes. */
  let covered = seen.length;
  let failures = 0;
  let hint = false;
  let stopped = false;
  /** Kizuna AI refused for the account: nothing more is sent, Stop's last update included. */
  let refused = false;
  let disposed = false;
  let open: Update | null = null;
  /** The session is stopping: only the last update at Stop is left. */
  let quieted = false;
  let cancelTick: (() => void) | null = null;

  const failed = () => {
    failures += 1;
    if (failures >= LIVE_HINT_AFTER && !hint) { hint = true; d.onHint(true); }
  };
  const succeeded = () => {
    failures = 0;
    if (hint) { hint = false; d.onHint(false); }
  };

  const finish = (u: Update, answer: unknown, o: { counted?: boolean } = {}) => {
    if (u.done || disposed) return;
    u.done = true;
    u.cancelTimeout();
    if (open === u) open = null;
    const next = answer !== undefined && !u.givenUp
      ? applyLive(state, answer, { fresh: u.fresh, seen: seen.slice(0, u.upTo), speakerLabel: d.speakerLabel })
      : null;
    d.log?.({
      sentences: u.fresh.length, latencyMs: d.clock.now() - u.startedAt, accepted: next !== null, givenUp: u.givenUp,
      unstablePoints: next ? unstableCount(next) - unstableCount(state) : 0,
    });
    if (!next) { if (o.counted !== false) failed(); return; }
    state = next;
    covered = u.upTo;
    succeeded();
    d.onState(state);
  };

  const send = (): Update | null => {
    const fresh = seen.slice(covered);
    if (fresh.length === 0) return null;
    const controller = new AbortController();
    const upTo = seen.length;
    const u: Update = {
      controller, fresh, upTo, startedAt: d.clock.now(), givenUp: false, done: false, cancelTimeout: () => {}, promise: Promise.resolve(),
    };
    const payload = livePayload({ state, fresh, seen: seen.slice(0, upTo), language: d.language, speakerLabel: d.speakerLabel, names: d.names });
    u.cancelTimeout = d.clock.setTimeout(() => { if (!u.done) { u.givenUp = true; controller.abort(); } }, LIVE_TIMEOUT_MS);
    u.promise = d.chat({
      system: livePrompt(d.language.name, prompts), prompt: 'live-update', promptVersion: prompts.version,
      // A little reasoning keeps the notes in the language asked for when the speech is in another (owner, 2026-11-18):
      // with none, Japanese speech asked for in Chinese came out in Japanese in about half the runs. It answers in about
      // 5 s instead of 2, well within the 20 s an update may take.
      user: payload, effort: 'low', maxTokens: LIVE_TOKENS, signal: controller.signal,
      onAnswered: (info) => { if (info.usage) d.onUsage?.(info.usage); },
    })
      .then((answer) => finish(u, answer), (error: unknown) => {
        // A refusal for the account would come again every 20 seconds: the loop stops instead, and says why, also
        // when it comes during Stop's last update. It is not a failure to try again: no "will try again" hint.
        if (error instanceof ChatError && error.code && STOPPING_CODES.has(error.code) && !refused && !disposed) {
          refused = true;
          stopped = true;
          cancelTick?.();
          cancelTick = null;
          d.onStopped?.(error.code);
          finish(u, undefined, { counted: false });
          return;
        }
        finish(u, undefined);
      });
    open = u;
    return u;
  };

  const tick = () => {
    cancelTick = null;
    if (stopped || disposed || quieted) return;
    cancelTick = d.clock.setTimeout(tick, LIVE_INTERVAL_MS);
    // The last has not answered: it is given up, and its sentences go with this one.
    if (open && !open.done) {
      open.givenUp = true;
      open.controller.abort();
    }
    send();
  };
  cancelTick = d.clock.setTimeout(tick, LIVE_INTERVAL_MS);

  return {
    sentences(list) {
      if (stopped || disposed) return;
      for (const s of list) {
        if (known.has(s.n)) continue;
        known.add(s.n);
        seen.push(s);
      }
    },
    quiet() {
      cancelTick?.();
      cancelTick = null;
      quieted = true;
    },
    async stop() {
      if (stopped || disposed) return;
      stopped = true;
      cancelTick?.();
      cancelTick = null;
      if (open) await open.promise;
      // Disposed while waiting, or the open update was refused for the account: nothing more is said.
      if (disposed || refused) return;
      const last = send();
      if (last) await last.promise;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stopped = true;
      cancelTick?.();
      cancelTick = null;
      if (open) {
        open.cancelTimeout();
        open.controller.abort();
      }
    },
  };
}
