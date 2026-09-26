import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';

const { stored, setSetting, trackEvent } = vi.hoisted(() => {
  const stored = new Map<string, unknown>();
  return {
    stored,
    setSetting: vi.fn(async (key: string, value: unknown) => {
      stored.set(key, value);
      return { success: true };
    }),
    trackEvent: vi.fn(),
  };
});
vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (key: string, def: unknown) => (stored.has(key) ? stored.get(key) : def),
      setSetting,
    }),
  },
}));
vi.mock('../../lib/analytics', () => ({ useAnalytics: () => ({ trackEvent }) }));
vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return { ...actual, useTranslation: () => ({ t: (key: string) => key }) };
});
const mockResolve = vi.fn();
vi.mock('../../stores/modelStore', () => ({
  useModelStore: { getState: () => ({ resolve: mockResolve }) },
  useModelStatuses: () => ({}),
}));

// The port's rich/plain option split (ProviderSection.tsx's richSelect) reads
// this same detector — stubbed per-test the way ProviderSection.select.test.tsx
// does, so both branches are exercised deterministically regardless of what
// jsdom's real CSS.supports reports.
const baseSelectSupported = vi.hoisted(() => ({ value: false }));
vi.mock('../../utils/supportsBaseSelect', () => ({
  supportsBaseSelect: () => baseSelectSupported.value,
}));

// The vendor credit renders through <Trans>, which reads the real i18next
// singleton directly (context or getI18n()) rather than the useTranslation()
// hook mocked above — same setup PoweredBy.test.tsx uses to exercise the same
// i18nKey ('providers.poweredBy').
import '../../locales';

import { fakeProvider } from '../../providers/fake/provider';
import { localInferenceProvider } from '../../providers/localInference/provider';
import type { EngineSummaryProps } from '../../lib/provider/types';
import type { FakeSettings } from '../../providers/fake/settings';
import { useProviderStore } from '../../stores/providerStore';
import { ProviderPicker } from './ProviderPicker';

const noAuth = { signedIn: false, getToken: async () => null };

beforeEach(() => {
  stored.clear();
  setSetting.mockClear();
  trackEvent.mockClear();
  useProviderStore.setState({ entries: {}, readiness: {}, selected: null });
  localStorage.clear();
  baseSelectSupported.value = false;
});

describe('ProviderPicker', () => {
  it('switches providers: loads the new one, selects it, persists the pick and tracks it', async () => {
    stored.set('settings.second.script', 'long');
    const second = { ...fakeProvider, id: 'second', settings: { ...fakeProvider.settings, key: 'second' } };
    render(<ProviderPicker providers={[fakeProvider, second]} auth={noAuth} />);
    await screen.findByTitle('simpleSettings.validate');

    fireEvent.change(screen.getByLabelText('simpleSettings.provider'), { target: { value: 'second' } });

    expect(useProviderStore.getState().selected).toBe('second');
    await waitFor(() => expect(useProviderStore.getState().entries.second).toBeDefined());
    expect(useProviderStore.getState().entries.second?.settings).toMatchObject({ script: 'long' });
    await waitFor(() => expect(setSetting).toHaveBeenCalledWith('settings.common.provider', 'second'));
    expect(trackEvent).toHaveBeenCalledWith('provider_switched', { from_provider: 'fake', to_provider: 'second', during_session: false });
    expect(trackEvent).not.toHaveBeenCalledWith('settings_modified', expect.anything());
  });

  it('with nothing selected, shows the first offered provider and selects nothing (a load, not a pick)', async () => {
    render(<ProviderPicker providers={[fakeProvider]} auth={noAuth} />);
    await screen.findByTitle('simpleSettings.validate');
    expect(screen.getByLabelText('simpleSettings.provider')).toHaveValue('fake');
    expect(useProviderStore.getState().selected).toBeNull();
    expect(setSetting).not.toHaveBeenCalledWith('settings.common.provider', expect.anything());
  });

  it("reads LocalInference's option under the old enum's spelling", async () => {
    render(<ProviderPicker providers={[localInferenceProvider]} auth={noAuth} />);
    expect(await screen.findByRole('option', { name: 'providers.local_inference.name' })).toBeTruthy();
  });

  it('disables the select and the credential inputs', async () => {
    stored.set('settings.fake.requireKey', true);
    render(<ProviderPicker providers={[fakeProvider]} auth={noAuth} disabled />);
    expect(screen.getByLabelText('simpleSettings.provider')).toBeDisabled();
    expect(await screen.findByLabelText('setup.credentials.apiKey')).toBeDisabled();
  });

  // Review Minor 3: today's ProviderSection.tsx:590-611 had a help tooltip in
  // the heading (same keys and link as its own languages heading's, restored
  // by group check 1's LanguagePairSection); ProviderPicker's had none.
  it('the heading holds a help tooltip trigger (parity with ProviderSection.tsx)', async () => {
    const { container } = render(<ProviderPicker providers={[fakeProvider]} auth={noAuth} />);
    await screen.findByTitle('simpleSettings.validate');
    expect(container.querySelector('h3 .tooltip-trigger')).toBeTruthy();
  });

  it("shows a provider's EngineSummary, with the store's legs and openSlot passed through", async () => {
    const seen: EngineSummaryProps<FakeSettings>[] = [];
    const EngineSummary = (props: EngineSummaryProps<FakeSettings>) => { seen.push(props); return <div data-testid="engine-summary" />; };
    const openSlot = vi.fn();
    useProviderStore.setState({ legs: ['speaker', 'participant'] });
    render(<ProviderPicker providers={[{ ...fakeProvider, EngineSummary }]} auth={noAuth} openSlot={openSlot} />);
    await screen.findByTestId('engine-summary');
    const props = seen[seen.length - 1];
    expect(props?.legs).toEqual(['speaker', 'participant']);
    expect(props?.openSlot).toBe(openSlot);
  });

  it('shows no EngineSummary without openSlot', async () => {
    const EngineSummary = () => <div data-testid="engine-summary" />;
    render(<ProviderPicker providers={[{ ...fakeProvider, EngineSummary }]} auth={noAuth} />);
    await screen.findByTitle('simpleSettings.validate');
    expect(screen.queryByTestId('engine-summary')).toBeNull();
  });

  it('shows no EngineSummary for a provider that offers none', async () => {
    render(<ProviderPicker providers={[fakeProvider]} auth={noAuth} openSlot={vi.fn()} />);
    await screen.findByTitle('simpleSettings.validate');
    expect(screen.queryByTestId('engine-summary')).toBeNull();
  });

  it('shows the readiness reason in words for a local provider, with no Validate button', async () => {
    render(<ProviderPicker providers={[localInferenceProvider]} auth={noAuth} />);
    act(() => {
      useProviderStore.setState((st) => ({
        readiness: { ...st.readiness, localInference: { state: 'not-ready', reason: 'x', code: 'local_models_missing' } },
      }));
    });
    expect(await screen.findByText('notices.local_models_missing')).toHaveClass('validation-message', 'error');
    expect(screen.queryByTitle('simpleSettings.validate')).toBeNull();
  });

  describe('the setup guide link (parity with ProviderSection.tsx)', () => {
    it('shows the link for a provider with guideUrl', async () => {
      const guided = { ...fakeProvider, guideUrl: 'https://example.com/guide' };
      render(<ProviderPicker providers={[guided]} auth={noAuth} />);
      const link = await screen.findByRole('link', { name: /simpleSettings\.setupGuide/ });
      expect(link).toHaveAttribute('href', 'https://example.com/guide');
    });

    it('shows no link for a provider without guideUrl', async () => {
      render(<ProviderPicker providers={[fakeProvider]} auth={noAuth} />);
      await screen.findByTitle('simpleSettings.validate');
      expect(screen.queryByRole('link', { name: /simpleSettings\.setupGuide/ })).toBeNull();
    });

    it('dismissing hides the link and writes the dismissed-tutorials key with the stored spelling', async () => {
      const guided = { ...fakeProvider, guideUrl: 'https://example.com/guide' };
      render(<ProviderPicker providers={[guided]} auth={noAuth} />);
      await screen.findByRole('link', { name: /simpleSettings\.setupGuide/ });
      fireEvent.click(screen.getByTitle('common.dismiss'));
      expect(screen.queryByRole('link', { name: /simpleSettings\.setupGuide/ })).toBeNull();
      expect(JSON.parse(localStorage.getItem('sokuji-dismissed-tutorials') ?? '[]')).toEqual(['fake']);
    });

    it('shows no link for an already-dismissed provider (seeded key)', async () => {
      localStorage.setItem('sokuji-dismissed-tutorials', JSON.stringify(['fake']));
      const guided = { ...fakeProvider, guideUrl: 'https://example.com/guide' };
      render(<ProviderPicker providers={[guided]} auth={noAuth} />);
      await screen.findByTitle('simpleSettings.validate');
      expect(screen.queryByRole('link', { name: /simpleSettings\.setupGuide/ })).toBeNull();
    });

    it("stores LocalInference's dismissal under the old enum's spelling", async () => {
      const guided = { ...localInferenceProvider, guideUrl: 'https://example.com/guide' };
      render(<ProviderPicker providers={[guided]} auth={noAuth} />);
      await screen.findByRole('link', { name: /simpleSettings\.setupGuide/ });
      fireEvent.click(screen.getByTitle('common.dismiss'));
      expect(JSON.parse(localStorage.getItem('sokuji-dismissed-tutorials') ?? '[]')).toEqual(['local_inference']);
    });
  });

  // Today's ProviderSection.tsx keeps its rich option markup (icon, name +
  // engine credit, description) — plan 1e-3b-2 ruling 2's "plain <select>" was
  // reversed by the owner (follow-up B). ProviderSection.select.test.tsx pins
  // the same split on the port's original.
  describe('rich provider options (base-select supported)', () => {
    it('holds the icon, the name, the vendor credit (when the definition has one) and the description', async () => {
      baseSelectSupported.value = true;
      render(<ProviderPicker providers={[localInferenceProvider, fakeProvider]} auth={noAuth} />);
      await screen.findByLabelText('simpleSettings.provider');

      // LocalInference: icon + name + description, no engine credit — it has
      // no `vendor` (no third-party engine to credit).
      const localOption = document.querySelector('.provider-select option[value="localInference"]');
      expect(localOption?.querySelector('.provider-select__icon')?.firstElementChild).not.toBeNull();
      expect(localOption?.querySelector('.provider-select__name')?.textContent).toBe('providers.local_inference.name');
      expect(localOption?.querySelector('.provider-select__description')?.textContent).toBe('providers.local_inference.description');
      expect(localOption?.querySelector('.powered-by')).toBeNull();

      // The fake provider declares vendor: 'Sokuji' — the credit renders
      // beside its name.
      const fakeOption = document.querySelector('.provider-select option[value="fake"]');
      expect(fakeOption?.querySelector('.provider-select__icon')?.firstElementChild).not.toBeNull();
      expect(fakeOption?.querySelector('.powered-by-vendor')?.textContent).toBe('Sokuji');

      // The closed control mirrors the selected option (today's <selectedcontent>).
      expect(document.querySelector('.provider-select selectedcontent')).not.toBeNull();
    });
  });

  describe('plain provider options (base-select unsupported)', () => {
    it('renders text-only options, no child elements — the extension floor (Chrome 116) flattens them', async () => {
      baseSelectSupported.value = false;
      render(<ProviderPicker providers={[localInferenceProvider, fakeProvider]} auth={noAuth} />);
      await screen.findByLabelText('simpleSettings.provider');

      const localOption = document.querySelector('.provider-select option[value="localInference"]');
      expect(localOption?.querySelector('span')).toBeNull();
      expect(localOption?.textContent).toBe('providers.local_inference.name');

      const fakeOption = document.querySelector('.provider-select option[value="fake"]');
      expect(fakeOption?.querySelector('span')).toBeNull();
      expect(fakeOption?.textContent).toBe('providers.fake.name');

      expect(document.querySelector('.provider-select selectedcontent')).toBeNull();
    });
  });
});
