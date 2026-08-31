/**
 * Tests for NativeVoiceSection — the native adapter over the generalized
 * VoiceLibrarySection. It composes a VoiceLibrarySection from `builtinVoices`
 * + the injected `store`'s custom voices, wiring import/record/rename/delete
 * to the store and surfacing capture errors inline. (The old speaker-id
 * slider for a `builtin === 'range'` capability died with the ONNX backends
 * that were its only producers — Task 5's catalog rewire onto native_tts,
 * swept out of this component in Task 7 — R4.)
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

  it('renders nothing when the model has neither built-in nor custom voices', () => {
    const { container } = render(<NativeVoiceSection capability={{ builtin: 'none', custom: 'none' }}
      builtinVoices={[]} store={null} selected="" targetLanguage="en" onSelect={() => {}} onCustomChanged={() => {}} />);
    expect(container).toBeEmptyDOMElement();
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

  it('surfaces a VoiceImportError message from a clip store (shared error type with the WASM lane)', async () => {
    // VoiceImportError itself lives in the shared voiceStorage.ts (the WASM
    // lane's own error type) — NativeVoiceSection imports only the type, not
    // a style-import flow, so any store can in principle throw it. The old
    // style-store producer of this error died in Task 5/6.
    const store = makeClipStore({
      onImport: vi.fn().mockRejectedValue(new VoiceImportError('not_json', 'Not a valid JSON file')),
    });
    const onCustomChanged = vi.fn();
    render(<NativeVoiceSection {...baseProps} store={store} onCustomChanged={onCustomChanged} />);
    await screen.findByText('Ava');
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

  it('keeps the typed transcript after a rejected clip import so the user does not retype it', async () => {
    // Regression test: VoiceLibrarySection only clears the transcript field
    // when the awaited onImport call resolves ("Field cleared after SUCCESS
    // only"). NativeVoiceSection.handleImport must rethrow store failures
    // (not just surface them via captureError) so VoiceLibrarySection's own
    // try/catch sees the rejection and leaves the field untouched.
    const store = makeClipStore({
      onImport: vi.fn().mockRejectedValue(new VoiceCaptureError('too_short', 'Voice clip failed validation: too_short')),
    });
    render(<NativeVoiceSection {...baseProps}
      capability={{ builtin: 'named', custom: 'clip', transcriptRequired: true }}
      store={store} />);
    await screen.findByText('Ava');
    const transcriptInput = screen.getByPlaceholderText(/type exactly what the clip says/i);
    fireEvent.change(transcriptInput, { target: { value: 'hello world' } });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [new File([new Uint8Array(8)], 'voice.wav')] } });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/too short/i));
    expect(transcriptInput).toHaveValue('hello world');
  });

  it('filters custom clips without transcripts for transcriptRequired models', async () => {
    const store = {
      kind: 'clip', capability: { importModes: ['record', 'upload'], curation: false, presentation: 'dropdown' },
      list: async () => [{ id: 1, name: 'WithText', hasTranscript: true }, { id: 2, name: 'NoText', hasTranscript: false }],
      onImport: async () => {}, onRecord: async () => {}, rename: async () => {}, delete: async () => {}, resolveApply: async () => null,
    };
    render(<NativeVoiceSection capability={{ builtin: 'none', custom: 'clip', transcriptRequired: true }}
      builtinVoices={[]} store={store as any} selected="" targetLanguage="en"
      onSelect={() => {}} onCustomChanged={() => {}} />);
    // 'WithText' appears twice in dropdown presentation (the <select> option AND
    // the "manage imported voices" row, same duplication as the 'MyVoice' case
    // above) — any match confirms it's present. 'NoText' must have zero matches.
    expect((await screen.findAllByText('WithText')).length).toBeGreaterThan(0);
    expect(screen.queryByText('NoText')).toBeNull();
  });
});
