import type { NativeReadinessReason } from '../../lib/local-inference/native/nativeCatalog';
import type { NativeModels } from '../../lib/local-inference/native/nativeModels';
import type { CheckContext, CheckResult } from '../../lib/provider/types';
import { modeOfLegs } from './engineLegs';
import type { LocalNativeSettings } from './settings';

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

/** This device's native facts as the provider store hands them to a `local` provider's check (`ctx.nativeModels`). */
function nativeModelsOfCheck(ctx: CheckContext): NativeModels {
  if (!ctx.nativeModels) throw new Error("The Local Native check was asked without this device's native models (CheckContext.nativeModels).");
  return ctx.nativeModels;
}

/**
 * Local Native's readiness (spec: "Readiness is one check"): the native gate — the engine's warmup, the bundle's
 * state, both directions' models — fed this provider's own selections, the pair and the legs, through this device's
 * native facts (#578 ruling 18). Writes nothing (#578 ruling 6). TTS never gates, so it asks with text-only off
 * (#578 ruling 16).
 */
export async function checkLocalNative(s: LocalNativeSettings, ctx: CheckContext): Promise<CheckResult> {
  const facts = nativeModelsOfCheck(ctx);
  const answer = await facts.ensureSelectionReady(() => ({
    selection: { sourceLanguage: ctx.pair.source, targetLanguage: ctx.pair.target },
    selections: s.selections,
    mode: modeOfLegs(ctx.legs),
    textOnly: false,
  }), ctx.signal);
  if (answer.ready) return { ok: true };
  const reason = answer.reason as NotReady;
  return { ok: false, reason: REASONS[reason], code: NATIVE_READINESS_CODES[reason] };
}
