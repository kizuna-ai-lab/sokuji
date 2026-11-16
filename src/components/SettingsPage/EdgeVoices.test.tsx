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
vi.mock('../../app/voicePreview', () => ({ appVoicePreview: { play: preview.play, stop: preview.stop } }));

import '../../locales';
import { EdgeVoices } from './EdgeVoices';
import { useProviderStore } from '../../stores/providerStore';
import { LOCAL_INFERENCE_DEFAULTS } from '../../providers/localInference/settings';

const local = (voices: Record<string, { edge?: string }> = {}) => ({ ...LOCAL_INFERENCE_DEFAULTS, voices });
function given(o: { voices?: Record<string, { edge?: string }>; legs?: string[]; participantSpeech?: boolean } = {}) {
  useProviderStore.setState({
    selected: 'local_inference',
    legs: (o.legs ?? ['speaker', 'participant']) as never,
    speech: { textOnly: false, participantSpeech: o.participantSpeech ?? true },
    entries: { local_inference: { settings: local(o.voices), credentials: {}, pair: { source: 'ja', target: 'en' } } } as never,
  });
}
const savedVoices = () => (useProviderStore.getState().entries.local_inference!.settings as { voices: Record<string, { edge?: string }> }).voices;

beforeEach(() => {
  list.fail = false;
  list.voices = [voice('en-US-AvaNeural'), voice('en-US-AndrewNeural', 'Male'), voice('ja-JP-NanamiNeural'), voice('ja-JP-KeitaNeural', 'Male')];
  preview.make.mockClear(); preview.play.mockClear(); preview.stop.mockClear();
  given();
});
afterEach(() => cleanup());

describe("Edge's voices", () => {
  it('gives each direction that speaks its own voice, from the voices of the language it speaks', async () => {
    given({ voices: { 'ja→en': { edge: 'en-US-AndrewNeural' }, 'en→ja': { edge: 'ja-JP-NanamiNeural' } } });
    render(<EdgeVoices disabled={false} />);
    const theirs = await screen.findByRole('combobox', { name: 'Translation the other side hears (English)' });
    await waitFor(() => expect(within(theirs).getAllByRole('option').map((o) => o.getAttribute('value'))).toEqual(['en-US-AvaNeural', 'en-US-AndrewNeural']));
    expect(theirs).toHaveValue('en-US-AndrewNeural');
    const mine = screen.getByRole('combobox', { name: 'Translation I hear (Japanese)' });
    expect(within(mine).getAllByRole('option').map((o) => o.getAttribute('value'))).toEqual(['ja-JP-NanamiNeural', 'ja-JP-KeitaNeural']);
    expect(mine).toHaveValue('ja-JP-NanamiNeural');
  });

  it("keeps a choice in that direction's voice, the other direction's untouched", async () => {
    given({ voices: { 'en→ja': { edge: 'ja-JP-NanamiNeural' } } });
    render(<EdgeVoices disabled={false} />);
    const theirs = await screen.findByRole('combobox', { name: 'Translation the other side hears (English)' });
    await waitFor(() => expect(within(theirs).getAllByRole('option')).toHaveLength(2));
    fireEvent.change(theirs, { target: { value: 'en-US-AndrewNeural' } });
    expect(savedVoices()['ja→en']).toEqual({ edge: 'en-US-AndrewNeural' });
    expect(savedVoices()['en→ja']).toEqual({ edge: 'ja-JP-NanamiNeural' });
  });

  it('shows only the voice of a direction that speaks', async () => {
    given({ participantSpeech: false });
    render(<EdgeVoices disabled={false} />);
    expect(await screen.findByRole('combobox', { name: 'Translation the other side hears (English)' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Translation I hear (Japanese)' })).toBeNull();
  });

  it("plays a voice's sample in the language it speaks", async () => {
    given({ voices: { 'ja→en': { edge: 'en-US-AvaNeural' } } });
    render(<EdgeVoices disabled={false} />);
    const key = screen.getByRole('button', { name: 'Preview Translation the other side hears (English)' });
    await waitFor(() => expect(key).toBeEnabled());
    fireEvent.click(key);
    await waitFor(() => expect(preview.play).toHaveBeenCalled());
    expect(preview.make).toHaveBeenCalledWith('en-US-AvaNeural', 'en', expect.anything());
  });

  it('says so when the voices could not be loaded', async () => {
    list.fail = true;
    render(<EdgeVoices disabled={false} />);
    const theirs = await screen.findByRole('combobox', { name: 'Translation the other side hears (English)' });
    await waitFor(() => expect(theirs).toBeDisabled());
    expect(within(theirs).getByRole('option')).toHaveTextContent(/Failed to load voices/);
  });

  it('is locked during a session', async () => {
    render(<EdgeVoices disabled />);
    expect(await screen.findByRole('combobox', { name: 'Translation the other side hears (English)' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Preview Translation the other side hears (English)' })).toBeDisabled();
  });
});
