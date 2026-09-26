import { FAKE_SCRIPT_NAMES, type FakeScriptName } from './scripts';

/** The fake's settings: which script plays, and the fault knobs (spec: "Testing", D24). */
export interface FakeSettings {
  script: FakeScriptName;
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
    requireKey: flag('requireKey'),
    checkFails: flag('checkFails'),
    buildRefused: flag('buildRefused'),
    startThrows: flag('startThrows'),
    startDelayMs: ms('startDelayMs'),
    failAfterMs: ms('failAfterMs'),
  };
}
