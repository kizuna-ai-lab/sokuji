import { describe, it, expect } from 'vitest';
import { BASICS_STEPS, visibleSteps, contentKey } from './steps';
import { buildTourCtx } from './tourContext';
import type { TourCtx } from './tourContext';
import { getScenario, SCENARIOS } from '../../lib/setup/scenarios';
import { Provider } from '../../types/Provider';

const electron = { isElectron: true, isLinux: true, isMacOS: false, isWindows: false };
const extension = { isElectron: false, isLinux: false, isMacOS: false, isWindows: true };

function ctxFor(scenarioId: TourCtx['scenario'], providerPath: TourCtx['providerPath'], env = electron, extra: Partial<TourCtx> = {}): TourCtx {
  const preset = scenarioId ? getScenario(scenarioId) : { mode: 'speaker' as const, textOnly: false };
  return {
    ...buildTourCtx({
      record: { scenario: scenarioId, providerPath },
      provider: providerPath === 'managed' ? Provider.KIZUNA_AI_SONIOX : providerPath === 'offline' ? Provider.LOCAL_INFERENCE : Provider.OPENAI,
      mode: preset.mode, textOnly: preset.textOnly, isSignedIn: true, apiKeyValid: true, env,
    }),
    ...extra,
  };
}
const ids = (ctx: TourCtx) => visibleSteps(ctx).map((s) => s.id);

describe('visibleSteps — the spec §2.2 table', () => {
  it('managed path, per scenario', () => {
    expect(ids(ctxFor('understand-others', 'managed'))).toEqual(['welcome', 'mode-picker', 'participant-source', 'subtitle', 'account', 'start', 'done']);
    expect(ids(ctxFor('be-heard', 'managed'))).toEqual(['welcome', 'mode-picker', 'microphone', 'monitor', 'output-routing', 'subtitle', 'account', 'start', 'done']);
    expect(ids(ctxFor('subtitle-myself', 'managed'))).toEqual(['welcome', 'mode-picker', 'microphone', 'subtitle', 'account', 'start', 'done']);
    expect(ids(ctxFor('two-way-voice', 'managed'))).toEqual(['welcome', 'mode-picker', 'microphone', 'output-routing', 'participant-source', 'subtitle', 'account', 'start', 'done']);
    expect(ids(ctxFor('two-way-text', 'managed'))).toEqual(['welcome', 'mode-picker', 'microphone', 'participant-source', 'subtitle', 'account', 'start', 'done']);
  });

  it('own-key swaps account for provider-settings; offline swaps it for models', () => {
    expect(ids(ctxFor('understand-others', 'own-key'))).toContain('provider-settings');
    expect(ids(ctxFor('understand-others', 'own-key'))).not.toContain('account');
    expect(ids(ctxFor('understand-others', 'offline'))).toContain('models');
    expect(ids(ctxFor('understand-others', 'offline'))).not.toContain('account');
  });

  it('a migrated user (no scenario) gets device steps from the current mode', () => {
    expect(ids(ctxFor(null, null, electron, { mode: 'speaker', textOnly: false }))).toEqual(['welcome', 'mode-picker', 'microphone', 'monitor', 'output-routing', 'subtitle', 'start', 'done']);
    expect(ids(ctxFor(null, null, electron, { mode: 'participant', textOnly: true }))).toEqual(['welcome', 'mode-picker', 'participant-source', 'subtitle', 'start', 'done']);
    expect(ids(ctxFor(null, null, electron, { mode: 'both', textOnly: true }))).toEqual(['welcome', 'mode-picker', 'microphone', 'participant-source', 'subtitle', 'start', 'done']);
  });

  it('covers every scenario × path × platform without throwing and always ends with start, done', () => {
    for (const s of SCENARIOS) for (const p of ['managed', 'own-key', 'offline'] as const) for (const env of [electron, extension]) {
      const list = ids(ctxFor(s.id, p, env));
      expect(list.slice(0, 2)).toEqual(['welcome', 'mode-picker']);
      expect(list.slice(-2)).toEqual(['start', 'done']);
    }
  });
});

describe('contentKey — copy variants', () => {
  const step = (id: string) => BASICS_STEPS.find((s) => s.id === id)!;

  it('output-routing varies by platform and OS', () => {
    expect(contentKey(step('output-routing'), ctxFor('be-heard', 'managed', extension))).toBe('tour.steps.output-routing.content_extension');
    expect(contentKey(step('output-routing'), ctxFor('be-heard', 'managed', electron))).toBe('tour.steps.output-routing.content_electronLinux');
    expect(contentKey(step('output-routing'), ctxFor('be-heard', 'managed', { isElectron: true, isLinux: false, isMacOS: true, isWindows: false }))).toBe('tour.steps.output-routing.content_electronOther');
  });

  it('participant-source varies by platform', () => {
    expect(contentKey(step('participant-source'), ctxFor('understand-others', 'managed', extension))).toBe('tour.steps.participant-source.content_extension');
    expect(contentKey(step('participant-source'), ctxFor('understand-others', 'managed', electron))).toBe('tour.steps.participant-source.content_electron');
  });

  it('account, provider-settings and start vary by readiness', () => {
    expect(contentKey(step('account'), ctxFor('be-heard', 'managed', electron, { isSignedIn: false }))).toBe('tour.steps.account.content_signedOut');
    expect(contentKey(step('account'), ctxFor('be-heard', 'managed'))).toBe('tour.steps.account.content');
    expect(contentKey(step('provider-settings'), ctxFor('be-heard', 'own-key', electron, { apiKeyValid: null }))).toBe('tour.steps.provider-settings.content_pending');
    expect(contentKey(step('provider-settings'), ctxFor('be-heard', 'own-key'))).toBe('tour.steps.provider-settings.content');
    expect(contentKey(step('start'), ctxFor('be-heard', 'offline'))).toBe('tour.steps.start.content_offline');
    expect(contentKey(step('start'), ctxFor('be-heard', 'managed', electron, { isSignedIn: false }))).toBe('tour.steps.start.content_signedOut');
    expect(contentKey(step('start'), ctxFor('be-heard', 'own-key', electron, { apiKeyValid: false }))).toBe('tour.steps.start.content_pendingKey');
    expect(contentKey(step('start'), ctxFor('be-heard', 'own-key'))).toBe('tour.steps.start.content');
  });

  it('a step without variants keys plainly', () => {
    expect(contentKey(step('welcome'), ctxFor('be-heard', 'managed'))).toBe('tour.steps.welcome.content');
  });
});

describe('buildTourCtx', () => {
  it('maps environment flags to platform and os', () => {
    const c = buildTourCtx({ record: null, provider: Provider.OPENAI, mode: 'speaker', textOnly: false, isSignedIn: false, apiKeyValid: null, env: extension });
    expect(c).toMatchObject({ scenario: null, providerPath: null, platform: 'extension', os: 'windows' });
    expect(buildTourCtx({ ...c, record: null, env: { isElectron: true, isLinux: false, isMacOS: false, isWindows: false } }).os).toBe('other');
  });
});
