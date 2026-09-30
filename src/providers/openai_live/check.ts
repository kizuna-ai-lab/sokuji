/**
 * OpenAI Live's readiness (spec: "Readiness is one check"): the key lists
 * `gpt-live-1` or a dated `gpt-live-…` snapshot, never the transcription
 * model — the old validation's filter (`OpenAILiveClient.ts:251-290`) — on
 * OpenAI's model list, lifted at this third user (ruling 9; choice 4). None
 * listed answers `no_realtime_model`, worded by the old validation's
 * "Realtime model is not available". It proves the key lists the model, not
 * that its account may open a Live session (parity). It reads no setting
 * (`checkReads: []`). The settings side: not reached by the adapter.
 */
import { createOpenAIModelCheck, type OpenAIModelCheckDeps } from '../../lib/provider/openaiModels';
import type { CheckContext, CheckResult } from '../../lib/provider/types';
import { isLiveModelId, type LiveCredentials, type LiveSettings } from './settings';

export function createLiveCheck(deps: OpenAIModelCheckDeps = {}) {
  const check = createOpenAIModelCheck({ keep: isLiveModelId, none: { code: 'no_realtime_model', reason: 'This key lists no gpt-live model.' } }, deps);
  return (k: LiveCredentials, _s: LiveSettings, ctx: CheckContext): Promise<CheckResult> => check(k.apiKey, ctx);
}

export const checkLive = createLiveCheck();
