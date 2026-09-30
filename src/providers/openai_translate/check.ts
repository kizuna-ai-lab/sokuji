/**
 * OpenAI Translate's readiness (spec: "Readiness is one check"): the model
 * list the old validation read (`OpenAIClient.ts:140-203`,
 * `OpenAITranslateGAClient.ts:224-257`), with three changes (choice 11) —
 * the request is bounded by `CHECK_TIMEOUT_MS` and the caller's signal; a
 * status the key does not explain (a 404, a 5xx) or a failed fetch throws,
 * where the old one called every failure an invalid key (survey §1.14.9);
 * and a refusal answers a code the surfaces put into words. The key rides in
 * the `Authorization` header, never the URL. The check itself is OpenAI's
 * model list, lifted at its third user (Stage 2 OpenAI Live, choice 4); this
 * provider's part is its family and its refusal. The settings side: not
 * reached by the adapter, so it may use the real clock by default.
 */
import { createOpenAIModelCheck, type OpenAIModelCheckDeps } from '../../lib/provider/openaiModels';
import type { CheckContext, CheckResult } from '../../lib/provider/types';
import { isTranslateModelId, type TranslateCredentials, type TranslateSettings } from './settings';

export { CHECK_TIMEOUT_MS, OPENAI_MODELS_URL } from '../../lib/provider/openaiModels';

export type TranslateCheckDeps = OpenAIModelCheckDeps;

export function createTranslateCheck(deps: TranslateCheckDeps = {}) {
  const check = createOpenAIModelCheck({ keep: isTranslateModelId, none: { code: 'no_translate_model', reason: 'This key lists no gpt-realtime-translate model.' } }, deps);
  return (k: TranslateCredentials, _s: TranslateSettings, ctx: CheckContext): Promise<CheckResult> => check(k.apiKey, ctx);
}

export const checkTranslate = createTranslateCheck();
