import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, cleanup, act, waitFor } from '@testing-library/react';

const env = vi.hoisted(() => ({ electron: true }));
vi.mock('../../utils/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/environment')>()),
  isKizunaAIEnabled: () => true, isElectron: () => env.electron, isExtension: () => !env.electron,
}));
const baseSelect = vi.hoisted(() => ({ rich: false }));
vi.mock('../../utils/supportsBaseSelect', () => ({ supportsBaseSelect: () => baseSelect.rich }));
const languagesProps = vi.hoisted(() => ({ last: null as null | { heading?: boolean; receive?: ReceiveChoices } }));
vi.mock('../providers/ProviderLanguages', () => ({ ProviderLanguages: (props: { heading?: boolean }) => { languagesProps.last = props; return <div id="languages-section" data-heading={String(props.heading)} />; } }));
vi.mock('../Settings/sections/SpeechSection', () => ({ SpeechSection: () => <div id="turn-detection-section" /> }));
vi.mock('./EdgeVoices', () => ({ EdgeVoices: () => <div id="edge-voices-section" /> }));
vi.mock('./LocalVoices', () => ({ LocalVoices: () => <div id="local-voices-section" /> }));
const engineProps = vi.hoisted(() => [] as Array<{ initialSlot?: unknown; onInitialSlotConsumed?: () => void }>);
vi.mock('../providers/ProviderOwnSettings', async () => {
  // The provider's settings say which stage they are drawn for, so a test can tell whose options a fold holds.
  const { useSettingsStage } = await import('../providers/stageParts');
  return {
    ProviderEngine: (props: { initialSlot?: unknown; onInitialSlotConsumed?: () => void }) => { engineProps.push(props); return <div id="model-management-section"><div id="model-tts-section" /></div>; },
    ProviderOwnSettings: () => <div id="provider-own-settings" data-stage={useSettingsStage()?.stage ?? ''} />,
    ProviderTurnDetectionControls: () => <div id="turn-detection-tuning-section" />,
  };
});
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
import type { ReceiveChoices } from '../providers/LanguagePairSection';
import { useWordList } from '../../lib/words/list';
import { useLineUpStore } from '../../stores/lineUpStore';
import { useProviderStore } from '../../stores/providerStore';
import useSettingsStore from '../../stores/settingsStore';
import useAudioStore from '../../stores/audioStore';
import { useRoutingStore } from '../../stores/routingStore';

const soniox = { transcription: 'soniox', translation: 'soniox', speech: 'soniox', summarisation: null };
const optionTexts = (name: string) => within(screen.getByRole('combobox', { name })).getAllByRole('option').map((o) => o.textContent ?? '');

beforeEach(() => {
  languagesProps.last = null;
  env.electron = true;
  authState.signedIn = true;
  notesPricing.value = null;
  noHosted.value = false;
  tracked.length = 0;
  useProviderStore.setState({ selected: 'soniox', selectionLocked: false, entries: {}, readiness: {} });
  useLineUpStore.setState({ lineUp: soniox, stored: true });
  useSettingsStore.setState({ settingsNavigationTarget: null, textOnly: false });
  useAudioStore.setState({ mode: 'speaker' });
  useRoutingStore.setState({ participantSpeech: null });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

// Owner, 2026-11-18 (design 1): the page opens with the translation mode, and a speech stage nothing will be read
// aloud by this time says so instead of offering its models.
describe('the translation mode and the speech stage', () => {
  const local = { transcription: 'local_inference', translation: 'bing', speech: 'local_inference', summarisation: null };
  const speechCard = () => screen.getByRole('combobox', { name: 'Speech' }).closest('.lineup-stage') as HTMLElement;

  it('opens with the translation mode, above the languages', () => {
    render(<LineUpCategory locked={false} />);
    const modes = screen.getByRole('group', { name: 'Translation mode' });
    expect(modes.compareDocumentPosition(document.getElementById('languages-section')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("says speech is not used this time when nothing is read aloud: the Other mode, Translation I hear off", () => {
    useAudioStore.setState({ mode: 'participant' });
    useRoutingStore.setState({ participantSpeech: false });
    useProviderStore.setState({ selected: 'local_inference' });
    useLineUpStore.setState({ lineUp: local, stored: true });
    render(<LineUpCategory locked={false} />);
    const card = speechCard();
    expect(within(card).getByText('Not used this time')).toBeTruthy();
    expect(within(card).queryByText(/options$/)).toBeNull();
    expect(within(card).queryByText('Needs a model')).toBeNull();
    // The choice stays, to be used again once something is read aloud.
    expect((within(card).getByRole('combobox', { name: 'Speech' }) as HTMLSelectElement).value).toBe('local_inference');
  });

  it('keeps speech in use, with its options, while my translation is read to the other side', () => {
    useAudioStore.setState({ mode: 'speaker' });
    useSettingsStore.setState({ textOnly: false });
    useProviderStore.setState({ selected: 'local_inference' });
    useLineUpStore.setState({ lineUp: local, stored: true });
    render(<LineUpCategory locked={false} />);
    const card = speechCard();
    expect(within(card).queryByText('Not used this time')).toBeNull();
    expect(within(card).getByText(/options$/)).toBeTruthy();
  });

  it("says speech is not used this time in the Me mode when the other side reads", () => {
    useAudioStore.setState({ mode: 'speaker' });
    useSettingsStore.setState({ textOnly: true });
    useProviderStore.setState({ selected: 'gemini' });
    useLineUpStore.setState({ lineUp: { transcription: 'gemini', translation: 'gemini', speech: 'gemini', summarisation: null }, stored: true });
    render(<LineUpCategory locked={false} />);
    // One card for the three stages of one connection: only its speech part is not used, the others keep their state.
    expect(screen.getAllByText('Not used this time')).toHaveLength(1);
    const parts = [...document.querySelectorAll('.lineup-stage__part')].map((p) => p.querySelector('.lineup-stage__state')?.textContent);
    expect(parts).toHaveLength(3);
    expect(parts.filter((text) => text !== 'Not used this time')).toHaveLength(2);
    // Review (PR #784): until the sentence's provider has loaded there is no sentence above to point to.
    expect(screen.queryByText('To have it read aloud, choose “hear” in the sentence above.')).toBeNull();
    act(() => useProviderStore.setState({ entries: { gemini: { settings: {}, credentials: {}, pair: { source: 'en', target: 'ja' } } } as never }));
    // Gemini leaves speaking to the switch: the reason is the switch, so the note says how to hear.
    expect(screen.getByText('To have it read aloud, choose “hear” in the sentence above.')).toBeTruthy();
  });

  it("the sentence's words are the audio page's switches: reading turns Translation the other side hears off", async () => {
    useAudioStore.setState({ mode: 'speaker' });
    render(<LineUpCategory locked={false} />);
    const { theirs } = languagesProps.last!.receive!;
    expect(theirs).toMatchObject({ hears: true, blocked: null });
    await act(async () => { theirs!.onChange(false); });
    expect(useSettingsStore.getState().textOnly).toBe(true);
  });

  it('a word that cannot change during a session says why, and the idle speech stage then says no way to hear', () => {
    useAudioStore.setState({ mode: 'participant' });
    render(<LineUpCategory locked />);
    expect(languagesProps.last!.receive!.mine!.blocked).toBe('Fixed for this session; stop it to change.');
    expect(screen.getByText('Not used this time')).toBeTruthy();
    expect(screen.queryByText('To have it read aloud, choose “hear” in the sentence above.')).toBeNull();
    cleanup();
    useAudioStore.setState({ mode: 'both' });
    render(<LineUpCategory locked />);
    expect(languagesProps.last!.receive!.theirs!.blocked).toBe('Fixed for this session; stop it to change.');
  });

  it('Both: speech is used while either running leg is read aloud', () => {
    useAudioStore.setState({ mode: 'both' });
    useSettingsStore.setState({ textOnly: true });
    render(<LineUpCategory locked={false} />);
    expect(screen.getByText('Not used this time')).toBeTruthy();
    cleanup();
    useSettingsStore.setState({ textOnly: false });
    render(<LineUpCategory locked={false} />);
    expect(screen.queryByText('Not used this time')).toBeNull();
    cleanup();
    // Only the other side's leg read aloud (to me): still in use.
    useSettingsStore.setState({ textOnly: true });
    useRoutingStore.setState({ participantSpeech: true });
    render(<LineUpCategory locked={false} />);
    expect(languagesProps.last!.receive!.mine!.hears).toBe(true);
    expect(screen.queryByText('Not used this time')).toBeNull();
    cleanup();
    // Both legs read aloud.
    useSettingsStore.setState({ textOnly: false });
    render(<LineUpCategory locked={false} />);
    expect(screen.queryByText('Not used this time')).toBeNull();
  });

  it("each side's audio-settings link opens that side's switch", () => {
    useAudioStore.setState({ mode: 'both' });
    render(<LineUpCategory locked={false} />);
    act(() => { languagesProps.last!.receive!.onOpenAudio!('theirs'); });
    expect(useSettingsStore.getState().settingsNavigationTarget).toBe('speech-other-hears');
    act(() => { languagesProps.last!.receive!.onOpenAudio!('mine'); });
    expect(useSettingsStore.getState().settingsNavigationTarget).toBe('speech-i-hear');
  });
});

describe('languages and line-up', () => {
  it('lists the providers that can serve each stage, each once, the hosted ones apart', () => {
    useLineUpStore.setState({ lineUp: { transcription: 'local_inference', translation: 'bing', speech: 'edge', summarisation: null }, stored: true });
    render(<LineUpCategory locked={false} />);
    const translation = optionTexts('Translation');
    // Soniox is not chosen here, so it shows what it lacks.
    expect(translation).toEqual(expect.arrayContaining(['KizunaAI (Soniox)', 'KizunaAI (Qwen)', 'Soniox (needs a key)', 'This device', 'Bing']));
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
    fireEvent.change(screen.getByRole('combobox', { name: 'Transcription and translation' }), { target: { value: 'kizunaai_soniox' } });
    await waitFor(() => expect(tracked).toHaveLength(1));
    expect(useLineUpStore.getState().lineUp).toMatchObject({ transcription: 'kizunaai_soniox', translation: 'kizunaai_soniox' });
    expect(screen.getAllByText(/over one connection/).length).toBeGreaterThan(0);
    expect(await screen.findByText(/^Speech moved to KizunaAI/)).toBeInTheDocument();
    expect(screen.queryByText(/translation moved/i)).toBeNull();
  });

  it('locks everything during a session', () => {
    render(<LineUpCategory locked />);
    // Soniox binds transcription and translation: one choice for both.
    for (const name of ['Transcription and translation', 'Speech', 'Notes']) expect(screen.getByRole('combobox', { name })).toBeDisabled();
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

  // B-20: the local engine's voices moved out of its model library into the speech card's own options.
  it("with this device speaking, the speech card holds the local engine's voices under its speech slot", () => {
    useLineUpStore.setState({ lineUp: { transcription: 'local_inference', translation: 'bing', speech: 'local_inference', summarisation: null }, stored: true });
    useProviderStore.setState({ selected: 'local_inference' });
    render(<LineUpCategory locked={false} />);
    expect(document.getElementById('local-voices-section')).toBeNull();
    act(() => { useSettingsStore.getState().navigateToSettings('local-voices'); });
    const card = document.getElementById('local-voices-section')!.closest('.lineup-stage') as HTMLElement;
    expect(within(card).getByRole('combobox', { name: 'Speech' })).toHaveValue('local_inference');
    expect(document.querySelectorAll('#local-voices-section')).toHaveLength(1);
  });

  it("with Edge speaking, the speech card has no local voices", () => {
    useLineUpStore.setState({ lineUp: { transcription: 'local_inference', translation: 'bing', speech: 'edge', summarisation: null }, stored: true });
    useProviderStore.setState({ selected: 'local_inference' });
    render(<LineUpCategory locked={false} />);
    act(() => { useSettingsStore.getState().navigateToSettings('edge-voices'); });
    expect(document.getElementById('local-voices-section')).toBeNull();
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
    // The three stages' cards (the notes card after them has its own state).
    const states = [...document.querySelectorAll('.lineup-stage')].slice(0, 3).map((c) => c.querySelector('.lineup-stage__state')?.textContent);
    expect(states).toEqual(['Needs a model', 'Ready', 'Ready']);
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
    // Transcription and translation share one card (Soniox binds them): the speech card points back to it.
    fireEvent.click(within(card('Speech')).getByRole('button', { name: /Soniox options/ }));
    expect(within(card('Speech')).getByText('The options acting on transcription, translation and speech are in the “Transcription” card.')).toBeInTheDocument();
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
    useLineUpStore.setState({ lineUp: { transcription: 'local_inference', translation: 'bing', speech: 'edge', summarisation: null }, stored: true });
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

  // Owner, 2026-11-17: the stages one provider binds were each outlined apart; they share one frame, each stage named
  // with its state, one choice for them all (Rudolf's details). Stages that merely use the same provider stay apart.
  it('frames the stages one provider binds in one card: each named with its state, one choice for them', () => {
    render(<LineUpCategory locked={false} />);
    const cards = [...document.querySelectorAll('.lineup-stage')];
    expect(cards.map((c) => c.classList.contains('is-joint'))).toEqual([true, false, false]);
    const joint = cards[0];
    expect([...joint.querySelectorAll('.lineup-stage__head .lineup-stage__name')].map((n) => n.textContent)).toEqual(['Transcription', 'Translation']);
    expect(joint.querySelectorAll('.lineup-stage__head .lineup-stage__state')).toHaveLength(2);
    expect(within(joint as HTMLElement).getAllByRole('combobox')).toHaveLength(1);
    expect(within(joint as HTMLElement).getByRole('combobox', { name: 'Transcription and translation' })).toBeInTheDocument();
    expect(within(joint as HTMLElement).getByText('Transcription and translation go over one connection; they change together.')).toBeInTheDocument();
  });

  // Owner, 2026-11-17: one frame and one choice do not merge the stages' options; each stage keeps its own, under its name.
  it('in a joint card each stage keeps its own options, under its own name', () => {
    // Gemini runs all three stages over one connection: one card, a part per stage.
    useLineUpStore.setState({ lineUp: { transcription: 'gemini', translation: 'gemini', speech: 'gemini', summarisation: null }, stored: true });
    render(<LineUpCategory locked={false} />);
    const joint = document.querySelector('.lineup-stage.is-joint') as HTMLElement;
    const parts = [...joint.querySelectorAll<HTMLElement>('.lineup-stage__part')];
    expect(parts.map((p) => p.querySelector('.lineup-stage__name')?.textContent)).toEqual(['Transcription', 'Translation', 'Speech']);
    // Each part: its name and state, then its own options fold.
    for (const part of parts) expect(within(part).getByRole('button', { name: /Gemini options/ })).toHaveAttribute('aria-expanded', 'false');
    // Opening one stage's options opens that stage's alone, drawn for that stage.
    fireEvent.click(within(parts[1]).getByRole('button', { name: /Gemini options/ }));
    expect(within(parts[0]).getByRole('button', { name: /Gemini options/ })).toHaveAttribute('aria-expanded', 'false');
    expect(parts[1].querySelector('#provider-own-settings')).toHaveAttribute('data-stage', 'translation');
    fireEvent.click(within(parts[2]).getByRole('button', { name: /Gemini options/ }));
    expect(parts[2].querySelector('#provider-own-settings')).toHaveAttribute('data-stage', 'speech');
    fireEvent.click(within(parts[0]).getByRole('button', { name: /Gemini options/ }));
    expect(parts[0].querySelector('#provider-own-settings')).toHaveAttribute('data-stage', 'transcription');
    // The options acting on several stages sit under the first of them, in the same frame: no pointer to it.
    expect(joint.querySelector('.lineup-stage__pointer')).toBeNull();
  });

  it('in a joint card a stage with no options of its own has no fold', () => {
    // Soniox binds transcription and translation; every option acting on translation also acts on transcription.
    render(<LineUpCategory locked={false} />);
    const parts = [...document.querySelectorAll<HTMLElement>('.lineup-stage.is-joint .lineup-stage__part')];
    expect(parts.map((p) => p.querySelector('.lineup-stage__name')?.textContent)).toEqual(['Transcription', 'Translation']);
    expect(within(parts[0]).getByRole('button', { name: /Soniox options/ })).toBeInTheDocument();
    expect(within(parts[1]).queryByRole('button', { name: /options/ })).toBeNull();
  });

  it('keeps apart the stages that merely use the same provider', () => {
    useLineUpStore.setState({ lineUp: { transcription: 'local_inference', translation: 'local_inference', speech: 'local_inference', summarisation: null }, stored: true });
    render(<LineUpCategory locked={false} />);
    const cards = [...document.querySelectorAll('.lineup-stage')];
    expect(cards).toHaveLength(4);
    expect(cards.some((c) => c.classList.contains('is-joint'))).toBe(false);
  });
});

// The fourth stage (stage 3, client side): the notes after a session, written with the user's own OpenAI key.
describe('the notes card', () => {
  const openAiKey = () => useProviderStore.setState({ entries: { openai: { settings: {}, credentials: { apiKey: 'sk-test' } } } as never });
  // The key checks the card asks for, answered here and never sent anywhere.
  let checked: string[] = [];
  beforeEach(() => {
    checked = [];
    useProviderStore.setState({ refreshReadiness: (async (p: { id: string }) => { checked.push(p.id); return { state: 'unknown' }; }) as never });
  });

  // The owner, 2026-11-17: OpenAI chosen for the notes said "Key not verified" for ever — only the session's own
  // provider is checked by itself. The card checks the key it shows, once, when nothing has checked it yet.
  it("checks an OpenAI key chosen for the notes, though the session runs on another service", async () => {
    authState.signedIn = false;
    openAiKey();
    render(<LineUpCategory locked={false} />);
    await waitFor(() => expect(checked).toEqual(['openai']));
  });

  const settle = () => new Promise((r) => setTimeout(r, 20));
  it('checks no OpenAI key already checked', async () => {
    authState.signedIn = false;
    openAiKey();
    useProviderStore.setState({ readiness: { openai: { state: 'ready', models: [] } } as never });
    render(<LineUpCategory locked={false} />);
    await settle();
    expect(checked).toEqual([]);
  });

  it('checks no OpenAI key when Kizuna AI writes the notes', async () => {
    authState.signedIn = true;
    openAiKey();
    render(<LineUpCategory locked={false} />);
    await settle();
    expect(checked).toEqual([]);
  });

  // Andrew's review: each condition on its own, the key never checked yet.
  it('checks no OpenAI key during a session, though it was never checked', async () => {
    authState.signedIn = false;
    openAiKey();
    render(<LineUpCategory locked />);
    await settle();
    expect(checked).toEqual([]);
  });

  it('checks nothing when OpenAI is chosen for the notes but has no key', async () => {
    authState.signedIn = false;
    useLineUpStore.setState({ lineUp: { ...soniox, summarisation: 'openai' }, stored: true });
    useProviderStore.setState({ entries: { openai: { settings: {}, credentials: { apiKey: '' } } } as never });
    render(<LineUpCategory locked={false} />);
    await settle();
    expect(checked).toEqual([]);
  });

  // Owner, 2026-11-17: no "None"; the card always names a service, Kizuna AI by default where it is offered.
  it('signed out with no OpenAI key: Kizuna AI by default, waiting for a sign-in, and the card says how to have notes written', () => {
    authState.signedIn = false;
    render(<LineUpCategory locked={false} />);
    expect(optionTexts('Notes')).toEqual(['Kizuna AI']);
    expect(screen.getByRole('combobox', { name: 'Notes' })).toHaveValue('kizunaai_openai');
    const card = screen.getByRole('combobox', { name: 'Notes' }).closest('.lineup-stage') as HTMLElement;
    expect(within(card).getByText('Needs a sign-in')).toBeInTheDocument();
    expect(screen.getByText('Sign in, or add an OpenAI key in Accounts and keys, to have notes written.')).toBeInTheDocument();
  });

  // Owner, 2026-11-18: Kizuna AI's notes are written by OpenAI; its mark reads so, as the other hosted services' do: the
  // Kizuna AI logo with OpenAI's mark as a corner badge.
  it("draws Kizuna AI's notes as Kizuna AI with OpenAI's badge", () => {
    baseSelect.rich = true;
    try {
      useLineUpStore.setState({ lineUp: { ...soniox, summarisation: 'kizunaai_openai' }, stored: true });
      render(<LineUpCategory locked={false} />);
      const card = screen.getByRole('combobox', { name: 'Notes' }).closest('.lineup-stage') as HTMLElement;
      const badge = card.querySelector('.hosted-provider-icon__badge');
      expect(badge).not.toBeNull();
      expect(badge!.querySelector('svg path')?.getAttribute('d')).toMatch(/^M9\.205 8\.658/);
    } finally {
      baseSelect.rich = false;
    }
  });

  // Andrew's review of B-48: Kizuna AI can be the notes' service while signed out; its prices wait for a sign-in.
  it('shows no Kizuna AI prices signed out, though Kizuna AI writes the notes', () => {
    authState.signedIn = false;
    notesPricing.value = { liveUsdPerHour: 0.04, afterSessionUsdPerHour: 0.012 };
    useLineUpStore.setState({ lineUp: { ...soniox, summarisation: 'kizunaai_openai' }, stored: true });
    render(<LineUpCategory locked={false} />);
    expect(screen.getByRole('combobox', { name: 'Notes' })).toHaveValue('kizunaai_openai');
    expect(screen.queryByText(/^Kizuna AI estimates/)).toBeNull();
  });

  it('signed in: offers Kizuna AI with its estimated prices per hour, and a choice sets the notes stage', async () => {
    notesPricing.value = { liveUsdPerHour: 0.04, afterSessionUsdPerHour: 0.012 };
    useLineUpStore.setState({ lineUp: { ...soniox, summarisation: 'openai' }, stored: true });
    render(<LineUpCategory locked={false} />);
    expect(optionTexts('Notes')).toEqual(['Kizuna AI', 'OpenAI']);
    expect(screen.queryByText(/Add an OpenAI key/)).toBeNull();
    // The owner, 2026-11-17: Kizuna AI's prices only where Kizuna AI writes the notes; not under OpenAI's own key.
    const price = 'Kizuna AI estimates: live notes about $0.04 an hour, notes after a session about $0.012 an hour, paid from the balance that pays for your sessions.';
    expect(screen.queryByText(price)).toBeNull();
    fireEvent.change(screen.getByRole('combobox', { name: 'Notes' }), { target: { value: 'kizunaai_openai' } });
    await waitFor(() => expect(useLineUpStore.getState().lineUp).toEqual({ ...soniox, summarisation: 'kizunaai_openai' }));
    expect(await screen.findByText(price)).toBeInTheDocument();
    const card = screen.getByRole('combobox', { name: 'Notes' }).closest('.lineup-stage') as HTMLElement;
    expect(within(card).getByText('Ready')).toBeInTheDocument();
  });

  // The card's state follows the service the notes stage names: OpenAI's key state while OpenAI writes
  // them, Kizuna AI's sign-in once Kizuna AI does, with nothing of OpenAI's key left.
  it("swaps OpenAI's key state for Kizuna AI's sign-in when the notes stage changes to Kizuna AI", async () => {
    openAiKey();
    useProviderStore.setState({ readiness: { openai: { state: 'not-ready', code: 'auth', reason: 'HTTP 401' } } as never });
    useLineUpStore.setState({ lineUp: { ...soniox, summarisation: 'openai' }, stored: true });
    render(<LineUpCategory locked={false} />);
    const card = () => screen.getByRole('combobox', { name: 'Notes' }).closest('.lineup-stage') as HTMLElement;
    expect(within(card()).getByRole('button', { name: 'Key not accepted' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Notes' }), { target: { value: 'kizunaai_openai' } });
    await waitFor(() => expect(within(card()).getByText('Ready')).toBeInTheDocument());
    expect(within(card()).queryByRole('button', { name: /^Key / })).toBeNull();
    expect(within(card()).queryByText(/OpenAI key/)).toBeNull();
  });

  it('keeps showing Kizuna AI while it is chosen, saying it needs a sign-in once signed out', () => {
    authState.signedIn = false;
    useLineUpStore.setState({ lineUp: { ...soniox, summarisation: 'kizunaai_openai' }, stored: true });
    render(<LineUpCategory locked={false} />);
    expect(optionTexts('Notes')).toEqual(['Kizuna AI']);
    const card = screen.getByRole('combobox', { name: 'Notes' }).closest('.lineup-stage') as HTMLElement;
    expect(within(card).getByText('Needs a sign-in')).toBeInTheDocument();
  });

  it('without the hosted services, OpenAI by default, needing a key, and the card says where to add one', () => {
    noHosted.value = true;
    render(<LineUpCategory locked={false} />);
    expect(optionTexts('Notes')).toEqual(['OpenAI']);
    const card = screen.getByRole('combobox', { name: 'Notes' }).closest('.lineup-stage') as HTMLElement;
    expect(within(card).getByText('Needs a key')).toBeInTheDocument();
    expect(screen.getByText('Add an OpenAI key in Accounts and keys to have notes written.')).toBeInTheDocument();
  });

  it('offers OpenAI once it has a key, and a choice sets the notes stage alone', async () => {
    openAiKey();
    render(<LineUpCategory locked={false} />);
    expect(optionTexts('Notes')).toEqual(['Kizuna AI', 'OpenAI']);
    fireEvent.change(screen.getByRole('combobox', { name: 'Notes' }), { target: { value: 'openai' } });
    await waitFor(() => expect(useLineUpStore.getState().lineUp).toEqual({ ...soniox, summarisation: 'openai' }));
    expect(tracked).toContainEqual(['lineup_changed', { stage: 'summarisation', from: null, to: 'openai', moved: [], during_session: false }]);
  });

  // B-11 (the owner, 2026-11-17): Ready means the key works, not only that one is saved. A Soniox key the selected
  // region refuses says so, by region, and takes you to the key.
  it("says a Soniox key the selected region refuses is no working key there, and takes you to the key", () => {
    useProviderStore.setState({
      entries: { soniox: { settings: { region: 'jp' }, credentials: { apiKey: 'sk-us', apiKeyJp: 'sk-wrong' }, pair: { source: 'ja', target: 'en' } } } as never,
      readiness: { soniox: { state: 'not-ready', code: 'auth', reason: 'HTTP 401' } } as never,
    });
    render(<LineUpCategory locked={false} />);
    const card = screen.getByRole('combobox', { name: 'Transcription and translation' }).closest('.lineup-stage') as HTMLElement;
    const state = within(card).getAllByRole('button', { name: 'No working key for 日本 (Japan)' })[0];
    fireEvent.click(state);
    // Owner, 2026-11-17: to that provider's key, not only to the accounts page.
    expect(useSettingsStore.getState().settingsNavigationTarget).toBe('provider:soniox');
  });

  // Rudolf's review of B-11: a saved key is not a working key. Only a check that passed says Ready; a key never
  // checked, or whose check could not reach the service, says it is not verified (a key that passed before for the
  // same region is served from that answer by the store, so it stays Ready).
  it('says Ready only for a key whose check passed', () => {
    const sonioxKey = (readiness: unknown) => useProviderStore.setState({
      entries: { soniox: { settings: { region: 'us' }, credentials: { apiKey: 'sk-us' }, pair: { source: 'ja', target: 'en' } } } as never,
      readiness: (readiness === undefined ? {} : { soniox: readiness }) as never,
    });
    const card = () => screen.getByRole('combobox', { name: 'Transcription and translation' }).closest('.lineup-stage') as HTMLElement;
    sonioxKey({ state: 'ready', models: [] });
    const { unmount } = render(<LineUpCategory locked={false} />);
    expect(within(card()).getAllByText('Ready').length).toBeGreaterThan(0);
    unmount();
    sonioxKey({ state: 'not-ready', code: 'network', reason: 'offline' });
    const second = render(<LineUpCategory locked={false} />);
    expect(within(card()).getAllByRole('button', { name: 'Key not verified' }).length).toBeGreaterThan(0);
    expect(within(card()).queryByText('Ready')).toBeNull();
    second.unmount();
    sonioxKey(undefined);
    const third = render(<LineUpCategory locked={false} />);
    expect(within(card()).getAllByRole('button', { name: 'Key not verified' }).length).toBeGreaterThan(0);
    third.unmount();
    sonioxKey({ state: 'checking' });
    render(<LineUpCategory locked={false} />);
    expect(within(card()).getAllByText('Checking the key…').length).toBeGreaterThan(0);
  });

  it('takes you to the key from "Needs a key"', () => {
    render(<LineUpCategory locked={false} />);
    const needs = screen.getAllByRole('button', { name: 'Needs a key' })[0];
    const card = needs.closest('.lineup-stage') as HTMLElement;
    const chosen = (within(card).getAllByRole('combobox')[0] as HTMLSelectElement).value;
    fireEvent.click(needs);
    expect(useSettingsStore.getState().settingsNavigationTarget).toBe(`provider:${chosen}`);
  });

  // Review: signed out with an OpenAI key, the notes are written with that key; no extra choice is needed. Ready
  // once the key's check has passed (B-11: a saved key is not a working key).
  it('signed out with an OpenAI key and nothing chosen: OpenAI by default, ready', () => {
    authState.signedIn = false;
    openAiKey();
    useProviderStore.setState({ readiness: { openai: { state: 'ready', models: [] } } as never });
    render(<LineUpCategory locked={false} />);
    expect(screen.getByRole('combobox', { name: 'Notes' })).toHaveValue('openai');
    const card = screen.getByRole('combobox', { name: 'Notes' }).closest('.lineup-stage') as HTMLElement;
    expect(within(card).getByText('Ready')).toBeInTheDocument();
  });

  // #728 review: the notes card follows the OpenAI key's check, as the other stages do.
  it('does not call an OpenAI key the service refuses Ready on the notes card, and takes you to the key', () => {
    authState.signedIn = false;
    openAiKey();
    useProviderStore.setState({ readiness: { openai: { state: 'not-ready', code: 'auth', reason: 'HTTP 401' } } as never });
    render(<LineUpCategory locked={false} />);
    const card = screen.getByRole('combobox', { name: 'Notes' }).closest('.lineup-stage') as HTMLElement;
    expect(within(card).queryByText('Ready')).toBeNull();
    fireEvent.click(within(card).getByRole('button', { name: 'Key not accepted' }));
    // Owner, 2026-11-17: to OpenAI's key, whatever provider the session runs on.
    expect(useSettingsStore.getState().settingsNavigationTarget).toBe('provider:openai');
  });

  it('says an OpenAI key not checked yet is not verified on the notes card', () => {
    authState.signedIn = false;
    openAiKey();
    render(<LineUpCategory locked={false} />);
    const card = screen.getByRole('combobox', { name: 'Notes' }).closest('.lineup-stage') as HTMLElement;
    expect(within(card).queryByText('Ready')).toBeNull();
    expect(within(card).getByRole('button', { name: 'Key not verified' })).toBeInTheDocument();
  });

  // Review: a Kizuna AI chosen on purpose is not changed by adding a key; the guidance says to choose OpenAI here too.
  it('with Kizuna AI chosen and signed out, says to sign in or to choose OpenAI here (adding a key first if need be)', () => {
    authState.signedIn = false;
    useLineUpStore.setState({ lineUp: { ...soniox, summarisation: 'kizunaai_openai' }, stored: true });
    const { unmount } = render(<LineUpCategory locked={false} />);
    expect(screen.getByText('Sign in, or add an OpenAI key in Accounts and keys and choose OpenAI here, to have notes written.')).toBeInTheDocument();
    unmount();
    openAiKey();
    render(<LineUpCategory locked={false} />);
    expect(screen.getByText('Sign in, or choose OpenAI here, to have notes written.')).toBeInTheDocument();
  });

  it('keeps showing OpenAI while it is chosen, saying it needs a key once the key is gone', () => {
    useLineUpStore.setState({ lineUp: { ...soniox, summarisation: 'openai' }, stored: true });
    render(<LineUpCategory locked={false} />);
    expect(optionTexts('Notes')).toEqual(['Kizuna AI', 'OpenAI']);
    const card = screen.getByRole('combobox', { name: 'Notes' }).closest('.lineup-stage') as HTMLElement;
    expect(within(card).getByText('Needs a key')).toBeInTheDocument();
  });

  // Owner, 2026-11-17: the notes card's choice is drawn like the other stages' (icon, name, a line under it), its
  // lines about writing notes, not about what the providers do in a session.
  it('draws its choices like the other stages: an icon, the name, a line about writing notes', () => {
    baseSelect.rich = true;
    openAiKey();
    try {
      render(<LineUpCategory locked={false} />);
      const select = screen.getByRole('combobox', { name: 'Notes' });
      expect(select).toHaveClass('provider-select');
      const kizuna = within(select).getByRole('option', { name: /^Kizuna AI/ });
      const openai = within(select).getByRole('option', { name: /^OpenAI/ });
      expect(kizuna.querySelector('.provider-select__icon')).not.toBeNull();
      expect(openai.querySelector('.provider-select__icon')).not.toBeNull();
      expect(kizuna.querySelector('.provider-select__description')).toHaveTextContent('OpenAI writes the notes through Kizuna AI, paid from your balance.');
      expect(openai.querySelector('.provider-select__description')).toHaveTextContent('Writes the notes with your own OpenAI key.');
    } finally {
      baseSelect.rich = false;
    }
  });

  it('is not in the extension', () => {
    env.electron = false;
    render(<LineUpCategory locked={false} />);
    expect(screen.queryByRole('combobox', { name: 'Notes' })).toBeNull();
  });
});
