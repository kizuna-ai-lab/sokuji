import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, cleanup, act, waitFor } from '@testing-library/react';

vi.mock('../../utils/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/environment')>()),
  isKizunaAIEnabled: () => true, isElectron: () => true, isExtension: () => false,
}));
vi.mock('../../utils/supportsBaseSelect', () => ({ supportsBaseSelect: () => false }));
vi.mock('../providers/ProviderLanguages', () => ({ ProviderLanguages: () => <div id="languages-section" /> }));
vi.mock('../Settings/sections/SpeechSection', () => ({ SpeechSection: () => <div id="turn-detection-section" /> }));
const engineProps = vi.hoisted(() => [] as Array<{ initialSlot?: unknown; onInitialSlotConsumed?: () => void }>);
vi.mock('../providers/ProviderOwnSettings', () => ({
  ProviderEngine: (props: { initialSlot?: unknown; onInitialSlotConsumed?: () => void }) => { engineProps.push(props); return <div id="model-management-section"><div id="model-tts-section" /></div>; },
  ProviderOwnSettings: () => <div id="provider-own-settings" />,
  ProviderTurnDetectionControls: () => <div id="turn-detection-tuning-section" />,
}));
// Every released provider offered, and signed in: the list shows what a signed-in user of a release sees.
vi.mock('../../providers/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../providers/registry')>();
  return { ...actual, presentProviders: () => actual.RELEASED };
});
vi.mock('../providers/useAuthContext', () => ({ useAuthContext: () => ({ signedIn: true, getToken: async () => null }) }));
const tracked = vi.hoisted(() => [] as Array<[string, unknown]>);
vi.mock('../../lib/analytics', () => ({ useAnalytics: () => ({ trackEvent: (name: string, props: unknown) => tracked.push([name, props]) }) }));

import { LineUpCategory, stageInSentence } from './LineUpCategory';
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

describe('languages and line-up — the way in from a notice', () => {
  it("a 'provider-options' target unfolds the provider's options", () => {
    render(<LineUpCategory locked={false} />);
    expect(document.getElementById('provider-own-settings')).toBeNull();
    act(() => { useSettingsStore.getState().navigateToSettings('provider-options'); });
    expect(document.getElementById('provider-own-settings')).not.toBeNull();
    expect(document.getElementById('provider-options-section')).not.toBeNull();
  });

  it("hands a pending engine slot to the provider's engine, and clears it once the engine has opened it", () => {
    engineProps.length = 0;
    useLineUpStore.setState({ lineUp: { transcription: 'local_inference', translation: 'local_inference', speech: 'local_inference', summarisation: null }, stored: true });
    useProviderStore.setState({ selected: 'local_inference' });
    useSettingsStore.setState({ engineSlotTarget: { dir: 'ja→en', stage: 'tts' } });
    render(<LineUpCategory locked={false} />);
    act(() => { useSettingsStore.getState().navigateToSettings('provider-options'); });
    const props = engineProps[engineProps.length - 1];
    expect(props.initialSlot).toEqual({ dir: 'ja→en', stage: 'tts' });
    act(() => props.onInitialSlotConsumed?.());
    expect(useSettingsStore.getState().engineSlotTarget).toBeNull();
  });

  it('Bing and Edge need no model: their rows read Ready while the local models are missing', () => {
    useLineUpStore.setState({ lineUp: { transcription: 'local_inference', translation: 'bing', speech: 'edge', summarisation: null }, stored: true });
    useProviderStore.setState({ selected: 'local_inference', readiness: { local_inference: { state: 'not-ready' } } as never });
    render(<LineUpCategory locked={false} />);
    expect(screen.getAllByText('Needs a model')).toHaveLength(1);
    expect(screen.getAllByText('Ready')).toHaveLength(2);
  });
});

describe('a stage named inside a sentence', () => {
  it('is lower-cased where the language writes it so, and kept as is in German', () => {
    expect(stageInSentence('Translation', 'en')).toBe('translation');
    expect(stageInSentence('Übersetzung', 'de')).toBe('Übersetzung');
    expect(stageInSentence('Traduction', 'fr')).toBe('traduction');
    expect(stageInSentence('翻译', 'zh_CN')).toBe('翻译');
  });
});

// PR review: the options heading follows the selected provider when it changes on its own.
describe('languages and line-up — the options heading', () => {
  it('follows the selected provider', () => {
    render(<LineUpCategory locked={false} />);
    expect(screen.getByRole('button', { name: /Soniox options/ })).toBeInTheDocument();
    act(() => { useProviderStore.setState({ selected: 'local_inference' }); });
    expect(screen.getByRole('button', { name: /This device options/ })).toBeInTheDocument();
  });
});

// The detailed VAD block of the old Advanced provider tab: in the provider's options, opened by the speech mode's summary link.
describe('languages and line-up — the detailed turn detection', () => {
  it("the summary link's target unfolds the provider's options, where the detailed block is", () => {
    useLineUpStore.setState({ lineUp: { transcription: 'local_inference', translation: 'bing', speech: 'edge', summarisation: null }, stored: true });
    useProviderStore.setState({ selected: 'local_inference' });
    render(<LineUpCategory locked={false} />);
    expect(document.getElementById('turn-detection-tuning-section')).toBeNull();
    act(() => { useSettingsStore.getState().navigateToSettings('turn-detection-tuning'); });
    expect(document.getElementById('turn-detection-tuning-section')).not.toBeNull();
  });
});
