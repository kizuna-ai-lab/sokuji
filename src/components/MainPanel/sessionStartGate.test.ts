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
});

describe('reasonToI18n', () => {
  it('maps every reason to an existing translation key', () => {
    const reasons = [
      'missing-device', 'local-models-missing', 'api-key-invalid',
      'no-models', 'loading-models', 'wallet-frozen', 'insufficient-balance',
    ] as const;
    for (const reason of reasons) {
      const entry = reasonToI18n(reason);
      expect(entry.key).toMatch(/^(mainPanel|modePicker)\./);
      expect(entry.defaultValue.length).toBeGreaterThan(0);
    }
  });
});
