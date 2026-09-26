import { describe, it, expect, vi } from 'vitest';
import { applySetupDraft } from './applySetup';
import type { ApplySetupDeps } from './applySetup';
import { initialDraft } from './setupDraft';
import type { SetupDraft } from './setupDraft';
import { Provider } from '../../types/Provider';

function deps(overrides: Partial<ApplySetupDeps> = {}): ApplySetupDeps {
  return {
    setMode: vi.fn(),
    setTextOnly: vi.fn(),
    setSpeakerDisplayMode: vi.fn(),
    setParticipantDisplayMode: vi.fn(),
    applyProvider: vi.fn(async () => {}),
    completeSetup: vi.fn(async () => {}),
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
  it('writes preset, provider, record — in that order — and not uiMode', async () => {
    const d = deps();
    await applySetupDraft(draft({}), d);

    expect(d.setMode).toHaveBeenCalledWith('speaker');
    expect(d.setTextOnly).toHaveBeenCalledWith(false);
    expect(d.setSpeakerDisplayMode).toHaveBeenCalledWith('both');
    expect(d.setParticipantDisplayMode).not.toHaveBeenCalled();
    expect(d.applyProvider).toHaveBeenCalledWith(Provider.SONIOX, { source: 'en', target: 'ja' }, { apiKey: 'sk-1' });
    expect(d.completeSetup).toHaveBeenCalledWith({ scenario: 'be-heard', providerPath: 'own-key', provider: Provider.SONIOX });

    const seq = order([d.setMode, d.setTextOnly, d.setSpeakerDisplayMode, d.applyProvider, d.completeSetup] as any);
    expect([...seq].sort((a, b) => a - b)).toEqual(seq);   // strictly increasing
    expect(Object.keys(d)).not.toContain('setUIMode');
  });

  it('omits credentials when they were skipped, and on the managed and offline paths', async () => {
    const skipped = deps();
    await applySetupDraft(draft({ credentials: {}, credentialsValidated: false, credentialsPending: true }), skipped);
    expect(skipped.applyProvider).toHaveBeenCalledWith(Provider.SONIOX, { source: 'en', target: 'ja' }, {});

    const managed = deps();
    await applySetupDraft(draft({ providerPath: 'managed', provider: Provider.KIZUNA_AI_SONIOX, credentials: {} }), managed);
    expect(managed.applyProvider).toHaveBeenCalledWith(Provider.KIZUNA_AI_SONIOX, { source: 'en', target: 'ja' }, {});

    const offline = deps();
    await applySetupDraft(draft({ providerPath: 'offline', provider: Provider.LOCAL_INFERENCE, credentials: { apiKey: 'sk-1' } }), offline);
    expect(offline.applyProvider).toHaveBeenCalledWith(Provider.LOCAL_INFERENCE, { source: 'en', target: 'ja' }, {});
  });

  it('sets participant display for the listening scenario and leaves the speaker one alone', async () => {
    const d = deps();
    await applySetupDraft(draft({ scenario: 'understand-others', providerPath: 'managed', provider: Provider.KIZUNA_AI_SONIOX, credentials: {} }), d);
    expect(d.setMode).toHaveBeenCalledWith('participant');
    expect(d.setTextOnly).toHaveBeenCalledWith(true);
    expect(d.setParticipantDisplayMode).toHaveBeenCalledWith('translation');
    expect(d.setSpeakerDisplayMode).not.toHaveBeenCalled();
  });

  it('awaits applyProvider so a rejected write surfaces to the caller, and skips the record', async () => {
    const d = deps({ applyProvider: vi.fn(async () => { throw new Error('persist failed'); }) });
    await expect(applySetupDraft(draft({}), d)).rejects.toThrow(/persist failed/);
    expect(d.completeSetup).not.toHaveBeenCalled();
  });

  it('refuses an incomplete draft', async () => {
    await expect(applySetupDraft(draft({ scenario: null }), deps())).rejects.toThrow(/incomplete/);
    await expect(applySetupDraft(draft({ targetLanguage: null }), deps())).rejects.toThrow(/incomplete/);
  });
});
