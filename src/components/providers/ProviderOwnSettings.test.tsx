import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

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
import { FAKE_DEFAULTS } from '../../providers/fake/settings';
import type { EngineProps, SettingsProps } from '../../lib/provider/types';
import type { FakeSettings } from '../../providers/fake/settings';
import { useProviderStore } from '../../stores/providerStore';
import { ProviderEngine, ProviderOwnSettings } from './ProviderOwnSettings';

beforeEach(() => {
  stored.clear();
  setSetting.mockClear();
  useProviderStore.setState({ entries: {}, readiness: {}, selected: 'fake', legs: ['speaker'] });
});

describe('ProviderOwnSettings', () => {
  it("mounts the selected provider's Settings with settings, update, disabled and pair", () => {
    useProviderStore.setState({ entries: { fake: { settings: FAKE_DEFAULTS, credentials: {}, pair: { source: 'auto', target: 'en' } } } });
    const seen: SettingsProps<FakeSettings>[] = [];
    const Settings = (props: SettingsProps<FakeSettings>) => { seen.push(props); return <div data-testid="settings-marker" />; };
    render(<ProviderOwnSettings providers={[{ ...fakeProvider, Settings }]} disabled />);
    expect(screen.getByTestId('settings-marker')).toBeTruthy();
    expect(seen[0].settings).toBe(FAKE_DEFAULTS);
    expect(seen[0].disabled).toBe(true);
    expect(seen[0].pair).toEqual({ source: 'auto', target: 'en' });
    expect(typeof seen[0].update).toBe('function');
  });

  it('renders nothing before the entry loads', () => {
    const { container } = render(<ProviderOwnSettings providers={[fakeProvider]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('ProviderEngine', () => {
  it("mounts the provider's Engine with the store's legs, initialSlot and onInitialSlotConsumed", () => {
    useProviderStore.setState({
      entries: { fake: { settings: FAKE_DEFAULTS, credentials: {}, pair: { source: 'auto', target: 'en' } } },
      legs: ['speaker', 'participant'],
    });
    const seen: EngineProps<FakeSettings>[] = [];
    const Engine = (props: EngineProps<FakeSettings>) => { seen.push(props); return <div data-testid="engine-marker" />; };
    const onInitialSlotConsumed = vi.fn();
    const slot = { dir: 'ja→en', stage: 'asr' as const };
    render(<ProviderEngine providers={[{ ...fakeProvider, Engine }]} initialSlot={slot} onInitialSlotConsumed={onInitialSlotConsumed} />);
    expect(screen.getByTestId('engine-marker')).toBeTruthy();
    expect(seen[0].legs).toEqual(['speaker', 'participant']);
    expect(seen[0].initialSlot).toBe(slot);
    expect(seen[0].onInitialSlotConsumed).toBe(onInitialSlotConsumed);
  });

  it('renders nothing when the provider has no Engine', () => {
    useProviderStore.setState({ entries: { fake: { settings: FAKE_DEFAULTS, credentials: {}, pair: { source: 'auto', target: 'en' } } } });
    const { container } = render(<ProviderEngine providers={[fakeProvider]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing before the entry loads', () => {
    const Engine = () => <div data-testid="engine-marker" />;
    const { container } = render(<ProviderEngine providers={[{ ...fakeProvider, Engine }]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
