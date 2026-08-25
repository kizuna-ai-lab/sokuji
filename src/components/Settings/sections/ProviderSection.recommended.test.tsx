/**
 * One provider in the list is the one we recommend, and the list should say so
 * — the wizard's managed card already carries the same badge, so a user who
 * took that path and later opens Settings meets the same claim in the same
 * words.
 *
 * Which provider it is comes from getDefaultManagedProvider(), never a literal:
 * that is the function the wizard's badge reads too, so the two surfaces cannot
 * disagree about what we are recommending.
 *
 * Runs against the real i18n catalog, like its sibling poweredBy test: a stub
 * that returned keys would not prove the plain-text fallback assembles.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

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

// Flipped per test: the badge is markup in the rich branch and text in the
// plain one, and the plain branch is what Chrome 116 (the extension's floor)
// actually renders.
let richSelect = true;
vi.mock('../../../utils/supportsBaseSelect', () => ({
  supportsBaseSelect: () => richSelect,
}));

const { default: useSettingsStore } = await import('../../../stores/settingsStore');
const { Provider } = await import('../../../types/Provider');
const { ProviderConfigFactory } = await import('../../../services/providers/ProviderConfigFactory');
const { default: ProviderSection } = await import('./ProviderSection');

const optionFor = (id: string) =>
  document.querySelector<HTMLOptionElement>(`.provider-select option[value="${id}"]`);

describe('ProviderSection — the recommended provider is marked', () => {
  beforeEach(() => {
    cleanup();
    richSelect = true;
    useSettingsStore.setState({ provider: Provider.OPENAI } as never);
  });

  it('badges the provider getDefaultManagedProvider names, inside the name line', () => {
    const recommended = ProviderConfigFactory.getDefaultManagedProvider();
    expect(recommended).toBeTruthy();

    render(<ProviderSection isSessionActive={false} />);

    const row = optionFor(recommended as string);
    const badge = row?.querySelector('.provider-name-line .provider-recommended');
    expect(badge?.textContent).toBe('Recommended');
  });

  it('leaves every other provider unbadged', () => {
    const recommended = ProviderConfigFactory.getDefaultManagedProvider();
    render(<ProviderSection isSessionActive={false} />);

    const others = Array.from(document.querySelectorAll<HTMLOptionElement>('.provider-select option'))
      .filter((o) => o.value && o.value !== recommended);
    expect(others.length).toBeGreaterThan(0);
    others.forEach((o) => {
      expect(o.querySelector('.provider-recommended'), `${o.value} should not be badged`).toBeNull();
    });
  });

  it('says it in words where the rich markup does not render', () => {
    // Chrome < 135 gets <option>{name}</option> and nothing else: a <span>
    // there is invisible, so the claim has to live in the text.
    richSelect = false;
    const recommended = ProviderConfigFactory.getDefaultManagedProvider();

    render(<ProviderSection isSessionActive={false} />);

    const row = optionFor(recommended as string);
    expect(row?.textContent).toMatch(/Recommended/);
    expect(row?.querySelector('.provider-recommended')).toBeNull();
    // ...and only that one.
    const others = Array.from(document.querySelectorAll<HTMLOptionElement>('.provider-select option'))
      .filter((o) => o.value && o.value !== recommended);
    others.forEach((o) => {
      expect(o.textContent, `${o.value} should not claim to be recommended`).not.toMatch(/Recommended/);
    });
  });

  it('keeps the badge out of the closed control', () => {
    // The closed control renders <selectedcontent>, a clone of the chosen
    // option. Once the user has chosen it, repeating "Recommended" argues with
    // someone already persuaded — so it is hidden there by CSS, and the rule
    // has to exist for that to happen.
    render(<ProviderSection isSessionActive={false} />);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    // The stylesheet is not applied in jsdom; this asserts the hook the rule
    // targets is present, so a rename of the class breaks here too.
    const recommended = ProviderConfigFactory.getDefaultManagedProvider();
    expect(optionFor(recommended as string)?.querySelector('.provider-recommended')).not.toBeNull();
  });
});
