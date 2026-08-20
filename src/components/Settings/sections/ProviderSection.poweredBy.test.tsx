/**
 * The provider row for a Kizuna-managed twin reads "KizunaAI  Powered by
 * Soniox" on one line, with the engine differentiating what the name no longer
 * does. Before this the three twins were named after their engines and their
 * descriptions were byte-identical boilerplate, so the list showed three
 * indistinguishable rows.
 *
 * The selector is a customizable <select> (appearance: base-select) whose
 * options carry the rich row markup; every provider — including the selected
 * one — is an option, so "the selected row" is option:checked.
 *
 * Runs against the real i18n catalog rather than a stubbed t(): the attribution
 * is a <Trans> with a component slot, so a stub that returns keys would assert
 * nothing about whether the sentence actually assembles.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../../lib/analytics', () => ({
  useAnalytics: () => ({ trackEvent: vi.fn() }),
}));

vi.mock('../../../lib/auth/hooks', () => ({
  useAuth: () => ({ isSignedIn: true, getToken: async () => 'token' }),
}));

vi.mock('../../../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (_k: string, d: unknown) => d,
      setSetting: async () => undefined,
    }),
  },
}));

// jsdom has no layout engine, so CSS.supports says false there; the rich
// markup path is what these tests are about.
vi.mock('../../../utils/supportsBaseSelect', () => ({
  supportsBaseSelect: () => true,
}));

const { default: useSettingsStore } = await import('../../../stores/settingsStore');
const { Provider } = await import('../../../types/Provider');
const { default: ProviderSection } = await import('./ProviderSection');

const selectedOption = () =>
  document.querySelector('.provider-select option:checked');

describe('ProviderSection — Kizuna-managed rows credit their engine', () => {
  beforeEach(() => {
    useSettingsStore.setState({ provider: Provider.KIZUNA_AI_SONIOX } as never);
  });

  it('names the selected row KizunaAI and credits the engine beside it', () => {
    render(<ProviderSection isSessionActive={false} />);

    const row = selectedOption();
    const name = row?.querySelector('.provider-select__name');
    expect(name?.textContent).toBe('KizunaAI');

    const credit = row?.querySelector('.powered-by');
    expect(credit?.textContent).toBe('Powered by Soniox');
    // Same line as the name — a separate line would make every row taller.
    expect(credit?.closest('.provider-name-line')).toBe(name?.closest('.provider-name-line'));
  });

  it('describes what sets this engine apart instead of the shared boilerplate', () => {
    render(<ProviderSection isSessionActive={false} />);

    const desc = selectedOption()?.querySelector('.provider-select__description');
    expect(desc?.textContent).toContain('60 languages');
    expect(desc?.textContent).not.toContain('authenticated via your account');
  });

  it('leaves a BYOK provider without an engine credit', () => {
    useSettingsStore.setState({ provider: Provider.SONIOX } as never);
    render(<ProviderSection isSessionActive={false} />);

    expect(selectedOption()?.querySelector('.powered-by')).toBeNull();
    expect(selectedOption()?.querySelector('.provider-select__name')?.textContent).toBe('Soniox');
  });

  it('tells the managed twins apart in the list', () => {
    render(<ProviderSection isSessionActive={false} />);

    // All three twins are named "KizunaAI", so the credit is the only thing
    // separating them. Options are always in the DOM on a select — including
    // the selected one, which the old custom dropdown used to filter out.
    const credits = Array.from(document.querySelectorAll('.provider-select option .powered-by'))
      .map((el) => el.textContent);
    expect(credits).toContain('Powered by Doubao');
    expect(credits).toContain('Powered by OpenAI');
    expect(credits).toContain('Powered by Soniox');
    // BYOK Soniox sits in the same list and must stay uncredited.
    expect(screen.getAllByText('Soniox').length).toBeGreaterThan(0);
  });
});
