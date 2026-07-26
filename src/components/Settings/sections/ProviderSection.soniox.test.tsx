/**
 * Regression test for finding C1 (final-review, feat/soniox-provider):
 * ProviderSection's `updateApiKey` was a `switch (provider)` with no
 * `Provider.SONIOX` case, so typing into the API key input while Soniox was
 * selected was a silent no-op — the value never reached the store, and the
 * provider could never be validated or used.
 *
 * Mounts the real component against the real settingsStore. Everything else
 * ProviderSection touches (auth, analytics, model stores) is mocked to keep
 * the test focused on the API-key write path and avoid unrelated network/IO.
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
    }),
    Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  };
});

vi.mock('../../../lib/analytics', () => ({
  useAnalytics: () => ({ trackEvent: vi.fn() }),
}));

vi.mock('../../../lib/auth/hooks', () => ({
  useAuth: () => ({ isSignedIn: false, getToken: undefined }),
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
const { default: ProviderSection } = await import('./ProviderSection');

describe('ProviderSection — Soniox API key wiring (regression for C1)', () => {
  beforeEach(() => {
    useSettingsStore.setState((s: any) => ({
      provider: Provider.SONIOX,
      soniox: { ...s.soniox, apiKey: '' },
    }));
  });

  it('writes typed input to the soniox slice apiKey field', () => {
    render(<ProviderSection isSessionActive={false} />);
    const input = screen.getByPlaceholderText('simpleSettings.apiKeyPlaceholder') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'sk-test-123' } });
    expect(useSettingsStore.getState().soniox.apiKey).toBe('sk-test-123');
  });
});
