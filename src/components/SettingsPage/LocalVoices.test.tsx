// The local engine's voices in the line-up's speech card (B-20): out of the old in-panel model library, one voice per
// direction that speaks, from the speech model that direction runs — Supertonic's library (presets and imported
// voices), or the speaker of a model with several; nothing for a model with one voice.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react';

vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: { getSettingsService: () => ({ getSetting: async (_k: string, d: unknown) => d, setSetting: async () => ({ success: true }) }) },
}));
const voices = vi.hoisted(() => ({
  list: [] as Array<{ id: number; engine: 'supertonic-3'; name: string; jsonData: Blob; importedAt: number }>,
  addVoice: vi.fn(async (_engine: string, _name: string, _file: File) => {}),
  renameVoice: vi.fn(async (_id: number, _name: string) => {}),
  deleteVoice: vi.fn(async (_id: number) => {}),
}));
vi.mock('../../lib/local-inference/voiceStorage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/local-inference/voiceStorage')>()),
  listVoices: async () => voices.list,
  addVoice: voices.addVoice,
  renameVoice: voices.renameVoice,
  deleteVoice: voices.deleteVoice,
}));
// Supertonic's library as a list of its voices, the selected one marked: the wiring is what is tested here.
vi.mock('../Settings/sections/VoiceLibrarySection', () => ({
  default: ({ voices: list, selectedId, onSelect, onDelete, isSessionActive }: {
    voices: Array<{ id: string; label: string; removable?: boolean }>; selectedId: string; onSelect: (id: string) => void;
    onDelete: (id: string) => void; isSessionActive?: boolean;
  }) => (
    <div data-testid="voice-library" data-selected={selectedId}>
      {list.map((v) => (
        <span key={v.id}>
          <button type="button" disabled={isSessionActive} onClick={() => onSelect(v.id)}>{v.label}</button>
          {v.removable && <button type="button" onClick={() => onDelete(v.id)}>{`Delete ${v.label}`}</button>}
        </span>
      ))}
    </div>
  ),
}));

import '../../locales';
import { LocalVoices } from './LocalVoices';
import { useProviderStore } from '../../stores/providerStore';
import { useModelStore } from '../../stores/modelStore';
import { LOCAL_INFERENCE_DEFAULTS } from '../../providers/localInference/settings';
import { getManifestEntry } from '../../lib/local-inference/modelManifest';

const SUPERTONIC = 'supertonic-3';
// A speech model with several speakers (904), and one with a single voice.
const MULTI = 'piper-en-libritts_r-medium';
const SINGLE = 'piper-en-amy-low';

function given(o: { tts?: Record<string, string>; voices?: Record<string, { speaker?: number }>; legs?: string[]; participantSpeech?: boolean } = {}) {
  const tts = o.tts ?? { 'ja→en': SUPERTONIC, 'en→ja': SUPERTONIC };
  useProviderStore.setState({
    selected: 'local_inference',
    legs: (o.legs ?? ['speaker', 'participant']) as never,
    speech: { textOnly: false, participantSpeech: o.participantSpeech ?? true },
    entries: { local_inference: { settings: { ...LOCAL_INFERENCE_DEFAULTS, voices: o.voices ?? {} }, credentials: {}, pair: { source: 'ja', target: 'en' } } } as never,
  });
  // What each direction's speech stage resolves to.
  useModelStore.setState({
    resolve: (src: string, tgt: string) => ({ asr: null, translation: null, tts: tts[`${src}→${tgt}`] ? { modelId: tts[`${src}→${tgt}`], source: 'auto' } : null, notes: [], prunes: [] }),
  } as never);
}
const savedVoices = () => (useProviderStore.getState().entries.local_inference!.settings as { voices: Record<string, { speaker?: number }> }).voices;
const presets = getManifestEntry(SUPERTONIC)!.ttsConfig!.presetVoices!;

beforeEach(() => {
  voices.list = [];
  for (const f of [voices.addVoice, voices.renameVoice, voices.deleteVoice]) f.mockClear();
  given();
});
afterEach(() => cleanup());

describe("the local engine's voices", () => {
  it('gives each direction that speaks its own voice, named by who hears it and in which language', () => {
    render(<LocalVoices disabled={false} />);
    expect(screen.getByText('Translation the other side hears (English)')).toBeInTheDocument();
    expect(screen.getByText('Translation I hear (Japanese)')).toBeInTheDocument();
    expect(screen.getAllByTestId('voice-library')).toHaveLength(2);
  });

  it("keeps a choice in that direction's voice, the other direction's untouched", () => {
    given({ voices: { 'en→ja': { speaker: presets[0].sid } } });
    render(<LocalVoices disabled={false} />);
    const [theirs] = screen.getAllByTestId('voice-library');
    fireEvent.click(within(theirs).getByRole('button', { name: presets[1].name }));
    expect(savedVoices()['ja→en']).toEqual({ speaker: presets[1].sid });
    expect(savedVoices()['en→ja']).toEqual({ speaker: presets[0].sid });
  });

  it('marks the voice each direction speaks in now', () => {
    given({ voices: { 'ja→en': { speaker: presets[2].sid } } });
    render(<LocalVoices disabled={false} />);
    expect(screen.getAllByTestId('voice-library')[0]).toHaveAttribute('data-selected', `preset:${presets[2].sid}`);
  });

  it('offers the imported voices beside the presets, and a deleted one leaves the directions that spoke in it', async () => {
    voices.list = [{ id: 7, engine: 'supertonic-3', name: 'My voice', jsonData: new Blob(['{}']), importedAt: 0 }];
    render(<LocalVoices disabled={false} />);
    const [theirs] = await screen.findAllByTestId('voice-library');
    await waitFor(() => expect(within(theirs).getByRole('button', { name: 'My voice' })).toBeInTheDocument());
    fireEvent.click(within(theirs).getByRole('button', { name: 'My voice' }));
    const sid = savedVoices()['ja→en'].speaker!;
    expect(sid).not.toBe(presets[0].sid);
    fireEvent.click(within(theirs).getByRole('button', { name: 'Delete My voice' }));
    await waitFor(() => expect(voices.deleteVoice).toHaveBeenCalledWith(7));
    await waitFor(() => expect(savedVoices()['ja→en']?.speaker).not.toBe(sid));
  });

  // Review (#728): the cleanup reads the settings as they are once the voice is deleted, not as they were before.
  it('keeps a choice made while an imported voice is being deleted', async () => {
    voices.list = [{ id: 7, engine: 'supertonic-3', name: 'My voice', jsonData: new Blob(['{}']), importedAt: 0 }];
    let release!: () => void;
    voices.deleteVoice.mockImplementationOnce(() => new Promise<void>((r) => { release = r; }));
    render(<LocalVoices disabled={false} />);
    const [theirs, mine] = await screen.findAllByTestId('voice-library');
    await waitFor(() => expect(within(theirs).getByRole('button', { name: 'My voice' })).toBeInTheDocument());
    fireEvent.click(within(theirs).getByRole('button', { name: 'My voice' }));
    const sid = savedVoices()['ja→en'].speaker!;
    fireEvent.click(within(theirs).getByRole('button', { name: 'Delete My voice' }));
    await waitFor(() => expect(voices.deleteVoice).toHaveBeenCalledWith(7));
    fireEvent.click(within(mine).getByRole('button', { name: presets[3].name }));
    release();
    await waitFor(() => expect(savedVoices()['ja→en']?.speaker).not.toBe(sid));
    expect(savedVoices()['en→ja']).toEqual({ speaker: presets[3].sid });
  });

  it('shows only the voice of a direction that speaks', () => {
    given({ participantSpeech: false });
    render(<LocalVoices disabled={false} />);
    expect(screen.getByText('Translation the other side hears (English)')).toBeInTheDocument();
    expect(screen.queryByText('Translation I hear (Japanese)')).toBeNull();
  });

  it("chooses the speaker of a model with several, by that direction's number", () => {
    given({ tts: { 'ja→en': MULTI }, participantSpeech: false });
    render(<LocalVoices disabled={false} />);
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '2' } });
    expect(savedVoices()['ja→en']).toEqual({ speaker: 2 });
  });

  it('draws nothing for a model with one voice, nor where no direction speaks a local model', () => {
    given({ tts: { 'ja→en': SINGLE }, participantSpeech: false });
    const { container } = render(<LocalVoices disabled={false} />);
    expect(container).toBeEmptyDOMElement();
    cleanup();
    given({ tts: {} });
    const { container: none } = render(<LocalVoices disabled={false} />);
    expect(none).toBeEmptyDOMElement();
  });

  it('is locked during a session', () => {
    render(<LocalVoices disabled />);
    const [theirs] = screen.getAllByTestId('voice-library');
    expect(within(theirs).getByRole('button', { name: presets[0].name })).toBeDisabled();
  });
});
