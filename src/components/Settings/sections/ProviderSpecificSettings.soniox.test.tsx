/**
 * Mutation-verified wiring tests for the Soniox advanced settings (#342):
 * each control must actually write its field to the ACTIVE soniox slice
 * (BYOK `soniox`, or `kizunaSoniox` for the managed twin). Mounts the real
 * ProviderSpecificSettings against the real settingsStore — the #339 lesson:
 * per-provider switches/routing fail silently, only real write-path tests
 * catch a missing case.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (_k: string, def?: string) => def ?? _k,
      i18n: { language: 'en' },
    }),
  };
});

vi.mock('../../../lib/analytics', () => ({
  useAnalytics: () => ({ trackEvent: vi.fn() }),
}));

vi.mock('../../../lib/auth/hooks', () => ({
  useAuth: () => ({ getToken: async () => null }),
}));

vi.mock('../../../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (_k: string, d: unknown) => d,
      setSetting: async () => undefined,
    }),
  },
}));

// Heavy local-provider sections; all render null for provider=SONIOX but pull
// large import graphs — stub them out.
vi.mock('./ModelManagementSection', () => ({ ModelManagementSection: () => null }));
vi.mock('./NativeModelManagementSection', () => ({ NativeModelManagementSection: () => null }));
vi.mock('./EngineSection', () => ({ EngineSection: () => null }));

const { default: useSettingsStore } = await import('../../../stores/settingsStore');
const { Provider } = await import('../../../types/Provider');
const { SonioxProviderConfig } = await import('../../../services/providers/SonioxProviderConfig');
const { default: ProviderSpecificSettings } = await import('./ProviderSpecificSettings');

const baseProps = {
  config: new SonioxProviderConfig().getConfig(),
  isSessionActive: false,
  isPreviewExpanded: false,
  setIsPreviewExpanded: () => {},
  getProcessedSystemInstructions: () => '',
  availableModels: [],
  loadingModels: false,
  fetchAvailableModels: async () => {},
};

function mount() {
  return render(<ProviderSpecificSettings {...baseProps} />);
}

describe('ProviderSpecificSettings — Soniox advanced settings wiring (#342)', () => {
  beforeEach(() => {
    useSettingsStore.setState((s: any) => ({
      provider: Provider.SONIOX,
      soniox: {
        ...s.soniox,
        vocabularyTerms: '',
        vocabularyTranslations: '',
        endpointSensitivity: 0,
        endpointLatencyAdjustmentLevel: 0,
        ttsSpeed: 1.0,
      },
    }));
  });

  it('writes the terms textarea to soniox.vocabularyTerms and caps it at 4000 chars', () => {
    const { container } = mount();
    const el = container.querySelector('#soniox-vocabulary-terms') as HTMLTextAreaElement;
    expect(el.getAttribute('maxlength')).toBe('4000');
    fireEvent.change(el, { target: { value: 'Sokuji\nKizuna AI' } });
    expect(useSettingsStore.getState().soniox.vocabularyTerms).toBe('Sokuji\nKizuna AI');
  });

  it('writes the translations textarea to soniox.vocabularyTranslations and caps it at 4000 chars', () => {
    const { container } = mount();
    const el = container.querySelector('#soniox-vocabulary-translations') as HTMLTextAreaElement;
    expect(el.getAttribute('maxlength')).toBe('4000');
    fireEvent.change(el, { target: { value: 'Kizuna AI=絆愛' } });
    expect(useSettingsStore.getState().soniox.vocabularyTranslations).toBe('Kizuna AI=絆愛');
  });

  it('writes the sensitivity slider to soniox.endpointSensitivity as a number', () => {
    const { container } = mount();
    const el = container.querySelector('#soniox-endpoint-sensitivity') as HTMLInputElement;
    fireEvent.change(el, { target: { value: '0.5' } });
    expect(useSettingsStore.getState().soniox.endpointSensitivity).toBe(0.5);
  });

  it('writes the latency-level select to soniox.endpointLatencyAdjustmentLevel as a number', () => {
    const { container } = mount();
    const el = container.querySelector('#soniox-endpoint-latency-level') as HTMLSelectElement;
    fireEvent.change(el, { target: { value: '2' } });
    expect(useSettingsStore.getState().soniox.endpointLatencyAdjustmentLevel).toBe(2);
  });

  it('writes the TTS speed slider (0.7–1.3 range) to soniox.ttsSpeed', () => {
    const { container } = mount();
    const el = container.querySelector('input[min="0.7"]') as HTMLInputElement;
    expect(el).not.toBeNull();
    expect(el.getAttribute('max')).toBe('1.3');
    fireEvent.change(el, { target: { value: '0.8' } });
    expect(useSettingsStore.getState().soniox.ttsSpeed).toBe(0.8);
  });

  it('renders no model dropdown for Soniox (fixed stt-rt-v5 + tts-rt-v1 pipeline, nothing to choose)', () => {
    const { container } = mount();
    expect(container.querySelector('.model-selection-container')).toBeNull();
    useSettingsStore.setState({ provider: Provider.KIZUNA_AI_SONIOX });
    const managed = mount();
    expect(managed.container.querySelector('.model-selection-container')).toBeNull();
  });

  it('routes writes to the kizunaSoniox slice for the managed twin', () => {
    useSettingsStore.setState((s: any) => ({
      provider: Provider.KIZUNA_AI_SONIOX,
      kizunaSoniox: { ...s.kizunaSoniox, vocabularyTerms: '' },
      soniox: { ...s.soniox, vocabularyTerms: '' },
    }));
    const { container } = mount();
    const el = container.querySelector('#soniox-vocabulary-terms') as HTMLTextAreaElement;
    fireEvent.change(el, { target: { value: 'Managed term' } });
    expect(useSettingsStore.getState().kizunaSoniox.vocabularyTerms).toBe('Managed term');
    expect(useSettingsStore.getState().soniox.vocabularyTerms).toBe('');
  });
});
