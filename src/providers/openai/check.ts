/**
 * OpenAI Realtime's readiness (spec: "Readiness is one check"): the model
 * list the old validation read (`OpenAIClient.ts:140-336`), with three
 * changes (choice 16) — the request is bounded (`boundedFetch`, choice 2);
 * a status the key does not explain (a 404, a 5xx) or a failed fetch
 * throws, where the old one called every failure an invalid key; and a
 * refusal answers a code the surfaces put into words — a restricted project
 * key's 403 a refused key, as the old validation did (ruling 17). The key
 * rides in the `Authorization` header, never the URL. It reads no setting
 * (ruling 9: `checkReads: []`). The check itself is OpenAI's model list,
 * lifted at its third user (Stage 2 OpenAI Live, choice 4); this provider's
 * part is its family and its refusal. The settings side: not reached by the
 * adapter, so it may use the real clock by default.
 */
import { createOpenAIModelCheck, type OpenAIModelCheckDeps } from '../../lib/provider/openaiModels';
import type { CheckContext, CheckResult } from '../../lib/provider/types';
import { isRealtimeModelId, type RealtimeCredentials, type RealtimeSettings } from './settings';

export { CHECK_TIMEOUT_MS, OPENAI_MODELS_URL } from '../../lib/provider/openaiModels';

export type RealtimeCheckDeps = OpenAIModelCheckDeps;

export function createRealtimeCheck(deps: RealtimeCheckDeps = {}) {
  const check = createOpenAIModelCheck({ keep: isRealtimeModelId, none: { code: 'no_realtime_model', reason: 'This key lists no gpt-realtime model.' } }, deps);
  return (k: RealtimeCredentials, _s: RealtimeSettings, ctx: CheckContext): Promise<CheckResult> => check(k.apiKey, ctx);
}

export const checkRealtime = createRealtimeCheck();
