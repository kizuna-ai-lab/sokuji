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
