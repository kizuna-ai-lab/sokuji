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
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import NativeVoiceSection, { validateVoiceClip } from './NativeVoiceSection';
import { VoiceCaptureError, type NativeVoiceStore } from '../../../lib/local-inference/native/nativeVoiceStores';
import { VoiceImportError } from '../../../lib/local-inference/voiceStorage';
import { createPreviewTts } from '../../../lib/local-inference/native/nativePreviewTts';
import { clearPreviewCache } from '../../../lib/tts/previewCache';
import { PREVIEW_SAMPLES } from '../../../lib/tts/previewSample';

// The native preview synthesis path (Task 6) is exercised on its own
// (nativePreviewTts.test.ts, at the method level against a fake
// NativeTtsClient). Here it's a seam: NativeVoiceSection.handlePreview only
// ever calls createPreviewTts() once and drives the returned handle, so
// mocking the whole module is the established way to observe that without
// standing up a fake sidecar connection (mirrors nativeModelStore's own
// "thin wrappers... so the renderer can mock it in tests" precedent).
vi.mock('../../../lib/local-inference/native/nativePreviewTts', () => ({
  createPreviewTts: vi.fn(),
}));

const builtinVoices = [
  { name: 'Ava', language: 'en', curated: true, unstable: false, default: true },
  { name: 'Bella', language: 'en', curated: true, unstable: false, default: false },
  { name: 'Adam', language: 'en', curated: false, unstable: true, default: false },
];

/** A minimal clip-store double (record + upload, throws VoiceCaptureError on invalid clips). */
function makeClipStore(overrides: Partial<NativeVoiceStore> = {}): NativeVoiceStore {
  return {
    kind: 'clip',
    capability: { importModes: ['record', 'upload'], accept: 'audio/*' },
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
  ttsModelId: 'moss_tts_nano',
  ttsLanguages: ['en'],
};

/** A clip store with one eligible custom voice ("MyClone", id 1) whose
 *  resolveApply resolves a playable reference clip. */
function storeWithClip(overrides: Partial<NativeVoiceStore> = {}): NativeVoiceStore {
  return makeClipStore({
    list: vi.fn().mockResolvedValue([{ id: 1, name: 'MyClone' }]),
    resolveApply: vi.fn().mockResolvedValue({
      kind: 'clip', audio: new Float32Array([0.5, 0.6]), sampleRate: 16000, transcript: 'hi',
    }),
    ...overrides,
  });
}

/** Shared Web Audio stub — jsdom has no Web Audio API. Mirrors
 *  VoiceLibrarySection.test.tsx's own stubWebAudio, plus a `playedAudio()`
 *  accessor (not a shared helper anywhere in the codebase) so a test can
 *  assert on the actual samples handed to copyToChannel — the only way to
 *  tell "played the synthesis" apart from "played the clip" from outside. */
function stubWebAudio() {
  const mockSource: any = { connect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null, buffer: null };
  let copied: Float32Array | null = null;
  const mockCtx: any = {
    state: 'running',
    resume: vi.fn().mockResolvedValue(undefined),
    destination: {},
    createBuffer: vi.fn(() => ({
      copyToChannel: vi.fn((data: Float32Array) => { copied = new Float32Array(data); }),
    })),
    createBufferSource: vi.fn(() => mockSource),
    close: vi.fn().mockResolvedValue(undefined),
  };
  (window as any).AudioContext = function AudioContext() { return mockCtx; };
  return { mockCtx, mockSource, playedAudio: () => copied };
}

// Opens the picker popover — the trigger is the one button with
// aria-expanded="false" before it opens (mirrors SonioxVoiceSection.test.tsx
// and VoiceLibrarySection.test.tsx's own openPicker helper).
const openPicker = () => fireEvent.click(screen.getByRole('button', { expanded: false }));

// Scopes a query to the grid: the picker's own TRIGGER button's accessible
// name is the concatenation of its value span and its subtitle span (e.g.
// "Ava en"), so an unscoped query meant for a row can match the trigger too.
const inGrid = () => within(screen.getByRole('grid'));

// Finds a voice row by its own picker button's `aria-label` (the row's
// accessible NAME, not the gridcell wrapper's computed accessible name,
// which concatenates the label with the row's subtitle — see the "Three
// query traps" note this task's brief carries) and scopes further queries
// (▶, Rename, Delete) to it. Essential once a row's own name is not unique
// among BUTTON roles across the grid (e.g. every builtin preset is also
// previewable, so an unscoped "Play" query matches several rows at once).
const rowFor = (label: string | RegExp): HTMLElement =>
  inGrid().getByRole('button', { name: label }).closest('[role="row"]') as HTMLElement;

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
    // The preview cache (src/lib/tts/previewCache.ts) is a module-level
    // singleton so a synthesized preview survives a panel close/reopen --
    // several tests below preview the same (modelId, voice id, language,
    // speed) tuple, so a stale entry from an earlier test would otherwise
    // short-circuit the next one before it ever calls synthesize().
    clearPreviewCache();
  });

  it('renders nothing when the model has neither built-in nor custom voices', () => {
    const { container } = render(<NativeVoiceSection capability={{ builtin: 'none', custom: 'none' }}
      builtinVoices={[]} store={null} selected="" targetLanguage="en" onSelect={() => {}} onCustomChanged={() => {}}
      ttsModelId="m" ttsLanguages={['en']} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('lists builtin voices and writes ttsVoice on select', async () => {
    const store = makeClipStore();
    const onSelect = vi.fn();
    render(<NativeVoiceSection {...baseProps} store={store} onSelect={onSelect} />);
    openPicker();
    fireEvent.click(await inGrid().findByRole('button', { name: 'Bella' }));
    expect(onSelect).toHaveBeenCalledWith('builtin:Bella');
  });

  it('uses the store capability for the dropdown import affordances (record + upload, audio)', async () => {
    const store = makeClipStore();
    render(<NativeVoiceSection {...baseProps} store={store} />);
    openPicker();
    fireEvent.click(await inGrid().findByRole('button', { name: /add a voice/i }));
    expect(screen.getByRole('button', { name: /record voice/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /import voice/i })).toBeInTheDocument();
  });

  it('rejects an invalid clip upload without storing it and surfaces a mapped error', async () => {
    const store = makeClipStore({
      onImport: vi.fn().mockRejectedValue(new VoiceCaptureError('too_short', 'Voice clip failed validation: too_short')),
    });
    const onCustomChanged = vi.fn();
    render(<NativeVoiceSection {...baseProps} store={store} onCustomChanged={onCustomChanged} />);
    openPicker();
    fireEvent.click(await inGrid().findByRole('button', { name: /add a voice/i }));
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
    openPicker();
    fireEvent.click(await inGrid().findByRole('button', { name: /add a voice/i }));
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
    openPicker();
    fireEvent.click(await inGrid().findByRole('button', { name: /add a voice/i }));
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
    openPicker();
    await inGrid().findByRole('button', { name: 'MyClone' });
    fireEvent.click(inGrid().getByRole('button', { name: /^rename$/i }));
    fireEvent.change(screen.getByDisplayValue('MyClone'), { target: { value: 'Renamed' } });
    fireEvent.blur(screen.getByDisplayValue('Renamed'));
    await waitFor(() => expect(store.rename).toHaveBeenCalledWith(5, 'Renamed'));

    fireEvent.click(inGrid().getByRole('button', { name: /^delete$/i }));
    const dialog = screen.getByRole('dialog', { name: /delete voice/i });
    fireEvent.click(within(dialog).getByRole('button', { name: /^delete$/i }));
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
    openPicker();
    fireEvent.click(await inGrid().findByRole('button', { name: /add a voice/i }));
    const transcriptInput = screen.getByPlaceholderText(/type exactly what the clip says/i);
    fireEvent.change(transcriptInput, { target: { value: 'hello world' } });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [new File([new Uint8Array(8)], 'voice.wav')] } });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/too short/i));
    expect(transcriptInput).toHaveValue('hello world');
  });

  it('filters custom clips without transcripts for transcriptRequired models', async () => {
    const store = {
      kind: 'clip', capability: { importModes: ['record', 'upload'] },
      list: async () => [{ id: 1, name: 'WithText', hasTranscript: true }, { id: 2, name: 'NoText', hasTranscript: false }],
      onImport: async () => {}, onRecord: async () => {}, rename: async () => {}, delete: async () => {}, resolveApply: async () => null,
    };
    render(<NativeVoiceSection capability={{ builtin: 'none', custom: 'clip', transcriptRequired: true }}
      builtinVoices={[]} store={store as any} selected="" targetLanguage="en"
      onSelect={() => {}} onCustomChanged={() => {}} ttsModelId="m" ttsLanguages={['en']} />);
    openPicker();
    expect(await inGrid().findByRole('button', { name: 'WithText' })).toBeInTheDocument();
    expect(inGrid().queryByRole('button', { name: 'NoText' })).toBeNull();
  });

  describe('clone-only voice gate (slice 5 — renderer mirror of the sidecar R16 pre-check)', () => {
    it('warns when a clone-only model (builtin:none, custom:clip) has no clip yet', async () => {
      const store = makeClipStore({ list: vi.fn().mockResolvedValue([]) });
      render(<NativeVoiceSection capability={{ builtin: 'none', custom: 'clip' }}
        builtinVoices={[]} store={store} selected="" targetLanguage="en"
        onSelect={() => {}} onCustomChanged={() => {}} ttsModelId="m" ttsLanguages={['en']} />);
      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/needs a clip/i));
    });

    it('does not warn once a clip is stored for that clone-only model', async () => {
      const store = makeClipStore({ list: vi.fn().mockResolvedValue([{ id: 1, name: 'MyClone' }]) });
      render(<NativeVoiceSection capability={{ builtin: 'none', custom: 'clip' }}
        builtinVoices={[]} store={store} selected="" targetLanguage="en"
        onSelect={() => {}} onCustomChanged={() => {}} ttsModelId="m" ttsLanguages={['en']} />);
      openPicker();
      await inGrid().findByRole('button', { name: 'MyClone' });
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('a transcriptRequired clone-only model still warns when clips exist but none carry a transcript', async () => {
      const store = makeClipStore({
        list: vi.fn().mockResolvedValue([{ id: 1, name: 'NoText', hasTranscript: false }]),
      });
      render(<NativeVoiceSection capability={{ builtin: 'none', custom: 'clip', transcriptRequired: true }}
        builtinVoices={[]} store={store} selected="" targetLanguage="en"
        onSelect={() => {}} onCustomChanged={() => {}} ttsModelId="m" ttsLanguages={['en']} />);
      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/needs a clip/i));
    });

    it('a preset/named-voice family (MOSS-shaped) is unaffected even with zero custom clips', async () => {
      const store = makeClipStore({ list: vi.fn().mockResolvedValue([]) });
      render(<NativeVoiceSection {...baseProps} store={store} />);
      await screen.findByText('Ava');
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });

  describe('preview (Task 7 — synthesize with the cloned voice, falling back to the clip)', () => {
    it('synthesizes with the custom voice rather than replaying the clip', async () => {
      const { playedAudio } = stubWebAudio();
      const synthesize = vi.fn().mockResolvedValue({ audio: new Float32Array([0.25]), sampleRate: 24000 });
      vi.mocked(createPreviewTts).mockReturnValue({ synthesize, close: vi.fn() });
      const store = storeWithClip();

      render(<NativeVoiceSection {...baseProps} store={store} />);
      openPicker();
      await inGrid().findByRole('button', { name: 'MyClone' });
      // Scoped to the row: every builtin preset is ALSO previewable (Task 1),
      // so an unscoped "Play" query would match Ava/Bella/Adam's rows too.
      fireEvent.click(within(rowFor('MyClone')).getByRole('button', { name: /play/i }));

      // The clip is still read -- it is the reference the clone is built from --
      // but what plays is the SYNTHESIS, so the model must have been asked.
      await waitFor(() => expect(synthesize).toHaveBeenCalledTimes(1));
      // Pinned to the actual sample sentence and the actual (fixed) preview
      // speed -- not `expect.any(...)` -- so a future edit that threads the
      // wrong text or a wrong/dropped speed through stays red here.
      expect(synthesize).toHaveBeenCalledWith({
        modelId: 'moss_tts_nano',
        language: 'en',
        text: PREVIEW_SAMPLES.en,
        speed: 1,
        voice: { kind: 'clip', audio: new Float32Array([0.5, 0.6]), sampleRate: 16000, refText: 'hi' },
      });
      await waitFor(() => expect(playedAudio()).toEqual(new Float32Array([0.25])));
    });

    it('falls back to replaying the reference clip when synthesis fails', async () => {
      // Deliberate, not a consolation prize: replaying answers "did I record
      // clearly?", synthesis answers "does the clone sound like me". Keeping the
      // old path as the failure mode costs nothing and loses nothing.
      const { playedAudio } = stubWebAudio();
      const synthesize = vi.fn().mockRejectedValue(new Error('synthesis exploded'));
      vi.mocked(createPreviewTts).mockReturnValue({ synthesize, close: vi.fn() });
      const clipAudio = new Float32Array([0.7, 0.8]);
      const store = storeWithClip({
        resolveApply: vi.fn().mockResolvedValue({ kind: 'clip', audio: clipAudio, sampleRate: 16000, transcript: 'hi' }),
      });

      render(<NativeVoiceSection {...baseProps} store={store} />);
      openPicker();
      await inGrid().findByRole('button', { name: 'MyClone' });
      fireEvent.click(within(rowFor('MyClone')).getByRole('button', { name: /play/i }));

      await waitFor(() => expect(synthesize).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(playedAudio()).toEqual(clipAudio));
    });

    it('disables preview with a reason while a session is active, and never dials out', async () => {
      // The sidecar's TTS engine is a process singleton guarded by `_owner_conn`;
      // a panel-issued tts_generate during a session returns _not_owner_error. So
      // refuse up front instead of failing slowly.
      const synthesize = vi.fn();
      vi.mocked(createPreviewTts).mockReturnValue({ synthesize, close: vi.fn() });
      const store = storeWithClip();

      render(<NativeVoiceSection {...baseProps} store={store} isSessionActive />);
      openPicker();
      await inGrid().findByRole('button', { name: 'MyClone' });
      // previewUnavailableReason disables the ▶ on EVERY row uniformly (both
      // presets and the clone), so any one of them proves the point.
      const btn = within(rowFor('MyClone')).getByRole('button', { name: /stop the session/i });
      expect(btn).toBeDisabled();

      fireEvent.click(btn);
      expect(synthesize).not.toHaveBeenCalled();
      expect(store.resolveApply).not.toHaveBeenCalled();
    });

    it('disables preview with a reason when no language the family speaks has a sample', async () => {
      // `ttsLanguages` names only a code the 28-entry table has no sentence for,
      // so `resolvePreviewSample` returns null and there is nothing to synthesize.
      const store = storeWithClip();
      render(<NativeVoiceSection {...baseProps} store={store} ttsLanguages={['xx']} />);
      openPicker();
      await inGrid().findByRole('button', { name: 'MyClone' });
      const btn = within(rowFor('MyClone')).getByRole('button', { name: /no sample sentence/i });
      expect(btn).toBeDisabled();
    });

    it('closes the preview client when the section unmounts', async () => {
      // A resident TTS model is GB-scale; the memory goes back when the user
      // leaves the panel.
      stubWebAudio();
      const synthesize = vi.fn().mockResolvedValue({ audio: new Float32Array([0.25]), sampleRate: 24000 });
      const close = vi.fn();
      vi.mocked(createPreviewTts).mockReturnValue({ synthesize, close });
      const store = storeWithClip();

      const { unmount } = render(<NativeVoiceSection {...baseProps} store={store} />);
      openPicker();
      await inGrid().findByRole('button', { name: 'MyClone' });
      fireEvent.click(within(rowFor('MyClone')).getByRole('button', { name: /play/i }));
      await waitFor(() => expect(synthesize).toHaveBeenCalledTimes(1));

      unmount();
      expect(close).toHaveBeenCalledTimes(1);
    });

    it('does not start a second overlapping synthesize while one is already in flight for another voice', async () => {
      // Carried from Task 6's review: nativePreviewTts keeps its client as
      // unguarded closure state, trusting the CALLER to prevent overlap.
      // VoiceLibrarySection's per-row `disabled={isLoading}` only blocks a
      // second click on the SAME row -- clicking a DIFFERENT custom voice's
      // Play button while the first's synthesis is still pending is a real
      // path to two concurrent synthesize() calls on the same client, so
      // this component itself must refuse the second one.
      const { playedAudio } = stubWebAudio();
      let resolveFirst!: (v: { audio: Float32Array; sampleRate: number }) => void;
      const firstSynthesis = new Promise<{ audio: Float32Array; sampleRate: number }>((resolve) => { resolveFirst = resolve; });
      const synthesize = vi.fn()
        .mockImplementationOnce(() => firstSynthesis)
        .mockResolvedValue({ audio: new Float32Array([0.9]), sampleRate: 24000 });
      vi.mocked(createPreviewTts).mockReturnValue({ synthesize, close: vi.fn() });

      const store = makeClipStore({
        list: vi.fn().mockResolvedValue([{ id: 1, name: 'Voice1' }, { id: 2, name: 'Voice2' }]),
        resolveApply: vi.fn().mockImplementation((id: number) => Promise.resolve({
          kind: 'clip', audio: new Float32Array([id === 1 ? 0.1 : 0.2]), sampleRate: 16000, transcript: 'hi',
        })),
      });

      render(<NativeVoiceSection {...baseProps} store={store} />);
      openPicker();
      await inGrid().findByRole('button', { name: 'Voice1' });
      await inGrid().findByRole('button', { name: 'Voice2' });
      // Scoped per-row, not `findAllByRole('button', {name: /play/i})`: since
      // Task 1, Ava/Bella/Adam's preset rows are previewable too, so an
      // unscoped Play query would return 5 buttons here, not 2 -- the
      // original `buttons[0]`/`buttons[1]` indexing no longer identifies
      // "the two custom voices" now that the redesign's own earlier task
      // widened who gets a ▶. Captured ONCE as element references (like the
      // original `buttons[0]`/`buttons[1]`), not re-queried by name on every
      // click: the button's own accessible name flips between Play/Stop/
      // Synthesizing… as state changes, so a live `/play/i` re-query would
      // stop matching its own target mid-test.
      const play1 = within(rowFor('Voice1')).getByRole('button', { name: /play/i });
      const play2 = within(rowFor('Voice2')).getByRole('button', { name: /play/i });

      fireEvent.click(play1);
      await waitFor(() => expect(synthesize).toHaveBeenCalledTimes(1)); // first synthesize is now pending

      fireEvent.click(play2);
      await waitFor(() => expect(store.resolveApply).toHaveBeenCalledWith(2));
      // The second request must NOT have started a second, concurrent
      // synthesize() call against the still-busy shared client -- it falls
      // back to replaying voice 2's own clip instead.
      expect(synthesize).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(playedAudio()).toEqual(new Float32Array([0.2])));

      // Once the first settles, the guard clears -- a later preview can use
      // the shared client again rather than being permanently locked out.
      // (Voice 1's own superseded-but-successful result is also cached now --
      // Finding 2, covered by its own test below -- so re-previewing voice 2,
      // which never reached a real synthesize() call, is what actually
      // proves the GUARD itself cleared rather than a cache hit doing it.)
      resolveFirst({ audio: new Float32Array([0.25]), sampleRate: 24000 });
      fireEvent.click(play2); // stop voice 2's clip playback
      fireEvent.click(play2); // a fresh request for voice 2
      await waitFor(() => expect(synthesize).toHaveBeenCalledTimes(2));
    });

    it('caches a superseded-but-successful synthesis instead of discarding it', async () => {
      // Finding 2: the user already waited and the sidecar already did the
      // work, so a request that finishes successfully AFTER being superseded
      // must still be cached -- only the immediate playback is skipped.
      const { playedAudio } = stubWebAudio();
      let resolveFirst!: (v: { audio: Float32Array; sampleRate: number }) => void;
      const firstSynthesis = new Promise<{ audio: Float32Array; sampleRate: number }>((resolve) => { resolveFirst = resolve; });
      const synthesize = vi.fn().mockImplementationOnce(() => firstSynthesis);
      vi.mocked(createPreviewTts).mockReturnValue({ synthesize, close: vi.fn() });

      const store = makeClipStore({
        list: vi.fn().mockResolvedValue([{ id: 1, name: 'Voice1' }, { id: 2, name: 'Voice2' }]),
        resolveApply: vi.fn().mockImplementation((id: number) => Promise.resolve({
          kind: 'clip', audio: new Float32Array([id === 1 ? 0.1 : 0.2]), sampleRate: 16000, transcript: 'hi',
        })),
      });

      render(<NativeVoiceSection {...baseProps} store={store} />);
      openPicker();
      await inGrid().findByRole('button', { name: 'Voice1' });
      await inGrid().findByRole('button', { name: 'Voice2' });
      // Captured ONCE, not re-queried by name — see the sibling test above's
      // comment on why a live `/play/i` re-query breaks once a button's own
      // label flips to Stop/Synthesizing….
      const play1 = within(rowFor('Voice1')).getByRole('button', { name: /play/i });
      const play2 = within(rowFor('Voice2')).getByRole('button', { name: /play/i });

      fireEvent.click(play1); // voice 1 -- synthesize() pending
      await waitFor(() => expect(synthesize).toHaveBeenCalledTimes(1));
      fireEvent.click(play2); // supersedes voice 1's request (aborts its signal)
      await waitFor(() => expect(store.resolveApply).toHaveBeenCalledWith(2));

      // Voice 1's synthesis finishes successfully AFTER being superseded.
      // Its continuation (await -> cache write -> aborted check -> return
      // null) has no OTHER observable effect in this test, so flush the
      // microtask queue explicitly rather than polling for a side effect
      // that doesn't exist -- a bare `waitFor` here would pass immediately
      // on the state left over from the earlier assertions and prove
      // nothing.
      resolveFirst({ audio: new Float32Array([0.42]), sampleRate: 24000 });
      await new Promise((resolve) => setTimeout(resolve, 0));

      fireEvent.click(play2); // stop voice 2's clip playback
      fireEvent.click(play1); // voice 1 again -- must be a cache hit
      await waitFor(() => expect(playedAudio()).toEqual(new Float32Array([0.42])));
      // Still exactly 1 real synthesize() call -- the cache served the
      // second voice-1 preview instantly, no re-synthesis.
      expect(synthesize).toHaveBeenCalledTimes(1);
    });
  });

  describe('preset preview (Task 8 — presets audition in THEIR OWN language, not the target language)', () => {
    it('auditions a preset with the sentence for THAT voice language, not the target language', async () => {
      // targetLanguage is 'en' (baseProps); the preset's OWN meta.language
      // ('ja') is what must drive the sample and the synthesize() call, not
      // the target.
      const { playedAudio } = stubWebAudio();
      const synthesize = vi.fn().mockResolvedValue({ audio: new Float32Array([0.42]), sampleRate: 24000 });
      vi.mocked(createPreviewTts).mockReturnValue({ synthesize, close: vi.fn() });
      const store = makeClipStore();
      const withJa = [...builtinVoices, { name: 'jp-voice', language: 'ja', curated: false, unstable: false, default: false }];

      render(<NativeVoiceSection {...baseProps} builtinVoices={withJa} store={store} ttsLanguages={['en', 'ja']} />);
      openPicker();
      await inGrid().findByRole('button', { name: 'jp-voice' });
      fireEvent.click(within(rowFor('jp-voice')).getByRole('button', { name: /play/i }));

      await waitFor(() => expect(synthesize).toHaveBeenCalledTimes(1));
      expect(synthesize.mock.calls[0][0]).toMatchObject({
        language: 'ja',
        voice: { kind: 'name', name: 'jp-voice' },
      });
      await waitFor(() => expect(playedAudio()).toEqual(new Float32Array([0.42])));
    });

    it('re-inits the engine when the next audition is in another language', async () => {
      // nativePreviewTts.createPreviewTts is mocked away here (see this file's
      // top-of-file note), so its own re-init-on-language-change behaviour is
      // exercised separately in nativePreviewTts.test.ts. What THIS component
      // owns, and what this proves, is feeding synthesize() the two auditions
      // 'en' then 'ja' IN THAT ORDER -- the exact sequence that drives the
      // real handle's re-init.
      const { playedAudio } = stubWebAudio();
      const synthesize = vi.fn().mockResolvedValue({ audio: new Float32Array([0.1]), sampleRate: 24000 });
      vi.mocked(createPreviewTts).mockReturnValue({ synthesize, close: vi.fn() });
      const store = makeClipStore();
      const withJa = [...builtinVoices, { name: 'jp-voice', language: 'ja', curated: false, unstable: false, default: false }];

      render(<NativeVoiceSection {...baseProps} builtinVoices={withJa} store={store} ttsLanguages={['en', 'ja']} />);
      openPicker();
      await inGrid().findByRole('button', { name: 'Ava' });
      fireEvent.click(within(rowFor('Ava')).getByRole('button', { name: /play/i }));
      await waitFor(() => expect(synthesize).toHaveBeenCalledTimes(1));

      fireEvent.click(within(rowFor('jp-voice')).getByRole('button', { name: /play/i }));
      await waitFor(() => expect(synthesize).toHaveBeenCalledTimes(2));

      expect(synthesize.mock.calls.map((call) => call[0].language)).toEqual(['en', 'ja']);
      await waitFor(() => expect(playedAudio()).toEqual(new Float32Array([0.1])));
    });

    it('reports a failed preset audition instead of playing a clip', async () => {
      // A preset has no reference clip behind it, unlike a clone -- so a
      // synthesis failure has nothing to fall back to.
      const { playedAudio } = stubWebAudio();
      const synthesize = vi.fn().mockRejectedValue(new Error('synthesis exploded'));
      vi.mocked(createPreviewTts).mockReturnValue({ synthesize, close: vi.fn() });
      const store = makeClipStore();

      render(<NativeVoiceSection {...baseProps} store={store} />);
      openPicker();
      await inGrid().findByRole('button', { name: 'Ava' });
      fireEvent.click(within(rowFor('Ava')).getByRole('button', { name: /play/i }));

      expect(await screen.findByText(/could not synthesize a preview/i)).toBeInTheDocument();
      expect(playedAudio()).toBeNull();
    });

    it('still falls back to the reference clip when a CLONE fails to synthesize', async () => {
      // Guard for the sibling describe block above: presets (this block) have
      // no clip to fall back to, but a clone still does -- proving the new
      // `builtin:` branch of handlePreview left the pre-existing `custom:`
      // branch's fallback untouched.
      const { playedAudio } = stubWebAudio();
      const synthesize = vi.fn().mockRejectedValue(new Error('synthesis exploded'));
      vi.mocked(createPreviewTts).mockReturnValue({ synthesize, close: vi.fn() });
      const clipAudio = new Float32Array([0.33]);
      const store = storeWithClip({
        resolveApply: vi.fn().mockResolvedValue({ kind: 'clip', audio: clipAudio, sampleRate: 16000, transcript: 'hi' }),
      });

      render(<NativeVoiceSection {...baseProps} store={store} />);
      openPicker();
      await inGrid().findByRole('button', { name: 'MyClone' });
      fireEvent.click(within(rowFor('MyClone')).getByRole('button', { name: /play/i }));

      await waitFor(() => expect(synthesize).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(playedAudio()).toEqual(clipAudio));
    });
  });
});
