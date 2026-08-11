import { describe, it, expect } from 'vitest';
import { Provider } from '../../types/Provider';
import {
  computeStartGate,
  reasonToSettingsTarget,
  reasonToI18n,
  type StartGateInput,
} from './sessionStartGate';

// A configuration where every gate condition passes. Individual tests break
// exactly one condition so precedence is unambiguous.
const ready: StartGateInput = {
  isApiKeyValid: true,
  availableModelCount: 3,
  loadingModels: false,
  isInitializing: false,
  provider: Provider.OPENAI,
  quota: null,
  missingDeviceForMode: null,
  autoSourceParticipantBlocked: false,
};

describe('computeStartGate', () => {
  it('allows start when every condition passes', () => {
    expect(computeStartGate(ready)).toEqual({ canStart: true, reason: null });
  });

  it('reports missing-device with the offending scope', () => {
    expect(computeStartGate({ ...ready, missingDeviceForMode: 'participant' })).toEqual({
      canStart: false,
      reason: 'missing-device',
      deviceScope: 'participant',
    });
  });

  it('treats an invalid key on LOCAL_INFERENCE as missing models, not a bad key', () => {
    const gate = computeStartGate({
      ...ready,
      isApiKeyValid: false,
      provider: Provider.LOCAL_INFERENCE,
    });
    expect(gate).toEqual({ canStart: false, reason: 'local-models-missing' });
  });

  it('reports api-key-invalid for a non-local provider', () => {
    expect(computeStartGate({ ...ready, isApiKeyValid: false })).toEqual({
      canStart: false,
      reason: 'api-key-invalid',
    });
  });

  it('reports no-models when the model list came back empty', () => {
    expect(computeStartGate({ ...ready, availableModelCount: 0 })).toEqual({
      canStart: false,
      reason: 'no-models',
    });
  });

  it('reports loading-models while the list is still loading', () => {
    expect(
      computeStartGate({ ...ready, availableModelCount: 0, loadingModels: true }),
    ).toEqual({ canStart: false, reason: 'loading-models' });
  });

  it('reports wallet-frozen for a Kizuna-managed provider', () => {
    expect(
      computeStartGate({
        ...ready,
        provider: Provider.KIZUNA_AI_OPENAI_TRANSLATE,
        quota: { balance: 100, frozen: true },
      }),
    ).toEqual({ canStart: false, reason: 'wallet-frozen' });
  });

  it('reports insufficient-balance with the balance attached', () => {
    expect(
      computeStartGate({
        ...ready,
        provider: Provider.KIZUNA_AI_OPENAI_TRANSLATE,
        quota: { balance: 0, frozen: false },
      }),
    ).toEqual({ canStart: false, reason: 'insufficient-balance', balance: 0 });
  });

  // Managed Soniox is the one provider with a real floor rather than "any
  // positive balance": the backend refuses a session key below the price of
  // its shortest session (60s) at the conservative aggregate rate for the
  // stream set that session opens. `> 0` showed a green Start to a user who
  // was then handed a 402. Boundaries are checked on both sides of each stream
  // set's floor; the floor values themselves are pinned against the backend
  // formula in services/providers/sonioxManagedMinBalance.test.ts.
  describe('managed Soniox balance floor', () => {
    const soniox = { ...ready, provider: Provider.KIZUNA_AI_SONIOX } as StartGateInput;

    it('blocks one micro-USD below the single-stream text-only floor ($0.018334)', () => {
      expect(
        computeStartGate({ ...soniox, textOnly: true, quota: { balance: 18_333, frozen: false } }),
      ).toEqual({ canStart: false, reason: 'insufficient-balance', balance: 18_333 });
    });

    it('allows exactly the single-stream text-only floor', () => {
      expect(
        computeStartGate({ ...soniox, textOnly: true, quota: { balance: 18_334, frozen: false } }),
      ).toEqual({ canStart: true, reason: null });
    });

    it('blocks one micro-USD below the single-stream speech-to-speech floor ($0.041667)', () => {
      expect(
        computeStartGate({ ...soniox, textOnly: false, quota: { balance: 41_666, frozen: false } }),
      ).toEqual({ canStart: false, reason: 'insufficient-balance', balance: 41_666 });
    });

    it('allows exactly the single-stream speech-to-speech floor', () => {
      expect(
        computeStartGate({ ...soniox, textOnly: false, quota: { balance: 41_667, frozen: false } }),
      ).toEqual({ canStart: true, reason: null });
    });

    // Split Both opens a SECOND transcription stream, so the shortest session
    // the backend will start costs roughly twice as much. Decision 2: the
    // difference is reflected honestly rather than absorbed, so a low-balance
    // user finds split refused.
    it('blocks one micro-USD below the split text-only floor ($0.036667)', () => {
      expect(
        computeStartGate({
          ...soniox,
          textOnly: true,
          sonioxBothSplit: true,
          quota: { balance: 36_666, frozen: false },
        }),
      ).toEqual({ canStart: false, reason: 'insufficient-balance', balance: 36_666 });
    });

    it('allows exactly the split text-only floor', () => {
      expect(
        computeStartGate({
          ...soniox,
          textOnly: true,
          sonioxBothSplit: true,
          quota: { balance: 36_667, frozen: false },
        }),
      ).toEqual({ canStart: true, reason: null });
    });

    it('blocks one micro-USD below the split speech-to-speech floor ($0.06)', () => {
      expect(
        computeStartGate({
          ...soniox,
          textOnly: false,
          sonioxBothSplit: true,
          quota: { balance: 59_999, frozen: false },
        }),
      ).toEqual({ canStart: false, reason: 'insufficient-balance', balance: 59_999 });
    });

    it('allows exactly the split speech-to-speech floor', () => {
      expect(
        computeStartGate({
          ...soniox,
          textOnly: false,
          sonioxBothSplit: true,
          quota: { balance: 60_000, frozen: false },
        }),
      ).toEqual({ canStart: true, reason: null });
    });

    // The exact regression the floor exists to close: a balance that passes
    // `> 0` but cannot buy the shortest session the backend will start.
    it('blocks a positive balance that sits between zero and the floor', () => {
      const gate = computeStartGate({ ...soniox, quota: { balance: 5_000, frozen: false } });
      expect(gate.canStart).toBe(false);
      expect(gate.reason).toBe('insufficient-balance');
    });

    // textOnly is optional, so callers that don't know about the toggle must
    // still get a safe gate rather than silently falling back to `> 0`.
    it('defaults to the speech-to-speech floor when textOnly is omitted', () => {
      expect(
        computeStartGate({ ...soniox, quota: { balance: 41_666, frozen: false } }).canStart,
      ).toBe(false);
      expect(
        computeStartGate({ ...soniox, quota: { balance: 41_667, frozen: false } }).canStart,
      ).toBe(true);
    });

    // sonioxBothSplit defaults the OPPOSITE way to textOnly, on purpose: split
    // is opt-in and only a caller that reads the shared/split toggle can be in
    // it, so omitting it must not raise the floor for every speaker-only
    // session a split-unaware caller starts.
    it('defaults to the single-stream floor when sonioxBothSplit is omitted', () => {
      expect(
        computeStartGate({ ...soniox, textOnly: true, quota: { balance: 36_666, frozen: false } })
          .canStart,
      ).toBe(true);
    });

    // Every other provider keeps the historical rule. Balances are integer
    // micro-USD, so the floor of 1 is exactly `> 0`.
    it('leaves other Kizuna-managed providers on the any-positive-balance rule', () => {
      const other = { ...ready, provider: Provider.KIZUNA_AI_OPENAI_TRANSLATE } as StartGateInput;
      expect(computeStartGate({ ...other, quota: { balance: 1, frozen: false } })).toEqual({
        canStart: true,
        reason: null,
      });
      expect(computeStartGate({ ...other, quota: { balance: 0, frozen: false } }).reason).toBe(
        'insufficient-balance',
      );
      // Neither toggle may move a non-Soniox provider's floor.
      expect(
        computeStartGate({ ...other, textOnly: true, quota: { balance: 1, frozen: false } })
          .canStart,
      ).toBe(true);
      expect(
        computeStartGate({ ...other, sonioxBothSplit: true, quota: { balance: 1, frozen: false } })
          .canStart,
      ).toBe(true);
    });

    it('still prefers wallet-frozen over a sub-floor balance', () => {
      const gate = computeStartGate({ ...soniox, quota: { balance: 5_000, frozen: true } });
      expect(gate.reason).toBe('wallet-frozen');
    });
  });

  // Defensive fallback: the Kizuna-managed profile fetch is async and can
  // still be null/pending when the gate is computed. This must not be
  // reported as 'insufficient-balance' — that reason's message interpolates
  // {{balance}}, which would render as an empty slot for a problem that may
  // not exist (issue found in whole-branch review, Fix 4).
  it('reports quota-unknown when a Kizuna-managed provider has no quota loaded yet', () => {
    expect(
      computeStartGate({
        ...ready,
        provider: Provider.KIZUNA_AI_OPENAI_TRANSLATE,
        quota: null,
      }),
    ).toEqual({ canStart: false, reason: 'quota-unknown' });
  });

  it('ignores balance for providers that are not Kizuna-managed', () => {
    expect(computeStartGate({ ...ready, quota: { balance: 0, frozen: true } })).toEqual({
      canStart: true,
      reason: null,
    });
  });

  it('blocks while initializing but reports no reason (it is a transient state)', () => {
    expect(computeStartGate({ ...ready, isInitializing: true })).toEqual({
      canStart: false,
      reason: null,
    });
  });

  // Precedence must match the main-window tooltip chain at MainPanel.tsx:3408.
  it('prefers missing-device over every other reason', () => {
    const gate = computeStartGate({
      ...ready,
      missingDeviceForMode: 'speaker',
      isApiKeyValid: false,
      availableModelCount: 0,
      provider: Provider.KIZUNA_AI_OPENAI_TRANSLATE,
      quota: { balance: 0, frozen: true },
    });
    expect(gate.reason).toBe('missing-device');
  });

  it('prefers an invalid key over an empty model list', () => {
    const gate = computeStartGate({ ...ready, isApiKeyValid: false, availableModelCount: 0 });
    expect(gate.reason).toBe('api-key-invalid');
  });

  // Soniox reverses source/target for the participant client, so an 'auto'
  // source cannot be reversed. On main this closed the gate with no
  // explanation at all; it now reports a reason like every other blocker.
  it('reports auto-source-participant when auto detection blocks the participant', () => {
    expect(computeStartGate({ ...ready, autoSourceParticipantBlocked: true })).toEqual({
      canStart: false,
      reason: 'auto-source-participant',
    });
  });

  it('prefers missing-device over auto-source-participant', () => {
    const gate = computeStartGate({
      ...ready,
      missingDeviceForMode: 'speaker',
      autoSourceParticipantBlocked: true,
    });
    expect(gate.reason).toBe('missing-device');
  });

  it('prefers auto-source-participant over a credential problem', () => {
    const gate = computeStartGate({
      ...ready,
      autoSourceParticipantBlocked: true,
      isApiKeyValid: false,
    });
    expect(gate.reason).toBe('auto-source-participant');
  });

  it('prefers wallet-frozen over insufficient-balance', () => {
    const gate = computeStartGate({
      ...ready,
      provider: Provider.KIZUNA_AI_OPENAI_TRANSLATE,
      quota: { balance: 0, frozen: true },
    });
    expect(gate.reason).toBe('wallet-frozen');
  });
});

describe('reasonToSettingsTarget', () => {
  it('routes a missing speaker device to the microphone section', () => {
    expect(reasonToSettingsTarget('missing-device', 'speaker')).toBe('microphone');
  });

  it('routes a missing participant device to the participant section', () => {
    expect(reasonToSettingsTarget('missing-device', 'participant')).toBe('participant');
  });

  it('routes a both-scope device gap to the microphone section', () => {
    expect(reasonToSettingsTarget('missing-device', 'both')).toBe('microphone');
  });

  it('routes the Soniox auto-source block to the language settings', () => {
    expect(reasonToSettingsTarget('auto-source-participant')).toBe('languages');
  });

  it('routes model and key problems to their sections', () => {
    expect(reasonToSettingsTarget('local-models-missing')).toBe('model-management');
    expect(reasonToSettingsTarget('api-key-invalid')).toBe('provider');
    expect(reasonToSettingsTarget('no-models')).toBe('provider');
  });

  it('routes wallet problems to the account section', () => {
    expect(reasonToSettingsTarget('wallet-frozen')).toBe('user-account');
    expect(reasonToSettingsTarget('insufficient-balance')).toBe('user-account');
  });

  it('offers no destination for the transient loading state', () => {
    expect(reasonToSettingsTarget('loading-models')).toBeNull();
  });

  it('offers no destination when the quota state is unknown', () => {
    expect(reasonToSettingsTarget('quota-unknown')).toBeNull();
  });
});

describe('reasonToI18n', () => {
  it('maps every reason to an existing translation key', () => {
    const reasons = [
      'missing-device', 'auto-source-participant', 'local-models-missing',
      'api-key-invalid', 'no-models', 'loading-models', 'wallet-frozen',
      'insufficient-balance', 'quota-unknown',
    ] as const;
    for (const reason of reasons) {
      const entry = reasonToI18n(reason);
      expect(entry.key).toMatch(/^(mainPanel|modePicker|tokenUsage|settings)\./);
      expect(entry.defaultValue.length).toBeGreaterThan(0);
    }
  });

  // The wallet is micro-USD and this branch removed token vocabulary
  // product-wide, so interpolating the raw value would render a 7-digit
  // integer next to the word "tokens". Formatting lives here so no surface
  // can forget it.
  it('formats the insufficient-balance amount as USD, not as a raw wallet integer', () => {
    const entry = reasonToI18n('insufficient-balance', 9_999);
    expect(entry.defaultValue).toBe('Insufficient balance: {{balance}}');
    expect(entry.defaultValue).not.toMatch(/token/i);
    expect(entry.values).toEqual({ balance: '$0.01' });
  });

  it('renders a missing balance as $0.00 rather than an empty slot', () => {
    expect(reasonToI18n('insufficient-balance').values).toEqual({ balance: '$0.00' });
  });

  it('maps quota-unknown to the existing tokenUsage.unableToLoadQuota key (no new i18n key)', () => {
    expect(reasonToI18n('quota-unknown')).toEqual({
      key: 'tokenUsage.unableToLoadQuota',
      defaultValue: 'Unable to load quota information',
    });
  });
});
