import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, cleanup, act, waitFor } from '@testing-library/react';

const env = vi.hoisted(() => ({ electron: true }));
vi.mock('../../utils/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/environment')>()),
  isKizunaAIEnabled: () => true, isElectron: () => env.electron, isExtension: () => !env.electron,
}));
vi.mock('../../utils/supportsBaseSelect', () => ({ supportsBaseSelect: () => false }));
vi.mock('../providers/ProviderLanguages', () => ({ ProviderLanguages: ({ heading }: { heading?: boolean }) => <div id="languages-section" data-heading={String(heading)} /> }));
vi.mock('../Settings/sections/SpeechSection', () => ({ SpeechSection: () => <div id="turn-detection-section" /> }));
vi.mock('./EdgeVoices', () => ({ EdgeVoices: () => <div id="edge-voices-section" /> }));
const engineProps = vi.hoisted(() => [] as Array<{ initialSlot?: unknown; onInitialSlotConsumed?: () => void }>);
vi.mock('../providers/ProviderOwnSettings', () => ({
  ProviderEngine: (props: { initialSlot?: unknown; onInitialSlotConsumed?: () => void }) => { engineProps.push(props); return <div id="model-management-section"><div id="model-tts-section" /></div>; },
  ProviderOwnSettings: () => <div id="provider-own-settings" />,
  ProviderTurnDetectionControls: () => <div id="turn-detection-tuning-section" />,
}));
// Every released provider offered, and signed in: the list shows what a signed-in user of a release sees.
const noHosted = vi.hoisted(() => ({ value: false }));
vi.mock('../../providers/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../providers/registry')>();
  return { ...actual, presentProviders: () => (noHosted.value ? actual.RELEASED.filter((p) => p.kind !== 'managed') : actual.RELEASED) };
});
const authState = vi.hoisted(() => ({ signedIn: true }));
vi.mock('../providers/useAuthContext', () => ({ useAuthContext: () => ({ signedIn: authState.signedIn, getToken: async () => null }) }));
// The notes' prices per hour, as the backend's pricing table would give them (null: not known).
const notesPricing = vi.hoisted(() => ({ value: null as null | { liveUsdPerHour: number; afterSessionUsdPerHour: number } }));
vi.mock('../../lib/notes/notesPricing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/notes/notesPricing')>()),
  useNotesPricing: () => notesPricing.value,
}));
const tracked = vi.hoisted(() => [] as Array<[string, unknown]>);
vi.mock('../../lib/analytics', () => ({ useAnalytics: () => ({ trackEvent: (name: string, props: unknown) => tracked.push([name, props]) }) }));

import { LineUpCategory, stageInSentence } from './LineUpCategory';
import { useWordList } from '../../lib/words/list';
import { useLineUpStore } from '../../stores/lineUpStore';
import { useProviderStore } from '../../stores/providerStore';
import useSettingsStore from '../../stores/settingsStore';

const soniox = { transcription: 'soniox', translation: 'soniox', speech: 'soniox', summarisation: null };
const optionTexts = (name: string) => within(screen.getByRole('combobox', { name })).getAllByRole('option').map((o) => o.textContent ?? '');

beforeEach(() => {
  env.electron = true;
  authState.signedIn = true;
  notesPricing.value = null;
  noHosted.value = false;
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
    for (const name of ['Transcription', 'Translation', 'Speech', 'Notes']) expect(screen.getByRole('combobox', { name })).toBeDisabled();
  });

  it('a navigation target inside the provider options unfolds them', () => {
    useLineUpStore.setState({ lineUp: { transcription: 'local_inference', translation: 'bing', speech: 'local_inference', summarisation: null }, stored: true });
    useProviderStore.setState({ selected: 'local_inference' });
    render(<LineUpCategory locked={false} />);
    expect(document.getElementById('model-tts-section')).toBeNull();
    act(() => { useSettingsStore.getState().navigateToSettings('model-tts'); });
    expect(document.getElementById('model-tts-section')).not.toBeNull();
  });

  it("with Edge speaking, the speech card holds Edge's voices in place of the engine's speech slot", () => {
    useLineUpStore.setState({ lineUp: { transcription: 'local_inference', translation: 'bing', speech: 'edge', summarisation: null }, stored: true });
    useProviderStore.setState({ selected: 'local_inference' });
    render(<LineUpCategory locked={false} />);
    expect(document.getElementById('edge-voices-section')).toBeNull();
    act(() => { useSettingsStore.getState().navigateToSettings('edge-voices'); });
    const card = document.getElementById('edge-voices-section')!.closest('.lineup-stage') as HTMLElement;
    expect(within(card).getByRole('combobox', { name: 'Speech' })).toHaveValue('edge');
    expect(card.querySelector('#model-management-section')).toBeNull();
    expect(card.querySelector('#provider-own-settings')).not.toBeNull();
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

  it('says on the desktop that Soniox recognition also transcribes imported files and records again', () => {
    env.electron = true;
    useLineUpStore.setState({ lineUp: { transcription: 'soniox', translation: 'soniox', speech: 'soniox', summarisation: null }, stored: true });
    const { unmount } = render(<LineUpCategory locked={false} />);
    expect(screen.getByText('Also transcribes imported files and records again.')).toBeInTheDocument();
    unmount();
    useLineUpStore.setState({ lineUp: { transcription: 'local_inference', translation: 'bing', speech: 'edge', summarisation: null }, stored: true });
    render(<LineUpCategory locked={false} />);
    expect(screen.queryByText('Also transcribes imported files and records again.')).toBeNull();
  });

  it("says on a stage how many word list entries its service leaves out, once per service", () => {
    useWordList.setState({ entries: Array.from({ length: 1005 }, (_, i) => ({ written: `w${i}`, translation: `t${i}` })), background: '', loaded: true });
    useLineUpStore.setState({ lineUp: { transcription: 'qwen_livetranslate', translation: 'qwen_livetranslate', speech: 'qwen_livetranslate', summarisation: null }, stored: true });
    const { unmount } = render(<LineUpCategory locked={false} />);
    expect(screen.getAllByText('Word list: 5 entries over this service’s limit are left out.')).toHaveLength(1);
    unmount();
    useWordList.setState({ entries: [{ written: 'Sokuji' }], background: '', loaded: true });
    render(<LineUpCategory locked={false} />);
    expect(screen.queryByText(/left out/)).toBeNull();
  });

  it('says one entry left out in the singular', () => {
    useWordList.setState({ entries: Array.from({ length: 1001 }, (_, i) => ({ written: `w${i}`, translation: `t${i}` })), background: '', loaded: true });
    useLineUpStore.setState({ lineUp: { transcription: 'qwen_livetranslate', translation: 'qwen_livetranslate', speech: 'qwen_livetranslate', summarisation: null }, stored: true });
    render(<LineUpCategory locked={false} />);
    expect(screen.getByText('Word list: 1 entry over this service’s limit is left out.')).toBeInTheDocument();
  });

  it('says when the chosen Gemini model cannot use the word list, and not when it can or the list is empty', () => {
    useWordList.setState({ entries: [{ written: 'Sokuji' }], background: '', loaded: true });
    useLineUpStore.setState({ lineUp: { transcription: 'gemini', translation: 'gemini', speech: 'gemini', summarisation: null }, stored: true });
    const gemini = (model: string) => useProviderStore.setState({
      entries: { gemini: { settings: { model }, credentials: { apiKey: 'k' }, pair: { source: 'ja', target: 'en' } } } as never,
    });
    gemini('gemini-2.5-flash-native-audio-preview-12-2025');
    const first = render(<LineUpCategory locked={false} />);
    expect(screen.getAllByText('Word list: this model cannot use it.')).toHaveLength(1);
    first.unmount();
    gemini('gemini-3.8-live');
    const second = render(<LineUpCategory locked={false} />);
    expect(screen.queryByText('Word list: this model cannot use it.')).toBeNull();
    second.unmount();
    gemini('gemini-2.5-flash-native-audio-preview-12-2025');
    useWordList.setState({ entries: [], background: '', loaded: true });
    render(<LineUpCategory locked={false} />);
    expect(screen.queryByText('Word list: this model cannot use it.')).toBeNull();
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

// Mock v19 (the owner's call, 2026-11-15): each stage card holds the options of the provider serving it, inside it.
describe('languages and line-up — options inside each stage card', () => {
  const card = (name: string) => screen.getByText(name, { selector: '.lineup-stage__name' }).closest('.lineup-stage') as HTMLElement;

  it("this device, Bing and Edge: each card names its provider's options; Bing has none", () => {
    useLineUpStore.setState({ lineUp: { transcription: 'local_inference', translation: 'bing', speech: 'edge', summarisation: null }, stored: true });
    render(<LineUpCategory locked={false} />);
    expect(within(card('Transcription')).getByRole('button', { name: /This device options/ })).toBeInTheDocument();
    expect(within(card('Translation')).queryByRole('button', { name: /options/ })).toBeNull();
    expect(within(card('Speech')).getByRole('button', { name: /Edge options/ })).toBeInTheDocument();
  });

  it('opens one card without the others', () => {
    useLineUpStore.setState({ lineUp: { transcription: 'local_inference', translation: 'local_inference', speech: 'local_inference', summarisation: null }, stored: true });
    render(<LineUpCategory locked={false} />);
    fireEvent.click(within(card('Speech')).getByRole('button', { name: /options/ }));
    expect(within(card('Speech')).getByRole('button', { name: /options/ })).toHaveAttribute('aria-expanded', 'true');
    expect(within(card('Transcription')).getByRole('button', { name: /options/ })).toHaveAttribute('aria-expanded', 'false');
    expect(within(card('Speech')).queryByText((_, el) => el?.id === 'provider-own-settings')).not.toBeNull();
  });

  it("a later card points back to the first for the options acting on several stages, naming them", () => {
    // Soniox's region acts on all three stages, its session background on transcription and translation.
    render(<LineUpCategory locked={false} />);
    fireEvent.click(within(card('Translation')).getByRole('button', { name: /Soniox options/ }));
    expect(within(card('Translation')).getByText('The options acting on transcription, translation and speech are in the “Transcription” card.')).toBeInTheDocument();
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

// The mock's line-up page (v18): the language pair without its own heading, then the line-up under a plain
// heading with its hint, one card per stage — its name and state on top, the choice under them.
describe('languages and line-up — as the mock draws them', () => {
  it('asks the language pair to leave its heading out', () => {
    render(<LineUpCategory locked={false} />);
    expect(document.getElementById('languages-section')).toHaveAttribute('data-heading', 'false');
  });

  it('heads the line-up with its name and a hint', () => {
    render(<LineUpCategory locked={false} />);
    const heading = screen.getByRole('heading', { name: /Line-up/ });
    expect(heading).toHaveClass('settings-subhead');
    expect(heading).toHaveTextContent('Which service does each stage');
  });

  it('draws each stage as a card: its name and state on one line, the choice under them', () => {
    render(<LineUpCategory locked={false} />);
    const cards = document.querySelectorAll('.lineup-stage');
    // The three a session runs, then the notes (desktop).
    expect(cards).toHaveLength(4);
    const first = cards[0];
    const head = first.querySelector('.lineup-stage__head')!;
    expect(head.querySelector('.lineup-stage__name')).toHaveTextContent('Transcription');
    expect(head.querySelector('.lineup-stage__state')).not.toBeNull();
    expect(head.nextElementSibling?.tagName).toBe('SELECT');
  });

  it('marks the cards one provider serves over one connection', () => {
    render(<LineUpCategory locked={false} />);
    const cards = [...document.querySelectorAll('.lineup-stage')];
    expect(cards.map((c) => c.classList.contains('is-joint'))).toEqual([true, true, false, false]);
  });
});

// The fourth stage (stage 3, client side): the notes after a session, written with the user's own OpenAI key.
describe('the notes card', () => {
  const openAiKey = () => useProviderStore.setState({ entries: { openai: { settings: {}, credentials: { apiKey: 'sk-test' } } } as never });

  it('signed out with no OpenAI key: Kizuna AI waits for a sign-in, and the card says how to have notes written', () => {
    authState.signedIn = false;
    render(<LineUpCategory locked={false} />);
    expect(optionTexts('Notes')).toEqual(['None', 'Kizuna AI (needs a sign-in)']);
    expect(screen.getByRole('option', { name: 'Kizuna AI (needs a sign-in)' })).toBeDisabled();
    expect(screen.getByText('Sign in, or add an OpenAI key in Accounts and keys, to have notes written.')).toBeInTheDocument();
  });

  it('signed in: offers Kizuna AI with its estimated prices per hour, and a choice sets the notes stage', async () => {
    notesPricing.value = { liveUsdPerHour: 0.04, afterSessionUsdPerHour: 0.012 };
    render(<LineUpCategory locked={false} />);
    expect(optionTexts('Notes')).toEqual(['None', 'Kizuna AI']);
    expect(screen.queryByText(/Add an OpenAI key/)).toBeNull();
    expect(screen.getByText('Kizuna AI estimates: live notes about $0.04 an hour, notes after a session about $0.012 an hour, paid from the balance that pays for your sessions.')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Notes' }), { target: { value: 'kizunaai' } });
    await waitFor(() => expect(useLineUpStore.getState().lineUp).toEqual({ ...soniox, summarisation: 'kizunaai' }));
    const card = screen.getByRole('combobox', { name: 'Notes' }).closest('.lineup-stage') as HTMLElement;
    expect(within(card).getByText('Ready')).toBeInTheDocument();
  });

  it('keeps showing Kizuna AI while it is chosen, saying it needs a sign-in once signed out', () => {
    authState.signedIn = false;
    useLineUpStore.setState({ lineUp: { ...soniox, summarisation: 'kizunaai' }, stored: true });
    render(<LineUpCategory locked={false} />);
    expect(optionTexts('Notes')).toEqual(['None', 'Kizuna AI']);
    const card = screen.getByRole('combobox', { name: 'Notes' }).closest('.lineup-stage') as HTMLElement;
    expect(within(card).getByText('Needs a sign-in')).toBeInTheDocument();
  });

  it('without the hosted services, offers only None until OpenAI has a key, and says where to add one', () => {
    noHosted.value = true;
    render(<LineUpCategory locked={false} />);
    expect(optionTexts('Notes')).toEqual(['None']);
    expect(screen.getByText('Add an OpenAI key in Accounts and keys to have notes written.')).toBeInTheDocument();
  });

  it('offers OpenAI once it has a key, and a choice sets the notes stage alone', async () => {
    openAiKey();
    render(<LineUpCategory locked={false} />);
    expect(optionTexts('Notes')).toEqual(['None', 'Kizuna AI', 'OpenAI']);
    fireEvent.change(screen.getByRole('combobox', { name: 'Notes' }), { target: { value: 'openai' } });
    await waitFor(() => expect(useLineUpStore.getState().lineUp).toEqual({ ...soniox, summarisation: 'openai' }));
    expect(tracked).toContainEqual(['lineup_changed', { stage: 'summarisation', from: null, to: 'openai', moved: [], during_session: false }]);
    fireEvent.change(screen.getByRole('combobox', { name: 'Notes' }), { target: { value: '' } });
    await waitFor(() => expect(useLineUpStore.getState().lineUp?.summarisation).toBeNull());
  });

  it('keeps showing OpenAI while it is chosen, saying it needs a key once the key is gone', () => {
    useLineUpStore.setState({ lineUp: { ...soniox, summarisation: 'openai' }, stored: true });
    render(<LineUpCategory locked={false} />);
    expect(optionTexts('Notes')).toEqual(['None', 'Kizuna AI', 'OpenAI']);
    const card = screen.getByRole('combobox', { name: 'Notes' }).closest('.lineup-stage') as HTMLElement;
    expect(within(card).getByText('Needs a key')).toBeInTheDocument();
  });

  it('is not in the extension', () => {
    env.electron = false;
    render(<LineUpCategory locked={false} />);
    expect(screen.queryByRole('combobox', { name: 'Notes' })).toBeNull();
  });
});
