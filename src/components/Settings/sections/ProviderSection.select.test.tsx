/**
 * Behavior of the provider selector as a customizable <select>
 * (appearance: base-select) — and its graceful degradation.
 *
 * The rich markup (icons, descriptions, engine credits inside <option>) only
 * renders where the runtime supports base-select; Chromium ≥135 does (the
 * packaged Electron is 144), but the extension's floor is Chrome 116, where a
 * classic select must get plain text options instead — rich children would be
 * invisible in its OS-drawn popup.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';

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

const baseSelectSupported = vi.hoisted(() => ({ value: true }));
vi.mock('../../../utils/supportsBaseSelect', () => ({
  supportsBaseSelect: () => baseSelectSupported.value,
}));

const { default: useSettingsStore } = await import('../../../stores/settingsStore');
const { Provider } = await import('../../../types/Provider');
const { default: ProviderSection } = await import('./ProviderSection');

const getSelect = () =>
  document.querySelector('.provider-select') as HTMLSelectElement;

describe('ProviderSection — provider <select>', () => {
  beforeEach(() => {
    baseSelectSupported.value = true;
    useSettingsStore.setState({ provider: Provider.OPENAI } as never);
  });

  it('switches provider through the store on change', () => {
    render(<ProviderSection isSessionActive={false} />);

    fireEvent.change(getSelect(), { target: { value: Provider.GEMINI } });

    expect(useSettingsStore.getState().provider).toBe(Provider.GEMINI);
  });

  it('reflects the current provider as the selected option', () => {
    useSettingsStore.setState({ provider: Provider.PALABRA_AI } as never);
    render(<ProviderSection isSessionActive={false} />);

    expect(getSelect().value).toBe(Provider.PALABRA_AI);
  });

  it('is disabled while a session is active', () => {
    // The old custom dropdown refused to expand mid-session; the select
    // expresses the same rule as the disabled attribute.
    render(<ProviderSection isSessionActive={true} />);

    expect(getSelect().disabled).toBe(true);
  });

  it('renders rich option content when base-select is supported', () => {
    render(<ProviderSection isSessionActive={false} />);

    const option = document.querySelector(
      `.provider-select option[value="${Provider.OPENAI}"]`,
    );
    expect(option?.querySelector('.provider-select__icon svg')).not.toBeNull();
    expect(option?.querySelector('.provider-select__description')?.textContent)
      .toContain('GPT');
    // The closed control mirrors the selected option via <selectedcontent>.
    expect(document.querySelector('.provider-select selectedcontent')).not.toBeNull();
  });

  it('falls back to plain text options where base-select is unsupported', () => {
    baseSelectSupported.value = false;
    render(<ProviderSection isSessionActive={false} />);

    const option = document.querySelector(
      `.provider-select option[value="${Provider.OPENAI}"]`,
    );
    // A classic select popup renders option text only — element children
    // would be flattened or invisible, so the markup must not emit them.
    expect(option?.querySelector('span')).toBeNull();
    expect(option?.textContent).toBe('OpenAI');
    expect(document.querySelector('.provider-select selectedcontent')).toBeNull();
    // Switching still works through the same handler.
    fireEvent.change(getSelect(), { target: { value: Provider.GEMINI } });
    expect(useSettingsStore.getState().provider).toBe(Provider.GEMINI);
  });
});
