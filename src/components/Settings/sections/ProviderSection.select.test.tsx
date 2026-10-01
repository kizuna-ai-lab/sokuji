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

vi.mock('../../../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (_k: string, d: unknown) => d,
      setSetting: async () => undefined,
    }),
  },
}));

// Local Native registers in the old registry only on Electron with its gate
// on — the only provider the old section still offers (Stage 2 deletion,
// ruling 1).
vi.mock('../../../utils/environment', async (orig) => ({
  ...(await orig<any>()),
  isElectron: () => true,
  isLocalNativeEnabled: () => true,
}));

const baseSelectSupported = vi.hoisted(() => ({ value: true }));
vi.mock('../../../utils/supportsBaseSelect', () => ({
  supportsBaseSelect: () => baseSelectSupported.value,
}));

const { default: useSettingsStore } = await import('../../../stores/settingsStore');
const { Provider } = await import('../../../types/Provider');
const { default: ProviderSection } = await import('./ProviderSection');

// The pre-twin managed id: a stored value no registry has ever registered.
const UNREGISTERED = 'kizunaai' as (typeof Provider)[keyof typeof Provider];

const getSelect = () =>
  document.querySelector('.provider-select') as HTMLSelectElement;

describe('ProviderSection — provider <select>', () => {
  beforeEach(() => {
    baseSelectSupported.value = true;
    useSettingsStore.setState({ provider: Provider.LOCAL_NATIVE } as never);
  });

  it('switches provider through the store on change', () => {
    useSettingsStore.setState({ provider: UNREGISTERED } as never);
    render(<ProviderSection isSessionActive={false} />);

    fireEvent.change(getSelect(), { target: { value: Provider.LOCAL_NATIVE } });

    expect(useSettingsStore.getState().provider).toBe(Provider.LOCAL_NATIVE);
  });

  it('reflects the current provider as the selected option', () => {
    render(<ProviderSection isSessionActive={false} />);

    expect(getSelect().value).toBe(Provider.LOCAL_NATIVE);
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
      `.provider-select option[value="${Provider.LOCAL_NATIVE}"]`,
    );
    expect(option?.querySelector('.provider-select__icon img')).not.toBeNull();
    expect(option?.querySelector('.provider-select__description')?.textContent)
      .toContain('Speech Recognition');
    // The closed control mirrors the selected option via <selectedcontent>.
    expect(document.querySelector('.provider-select selectedcontent')).not.toBeNull();
  });

  it('survives a persisted provider that is not registered and keeps it visible', () => {
    // Every stored provider but Local Native since the Stage 2 deletion — or a
    // feature flag turned off since. The registry has no descriptor for it;
    // the settings-slice selector would throw (getDescriptor) and crash the
    // whole section. The select must render, report the stored value, and pin
    // it on a disabled option instead of silently displaying the first
    // registered provider (Stage 2 deletion, choice 4).
    useSettingsStore.setState({ provider: UNREGISTERED } as never);
    render(<ProviderSection isSessionActive={false} />);

    const select = getSelect();
    expect(select.value).toBe(UNREGISTERED);
    const opt = document.querySelector(
      `.provider-select option[value="${UNREGISTERED}"]`,
    ) as HTMLOptionElement;
    expect(opt).not.toBeNull();
    expect(opt.disabled).toBe(true);
    // Switching AWAY still works.
    fireEvent.change(select, { target: { value: Provider.LOCAL_NATIVE } });
    expect(useSettingsStore.getState().provider).toBe(Provider.LOCAL_NATIVE);
  });

  it('falls back to plain text options where base-select is unsupported', () => {
    baseSelectSupported.value = false;
    render(<ProviderSection isSessionActive={false} />);

    const option = document.querySelector(
      `.provider-select option[value="${Provider.LOCAL_NATIVE}"]`,
    );
    // A classic select popup renders option text only — element children
    // would be flattened or invisible, so the markup must not emit them.
    expect(option?.querySelector('span')).toBeNull();
    expect(option?.textContent).toBe('Free (Native)');
    expect(document.querySelector('.provider-select selectedcontent')).toBeNull();
    // Switching still works through the same handler.
    useSettingsStore.setState({ provider: UNREGISTERED } as never);
    fireEvent.change(getSelect(), { target: { value: Provider.LOCAL_NATIVE } });
    expect(useSettingsStore.getState().provider).toBe(Provider.LOCAL_NATIVE);
  });
});
