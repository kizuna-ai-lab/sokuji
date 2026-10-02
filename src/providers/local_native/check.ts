import type { NativeReadinessReason } from '../../lib/local-inference/native/nativeCatalog';
import type { CheckContext, CheckResult } from '../../lib/provider/types';
import { useNativeModelStore } from '../../stores/nativeModelStore';
import { modeOfLegs } from './engineLegs';
import type { LocalNativeSettings } from './settings';

type NativeModelStoreState = ReturnType<typeof useNativeModelStore.getState>;
type NotReady = Exclude<NativeReadinessReason, 'ready'>;

/** Each reason's code; `noticeText`'s aliases word them by the sentences every locale has (#578 ruling 5). */
export const NATIVE_READINESS_CODES: Readonly<Record<NotReady, string>> = {
  // Unreachable: the provider is Electron only.
  'not-electron': 'native_unavailable',
  'engine-mismatch': 'native_engine_update_required',
  'engine-absent': 'native_engine_required',
  unavailable: 'native_unavailable',
  starting: 'native_starting',
  'asr-incompatible': 'native_asr_missing',
  'translation-incompatible': 'native_translation_missing',
};

/** Diagnostic English, for the console and a surface with no words for the code. */
const REASONS: Readonly<Record<NotReady, string>> = {
  'not-electron': 'Local Native runs in the desktop app only.',
  'engine-mismatch': 'The inference engine needs an update.',
  'engine-absent': 'The inference engine is not installed.',
  unavailable: 'The native engine is unavailable.',
  starting: 'The local engine is starting.',
  'asr-incompatible': 'No speech recognition model for this language.',
  'translation-incompatible': 'No translation model for this language pair.',
};

/**
 * Local Native's readiness (spec: "Readiness is one check"): the native model
 * store's gate — sidecar warmup, the bundle's state, both directions' models —
 * fed this provider's own selections, the pair and the legs. Writes nothing
 * (#578 ruling 6). TTS never gates, so it asks with text-only off (#578 ruling 16).
 */
export async function checkLocalNative(s: LocalNativeSettings, ctx: CheckContext): Promise<CheckResult> {
  const answer = await raceSignal(useNativeModelStore.getState().ensureSelectionReady(() => ({
    selection: { sourceLanguage: ctx.pair.source, targetLanguage: ctx.pair.target },
    selections: s.selections,
    mode: modeOfLegs(ctx.legs),
    textOnly: false,
  })), ctx.signal);
  if (answer.ready) return { ok: true };
  const reason = answer.reason as NotReady;
  return { ok: false, reason: REASONS[reason], code: NATIVE_READINESS_CODES[reason] };
}

/**
 * What `check`'s answer depends on, as content. `refresh` writes a new
 * statuses object even when nothing changed, and `check` itself refreshes:
 * keyed by reference, every check would schedule the next. A running download
 * reads as `absent`, as it does to the gate: its start schedules no check, its
 * completion does (#578).
 */
export function nativeReadinessKey(state: Pick<NativeModelStoreState, 'sidecarStatus' | 'bundleStatus' | 'catalog' | 'statuses'>): string {
  const statuses = Object.keys(state.statuses).sort()
    .map((id) => `${id}=${state.statuses[id] === 'downloading' ? 'absent' : state.statuses[id]}`).join(',');
  return `${state.sidecarStatus}|${state.bundleStatus}|${Object.keys(state.catalog).sort().join(',')}|${statuses}`;
}

/**
 * A download, a delete, the bundle or the sidecar's lifecycle moving: the
 * store's own events, once each. `starting` neither calls back nor is
 * remembered: every check starts an engine that is not ready, so a start that
 * fails must end where it began (`unavailable → starting → unavailable`), or
 * each check would schedule the next (#578).
 */
export function watchLocalNativeReadiness(onChange: () => void): () => void {
  let key = nativeReadinessKey(useNativeModelStore.getState());
  return useNativeModelStore.subscribe((state) => {
    if (state.sidecarStatus === 'starting') return;
    const next = nativeReadinessKey(state);
    if (next === key) return;
    key = next;
    onChange();
  });
}

/** `work`'s answer, or the abort reason if the start that asked is cancelled first (LocalInference's `raceInitialize`, for any promise). */
function raceSignal<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) {
    work.catch(() => {});
    return Promise.reject(signal.reason ?? new Error('aborted'));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new Error('aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (value) => { signal.removeEventListener('abort', onAbort); resolve(value); },
      (error) => { signal.removeEventListener('abort', onAbort); reject(error); },
    );
  });
}
