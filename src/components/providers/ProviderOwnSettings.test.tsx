import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { resolve } from 'node:path';
import { compile } from 'sass';

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
import { ProviderEngine, ProviderOwnSettings, ProviderTurnDetectionControls } from './ProviderOwnSettings';

type TurnDetectionSlot = NonNullable<(typeof fakeProvider)['TurnDetection']>;

const AUTH = { signedIn: true, userId: 'u1', getToken: async () => 't' };

beforeEach(() => {
  stored.clear();
  setSetting.mockClear();
  useProviderStore.setState({ entries: {}, readiness: {}, models: {}, selected: 'fake', legs: ['speaker'] });
});

describe('ProviderOwnSettings', () => {
  it("mounts the selected provider's Settings with settings, update, disabled and pair", () => {
    useProviderStore.setState({ entries: { fake: { settings: FAKE_DEFAULTS, credentials: {}, pair: { source: 'auto', target: 'en' } } } });
    const seen: SettingsProps<FakeSettings>[] = [];
    const Settings = (props: SettingsProps<FakeSettings>) => { seen.push(props); return <div data-testid="settings-marker" />; };
    render(<ProviderOwnSettings providers={[{ ...fakeProvider, Settings }]} auth={AUTH} disabled />);
    expect(screen.getByTestId('settings-marker')).toBeTruthy();
    expect(seen[0].settings).toBe(FAKE_DEFAULTS);
    expect(seen[0].disabled).toBe(true);
    expect(seen[0].pair).toEqual({ source: 'auto', target: 'en' });
    expect(typeof seen[0].update).toBe('function');
    expect(seen[0].models).toEqual([]);
  });

  it('renders nothing before the entry loads', () => {
    const { container } = render(<ProviderOwnSettings providers={[fakeProvider]} auth={AUTH} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('hands Settings the models and the account: the saved credentials and the sign-in', () => {
    useProviderStore.setState({
      entries: { fake: { settings: FAKE_DEFAULTS, credentials: { apiKey: 'k' }, pair: { source: 'auto', target: 'en' } } },
      models: { fake: [{ id: 'm1' }] },
    });
    const seen: SettingsProps<FakeSettings>[] = [];
    const Settings = (props: SettingsProps<FakeSettings>) => { seen.push(props); return null; };
    render(<ProviderOwnSettings providers={[{ ...fakeProvider, Settings }]} auth={AUTH} />);
    expect(seen[0].models).toEqual([{ id: 'm1' }]);
    expect(seen[0].account).toEqual({ credentials: { apiKey: 'k' }, auth: AUTH });
  });

  it("keeps the account's identity while the credentials and the sign-in stay the same", () => {
    useProviderStore.setState({ entries: { fake: { settings: FAKE_DEFAULTS, credentials: { apiKey: 'k' }, pair: { source: 'auto', target: 'en' } } } });
    const seen: SettingsProps<FakeSettings>[] = [];
    const Settings = (props: SettingsProps<FakeSettings>) => { seen.push(props); return null; };
    const providers = [{ ...fakeProvider, Settings }];
    const { rerender } = render(<ProviderOwnSettings providers={providers} auth={AUTH} />);
    expect(seen[0].account).toBeDefined();
    rerender(<ProviderOwnSettings providers={providers} auth={AUTH} />);
    expect(seen[1].account).toBe(seen[0].account);
  });
});

describe('ProviderTurnDetectionControls', () => {
  const loaded = () => useProviderStore.setState({ entries: { fake: { settings: FAKE_DEFAULTS, credentials: {}, pair: { source: 'auto', target: 'en' } } } });
  const withTurnDetection = (Controls: TurnDetectionSlot['Controls']) => ({ ...fakeProvider, TurnDetection: { Summary: () => null, Controls } });

  it("mounts the provider's TurnDetection Controls in the Speech section's link target, with settings, update, disabled and pair", () => {
    loaded();
    const seen: SettingsProps<FakeSettings>[] = [];
    const Controls = (props: SettingsProps<FakeSettings>) => { seen.push(props); return <div data-testid="controls-marker" />; };
    const { container } = render(<ProviderTurnDetectionControls providers={[withTurnDetection(Controls)]} disabled />);
    const block = container.querySelector('#turn-detection-tuning-section')!;
    expect(block).toHaveClass('turn-detection-tuning-block');
    expect(block.contains(screen.getByTestId('controls-marker'))).toBe(true);
    expect(seen[0].settings).toBe(FAKE_DEFAULTS);
    expect(seen[0].disabled).toBe(true);
    expect(seen[0].pair).toEqual({ source: 'auto', target: 'en' });
    expect(typeof seen[0].update).toBe('function');
  });

  it('renders nothing for a provider without TurnDetection', () => {
    loaded();
    const { container } = render(<ProviderTurnDetectionControls providers={[fakeProvider]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing before the entry loads', () => {
    const { container } = render(<ProviderTurnDetectionControls providers={[withTurnDetection(() => <div data-testid="controls-marker" />)]} />);
    expect(container).toBeEmptyDOMElement();
  });

  // Controls with nothing to tune (LocalInference on a streaming ASR with no
  // worker type) leave the host's wrapper empty. It is the tab's last child
  // then, so the section before it is no longer `:last-child` and would keep
  // its divider at the bottom of the tab: the stylesheet hides the empty
  // wrapper and gives that section the `:last-child` resets. Asserted in two
  // halves, as the Speech section's own empty row is.
  it("Controls that render nothing leave the wrapper empty, and the stylesheet hides it and resets the section before it", () => {
    loaded();
    const { container } = render(<ProviderTurnDetectionControls providers={[withTurnDetection(() => null)]} />);
    expect(container.querySelector('#turn-detection-tuning-section')!.childNodes).toHaveLength(0);

    const { css } = compile(resolve(__dirname, '../Settings/Settings.scss'));
    expect(css).toMatch(/\.turn-detection-tuning-block:empty\s*\{\s*display:\s*none;/);
    expect(css).toMatch(/\.config-section:has\(\+ \.turn-detection-tuning-block:empty\),\s*\.settings-section:has\(\+ \.turn-detection-tuning-block:empty\)\s*\{[^}]*border-bottom:\s*none;[^}]*margin-bottom:\s*0;[^}]*padding-bottom:\s*0;/);
  });

  // A plain wrapper, not a section: `.settings-section.highlight` does not
  // reach it, so it carries the sections' highlight itself.
  it('the wrapper takes the sections\' navigation highlight (compiled Settings.scss)', () => {
    const { css } = compile(resolve(__dirname, '../Settings/Settings.scss'));
    expect(css).toMatch(/\.turn-detection-tuning-block\.highlight\s*\{[^}]*animation:\s*pulse-highlight 2s ease-out;/);
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

describe('the models and the account beyond Settings (choice 4)', () => {
  it('hands the TurnDetection Controls and the Engine the models, and no account', () => {
    useProviderStore.setState({
      entries: { fake: { settings: FAKE_DEFAULTS, credentials: { apiKey: 'k' }, pair: { source: 'auto', target: 'en' } } },
      models: { fake: [{ id: 'm1' }] },
    });
    const controls: SettingsProps<FakeSettings>[] = [];
    const engine: EngineProps<FakeSettings>[] = [];
    const Controls = (props: SettingsProps<FakeSettings>) => { controls.push(props); return null; };
    const Engine = (props: EngineProps<FakeSettings>) => { engine.push(props); return null; };
    const providers = [{ ...fakeProvider, TurnDetection: { Summary: () => null, Controls }, Engine }];
    render(<><ProviderTurnDetectionControls providers={providers} /><ProviderEngine providers={providers} /></>);
    for (const seen of [controls, engine]) {
      expect(seen[0].models).toEqual([{ id: 'm1' }]);
      expect(seen[0].account).toBeUndefined();
    }
  });
});
