/**
 * Coverage for the PalabraAI auth-mode toggle (final-review follow-up,
 * feat/palabra-platform-auth): the radio pair only selects which credential
 * inputs render — switching modes must never clear or overwrite any of the
 * three stored credential values (apiKey / clientId / clientSecret).
 *
 * Mounts the real component against the real settingsStore, mirroring
 * ProviderSection.soniox.test.tsx: everything else ProviderSection touches
 * (auth, analytics, settings service) is mocked to keep the test focused.
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

describe('ProviderSection — PalabraAI auth mode toggle', () => {
  beforeEach(() => {
    useSettingsStore.setState((s: any) => ({
      provider: Provider.PALABRA_AI,
      palabraai: {
        ...s.palabraai,
        authMode: 'platform',
        apiKey: 'pk-existing',
        clientId: 'id-existing',
        clientSecret: 'sec-existing',
      },
    }));
  });

  it('renders the platform input and writes typed input to apiKey', () => {
    render(<ProviderSection isSessionActive={false} />);
    const input = screen.getByPlaceholderText('API Key') as HTMLInputElement;
    expect(input.value).toBe('pk-existing');
    fireEvent.change(input, { target: { value: 'pk-new' } });
    expect(useSettingsStore.getState().palabraai.apiKey).toBe('pk-new');
  });

  it('switching modes swaps the inputs and never clears any credential', () => {
    render(<ProviderSection isSessionActive={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'App Client ID/Secret' }));
    expect(useSettingsStore.getState().palabraai.authMode).toBe('app');
    expect((screen.getByPlaceholderText('Client ID') as HTMLInputElement).value).toBe('id-existing');
    expect((screen.getByPlaceholderText('Client Secret') as HTMLInputElement).value).toBe('sec-existing');
    expect(useSettingsStore.getState().palabraai.apiKey).toBe('pk-existing');

    fireEvent.click(screen.getByRole('button', { name: 'Platform API Key' }));
    expect(useSettingsStore.getState().palabraai.authMode).toBe('platform');
    expect((screen.getByPlaceholderText('API Key') as HTMLInputElement).value).toBe('pk-existing');
    expect(useSettingsStore.getState().palabraai.clientId).toBe('id-existing');
    expect(useSettingsStore.getState().palabraai.clientSecret).toBe('sec-existing');
  });
});
