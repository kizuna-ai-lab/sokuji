import { describe, it, expect, vi } from 'vitest';
import { applySetupDraft } from './applySetup';
import type { ApplySetupDeps } from './applySetup';
import { initialDraft } from './setupDraft';
import type { SetupDraft } from './setupDraft';
import { Provider } from '../../types/Provider';

function deps(overrides: Partial<ApplySetupDeps> = {}): ApplySetupDeps {
  return {
    currentProvider: Provider.OPENAI,
    sliceKeyFor: (p) =>
      p === Provider.SONIOX ? 'soniox'
        : p === Provider.OPENAI ? 'openai'
          : p === Provider.LOCAL_INFERENCE ? 'localInference'
            : 'kizunaSoniox',
    setMode: vi.fn(),
    setTextOnly: vi.fn(),
    setSpeakerDisplayMode: vi.fn(),
    setParticipantDisplayMode: vi.fn(),
    updateProviderSlice: vi.fn(async () => {}),
    setProvider: vi.fn(),
    completeSetup: vi.fn(async () => {}),
    validateApiKey: vi.fn(async () => ({})),
    ...overrides,
  };
}

const order = (fns: Array<ReturnType<typeof vi.fn>>) =>
  fns.map((f) => f.mock.invocationCallOrder[0]);

const draft = (over: Partial<SetupDraft>): SetupDraft => ({
  ...initialDraft(), step: 5, scenario: 'be-heard', providerPath: 'own-key', provider: Provider.SONIOX,
  credentials: { apiKey: 'sk-1' }, credentialsValidated: true, sourceLanguage: 'en', targetLanguage: 'ja', ...over,
});

describe('applySetupDraft (spec §1.5)', () => {
  it('writes preset, slice, provider, record — in that order — and not uiMode', async () => {
    const d = deps();
    await applySetupDraft(draft({}), d);

    expect(d.setMode).toHaveBeenCalledWith('speaker');
    expect(d.setTextOnly).toHaveBeenCalledWith(false);
    expect(d.setSpeakerDisplayMode).toHaveBeenCalledWith('both');
    expect(d.setParticipantDisplayMode).not.toHaveBeenCalled();
    expect(d.updateProviderSlice).toHaveBeenCalledWith('soniox', { sourceLanguage: 'en', targetLanguage: 'ja', apiKey: 'sk-1' });
    expect(d.setProvider).toHaveBeenCalledWith(Provider.SONIOX);
    expect(d.completeSetup).toHaveBeenCalledWith({ scenario: 'be-heard', providerPath: 'own-key', provider: Provider.SONIOX });

    const seq = order([d.setMode, d.setTextOnly, d.setSpeakerDisplayMode, d.updateProviderSlice, d.setProvider, d.completeSetup] as any);
    expect([...seq].sort((a, b) => a - b)).toEqual(seq);   // strictly increasing
    expect(Object.keys(d)).not.toContain('setUIMode');
  });

  it('writes the slice before the provider so the validation effect fires once with final values', async () => {
    const d = deps();
    await applySetupDraft(draft({}), d);
    expect((d.updateProviderSlice as any).mock.invocationCallOrder[0]).toBeLessThan((d.setProvider as any).mock.invocationCallOrder[0]);
  });

  it('omits credentials when they were skipped, and on the managed and offline paths', async () => {
    const skipped = deps();
    await applySetupDraft(draft({ credentials: {}, credentialsValidated: false, credentialsPending: true }), skipped);
    expect(skipped.updateProviderSlice).toHaveBeenCalledWith('soniox', { sourceLanguage: 'en', targetLanguage: 'ja' });

    const managed = deps();
    await applySetupDraft(draft({ providerPath: 'managed', provider: Provider.KIZUNA_AI_SONIOX, credentials: {} }), managed);
    expect(managed.updateProviderSlice).toHaveBeenCalledWith('kizunaSoniox', { sourceLanguage: 'en', targetLanguage: 'ja' });

    const offline = deps();
    await applySetupDraft(draft({ providerPath: 'offline', provider: Provider.LOCAL_INFERENCE, credentials: { apiKey: 'sk-1' } }), offline);
    expect(offline.updateProviderSlice).toHaveBeenCalledWith('localInference', { sourceLanguage: 'en', targetLanguage: 'ja' });
  });

  it('sets participant display for the listening scenario and leaves the speaker one alone', async () => {
    const d = deps();
    await applySetupDraft(draft({ scenario: 'understand-others', providerPath: 'managed', provider: Provider.KIZUNA_AI_SONIOX, credentials: {} }), d);
    expect(d.setMode).toHaveBeenCalledWith('participant');
    expect(d.setTextOnly).toHaveBeenCalledWith(true);
    expect(d.setParticipantDisplayMode).toHaveBeenCalledWith('translation');
    expect(d.setSpeakerDisplayMode).not.toHaveBeenCalled();
  });

  it('re-validates whenever the provider did not change (setProvider clears the cache regardless)', async () => {
    const same = deps({ currentProvider: Provider.SONIOX });
    await applySetupDraft(draft({}), same);
    expect(same.validateApiKey).toHaveBeenCalledTimes(1);
    expect((same.validateApiKey as any).mock.invocationCallOrder[0]).toBeGreaterThan((same.completeSetup as any).mock.invocationCallOrder[0]);

    const changed = deps({ currentProvider: Provider.OPENAI });
    await applySetupDraft(draft({}), changed);
    expect(changed.validateApiKey).not.toHaveBeenCalled();

    const managedSame = deps({ currentProvider: Provider.KIZUNA_AI_SONIOX });
    await applySetupDraft(draft({ providerPath: 'managed', provider: Provider.KIZUNA_AI_SONIOX, credentials: {} }), managedSame);
    expect(managedSame.validateApiKey).toHaveBeenCalledTimes(1);

    const offlineSame = deps({ currentProvider: Provider.LOCAL_INFERENCE });
    await applySetupDraft(draft({ providerPath: 'offline', provider: Provider.LOCAL_INFERENCE, credentials: {} }), offlineSame);
    expect(offlineSame.validateApiKey).toHaveBeenCalledTimes(1);
  });

  it('awaits setProvider so a rejected persist surfaces to the caller', async () => {
    const d = deps({ setProvider: vi.fn(async () => { throw new Error('persist failed'); }) });
    await expect(applySetupDraft(draft({}), d)).rejects.toThrow(/persist failed/);
    expect(d.completeSetup).not.toHaveBeenCalled();
  });

  it('tolerates a rejected post-finish re-validation instead of swallowing completion', async () => {
    const d = deps({
      currentProvider: Provider.SONIOX,
      validateApiKey: vi.fn(async () => { throw new Error('boom'); }),
    });
    await expect(applySetupDraft(draft({}), d)).resolves.toBeUndefined();
    expect(d.completeSetup).toHaveBeenCalled();
  });

  it('refuses an incomplete draft', async () => {
    await expect(applySetupDraft(draft({ scenario: null }), deps())).rejects.toThrow(/incomplete/);
    await expect(applySetupDraft(draft({ targetLanguage: null }), deps())).rejects.toThrow(/incomplete/);
  });
});
