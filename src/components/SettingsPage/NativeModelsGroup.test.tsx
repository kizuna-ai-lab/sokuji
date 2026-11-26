// The native engine's library on Local models and storage (#578): its engine card, then each stage's models under the
// anchors an engine slot's "Browse library…" goes to, fed Local Native's own settings.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';

const seen = vi.hoisted(() => ({ libraries: [] as Array<Record<string, unknown>>, engines: [] as Array<Record<string, unknown>>, previews: [] as unknown[] }));
const offered = vi.hoisted(() => ({ native: true }));
vi.mock('../../providers/registry', () => ({
  presentProviders: () => (offered.native ? [{ id: 'local_native' }] : []),
}));
vi.mock('../Settings/sections/EngineSection', () => ({
  EngineSection: (props: Record<string, unknown>) => { seen.engines.push(props); return <div data-testid="engine-card" />; },
}));
vi.mock('../Settings/sections/NativeModelManagementSection', async () => {
  const { useContext } = await import('react');
  const { VoicePreviewContext } = await import('../providers/VoicePreviewContext');
  return {
    NativeModelManagementSection: (props: Record<string, unknown>) => {
      seen.libraries.push(props);
      seen.previews.push(useContext(VoicePreviewContext));
      return <div data-testid={`library-${String(props.stageFilter)}`} />;
    },
  };
});

import '../../locales';
import { NativeModelsGroup } from './NativeModelsGroup';
import { useProviderStore } from '../../stores/providerStore';
import { LOCAL_NATIVE_DEFAULTS } from '../../providers/local_native/settings';
import { appVoicePreview } from '../../app/voicePreview';
import { useNativeModelStore } from '../../stores/nativeModelStore';
import { useSettingsStore } from '../../stores/settingsStore';

const load = vi.fn(async () => {});
const ensureCatalog = vi.fn(async () => {});
const own = { selections: { 'en→ja': { asr: 'x' } } } as never;

beforeEach(() => {
  seen.libraries.length = 0; seen.engines.length = 0; seen.previews.length = 0;
  offered.native = true;
  useProviderStore.setState({ entries: { local_native: { settings: own, pair: { source: 'en', target: 'ja' } } } } as never);
  load.mockClear();
  ensureCatalog.mockClear();
  useNativeModelStore.setState({ statuses: {}, bundleStatus: 'absent', ensureCatalog } as never);
  useProviderStore.setState({ load } as never);
});
afterEach(() => cleanup());

describe('NativeModelsGroup', () => {
  it("lists its library by stage under the native anchors, fed its own settings and the app's voice preview", () => {
    render(<NativeModelsGroup locked />);
    expect(screen.getByTestId('engine-card')).toBeTruthy();
    expect(seen.engines[0]).toEqual({ isSessionActive: true });
    // Each stage's list owns its anchor (the section is handed the id), so a jump lands on it.
    expect(seen.libraries.map((l) => l.anchorId)).toEqual(['asr', 'translation', 'tts'].map((s) => `native-models-${s}-section`));
    expect(seen.libraries.map((l) => l.stageFilter)).toEqual(['asr', 'translation', 'tts']);
    expect(seen.libraries[0]).toMatchObject({ settings: own, pair: { source: 'en', target: 'ja' }, isSessionActive: true });
    expect(seen.previews.every((p) => p === appVoicePreview)).toBe(true);
  });

  it('writes a change to Local Native’s own settings', () => {
    render(<NativeModelsGroup locked={false} />);
    const update = vi.spyOn(useProviderStore.getState(), 'updateSettings').mockImplementation(() => {});
    (seen.libraries[0].update as (p: unknown) => void)({ selections: {} });
    expect(update).toHaveBeenCalledWith({ id: 'local_native' }, { selections: {} });
  });

  it('starts from the defaults until the provider has loaded', () => {
    useProviderStore.setState({ entries: {} } as never);
    render(<NativeModelsGroup locked={false} />);
    expect(seen.libraries[0].settings).toBe(LOCAL_NATIVE_DEFAULTS);
    expect(load).toHaveBeenCalledWith({ id: 'local_native' });
  });

  it('renders nothing where Local Native is not offered', () => {
    offered.native = false;
    const { container } = render(<NativeModelsGroup locked={false} />);
    expect(container.innerHTML).toBe('');
  });

  it('says where to choose a model once its download finishes, and changes no configuration itself', () => {
    const navigate = vi.spyOn(useSettingsStore.getState(), 'navigateToSettings').mockImplementation(() => {});
    render(<NativeModelsGroup locked={false} />);
    expect(screen.queryByRole('status')).toBeNull();
    act(() => { useNativeModelStore.setState({ statuses: { m: 'downloading' } } as never); });
    expect(screen.queryByRole('status')).toBeNull();
    act(() => { useNativeModelStore.setState({ statuses: { m: 'ready' } } as never); });
    expect(screen.getByRole('status').textContent).toMatch(/Languages and line-up/);
    fireEvent.click(screen.getByRole('button', { name: 'Choose' }));
    expect(navigate).toHaveBeenCalledWith('lineup');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('status')).toBeNull();
    navigate.mockRestore();
  });

  it('says nothing for a model that was already there', () => {
    render(<NativeModelsGroup locked={false} />);
    act(() => { useNativeModelStore.setState({ statuses: { m: 'ready' } } as never); });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('starts the engine so its models are listed, again once the engine has been installed', () => {
    render(<NativeModelsGroup locked={false} />);
    expect(ensureCatalog).toHaveBeenCalledTimes(1);
    act(() => { useNativeModelStore.setState({ bundleStatus: 'ready' } as never); });
    expect(ensureCatalog).toHaveBeenCalledTimes(2);
  });

  it('does not start the engine where Local Native is not offered', () => {
    offered.native = false;
    render(<NativeModelsGroup locked={false} />);
    expect(ensureCatalog).not.toHaveBeenCalled();
  });

  // Review on #888: an edit made before Local Native's settings had loaded threw (there was no entry to write to) and
  // was lost. It waits for the load and then lands.
  it('keeps an edit made before its settings have loaded: it lands once they are', async () => {
    // As the real store does: no entry, nothing to write to.
    const updateSettings = vi.fn(() => { if (!useProviderStore.getState().entries.local_native) throw new Error('local_native is not loaded'); });
    useProviderStore.setState({ entries: {}, updateSettings } as never);
    // The load is still reading storage when the edit is made.
    let finish!: () => void;
    load.mockImplementation(() => new Promise<void>((resolve) => {
      finish = () => { useProviderStore.setState({ entries: { local_native: { settings: own, pair: { source: 'en', target: 'ja' } } } } as never); resolve(); };
    }));
    render(<NativeModelsGroup locked={false} />);
    const update = seen.libraries[0].update as (patch: Record<string, unknown>) => unknown;
    let edit!: Promise<unknown>;
    expect(() => { edit = Promise.resolve(update({ asrDevice: 'cpu' })); }).not.toThrow();
    expect(updateSettings).not.toHaveBeenCalled();
    await act(async () => { finish(); await edit; });
    expect(updateSettings).toHaveBeenCalledWith({ id: 'local_native' }, { asrDevice: 'cpu' });
    load.mockReset().mockImplementation(async () => {});
  });
});
