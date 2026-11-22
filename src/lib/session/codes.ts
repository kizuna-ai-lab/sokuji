import { PLAN_REFUSAL_CODES } from '../plan/types';

/**
 * The notice codes the runner itself records (spec: "Notices reach the user
 * localized"). snake_case, like the adapters' `CLIENT_DIAGNOSTICS` codes and
 * the capture's degradations, so one table of words serves them all. A
 * provider's own codes — a refusal's, a lease's end — stay open strings.
 */
export const RUN_NOTICE_CODES = [
  'no_provider',
  'no_legs',
  'turn_mode_unsupported',
  'participant_source_unavailable',
  'participant_unsupported',
  'credentials_missing',
  'not_ready',
  'build_refused',
  'admit_refused',
  'start_failed',
  'leg_failed',
  'leg_closed',
  'source_ended',
  'still_stopping',
  'connection_restored',
  // A line-up that cannot run: the composer's refusals (`PLAN_REFUSAL_CODES`), which a start answers with.
  ...PLAN_REFUSAL_CODES,
] as const;

export type RunNoticeCode = (typeof RUN_NOTICE_CODES)[number];

/**
 * The notices about one provider's key or sign-in. Whoever makes one names the provider it is about in
 * `params.provider`, so that its action opens that provider's account row, whichever provider transcribes.
 */
export const ACCOUNT_CODES: ReadonlySet<string> = new Set(['credentials_missing', 'sign_in_required', 'address_missing', 'address_invalid']);

/** A notice's params with the provider an account notice is about; any other code's params as they are. */
export function namingProvider(code: string | undefined, params: Record<string, string | number> | undefined, providerId: string): Record<string, string | number> | undefined {
  if (code === undefined || !ACCOUNT_CODES.has(code)) return params;
  return { ...params, provider: providerId };
}
