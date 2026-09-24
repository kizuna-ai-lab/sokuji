import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { stored, setSetting } = vi.hoisted(() => {
  const stored = new Map<string, unknown>();
  return {
    stored,
    setSetting: vi.fn(async (key: string, value: unknown) => {
      stored.set(key, value);
      return { success: true };
    }),
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
vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return { ...actual, useTranslation: () => ({ t: (key: string) => key }) };
});

import { fakeProvider } from '../../providers/fake/provider';
import type { FakeSettings } from '../../providers/fake/settings';
import type { SettingsProps } from '../../lib/provider/types';
import { useProviderStore } from '../../stores/providerStore';
import { ProviderPanel } from './ProviderPanel';

const noAuth = { signedIn: false, getToken: async () => null };

beforeEach(() => {
  stored.clear();
  setSetting.mockClear();
  useProviderStore.setState({ entries: {}, readiness: {}, selected: null });
});

describe('ProviderPanel', () => {
  it("loads the provider and shows its language pair and its own settings", async () => {
    stored.set('settings.fake.script', 'long');
    render(<ProviderPanel providers={[fakeProvider]} auth={noAuth} />);
    expect(await screen.findByLabelText('Script')).toHaveValue('long');
    expect(screen.getByLabelText('settings.sourceLanguage')).toHaveValue('auto');
    expect(screen.getByLabelText('settings.targetLanguage')).toHaveValue('en');
    expect(screen.getByLabelText('simpleSettings.provider')).toHaveValue('fake');
  });

  it("saves the provider's own settings where they persist today", async () => {
    render(<ProviderPanel providers={[fakeProvider]} auth={noAuth} />);
    fireEvent.click(await screen.findByRole('switch', { name: 'Refuse to build' }));
    await waitFor(() => expect(setSetting).toHaveBeenCalledWith('settings.fake.buildRefused', true));
  });

  it('shows a credential field when the settings ask for one, and saves what is typed', async () => {
    render(<ProviderPanel providers={[fakeProvider]} auth={noAuth} />);
    fireEvent.click(await screen.findByRole('switch', { name: 'Require an API key' }));
    fireEvent.change(await screen.findByLabelText('setup.credentials.apiKey'), { target: { value: 'k1' } });
    await waitFor(() => expect(setSetting).toHaveBeenCalledWith('settings.fake.apiKey', 'k1'));
  });

  it('runs the check and marks the credentials valid', async () => {
    render(<ProviderPanel providers={[fakeProvider]} auth={noAuth} />);
    fireEvent.click(await screen.findByRole('switch', { name: 'Require an API key' }));
    fireEvent.change(await screen.findByLabelText('setup.credentials.apiKey'), { target: { value: 'k1' } });
    fireEvent.click(screen.getByTitle('simpleSettings.validate'));
    await waitFor(() => expect(screen.getByLabelText('setup.credentials.apiKey')).toHaveClass('valid'));
  });

  it("shows the check's reason when the provider is not ready", async () => {
    render(<ProviderPanel providers={[fakeProvider]} auth={noAuth} />);
    fireEvent.click(await screen.findByRole('switch', { name: 'Check reports not ready' }));
    fireEvent.click(screen.getByTitle('simpleSettings.validate'));
    expect(await screen.findByText('The fake reports not ready (fault knob).')).toHaveClass('validation-message', 'error');
  });

  it('saves a new language pair', async () => {
    render(<ProviderPanel providers={[fakeProvider]} auth={noAuth} />);
    fireEvent.change(await screen.findByLabelText('settings.sourceLanguage'), { target: { value: 'ja' } });
    await waitFor(() => expect(setSetting).toHaveBeenCalledWith('settings.fake.sourceLanguage', 'ja'));
  });

  it('draws nothing when no provider is offered', () => {
    const { container } = render(<ProviderPanel providers={[]} auth={noAuth} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the provider the store has chosen, and records a new choice there', async () => {
    const other = { ...fakeProvider, id: 'fake2', settings: { ...fakeProvider.settings, key: 'fake2' } };
    useProviderStore.setState({ selected: 'fake2' });
    render(<ProviderPanel providers={[fakeProvider, other]} auth={noAuth} />);
    expect(await screen.findByLabelText('simpleSettings.provider')).toHaveValue('fake2');
    fireEvent.change(screen.getByLabelText('simpleSettings.provider'), { target: { value: 'fake' } });
    expect(useProviderStore.getState().selected).toBe('fake');
  });

  it('records the provider it shows when the store has none', async () => {
    render(<ProviderPanel providers={[fakeProvider]} auth={noAuth} />);
    await screen.findByLabelText('Script');
    expect(useProviderStore.getState().selected).toBe('fake');
  });

  it('locks every control while disabled', async () => {
    render(<ProviderPanel providers={[fakeProvider]} auth={noAuth} disabled />);
    expect(await screen.findByLabelText('Script')).toBeDisabled();
    expect(screen.getByLabelText('simpleSettings.provider')).toBeDisabled();
    expect(screen.getByLabelText('settings.sourceLanguage')).toBeDisabled();
    expect(screen.getByTitle('simpleSettings.validate')).toBeDisabled();
  });

  it("renders a provider's Engine below its Settings, with the same settings", async () => {
    const Engine = ({ settings }: SettingsProps<FakeSettings>) => (
      <div data-testid="engine-marker">{settings.script}</div>
    );
    const withEngine = { ...fakeProvider, Engine };
    render(<ProviderPanel providers={[withEngine]} auth={noAuth} />);
    const settingsHeading = await screen.findByText('Fake provider');
    const engineMarker = screen.getByTestId('engine-marker');
    expect(engineMarker).toHaveTextContent('exchange');
    // "below": the Engine node comes after the Settings node in document order.
    expect(settingsHeading.compareDocumentPosition(engineMarker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('draws no Engine when the provider offers none', async () => {
    render(<ProviderPanel providers={[fakeProvider]} auth={noAuth} />);
    await screen.findByLabelText('Script');
    expect(screen.queryByTestId('engine-marker')).toBeNull();
  });
});
