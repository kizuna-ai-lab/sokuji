import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, cleanup, act, waitFor } from '@testing-library/react';

vi.mock('../../utils/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/environment')>()),
  isKizunaAIEnabled: () => true, isElectron: () => true, isExtension: () => false,
}));
vi.mock('../../utils/supportsBaseSelect', () => ({ supportsBaseSelect: () => false }));
vi.mock('../providers/ProviderLanguages', () => ({ ProviderLanguages: () => <div id="languages-section" /> }));
vi.mock('../Settings/sections/SpeechSection', () => ({ SpeechSection: () => <div id="turn-detection-section" /> }));
vi.mock('../providers/ProviderOwnSettings', () => ({
  ProviderEngine: () => <div id="model-management-section"><div id="model-tts-section" /></div>,
  ProviderOwnSettings: () => <div id="provider-own-settings" />,
  ProviderTurnDetectionControls: () => null,
}));
// Every released provider offered, and signed in: the list shows what a signed-in user of a release sees.
vi.mock('../../providers/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../providers/registry')>();
  return { ...actual, presentProviders: () => actual.RELEASED };
});
vi.mock('../providers/useAuthContext', () => ({ useAuthContext: () => ({ signedIn: true, getToken: async () => null }) }));
const tracked = vi.hoisted(() => [] as Array<[string, unknown]>);
vi.mock('../../lib/analytics', () => ({ useAnalytics: () => ({ trackEvent: (name: string, props: unknown) => tracked.push([name, props]) }) }));

import { LineUpCategory } from './LineUpCategory';
import { useLineUpStore } from '../../stores/lineUpStore';
import { useProviderStore } from '../../stores/providerStore';
import useSettingsStore from '../../stores/settingsStore';

const soniox = { transcription: 'soniox', translation: 'soniox', speech: 'soniox', summarisation: null };
const optionTexts = (name: string) => within(screen.getByRole('combobox', { name })).getAllByRole('option').map((o) => o.textContent ?? '');

beforeEach(() => {
  tracked.length = 0;
  useProviderStore.setState({ selected: 'soniox', selectionLocked: false, entries: {}, readiness: {} });
  useLineUpStore.setState({ lineUp: soniox, stored: true });
  useSettingsStore.setState({ settingsNavigationTarget: null });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('languages and line-up', () => {
  it('lists the providers that can serve each stage, each once, the hosted ones apart', () => {
    render(<LineUpCategory locked={false} />);
    const translation = optionTexts('Translation');
    expect(translation).toEqual(expect.arrayContaining(['KizunaAI (Soniox)', 'KizunaAI (Qwen)', 'Soniox', 'This device', 'Bing']));
    expect(translation.filter((t) => t.startsWith('KizunaAI (Soniox)'))).toHaveLength(1);
    expect(translation.some((t) => t.startsWith('OpenAI Realtime') && t.includes('needs a key'))).toBe(true);
    const speech = optionTexts('Speech');
    expect(speech).toContain('Edge');
    expect(speech).not.toContain('Bing');
  });

  it('a choice goes through the line-up store and says what moved with it', async () => {
    render(<LineUpCategory locked={false} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Speech' }), { target: { value: 'edge' } });
    expect(useLineUpStore.getState().lineUp).toMatchObject({ transcription: 'local_inference', translation: 'bing', speech: 'edge' });
    expect(await screen.findByText(/Transcription and translation moved/)).toBeInTheDocument();
    expect(tracked).toContainEqual(['lineup_changed', { stage: 'speech', from: 'soniox', to: 'edge', moved: ['transcription', 'translation'], during_session: false }]);
  });

  it('a provider that binds two stages takes both: the joint line says so, the moved line names only the rest', async () => {
    render(<LineUpCategory locked={false} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Transcription' }), { target: { value: 'kizunaai_soniox' } });
    await waitFor(() => expect(tracked).toHaveLength(1));
    expect(useLineUpStore.getState().lineUp).toMatchObject({ transcription: 'kizunaai_soniox', translation: 'kizunaai_soniox' });
    expect(screen.getAllByText(/Goes with translation over one connection/).length).toBeGreaterThan(0);
    expect(await screen.findByText(/^Speech moved to KizunaAI/)).toBeInTheDocument();
    expect(screen.queryByText(/translation moved/i)).toBeNull();
  });

  it('locks everything during a session', () => {
    render(<LineUpCategory locked />);
    for (const name of ['Transcription', 'Translation', 'Speech']) expect(screen.getByRole('combobox', { name })).toBeDisabled();
  });

  it('a navigation target inside the provider options unfolds them', () => {
    useLineUpStore.setState({ lineUp: { transcription: 'local_inference', translation: 'bing', speech: 'edge', summarisation: null }, stored: true });
    useProviderStore.setState({ selected: 'local_inference' });
    render(<LineUpCategory locked={false} />);
    expect(document.getElementById('model-tts-section')).toBeNull();
    act(() => { useSettingsStore.getState().navigateToSettings('model-tts'); });
    expect(document.getElementById('model-tts-section')).not.toBeNull();
  });

  it('says so when Granite Speech turns speech straight into the translation', () => {
    useLineUpStore.setState({ lineUp: { transcription: 'local_inference', translation: 'local_inference', speech: 'edge', summarisation: null }, stored: true });
    useProviderStore.setState({
      selected: 'local_inference',
      entries: { local_inference: { settings: { selections: { 'ja→en': { asr: { modelId: 'granite-speech' }, translation: { modelId: 'granite-speech' }, tts: { modelId: '' } } } }, credentials: {}, pair: { source: 'ja', target: 'en' } } } as never,
    });
    render(<LineUpCategory locked={false} />);
    expect(screen.getByText(/Granite Speech turns speech straight into the translation/)).toBeInTheDocument();
  });

  it('says on each row whether the stage is ready or what it lacks', () => {
    useProviderStore.setState({ entries: { soniox: { settings: { region: 'us' }, credentials: { apiKey: '' }, pair: { source: 'ja', target: 'en' } } } as never });
    render(<LineUpCategory locked={false} />);
    expect(screen.getAllByText('Needs a key')).toHaveLength(3);
  });
});

