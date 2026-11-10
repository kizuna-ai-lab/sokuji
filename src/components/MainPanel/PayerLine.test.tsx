import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../../locales/en/translation.json';
import { getUseOwnBalance } from '../../lib/session/payerChoice';
import { useAccountStore } from '../../stores/accountStore';
import PayerLine from './PayerLine';

beforeAll(async () => {
  await i18next.use(initReactI18next).init({ lng: 'en', resources: { en: { translation: en } }, interpolation: { escapeValue: false }, showSupportNotice: false });
});
beforeEach(() => {
  localStorage.clear();
  useAccountStore.setState({ account: null });
});
afterEach(cleanup);

const memberAccount = {
  status: 'known' as const, balanceMicroUsd: 9, frozen: false,
  organization: { name: 'Acme', availableMicroUsd: 9, frozen: false },
  personal: { balanceMicroUsd: 5, frozen: false },
};

describe('PayerLine', () => {
  it('shows who pays and a toggle, off, for a member', () => {
    useAccountStore.setState({ account: memberAccount });
    render(<PayerLine />);
    expect(screen.getByText('Paid by Acme')).toBeTruthy();
    const toggle = screen.getByRole('checkbox', { name: 'Use my own balance' }) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
  });

  it('turning it on is remembered on this device and changes the line', () => {
    useAccountStore.setState({ account: memberAccount });
    render(<PayerLine />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Use my own balance' }));
    expect(getUseOwnBalance()).toBe(true);
    expect((screen.getByRole('checkbox', { name: 'Use my own balance' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByText('Paid by Acme')).toBeNull();
  });

  it('follows the account arriving after it mounted', () => {
    const { container } = render(<PayerLine />);
    expect(container.firstChild).toBeNull();
    act(() => useAccountStore.setState({ account: memberAccount }));
    expect(screen.getByText('Paid by Acme')).toBeTruthy();
  });

  it.each([
    ['signed out', null],
    ['loading', { status: 'loading' as const }],
    ['a non-member', { status: 'known' as const, balanceMicroUsd: 9, frozen: false }],
  ])('renders nothing for %s', (_n, account) => {
    useAccountStore.setState({ account });
    const { container } = render(<PayerLine />);
    expect(container.firstChild).toBeNull();
  });
});
