import { FAKE_SCRIPT_NAMES, type FakeScriptName } from './scripts';

/** The fake's settings: which script plays, and the fault knobs (spec: "Testing", D24). */
export interface FakeSettings {
  script: FakeScriptName;
  /** The participant leg's script; 'same' plays `script` on both legs. */
  participantScript: FakeScriptName | 'same';
  /** Shows an API key field; `read` reports it missing until something is typed. */
  requireKey: boolean;
  /** `check` answers not ready. */
  checkFails: boolean;
  /** `build` refuses. */
  buildRefused: boolean;
  /** `start` rejects. */
  startThrows: boolean;
  /** `start` waits this long, in ms, before the session opens. */
  startDelayMs: number;
  /** The session fails this long after it starts, in ms; 0 = never. */
  failAfterMs: number;
}

export const FAKE_DEFAULTS: FakeSettings = {
  script: 'exchange',
  participantScript: 'same',
  requireKey: false,
  checkFails: false,
  buildRefused: false,
  startThrows: false,
  startDelayMs: 0,
  failAfterMs: 0,
};

/** What was stored, made valid: an unknown script, a non-boolean flag or a bad number falls back to its default. */
export function migrateFakeSettings(stored: Readonly<Record<string, unknown>>): FakeSettings {
  const flag = (key: 'requireKey' | 'checkFails' | 'buildRefused' | 'startThrows'): boolean => {
    const value = stored[key];
    return typeof value === 'boolean' ? value : FAKE_DEFAULTS[key];
  };
  const ms = (key: 'startDelayMs' | 'failAfterMs'): number => {
    const value = stored[key];
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : FAKE_DEFAULTS[key];
  };
  return {
    script: FAKE_SCRIPT_NAMES.find((name) => name === stored.script) ?? FAKE_DEFAULTS.script,
    participantScript: stored.participantScript === 'same' ? 'same' : FAKE_SCRIPT_NAMES.find((name) => name === stored.participantScript) ?? 'same',
    requireKey: flag('requireKey'),
    checkFails: flag('checkFails'),
    buildRefused: flag('buildRefused'),
    startThrows: flag('startThrows'),
    startDelayMs: ms('startDelayMs'),
    failAfterMs: ms('failAfterMs'),
  };
}

/** The leased fake's settings: the fake's, and its session hooks' knobs (choice 1). `requireKey` does nothing on it: a managed provider has no field. */
export type FakeLeasedSettings = FakeSettings & {
  /** `prepare` answers with a `voice_fallback` notice, as a managed voice claim that fell back. */
  prepareFallback: boolean;
  /** The lease ends the run this long after it is acquired, in ms (`budget_exhausted`); 0 = never. */
  leaseEndsAfterMs: number;
  /** Both legs on one shared session (`startBoth` ties them), as Soniox's shared Both; off, two. */
  sharedBoth: boolean;
  /** `acquire` refuses with `insufficient_balance`, as a lease the backend turns down (402). */
  acquireRefused: boolean;
  /** Its start floor in µUSD for a text-only start; twice it when the speaker speaks, as a lease's floor rises with speech (Stage 2 Kizuna Soniox, choice 12). 0: a zero floor — a frozen or negative wallet still refuses. */
  minimumBalanceMicroUsd: number;
};

// Written out, not spread from FAKE_DEFAULTS: a module-scope spread of an import may be kept by the bundler (D24).
export const FAKE_LEASED_DEFAULTS: FakeLeasedSettings = {
  script: 'exchange', participantScript: 'same', requireKey: false, checkFails: false, buildRefused: false,
  startThrows: false, startDelayMs: 0, failAfterMs: 0,
  prepareFallback: false, leaseEndsAfterMs: 0, sharedBoth: true, acquireRefused: false, minimumBalanceMicroUsd: 0,
};

export function migrateFakeLeasedSettings(stored: Readonly<Record<string, unknown>>): FakeLeasedSettings {
  const leaseEnds = stored.leaseEndsAfterMs;
  const floor = stored.minimumBalanceMicroUsd;
  return {
    ...migrateFakeSettings(stored),
    prepareFallback: typeof stored.prepareFallback === 'boolean' ? stored.prepareFallback : FAKE_LEASED_DEFAULTS.prepareFallback,
    leaseEndsAfterMs: typeof leaseEnds === 'number' && Number.isFinite(leaseEnds) && leaseEnds >= 0 ? leaseEnds : FAKE_LEASED_DEFAULTS.leaseEndsAfterMs,
    sharedBoth: typeof stored.sharedBoth === 'boolean' ? stored.sharedBoth : FAKE_LEASED_DEFAULTS.sharedBoth,
    acquireRefused: typeof stored.acquireRefused === 'boolean' ? stored.acquireRefused : FAKE_LEASED_DEFAULTS.acquireRefused,
    minimumBalanceMicroUsd: typeof floor === 'number' && Number.isFinite(floor) && floor >= 0 ? floor : FAKE_LEASED_DEFAULTS.minimumBalanceMicroUsd,
  };
}
