/**
 * Regression test for finding C2 (final-review, feat/soniox-provider): both
 * updateSourceLanguage and updateTargetLanguage in LanguageSection had a
 * `switch (provider)` with no `Provider.SONIOX` case, so picking Soniox as
 * the provider and changing either language dropdown silently did nothing —
 * the store slice never updated, making two-way translation (and any
 * language pair other than the default auto→en) unreachable from the UI.
 *
 * This test mounts the real component against the real settingsStore (only
 * ServiceFactory and analytics are mocked — neither is exercised by a plain
 * language-select change) and asserts the store slice actually changes.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

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

vi.mock('../../../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (_k: string, d: unknown) => d,
      setSetting: async () => undefined,
    }),
  },
}));

const { default: useSettingsStore } = await import('../../../stores/settingsStore');
const { Provider } = await import('../../../types/Provider');
const { default: LanguageSection } = await import('./LanguageSection');

describe('LanguageSection — Soniox language wiring (regression for C2)', () => {
  beforeEach(() => {
    useSettingsStore.setState((s: any) => ({
      provider: Provider.SONIOX,
      soniox: { ...s.soniox, apiKey: '', sourceLanguage: 'auto', targetLanguage: 'en' },
    }));
  });

  it('writes the source language to the soniox slice when the source select changes', () => {
    render(
      <LanguageSection isSessionActive={false} showInterfaceLanguage={false} showTranslationLanguages={true} />
    );
    const selects = screen.getAllByRole('combobox');
    // Only the translation-language pair is rendered (interface language hidden):
    // selects[0] = source, selects[1] = target.
    fireEvent.change(selects[0], { target: { value: 'zh' } });
    expect(useSettingsStore.getState().soniox.sourceLanguage).toBe('zh');
  });

  it('writes the target language to the soniox slice when the target select changes', () => {
    render(
      <LanguageSection isSessionActive={false} showInterfaceLanguage={false} showTranslationLanguages={true} />
    );
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[1], { target: { value: 'ja' } });
    expect(useSettingsStore.getState().soniox.targetLanguage).toBe('ja');
  });
});
