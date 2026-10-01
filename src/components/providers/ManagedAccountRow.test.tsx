import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (_key: string, def: unknown) => def,
      setSetting: async () => ({ success: true }),
    }),
  },
}));
vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return { ...actual, useTranslation: () => ({ t: (key: string) => key }) };
});

// The sign-in sentence renders through <Trans>, which reads the real i18next
// singleton directly rather than the useTranslation() hook mocked above —
// same setup ProviderPicker.test.tsx uses for the vendor credit.
import '../../locales';

import { useSettingsStore } from '../../stores/settingsStore';
import { ManagedAccountRow } from './ManagedAccountRow';

const getToken = async () => null;

afterEach(() => {
  useSettingsStore.getState().setAccountPopoverRequested(false);
});

describe('ManagedAccountRow', () => {
  it("shows a spinner and 'Checking...' while the sign-in loads", () => {
    render(<ManagedAccountRow auth={{ signedIn: false, loaded: false, getToken }} />);
    expect(screen.getByText('update.checking')).toBeInTheDocument();
    expect(document.querySelector('.spinner')).not.toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('says the account signs the provider in, once signed in', () => {
    render(<ManagedAccountRow auth={{ signedIn: true, loaded: true, getToken }} />);
    const row = document.querySelector('.api-key-info');
    expect(row).not.toBeNull();
    expect(row?.textContent).toContain('simpleSettings.autoAuthenticated');
    expect(row?.querySelector('.success-icon')).not.toBeNull();
  });

  it('offers the account popover to a signed-out user', () => {
    render(<ManagedAccountRow auth={{ signedIn: false, loaded: true, getToken }} />);
    const row = document.querySelector('.api-key-warning');
    expect(row).not.toBeNull();
    expect(row?.textContent).toBe('Sign in or sign up to use Kizuna AI — no API key needed.');

    fireEvent.click(row!.querySelector('.sign-in-link')!);

    expect(useSettingsStore.getState().accountPopoverRequested).toBe(true);
  });
});
