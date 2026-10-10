import { describe, it, expect, vi } from 'vitest';
import { applySetupDraft } from './applySetup';
import type { ApplySetupDeps } from './applySetup';
import { initialDraft } from './setupDraft';
import type { SetupDraft } from './setupDraft';
import { SCENARIOS } from '../../lib/setup/scenarios';
import { Provider } from '../../types/Provider';

function deps(overrides: Partial<ApplySetupDeps> = {}): ApplySetupDeps {
  return {
    setMode: vi.fn(),
    setOtherSide: vi.fn(),
    setBothPopoverSeen: vi.fn(),
    setTextOnly: vi.fn(),
    setParticipantSpeech: vi.fn(),
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
  it('writes 我听到的翻译 for the Both scenarios only: on for voice, off for text, untouched elsewhere (Review Focus 3)', async () => {
    const voice = deps();
    await applySetupDraft(draft({ scenario: 'two-way-voice' }), voice);
    expect(voice.setParticipantSpeech).toHaveBeenCalledWith(true);
    const text = deps();
    await applySetupDraft(draft({ scenario: 'face-to-face-text' }), text);
    expect(text.setParticipantSpeech).toHaveBeenCalledWith(false);
    const listen = deps();
    await applySetupDraft(draft({ scenario: 'understand-others', providerPath: 'managed', provider: Provider.KIZUNA_AI_SONIOX, credentials: {} }), listen);
    expect(listen.setParticipantSpeech).not.toHaveBeenCalled();
  });

  it('writes preset, provider, record — in that order — and not uiMode', async () => {
    const d = deps();
    await applySetupDraft(draft({}), d);

    expect(d.setMode).toHaveBeenCalledWith('speaker');
    expect(d.setTextOnly).toHaveBeenCalledWith(false);
    expect(d.applyProvider).toHaveBeenCalledWith(Provider.SONIOX, { source: 'en', target: 'ja' }, { apiKey: 'sk-1' }, {});
    expect(d.completeSetup).toHaveBeenCalledWith({ scenario: 'be-heard', providerPath: 'own-key', provider: Provider.SONIOX });

    const seq = order([d.setMode, d.setTextOnly, d.applyProvider, d.completeSetup] as any);
    expect([...seq].sort((a, b) => a - b)).toEqual(seq);   // strictly increasing
    expect(Object.keys(d)).not.toContain('setUIMode');
  });

  it('writes no display mode for any scenario, so a mode the user chose survives a re-run (Stage 2 session end, ruling 1)', async () => {
    for (const { id } of SCENARIOS) {
      // The two setters the wizard used to call, offered all the same: it reaches for neither.
      const d = { ...deps(), setSpeakerDisplayMode: vi.fn(), setParticipantDisplayMode: vi.fn() };
      await applySetupDraft(draft({ scenario: id }), d);
      expect(d.setSpeakerDisplayMode).not.toHaveBeenCalled();
      expect(d.setParticipantDisplayMode).not.toHaveBeenCalled();
      expect(d.completeSetup).toHaveBeenCalledWith(expect.objectContaining({ scenario: id }));
    }
  });

  it('omits credentials when they were skipped, and on the managed and offline paths', async () => {
    const skipped = deps();
    await applySetupDraft(draft({ credentials: {}, credentialsValidated: false, credentialsPending: true }), skipped);
    expect(skipped.applyProvider).toHaveBeenCalledWith(Provider.SONIOX, { source: 'en', target: 'ja' }, {}, {});

    const managed = deps();
    await applySetupDraft(draft({ providerPath: 'managed', provider: Provider.KIZUNA_AI_SONIOX, credentials: {} }), managed);
    expect(managed.applyProvider).toHaveBeenCalledWith(Provider.KIZUNA_AI_SONIOX, { source: 'en', target: 'ja' }, {}, {});

    const offline = deps();
    await applySetupDraft(draft({ providerPath: 'offline', provider: Provider.LOCAL_INFERENCE, credentials: { apiKey: 'sk-1' } }), offline);
    expect(offline.applyProvider).toHaveBeenCalledWith(Provider.LOCAL_INFERENCE, { source: 'en', target: 'ja' }, {}, {});
  });

  it('writes the credential choice the step showed, on the own-key path only, skipped key or not (Stage 2 Volcengine AST2, I2)', async () => {
    const credentialChoice = { setting: 'authMode', value: 'apiKey' };
    const chosen = deps();
    await applySetupDraft(draft({ provider: Provider.VOLCENGINE_AST2, credentials: { apiKey: 'key-1' }, credentialChoice }), chosen);
    expect(chosen.applyProvider).toHaveBeenCalledWith(Provider.VOLCENGINE_AST2, { source: 'en', target: 'ja' }, { apiKey: 'key-1' }, { authMode: 'apiKey' });

    const skipped = deps();
    await applySetupDraft(draft({ provider: Provider.VOLCENGINE_AST2, credentials: {}, credentialsValidated: false, credentialsPending: true, credentialChoice }), skipped);
    expect(skipped.applyProvider).toHaveBeenCalledWith(Provider.VOLCENGINE_AST2, { source: 'en', target: 'ja' }, {}, { authMode: 'apiKey' });

    const offline = deps();
    await applySetupDraft(draft({ providerPath: 'offline', provider: Provider.LOCAL_INFERENCE, credentials: {}, credentialChoice }), offline);
    expect(offline.applyProvider).toHaveBeenCalledWith(Provider.LOCAL_INFERENCE, { source: 'en', target: 'ja' }, {}, {});
  });

  it("sets the listening scenario's mode, and text-only for hygiene", async () => {
    const d = deps();
    await applySetupDraft(draft({ scenario: 'understand-others', providerPath: 'managed', provider: Provider.KIZUNA_AI_SONIOX, credentials: {} }), d);
    expect(d.setMode).toHaveBeenCalledWith('participant');
    expect(d.setTextOnly).toHaveBeenCalledWith(true);
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

  it('writes the other side: beside me for face-to-face, a meeting for every other scenario', async () => {
    const d = deps();
    await applySetupDraft(draft({ scenario: 'face-to-face-voice' }), d);
    expect(d.setMode).toHaveBeenCalledWith('both');
    expect(d.setOtherSide).toHaveBeenCalledWith('beside');
    const again = deps();
    await applySetupDraft(draft({ scenario: 'two-way-voice' }), again);
    expect(again.setOtherSide).toHaveBeenCalledWith('meeting');
  });

  it('counts a face-to-face scenario as having seen the Both popover, and a meeting scenario not', async () => {
    const f2f = deps();
    await applySetupDraft(draft({ scenario: 'face-to-face-voice' }), f2f);
    expect(f2f.setBothPopoverSeen).toHaveBeenCalledWith(true);
    const meeting = deps();
    await applySetupDraft(draft({ scenario: 'two-way-voice' }), meeting);
    expect(meeting.setBothPopoverSeen).not.toHaveBeenCalled();
  });
});
