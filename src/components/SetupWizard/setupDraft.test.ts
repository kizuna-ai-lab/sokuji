import { describe, it, expect } from 'vitest';
import { initialDraft, draftFromRecord, canAdvance, setupReducer } from './setupDraft';
import type { SetupDraft } from './setupDraft';
import { Provider } from '../../types/Provider';

const env = { isSignedIn: false };
const run = (d: SetupDraft, ...actions: Parameters<typeof setupReducer>[1][]) =>
  actions.reduce((acc, a) => setupReducer(acc, a), d);

describe('setupReducer — stepping', () => {
  it('starts on step 0 and can always leave it', () => {
    const d = initialDraft();
    expect(d.step).toBe(0);
    expect(canAdvance(d, env)).toBe(true);
    expect(run(d, { type: 'next' }).step).toBe(1);
  });

  it('refuses to advance past a step whose requirement is unmet', () => {
    const d = run(initialDraft(), { type: 'next' });          // step 1: scenario
    expect(canAdvance(d, env)).toBe(false);
    const withScenario = run(d, { type: 'setScenario', scenario: 'be-heard', keepProvider: true });
    expect(canAdvance(withScenario, env)).toBe(true);
  });

  it('never goes below 0 and never above the last step', () => {
    expect(run(initialDraft(), { type: 'back' }).step).toBe(0);
    const full = run(initialDraft(),
      { type: 'next' }, { type: 'setScenario', scenario: 'be-heard', keepProvider: true }, { type: 'next' },
      { type: 'setPath', path: 'offline', provider: Provider.LOCAL_INFERENCE }, { type: 'next' },
      { type: 'next' },                                       // step 3 offline: nothing required
      { type: 'setLanguages', source: 'ja', target: 'en' }, { type: 'next' },
    );
    expect(full.step).toBe(5);
    expect(run(full, { type: 'next' }).step).toBe(5);
  });

  it('back never clears anything', () => {
    const d = run(initialDraft(),
      { type: 'next' }, { type: 'setScenario', scenario: 'two-way-text', keepProvider: true }, { type: 'next' },
      { type: 'setPath', path: 'own-key', provider: null }, { type: 'setProvider', provider: Provider.OPENAI },
      { type: 'setCredential', key: 'apiKey', value: 'sk-1' },
    );
    const back = run(d, { type: 'back' }, { type: 'back' });
    expect(back).toMatchObject({ step: 0, scenario: 'two-way-text', providerPath: 'own-key', provider: Provider.OPENAI, credentials: { apiKey: 'sk-1' } });
  });
});

describe('setupReducer — clearing rules (spec §1.4)', () => {
  const base = run(initialDraft(),
    { type: 'next' }, { type: 'setScenario', scenario: 'be-heard', keepProvider: true }, { type: 'next' },
    { type: 'setPath', path: 'own-key', provider: null }, { type: 'setProvider', provider: Provider.OPENAI },
    { type: 'setCredential', key: 'apiKey', value: 'sk-1' }, { type: 'credentialsValidated' },
    { type: 'setLanguages', source: 'en', target: 'ja' },
  );

  it('changing the scenario keeps a still-compatible provider and everything after it', () => {
    const d = run(base, { type: 'setScenario', scenario: 'two-way-voice', keepProvider: true });
    expect(d).toMatchObject({ providerPath: 'own-key', provider: Provider.OPENAI, credentialsValidated: true, sourceLanguage: 'en' });
  });

  it('changing the scenario to one the provider cannot serve clears the path onward', () => {
    const d = run(base, { type: 'setScenario', scenario: 'subtitle-myself', keepProvider: false });
    expect(d).toMatchObject({ scenario: 'subtitle-myself', providerPath: null, provider: null, credentials: {}, credentialsValidated: false, credentialsPending: false, sourceLanguage: null, targetLanguage: null });
  });

  it('changing the path or provider clears credentials and the language pair', () => {
    const viaPath = run(base, { type: 'setPath', path: 'offline', provider: Provider.LOCAL_INFERENCE });
    expect(viaPath).toMatchObject({ provider: Provider.LOCAL_INFERENCE, credentials: {}, credentialsValidated: false, credentialsPending: false, sourceLanguage: null });
    const viaProvider = run(base, { type: 'setProvider', provider: Provider.GEMINI });
    expect(viaProvider).toMatchObject({ provider: Provider.GEMINI, credentials: {}, credentialsValidated: false, sourceLanguage: null });
  });

  it('editing a credential invalidates a previous validation and un-skips', () => {
    const skipped = run(base, { type: 'skipCredentials' });
    expect(skipped).toMatchObject({ credentialsPending: true, credentials: {} });
    const edited = run(base, { type: 'setCredential', key: 'apiKey', value: 'sk-2' });
    expect(edited).toMatchObject({ credentialsValidated: false, credentialsPending: false, credentials: { apiKey: 'sk-2' } });
  });
});

describe('canAdvance — step 3 per path', () => {
  const at3 = (path: 'managed' | 'own-key' | 'offline', provider: Provider) => run(initialDraft(),
    { type: 'next' }, { type: 'setScenario', scenario: 'understand-others', keepProvider: true }, { type: 'next' },
    { type: 'setPath', path, provider }, { type: 'next' });

  it('managed needs sign-in, or skip', () => {
    const d = at3('managed', Provider.KIZUNA_AI_SONIOX);
    expect(d.step).toBe(3);
    expect(canAdvance(d, { isSignedIn: false })).toBe(false);
    expect(canAdvance(d, { isSignedIn: true })).toBe(true);
    expect(canAdvance(run(d, { type: 'skipCredentials' }), { isSignedIn: false })).toBe(true);
  });

  it('own-key needs a validated key, or skip', () => {
    const d = at3('own-key', Provider.OPENAI);
    expect(canAdvance(d, env)).toBe(false);
    expect(canAdvance(run(d, { type: 'credentialsValidated' }), env)).toBe(true);
    expect(canAdvance(run(d, { type: 'skipCredentials' }), env)).toBe(true);
  });

  it('offline needs nothing', () => {
    expect(canAdvance(at3('offline', Provider.LOCAL_INFERENCE), env)).toBe(true);
  });

  it('own-key cannot leave step 2 without a provider', () => {
    const d = run(initialDraft(), { type: 'next' }, { type: 'setScenario', scenario: 'be-heard', keepProvider: true }, { type: 'next' },
      { type: 'setPath', path: 'own-key', provider: null });
    expect(canAdvance(d, env)).toBe(false);
  });
});

describe('draftFromRecord (Help re-run)', () => {
  it('prefills scenario, path and provider, and treats an already-valid key as validated', () => {
    const d = draftFromRecord({ scenario: 'be-heard', providerPath: 'own-key', provider: 'openai' }, { credentialsAlreadyValid: true });
    expect(d).toMatchObject({ step: 0, scenario: 'be-heard', providerPath: 'own-key', provider: 'openai', credentialsValidated: true });
  });

  it('leaves a migrated record (nulls) as a blank draft', () => {
    const d = draftFromRecord({ scenario: null, providerPath: null, provider: 'openai' }, { credentialsAlreadyValid: false });
    expect(d).toEqual(initialDraft());
  });
});
