// The native engine's library on Local models and storage (#578): its engine card, then each stage's models under the
// anchors an engine slot's "Browse library…" goes to, fed Local Native's own settings.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StrictMode } from 'react';
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
    // The engine's card owns the `native-engine` target's anchor, where a notice about the engine leads (owner, 2026-11-28).
    expect(seen.engines[0]).toEqual({ isSessionActive: true, anchorId: 'native-engine-section' });
    // Each stage's list owns its anchor (the section is handed the id), so a jump lands on it.
    expect(seen.libraries.map((l) => l.anchorId)).toEqual(['asr', 'translation', 'tts'].map((s) => `native-models-${s}-section`));
    expect(seen.libraries.map((l) => l.stageFilter)).toEqual(['asr', 'translation', 'tts']);
    expect(seen.libraries[0]).toMatchObject({ settings: own, pair: { source: 'en', target: 'ja' }, isSessionActive: true });
    expect(seen.previews.every((p) => p === appVoicePreview)).toBe(true);
  });

  // PR review: translating what another provider hears, its library lists the models for that provider's pair.
  it("lists the models for the pair a session runs: the transcriber's where another provider transcribes", () => {
    useProviderStore.setState({
      stages: { soniox: ['transcription'], local_native: ['translation'] }, intent: { source: 'ko', target: 'en' },
      entries: { soniox: { settings: {}, pair: { source: 'ko', target: 'en' } }, local_native: { settings: own, pair: { source: 'en', target: 'ja' } } } as never,
    });
    render(<NativeModelsGroup locked={false} />);
    expect(seen.libraries[0]).toMatchObject({ pair: { source: 'ko', target: 'en' } });
    useProviderStore.setState({ stages: {} });
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

  // Review on #888: an edit made before Local Native's settings had loaded threw and was lost; letting it wait for the
  // load was worse — it was built from the defaults and, landing, replaced every stored pick. The library takes no edit
  // until they are loaded.
  it('takes no edit until its settings have loaded, then does', async () => {
    let finish!: () => void;
    useProviderStore.setState({ entries: {} } as never);
    load.mockImplementation(() => new Promise<void>((resolve) => {
      finish = () => { useProviderStore.setState({ entries: { local_native: { settings: own, pair: { source: 'en', target: 'ja' } } } } as never); resolve(); };
    }));
    render(<NativeModelsGroup locked={false} />);
    expect(seen.libraries.slice(-3).every((l) => l.isSessionActive === true)).toBe(true);
    await act(async () => { finish(); });
    expect(seen.libraries.slice(-3).every((l) => l.isSessionActive === false)).toBe(true);
    expect(seen.libraries.at(-1)?.settings).toBe(own);
    load.mockReset().mockImplementation(async () => {});
  });

  // Review on #888: a slot's "Browse library…" for the other direction (the participant's, ja→en on an en→ja pair)
  // opened the forward pair's lists. The library shows the direction it was opened for, says so, and goes back.
  it("shows the direction a slot opened it for, says which, and goes back to the session's own", () => {
    useNativeModelStore.getState().setLibraryDirection('ja→en');
    render(<NativeModelsGroup locked={false} />);
    expect(seen.libraries.slice(-3).map((l) => l.direction)).toEqual(['ja→en', 'ja→en', 'ja→en']);
    const note = screen.getByRole('status');
    expect(note.textContent).toMatch(/Japanese → English/);
    // Taken by this visit: the next one opens on the session's own direction.
    expect(useNativeModelStore.getState().libraryDirection).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /English → Japanese/ }));
    expect(seen.libraries.slice(-3).map((l) => l.direction)).toEqual([undefined, undefined, undefined]);
    expect(screen.queryByRole('status')).toBeNull();
  });

  // Sophie on a Mac dev build: the note never showed. The app runs under StrictMode, which mounts, unmounts and mounts
  // again in development; forgetting the direction on unmount forgot it before it was shown.
  it('keeps the direction it was opened for under StrictMode', () => {
    useNativeModelStore.getState().setLibraryDirection('ja→en');
    render(<StrictMode><NativeModelsGroup locked={false} /></StrictMode>);
    expect(seen.libraries.slice(-3).map((l) => l.direction)).toEqual(['ja→en', 'ja→en', 'ja→en']);
    expect(screen.getByRole('status').textContent).toMatch(/Japanese → English/);
  });

  it("shows no note for the session's own direction", () => {
    useNativeModelStore.getState().setLibraryDirection('en→ja');
    render(<NativeModelsGroup locked={false} />);
    expect(seen.libraries.slice(-3).map((l) => l.direction)).toEqual([undefined, undefined, undefined]);
    expect(screen.queryByRole('status')).toBeNull();
    useNativeModelStore.getState().setLibraryDirection(null);
  });
});
