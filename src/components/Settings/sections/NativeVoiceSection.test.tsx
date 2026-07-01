/**
 * Tests for NativeVoiceSection — the native adapter over the generalized
 * VoiceLibrarySection. It switches on the selected TTS model's
 * VoiceCapability: `builtin === 'range'` renders the classic speaker-id
 * slider; otherwise it composes a VoiceLibrarySection from `builtinVoices` +
 * the injected `store`'s custom voices, wiring import/record/rename/delete
 * to the store and surfacing capture errors inline.
 *
 * The real VoiceLibrarySection is used (not mocked) so these tests also
 * exercise the capability wiring (dropdown presentation, upload-only vs
 * record+upload) end to end; VoiceLibrarySection's own internals are covered
 * by VoiceLibrarySection.test.tsx.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import NativeVoiceSection, { validateVoiceClip } from './NativeVoiceSection';
import { VoiceCaptureError, type NativeVoiceStore } from '../../../lib/local-inference/native/nativeVoiceStores';
import { VoiceImportError } from '../../../lib/local-inference/voiceStorage';

const builtinVoices = [
  { name: 'Ava', language: 'en', curated: true, unstable: false, default: true },
  { name: 'Bella', language: 'en', curated: true, unstable: false, default: false },
  { name: 'Adam', language: 'en', curated: false, unstable: true, default: false },
];

/** A minimal clip-store double (record + upload, throws VoiceCaptureError on invalid clips). */
function makeClipStore(overrides: Partial<NativeVoiceStore> = {}): NativeVoiceStore {
  return {
    kind: 'clip',
    capability: { importModes: ['record', 'upload'], accept: 'audio/*', curation: false, presentation: 'dropdown' },
    list: vi.fn().mockResolvedValue([]),
    onImport: vi.fn().mockResolvedValue(undefined),
    onRecord: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    resolveApply: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

/** A minimal style-store double (upload only, throws VoiceImportError on invalid files). */
function makeStyleStore(overrides: Partial<NativeVoiceStore> = {}): NativeVoiceStore {
  return {
    kind: 'style',
    capability: { importModes: ['upload'], curation: false, presentation: 'dropdown' },
    list: vi.fn().mockResolvedValue([{ id: 3, name: 'MyVoice' }]),
    onImport: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    resolveApply: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

const baseProps = {
  capability: { builtin: 'named' as const, custom: 'clip' as const },
  builtinVoices,
  selected: 'builtin:Ava',
  targetLanguage: 'en',
  isSessionActive: false,
  onSelect: vi.fn(),
  onCustomChanged: vi.fn(),
};

describe('validateVoiceClip', () => {
  it('rejects too-short, too-long, and silent clips; accepts a valid one', () => {
    expect(validateVoiceClip(new Float32Array(16000).fill(0.3), 16000)).toBe('too_short'); // 1s
    expect(validateVoiceClip(new Float32Array(16000 * 25).fill(0.3), 16000)).toBe('too_long'); // 25s
    expect(validateVoiceClip(new Float32Array(16000 * 5), 16000)).toBe('silent'); // 5s of zeros
    expect(validateVoiceClip(new Float32Array(16000 * 5).fill(0.3), 16000)).toBeNull();
  });
});

describe('NativeVoiceSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('named+style renders presets + custom voices via VoiceLibrarySection', async () => {
    const styleStore = makeStyleStore();
    render(<NativeVoiceSection capability={{ builtin: 'named', custom: 'style' }}
      builtinVoices={[{ name: 'Sarah', curated: true, unstable: false, default: false } as any]}
      store={styleStore} selected="" targetLanguage="en" numSpeakers={10}
      onSelect={() => {}} onCustomChanged={() => {}} />);
    expect(await screen.findByText('Sarah')).toBeInTheDocument();
    // 'MyVoice' appears twice in dropdown presentation (the <select> option AND the
    // "manage imported voices" row) — both are custom-voice presence, so any match suffices.
    expect((await screen.findAllByText('MyVoice')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /record/i })).toBeNull(); // upload-only
  });

  it('range renders the speaker slider', () => {
    render(<NativeVoiceSection capability={{ builtin: 'range', custom: 'none' }} builtinVoices={[]} store={null}
      selected="sid:2" targetLanguage="en" numSpeakers={174} onSelect={() => {}} onCustomChanged={() => {}} />);
    expect(screen.getByRole('slider')).toBeInTheDocument();
  });

  it('renders nothing when the model has neither built-in nor custom voices', () => {
    const { container } = render(<NativeVoiceSection capability={{ builtin: 'none', custom: 'none' }}
      builtinVoices={[]} store={null} selected="" targetLanguage="en" onSelect={() => {}} onCustomChanged={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a speaker-id slider for a range model and writes sid:<n>', () => {
    const onSelect = vi.fn();
    render(<NativeVoiceSection {...baseProps} capability={{ builtin: 'range', custom: 'none' }}
      store={null} numSpeakers={904} selected="sid:3" onSelect={onSelect} builtinVoices={[]} />);
    const slider = screen.getByRole('slider');
    expect(slider).toHaveAttribute('max', '903');
    fireEvent.change(slider, { target: { value: '7' } });
    expect(onSelect).toHaveBeenCalledWith('sid:7');
  });

  it('lists builtin voices and writes ttsVoice on select', async () => {
    const store = makeClipStore();
    const onSelect = vi.fn();
    render(<NativeVoiceSection {...baseProps} store={store} onSelect={onSelect} />);
    expect(await screen.findByText('Ava')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'builtin:Bella' } });
    expect(onSelect).toHaveBeenCalledWith('builtin:Bella');
  });

  it('uses the store capability for the dropdown import affordances (record + upload, audio)', async () => {
    const store = makeClipStore();
    render(<NativeVoiceSection {...baseProps} store={store} />);
    await screen.findByText('Ava');
    expect(screen.getByRole('button', { name: /record voice/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /import voice/i })).toBeInTheDocument();
  });

  it('rejects an invalid clip upload without storing it and surfaces a mapped error', async () => {
    const store = makeClipStore({
      onImport: vi.fn().mockRejectedValue(new VoiceCaptureError('too_short', 'Voice clip failed validation: too_short')),
    });
    const onCustomChanged = vi.fn();
    render(<NativeVoiceSection {...baseProps} store={store} onCustomChanged={onCustomChanged} />);
    await screen.findByText('Ava');
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [new File([new Uint8Array(8)], 'voice.wav')] } });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/too short/i));
    expect(onCustomChanged).not.toHaveBeenCalled();
  });

  it('surfaces the store-provided message when a style import fails validation', async () => {
    const store = makeStyleStore({
      onImport: vi.fn().mockRejectedValue(new VoiceImportError('not_json', 'Not a valid JSON file')),
    });
    const onCustomChanged = vi.fn();
    render(<NativeVoiceSection capability={{ builtin: 'named', custom: 'style' }}
      builtinVoices={[]} store={store} selected="" targetLanguage="en"
      onSelect={() => {}} onCustomChanged={onCustomChanged} />);
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([new Uint8Array(8)], 'voice.json');
    fireEvent.change(fileInput, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Not a valid JSON file'));
    expect(onCustomChanged).not.toHaveBeenCalled();
  });

  it('imports a voice via the clip store and notifies the parent', async () => {
    const store = makeClipStore();
    const onCustomChanged = vi.fn();
    render(<NativeVoiceSection {...baseProps} store={store} onCustomChanged={onCustomChanged} />);
    await screen.findByText('Ava');
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([new Uint8Array(8)], 'voice.wav');
    fireEvent.change(fileInput, { target: { files: [file] } });
    await waitFor(() => expect(store.onImport).toHaveBeenCalledWith(file));
    await waitFor(() => expect(onCustomChanged).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renames and deletes a custom voice through the store', async () => {
    const store = makeClipStore({ list: vi.fn().mockResolvedValue([{ id: 5, name: 'MyClone' }]) });
    render(<NativeVoiceSection {...baseProps} store={store} />);
    await screen.findByText(/manage imported voices/i);
    fireEvent.click(screen.getByRole('button', { name: /^rename$/i }));
    fireEvent.change(screen.getByDisplayValue('MyClone'), { target: { value: 'Renamed' } });
    fireEvent.blur(screen.getByDisplayValue('Renamed'));
    await waitFor(() => expect(store.rename).toHaveBeenCalledWith(5, 'Renamed'));

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    await waitFor(() => expect(store.delete).toHaveBeenCalledWith(5));
  });
});
