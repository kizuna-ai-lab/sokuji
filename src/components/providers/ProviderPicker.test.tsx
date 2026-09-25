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
});
