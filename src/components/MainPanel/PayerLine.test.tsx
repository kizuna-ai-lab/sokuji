import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../../locales/en/translation.json';
import { SONIOX_DEFAULTS } from '../../providers/soniox/settings';
import { getUseOwnBalance, setUseOwnBalance } from '../../lib/session/payerChoice';
import { useAccountStore } from '../../stores/accountStore';
import { useProviderStore } from '../../stores/providerStore';
import PayerLine from './PayerLine';

beforeAll(async () => {
  await i18next.use(initReactI18next).init({ lng: 'en', resources: { en: { translation: en } }, interpolation: { escapeValue: false }, showSupportNotice: false });
});
/** A provider with a balance floor (managed), as the gate finds it. */
const selectManaged = () => useProviderStore.setState({
  selected: 'kizunaai_soniox',
  entries: { kizunaai_soniox: { settings: SONIOX_DEFAULTS, credentials: {}, pair: { source: 'ja', target: 'en' } } },
});
beforeEach(() => {
  localStorage.clear();
  useAccountStore.setState({ account: null });
  useProviderStore.setState({ entries: {}, selected: null });
  selectManaged();
});
afterEach(cleanup);

const memberAccount = {
  status: 'known' as const, balanceMicroUsd: 9, frozen: false,
  organization: { name: 'Acme', availableMicroUsd: 9, frozen: false },
  personal: { balanceMicroUsd: 5, frozen: false },
};
const toggle = () => screen.getByRole('switch', { name: 'Use my own balance' });

describe('PayerLine', () => {
  it('shows who pays and a switch, off, for a member', () => {
    useAccountStore.setState({ account: memberAccount });
    render(<PayerLine idle />);
    expect(screen.getByText('Paid by Acme')).toBeTruthy();
    expect(toggle().getAttribute('aria-checked')).toBe('false');
  });

  it('turning it on is remembered on this device and changes the line', () => {
    useAccountStore.setState({ account: memberAccount });
    render(<PayerLine idle />);
    fireEvent.click(toggle());
    expect(getUseOwnBalance()).toBe(true);
    expect(toggle().getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByText('Paid by Acme')).toBeNull();
    expect(screen.getByText('Paid by you')).toBeTruthy();
  });

  it("while a session runs it shows the run's payer, not the switch another window changed", () => {
    useAccountStore.setState({ account: memberAccount });
    const { rerender } = render(<PayerLine idle={false} runPayer="personal" />);
    expect(screen.getByText('Paid by you')).toBeTruthy();
    expect(toggle().getAttribute('aria-checked')).toBe('true');
    // The other window turns the switch on and off: the running session still spends what it started with.
    act(() => setUseOwnBalance(false));
    rerender(<PayerLine idle={false} runPayer="organization" />);
    act(() => setUseOwnBalance(true));
    expect(screen.getByText('Paid by Acme')).toBeTruthy();
    expect(toggle().getAttribute('aria-checked')).toBe('false');
  });

  it('shows nothing while a session runs that was started with no payer: it does not guess one from the switch', () => {
    useAccountStore.setState({ account: memberAccount });
    const { container } = render(<PayerLine idle={false} />);
    expect(container.innerHTML).toBe('');
  });

  it('is disabled while a session runs: the running payer is fixed', () => {
    useAccountStore.setState({ account: memberAccount });
    render(<PayerLine idle={false} runPayer="organization" />);
    expect(toggle().getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(toggle());
    expect(getUseOwnBalance()).toBe(false);
    expect(screen.getByText('Paid by Acme')).toBeTruthy();
  });

  it('follows the account arriving after it mounted', () => {
    const { container } = render(<PayerLine idle />);
    expect(container.firstChild).toBeNull();
    act(() => useAccountStore.setState({ account: memberAccount }));
    expect(screen.getByText('Paid by Acme')).toBeTruthy();
  });

  it('renders nothing when the selected provider has no balance floor (own key, local model)', () => {
    useAccountStore.setState({ account: memberAccount });
    useProviderStore.setState({
      selected: 'soniox',
      entries: { soniox: { settings: SONIOX_DEFAULTS, credentials: {}, pair: { source: 'ja', target: 'en' } } },
    });
    const { container } = render(<PayerLine idle />);
    expect(container.firstChild).toBeNull();
  });

  it.each([
    ['signed out', null],
    ['loading', { status: 'loading' as const }],
    ['a non-member', { status: 'known' as const, balanceMicroUsd: 9, frozen: false }],
  ])('renders nothing for %s', (_n, account) => {
    useAccountStore.setState({ account });
    const { container } = render(<PayerLine idle />);
    expect(container.firstChild).toBeNull();
  });
});
