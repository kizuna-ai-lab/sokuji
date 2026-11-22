// Edge's voices under the line-up's speech card (mock v18 ②): one voice per direction that speaks, each with a
// preview; the voice is kept per direction in this device's settings, as a session reads it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';

vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: { getSettingsService: () => ({ getSetting: async (_k: string, d: unknown) => d, setSetting: async () => ({ success: true }) }) },
}));
const voice = (ShortName: string, Gender = 'Female') => ({ ShortName, Locale: ShortName.split('-').slice(0, 2).join('-'), Gender, Name: ShortName, FriendlyName: ShortName, SuggestedCodec: '', Status: 'GA', VoiceTag: { ContentCategories: [], VoicePersonalities: [] } });
const list = vi.hoisted(() => ({ voices: [] as unknown[], fail: false }));
vi.mock('../../lib/edge-tts/voiceList', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/edge-tts/voiceList')>()),
  getEdgeTtsVoices: async () => { if (list.fail) throw new Error('offline'); return list.voices; },
}));
const preview = vi.hoisted(() => ({ make: vi.fn(async () => ({ audio: new Float32Array(1), sampleRate: 24000 })), play: vi.fn(async () => {}), stop: vi.fn() }));
vi.mock('../../lib/edge-tts/preview', () => ({ previewEdgeVoice: preview.make }));
// The app's voice-preview route, as the line-up page hands it to every provider's own settings.
const appPreview = vi.hoisted(() => ({ play: vi.fn(async () => {}), stop: vi.fn() }));
vi.mock('../../app/voicePreview', () => ({ appVoicePreview: appPreview }));

import '../../locales';
import { EdgeSettingsView } from './EdgeSettings';
import { edgeProvider } from './provider';
import { EDGE_DEFAULTS, type EdgeSettings } from './settings';
import { useProviderStore } from '../../stores/providerStore';
import { useLineUpStore } from '../../stores/lineUpStore';
import { runsOn } from '../../stores/lineUpStore.testing';
import { ProviderOwnSettings } from '../../components/providers/ProviderOwnSettings';

function given(o: { voices?: Record<string, string>; legs?: string[]; participantSpeech?: boolean } = {}) {
  runsOn('local_inference');
  useProviderStore.setState({
    legs: (o.legs ?? ['speaker', 'participant']) as never,
    speech: { textOnly: false, participantSpeech: o.participantSpeech ?? true },
    entries: {
      local_inference: { settings: {}, credentials: {}, pair: { source: 'ja', target: 'en' } },
      edge: { settings: { ...EDGE_DEFAULTS, voices: o.voices ?? {} }, credentials: {}, pair: { source: 'ja', target: 'en' } },
    } as never,
  });
}
const saved = () => useProviderStore.getState().entries.edge!.settings as EdgeSettings;
/** The card as the host draws it: Edge's entry as the settings, writing back to it. */
function EdgeCard({ disabled = false, participantSpeaks }: { disabled?: boolean; participantSpeaks?: boolean }) {
  const settings = useProviderStore((s) => s.entries.edge?.settings) as EdgeSettings;
  return <EdgeSettingsView settings={settings} update={(patch) => useProviderStore.getState().updateSettings(edgeProvider, patch)} disabled={disabled} participantSpeaks={participantSpeaks} preview={{ play: preview.play, stop: preview.stop }} />;
}

beforeEach(() => {
  list.fail = false;
  list.voices = [voice('en-US-AvaNeural'), voice('en-US-AndrewNeural', 'Male'), voice('ja-JP-NanamiNeural'), voice('ja-JP-KeitaNeural', 'Male')];
  preview.make.mockClear(); preview.play.mockClear(); preview.stop.mockClear();
  appPreview.play.mockClear(); appPreview.stop.mockClear();
  given();
});
afterEach(() => { cleanup(); useLineUpStore.setState({ lineUp: null, stored: false }); });

describe("Edge's settings", () => {
  it('gives each direction that speaks its own voice, from the voices of the language it speaks', async () => {
    given({ voices: { 'ja→en': 'en-US-AndrewNeural', 'en→ja': 'ja-JP-NanamiNeural' } });
    render(<EdgeCard />);
    const theirs = await screen.findByRole('combobox', { name: 'Translation the other side hears (English)' });
    await waitFor(() => expect(within(theirs).getAllByRole('option').map((o) => o.getAttribute('value'))).toEqual(['en-US-AvaNeural', 'en-US-AndrewNeural']));
    expect(theirs).toHaveValue('en-US-AndrewNeural');
    const mine = screen.getByRole('combobox', { name: 'Translation I hear (Japanese)' });
    expect(within(mine).getAllByRole('option').map((o) => o.getAttribute('value'))).toEqual(['ja-JP-NanamiNeural', 'ja-JP-KeitaNeural']);
    expect(mine).toHaveValue('ja-JP-NanamiNeural');
  });

  it('with no voice stored for a direction, shows the first listed voice, previews it, and stores it when chosen', async () => {
    given({ voices: {}, participantSpeech: false });
    render(<EdgeCard />);
    const mine = await screen.findByRole('combobox', { name: 'Translation the other side hears (English)' });
    await waitFor(() => expect(within(mine).getAllByRole('option')).toHaveLength(2));
    expect(mine).toHaveValue('en-US-AvaNeural');
    const button = screen.getByRole('button', { name: /^Preview / });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await waitFor(() => expect(preview.make).toHaveBeenCalledWith('en-US-AvaNeural', 'en', expect.anything()));
    fireEvent.change(mine, { target: { value: 'en-US-AndrewNeural' } });
    fireEvent.change(mine, { target: { value: 'en-US-AvaNeural' } });
    expect(saved().voices['ja→en']).toBe('en-US-AvaNeural');
  });

  it('stores the first listed voice of a direction whose voice is missing or not listed, without any user action, and leaves a valid one', async () => {
    given({ voices: { 'ja→en': 'en-US-ZzzNeural', 'en→ja': 'ja-JP-KeitaNeural' } });
    render(<EdgeCard />);
    await waitFor(() => expect(saved().voices['ja→en']).toBe('en-US-AvaNeural'));
    expect(saved().voices['en→ja']).toBe('ja-JP-KeitaNeural');
  });

  it('stores nothing while the card is disabled', async () => {
    given({ voices: {} });
    render(<EdgeCard disabled />);
    await screen.findByRole('combobox', { name: 'Translation the other side hears (English)' });
    await waitFor(() => expect(within(screen.getByRole('combobox', { name: 'Translation the other side hears (English)' })).getAllByRole('option')).toHaveLength(2));
    expect(saved().voices).toEqual({});
  });

  it("keeps a choice in that direction's voice, the other direction's untouched", async () => {
    given({ voices: { 'en→ja': 'ja-JP-NanamiNeural' } });
    render(<EdgeCard />);
    const theirs = await screen.findByRole('combobox', { name: 'Translation the other side hears (English)' });
    await waitFor(() => expect(within(theirs).getAllByRole('option')).toHaveLength(2));
    fireEvent.change(theirs, { target: { value: 'en-US-AndrewNeural' } });
    expect(saved().voices['ja→en']).toBe('en-US-AndrewNeural');
    expect(saved().voices['en→ja']).toBe('ja-JP-NanamiNeural');
  });

  it('shows only the voice of a direction that speaks', async () => {
    given({ participantSpeech: false });
    render(<EdgeCard />);
    expect(await screen.findByRole('combobox', { name: 'Translation the other side hears (English)' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Translation I hear (Japanese)' })).toBeNull();
  });

  it("prefers the host's participantSpeaks over the store's switch", async () => {
    given({ participantSpeech: true });
    const { unmount } = render(<EdgeCard participantSpeaks={false} />);
    expect(await screen.findByRole('combobox', { name: 'Translation the other side hears (English)' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Translation I hear (Japanese)' })).toBeNull();
    unmount();
    given({ participantSpeech: false });
    render(<EdgeCard participantSpeaks />);
    expect(await screen.findByRole('combobox', { name: 'Translation I hear (Japanese)' })).toBeInTheDocument();
  });

  it('a playback that rejects is no unhandled rejection', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      preview.play.mockRejectedValueOnce(new Error('no audio device'));
      given({ voices: { 'ja→en': 'en-US-AvaNeural' } });
      render(<EdgeCard />);
      const key = screen.getByRole('button', { name: 'Preview Translation the other side hears (English)' });
      await waitFor(() => expect(key).toBeEnabled());
      fireEvent.click(key);
      await waitFor(() => expect(preview.play).toHaveBeenCalled());
      await new Promise((r) => setTimeout(r, 20));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it("plays a voice's sample in the language it speaks", async () => {
    given({ voices: { 'ja→en': 'en-US-AvaNeural' } });
    render(<EdgeCard />);
    const key = screen.getByRole('button', { name: 'Preview Translation the other side hears (English)' });
    await waitFor(() => expect(key).toBeEnabled());
    fireEvent.click(key);
    await waitFor(() => expect(preview.play).toHaveBeenCalled());
    expect(preview.make).toHaveBeenCalledWith('en-US-AvaNeural', 'en', expect.anything());
  });

  it("reading another service's translation: the voices are for the session's pair, kept in this device's settings under that direction", async () => {
    list.voices = [voice('de-DE-KatjaNeural'), voice('de-DE-ConradNeural', 'Male'), voice('en-US-AvaNeural')];
    // Soniox transcribes and translates English into German; this device's own pair is another one.
    useLineUpStore.setState({ lineUp: { transcription: 'soniox', translation: 'soniox', speech: 'edge', summarisation: null }, stored: true });
    useProviderStore.setState((st) => ({ entries: { ...st.entries, soniox: { settings: {}, credentials: {}, pair: { source: 'en', target: 'de' } } } as never }));
    render(<EdgeCard />);
    const theirs = await screen.findByRole('combobox', { name: 'Translation the other side hears (German)' });
    await waitFor(() => expect(within(theirs).getAllByRole('option').map((o) => o.getAttribute('value'))).toEqual(['de-DE-KatjaNeural', 'de-DE-ConradNeural']));
    expect(screen.getByRole('combobox', { name: 'Translation I hear (English)' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Translation the other side hears (English)' })).toBeNull();
    fireEvent.change(theirs, { target: { value: 'de-DE-ConradNeural' } });
    expect(saved().voices['en→de']).toBe('de-DE-ConradNeural');
    expect(useProviderStore.getState().entries.local_inference!.pair).toEqual({ source: 'ja', target: 'en' });
  });

  it("shows no voice until the session's pair is known", () => {
    useLineUpStore.setState({ lineUp: { transcription: 'soniox', translation: 'soniox', speech: 'edge', summarisation: null }, stored: true });
    render(<EdgeCard />);
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
  });

  it('shows the speed, and keeps a change in Edge\'s own settings', () => {
    render(<EdgeCard />);
    const speed = screen.getByRole('slider', { name: 'Speech Speed' });
    expect(speed).toHaveValue('1');
    fireEvent.change(speed, { target: { value: '1.4' } });
    expect(saved().speed).toBe(1.4);
    expect(screen.getByText('1.4x')).toBeInTheDocument();
  });

  it("writes Edge's entry and leaves the local provider's alone", async () => {
    render(<EdgeCard />);
    const theirs = await screen.findByRole('combobox', { name: 'Translation the other side hears (English)' });
    await waitFor(() => expect(within(theirs).getAllByRole('option')).toHaveLength(2));
    fireEvent.change(theirs, { target: { value: 'en-US-AvaNeural' } });
    expect(useProviderStore.getState().entries.local_inference!.settings).toEqual({});
  });

  it('says so when the voices could not be loaded', async () => {
    list.fail = true;
    render(<EdgeCard />);
    const theirs = await screen.findByRole('combobox', { name: 'Translation the other side hears (English)' });
    await waitFor(() => expect(theirs).toBeDisabled());
    expect(within(theirs).getByRole('option')).toHaveTextContent(/Failed to load voices/);
  });

  // The line-up's speech card draws Edge's own settings as it draws every provider's (`ProviderOwnSettings`), handing
  // them the app's preview route: Edge cannot import it (the registry must not reach the plan's stores).
  it("drawn as the line-up's speech card draws a provider's own settings, plays the sample through the app's preview route", async () => {
    given({ voices: { 'ja→en': 'en-US-AvaNeural' } });
    render(<ProviderOwnSettings providers={[edgeProvider]} providerId="edge" auth={{ signedIn: false, getToken: async () => null }} />);
    const key = await screen.findByRole('button', { name: 'Preview Translation the other side hears (English)' });
    await waitFor(() => expect(key).toBeEnabled());
    fireEvent.click(key);
    await waitFor(() => expect(appPreview.play).toHaveBeenCalled());
    expect(preview.make).toHaveBeenCalledWith('en-US-AvaNeural', 'en', expect.anything());
    expect(document.getElementById('edge-voices-section')).not.toBeNull();
  });

  it('is locked during a session', async () => {
    render(<EdgeCard disabled />);
    expect(await screen.findByRole('combobox', { name: 'Translation the other side hears (English)' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Preview Translation the other side hears (English)' })).toBeDisabled();
  });
});
