/**
 * The providers, in UI order (D19). One list: its order is the order the
 * picker shows, `ProviderId` is derived from it, and `isPresent` decides what
 * this build and platform offer.
 */
import { registerPresentProviders } from '../lib/plan/present';
import { isPresent, type PresenceEnv } from '../lib/provider/presence';
import type { AnyProvider } from '../lib/provider/types';
import { debugSwitchOn, enabledProviderIds, getEnvironment, isDevelopmentMode, isKizunaAIEnabled } from '../utils/environment';
import { fakeLeasedProvider } from './fake/leased';
import { fakeProvider } from './fake/provider';
import { fakeTranscriberProvider } from './fake/transcriber';
import { fakeTranslatorProvider } from './fake/translator';
import { fakeVoiceProvider } from './fake/voice';
import { geminiProvider } from './gemini/provider';
import { geminiTextProvider } from './gemini_text/provider';
import { localInferenceProvider } from './localInference/provider';
import { openaiProvider } from './openai/provider';
import { openaiCompatibleProvider } from './openai_compatible/provider';
import { openaiTextProvider } from './openai_text/provider';
import { openaiLiveProvider } from './openai_live/provider';
import { openaiTranslateProvider } from './openai_translate/provider';
import { palabraProvider } from './palabraai/provider';
import { kizunaQwenProvider } from './qwen_livetranslate/kizuna';
import { qwenLiveTranslateProvider } from './qwen_livetranslate/provider';
import { kizunaSonioxProvider } from './soniox/kizuna';
import { sonioxProvider } from './soniox/provider';
import { volcengineAst2Provider } from './volcengine_ast2/provider';

/** Shipped providers, in UI order (Stage 2 Kizuna Soniox, ruling 6; Stage 2 Gemini, ruling 6; Stage 2 Volcengine AST2, ruling 5; Stage 2 OpenAI Translate, ruling 11; Stage 2 OpenAI Realtime, ruling 18; Stage 2 Palabra, ruling 14; Stage 2 OpenAI Live, ruling 9; Qwen LiveTranslate, spec 2026-10-13 §8; text models, spec 2026-11-22 §2): the managed Kizuna Soniox, the flagged managed Kizuna Qwen, the free LocalInference, then Gemini, Doubao AST 2.0, OpenAI Realtime, OpenAI Translate, OpenAI Live, Soniox, Qwen LiveTranslate and Palabra AI with your own key, then the text models that translate another provider's transcription (OpenAI's, Gemini's, a compatible service), on the desktop. */
export const RELEASED = [kizunaSonioxProvider, kizunaQwenProvider, localInferenceProvider, geminiProvider, volcengineAst2Provider, openaiProvider, openaiTranslateProvider, openaiLiveProvider, sonioxProvider, qwenLiveTranslateProvider, palabraProvider, openaiTextProvider, geminiTextProvider, openaiCompatibleProvider] as const;
/** Compiled into development builds only (D24): the fake, the leased fake that carries the session hooks (Stage 2 foundation, choice 1), the fake voice that only speaks, and the fakes that only transcribe and only translate. */
const DEV_ONLY = [fakeProvider, fakeLeasedProvider, fakeVoiceProvider, fakeTranscriberProvider, fakeTranslatorProvider] as const;

export type ProviderId = (typeof RELEASED)[number]['id'] | (typeof DEV_ONLY)[number]['id'];

// `import.meta.env.DEV` itself, not `isDevelopmentMode()`: the literal is what
// a release build replaces with `false`, which drops the fake from the bundle.
// The E2E build (`--mode e2e`) is a production bundle that keeps the fake: its
// tests run sessions on it. `MODE` is a literal too, so a release build drops it.
export const PROVIDERS: readonly AnyProvider[] =
  (import.meta.env.DEV || import.meta.env.MODE === 'e2e') ? [...RELEASED, ...DEV_ONLY] : [...RELEASED];

export function currentPresenceEnv(): PresenceEnv {
  return { platform: getEnvironment(), dev: isDevelopmentMode(), enabled: enabledProviderIds(), kizuna: isKizunaAIEnabled(), switchOn: debugSwitchOn };
}

/** The providers offered here, in UI order. */
export function presentProviders(env: PresenceEnv = currentPresenceEnv()): readonly AnyProvider[] {
  return PROVIDERS.filter((p) => isPresent(p, env));
}

export function getProvider(id: string): AnyProvider | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

// The line-up store composes over the providers offered here, but cannot import this module (the local provider
// reads that store: a cycle). It reads them through `presentHosts()`.
registerPresentProviders(presentProviders);
