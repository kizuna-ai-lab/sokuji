import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { VoiceLibrarySource } from './voiceLibrarySource';
import { SONIOX_TTS_MODEL, SONIOX_DEFAULT_VOICE } from '../../../lib/soniox/ttsCatalog';

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({ t: (_k: string, def?: string) => def ?? _k, i18n: { language: 'en' } }),
  };
});

// These stand in for whatever the section used to construct internally (a
// SonioxVoicesClient's list/create/delete/waitUntilReady). Now that the
// section receives its `source` as a prop (see voiceLibrarySource.ts), the
// fake below is the seam's test double — shared across tests so a test can
// keep configuring `listMock.mockResolvedValue(...)` etc. exactly as before.
const listMock = vi.fn();
const createMock = vi.fn();
const deleteMock = vi.fn();
const waitMock = vi.fn();

/** A fake source standing in for whatever the section used to construct
 *  internally. The assertions below are unchanged from before the seam
 *  existed — that is the point of this file: BYOK behaviour must come out
 *  bit-identical. Defaults route through the shared mocks above (not fresh
 *  vi.fn()s) so a test's `listMock.mockResolvedValue(...)` etc., set up
 *  before mount(), still reaches the source the component was given. */
function fakeSource(over: Partial<VoiceLibrarySource> = {}): VoiceLibrarySource {
  return {
    list: listMock,
    create: createMock,
    delete: deleteMock,
    waitUntilReady: waitMock,
    canPreview: true,
    ...over,
  } as VoiceLibrarySource;
}

const synthesizeMock = vi.fn();
vi.mock('../../../services/clients/SonioxTtsRest', () => ({
  synthesizeOnce: (...args: unknown[]) => synthesizeMock(...args),
}));

const { default: SonioxVoiceSection } = await import('./SonioxVoiceSection');
const { SonioxVoicesError } = await import('../../../services/clients/SonioxVoicesClient');

const READY = { model: SONIOX_TTS_MODEL, status: 'ready', error_type: null, error_message: null };
const cloned = (over: object = {}) => ({ id: 'uuid-1', name: 'Me', models: [READY], ...over });

// jsdom has no Web Audio — stub AudioContext.decodeAudioData to resolve a
// fake AudioBuffer of the given duration (mono, constant amplitude so the
// silence check never trips).
function stubAudioContext(sampleRate: number, numSamples: number) {
  const mockCtx = {
    decodeAudioData: vi.fn().mockResolvedValue({
      numberOfChannels: 1,
      length: numSamples,
      sampleRate,
      getChannelData: () => new Float32Array(numSamples).fill(0.5),
    }),
    close: vi.fn().mockResolvedValue(undefined),
  };
  // regular function (not an arrow) so `new AudioContext()` is constructable
  (window as any).AudioContext = function AudioContext() { return mockCtx; };
  return mockCtx;
}

// jsdom's File/Blob polyfill doesn't implement `arrayBuffer()` (unlike real
// browsers), so onImport's `file.arrayBuffer()` call throws under jsdom's
// real File. Build a minimal File-shaped object instead — only `size`,
// `name`, and `arrayBuffer()` are ever read by the component under test.
function fakeFile(name: string, size = 10): File {
  return {
    name,
    size,
    type: 'audio/wav',
    arrayBuffer: async () => new ArrayBuffer(size),
  } as unknown as File;
}

function mount(over: object = {}) {
  const onUpdate = vi.fn();
  const utils = render(
    <SonioxVoiceSection
      settings={{ voice: SONIOX_DEFAULT_VOICE, apiKey: 'k', targetLanguage: 'ja', ttsSpeed: 1.0 }}
      onUpdate={onUpdate}
      source={fakeSource()}
      managed={false}
      isSessionActive={false}
      {...over}
    />
  );
  return { onUpdate, ...utils };
}

const openManageDetails = () => fireEvent.click(screen.getByText(/manage imported voices/i));
const nameInputPlaceholder = /name for a new cloned voice/i;
const confirmButtonName = /^clone voice$/i;
// Checks the modal's usage-rights checkbox, without which the confirm
// button stays disabled.
const checkConsent = () => fireEvent.click(screen.getByRole('checkbox'));

describe('SonioxVoiceSection', () => {
  beforeEach(() => {
    listMock.mockReset().mockResolvedValue([]);
    createMock.mockReset();
    deleteMock.mockReset().mockResolvedValue(undefined);
    waitMock.mockReset();
    // jsdom has no URL.createObjectURL — the confirm modal's <audio> preview
    // needs it whenever a pending clip opens the modal.
    (URL as any).createObjectURL = vi.fn(() => 'blob:mock');
    (URL as any).revokeObjectURL = vi.fn();
    // jsdom's HTMLMediaElement doesn't implement play()/pause() (they throw
    // "not implemented") — the custom player's play-toggle button calls them
    // directly on the <audio> ref, so every test needs a stub.
    (window.HTMLMediaElement.prototype as any).play = vi.fn().mockResolvedValue(undefined);
    (window.HTMLMediaElement.prototype as any).pause = vi.fn();
    // VoiceLibrarySection's delete flow goes through window.confirm, which
    // jsdom stubs to a falsy no-op — accept it so delete clicks reach onDelete.
    (window as any).confirm = vi.fn(() => true);
    synthesizeMock.mockReset().mockResolvedValue({ audio: new Float32Array(2048), sampleRate: 24000 });
    // VoiceLibrarySection plays the returned sample through Web Audio, which
    // jsdom does not implement. The confirm-modal tests stub AudioContext with
    // decodeAudioData only; preview needs the buffer-source surface too.
    (window as any).AudioContext = function AudioContext() {
      return {
        state: 'running',
        resume: vi.fn().mockResolvedValue(undefined),
        destination: {},
        createBuffer: vi.fn(() => ({ copyToChannel: vi.fn() })),
        createBufferSource: vi.fn(() => ({ connect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null, buffer: null })),
        close: vi.fn().mockResolvedValue(undefined),
        decodeAudioData: vi.fn(),
      };
    };
  });

  it('renders the built-ins immediately and cloned voices after fetch', async () => {
    listMock.mockResolvedValue([cloned()]);
    const { container } = mount();
    const select = container.querySelector('select')!;
    // Not a count either: any threshold is still a roster-size contract, and
    // which voices exist is Soniox's to change (see ttsCatalog). The property
    // is that built-ins are already rendered before the fetch settles, so the
    // dropdown is never momentarily empty and always offers the default.
    const optionValues = () => [...select.querySelectorAll('option')].map((o) => o.value);
    expect(optionValues()).toContain(SONIOX_DEFAULT_VOICE);
    await waitFor(() => expect([...select.querySelectorAll('option')].some((o) => o.value === 'uuid-1')).toBe(true));
  });

  it('selecting a cloned voice writes the UUID through onUpdate', async () => {
    listMock.mockResolvedValue([cloned()]);
    const { container, onUpdate } = mount();
    await waitFor(() => expect(listMock).toHaveBeenCalled());
    const select = container.querySelector('select')!;
    await waitFor(() => expect([...select.querySelectorAll('option')].some((o) => o.value === 'uuid-1')).toBe(true));
    fireEvent.change(select, { target: { value: 'uuid-1' } });
    expect(onUpdate).toHaveBeenCalledWith({ voice: 'uuid-1' });
  });

  it('shows a deleted-voice placeholder when the stored UUID is not in the fetched list', async () => {
    listMock.mockResolvedValue([]);
    const { container } = mount({ settings: { voice: 'gone-uuid', apiKey: 'k', targetLanguage: 'ja', ttsSpeed: 1.0 } });
    await waitFor(() => expect(listMock).toHaveBeenCalled());
    const select = container.querySelector('select')!;
    await waitFor(() => {
      const opt = [...select.querySelectorAll('option')].find((o) => o.value === 'gone-uuid');
      expect(opt).toBeTruthy();
    });
    expect(select.value).toBe('gone-uuid'); // stored setting is not rewritten
  });

  it('does not mistake a voice retired by tts-rt-v2 for a deleted clone', async () => {
    // 'Maya' was Sokuji's shipped default under tts-rt-v1 and is absent from
    // v2's roster, so after the upgrade it is neither a built-in nor a clone —
    // exactly the shape the "(deleted voice)" placeholder is built to detect.
    // Showing it here would offer a Delete button for a voice the user never
    // cloned, and there is nothing behind that button to delete.
    listMock.mockResolvedValue([]);
    const { container } = mount({ settings: { voice: 'Maya', apiKey: 'k', targetLanguage: 'ja', ttsSpeed: 1.0 } });
    await waitFor(() => expect(listMock).toHaveBeenCalled());
    const select = container.querySelector('select')!;
    await waitFor(() => expect(select.value).toBe(SONIOX_DEFAULT_VOICE));
    expect([...select.querySelectorAll('option')].some((o) => o.value === 'Maya')).toBe(false);
    expect(screen.queryByRole('button', { name: /^delete$/i })).toBeNull();
  });

  it('managed mode renders built-ins only: no fetch, no refresh/create affordances', () => {
    mount({ managed: true, source: null });
    expect(listMock).not.toHaveBeenCalled();
    expect(screen.queryByTitle(/refresh voice list/i)).toBeNull();
    expect(screen.queryByText(/manage imported voices/i)).toBeNull();
    expect(screen.queryByText(/Record/i)).toBeNull();
  });

  it('marks failed clones and offers no selection benefit (label carries the failed hint)', async () => {
    listMock.mockResolvedValue([cloned({ id: 'bad', name: 'Broken', models: [{ model: SONIOX_TTS_MODEL, status: 'failed' }] })]);
    const { container } = mount();
    const select = container.querySelector('select')!;
    await waitFor(() => {
      const opt = [...select.querySelectorAll('option')].find((o) => o.value === 'bad');
      expect(opt?.textContent).toMatch(/failed/i);
    });
  });

  it('import/record are available as soon as a client exists (no consent gate)', async () => {
    listMock.mockResolvedValue([]);
    mount();
    await waitFor(() => expect(listMock).toHaveBeenCalled());
    openManageDetails();
    expect(screen.getByRole('button', { name: /import voice/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /record voice/i })).toBeInTheDocument();
  });

  it('cloned voices are deletable (manage list shows a Delete button)', async () => {
    listMock.mockResolvedValue([cloned()]);
    const { container } = mount();
    await waitFor(() => {
      const select = container.querySelector('select')!;
      expect([...select.querySelectorAll('option')].some((o) => o.value === 'uuid-1')).toBe(true);
    });
    openManageDetails();
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeInTheDocument();
  });

  it('the refresh button re-fetches the voice list', async () => {
    listMock.mockResolvedValueOnce([]).mockResolvedValueOnce([cloned()]);
    const { container } = mount();
    // The refresh button is disabled while the list is loading, and the first
    // fetch having been *called* does not mean it has resolved - clicking in
    // that window is a no-op and the second fetch never happens. Wait for the
    // button a user could actually press.
    const refreshButton = screen.getByTitle(/refresh voice list/i);
    await waitFor(() => expect(refreshButton).not.toBeDisabled());
    fireEvent.click(refreshButton);
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
    await waitFor(() => {
      const select = container.querySelector('select')!;
      expect([...select.querySelectorAll('option')].some((o) => o.value === 'uuid-1')).toBe(true);
    });
  });

  it('onImport rejects a file over 10MB before decoding, creating, or opening the modal', async () => {
    listMock.mockResolvedValue([]);
    const { container } = mount();
    openManageDetails();
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const bigFile = fakeFile('big.wav', 11 * 1024 * 1024);
    fireEvent.change(fileInput, { target: { files: [bigFile] } });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/too large/i));
    expect(createMock).not.toHaveBeenCalled();
    expect(screen.queryByPlaceholderText(nameInputPlaceholder)).toBeNull();
  });

  it('onImport rejects a decoded clip shorter than 3s with the localized message, without opening the modal', async () => {
    listMock.mockResolvedValue([]);
    stubAudioContext(16000, 16000 * 1); // 1s — below the 3s minimum
    const { container } = mount();
    openManageDetails();
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = fakeFile('clip.wav');
    fireEvent.change(fileInput, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/too short/i));
    expect(createMock).not.toHaveBeenCalled();
    expect(screen.queryByPlaceholderText(nameInputPlaceholder)).toBeNull();
  });

  it('onImport rejects a decoded clip longer than 20s with the localized message, without opening the modal', async () => {
    listMock.mockResolvedValue([]);
    stubAudioContext(16000, 16000 * 25); // 25s — above the 20s maximum
    const { container } = mount();
    openManageDetails();
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = fakeFile('clip.wav');
    fireEvent.change(fileInput, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/too long/i));
    expect(createMock).not.toHaveBeenCalled();
    expect(screen.queryByPlaceholderText(nameInputPlaceholder)).toBeNull();
  });

  it('selecting multiple files stages only the first (single pending slot; no silent last-wins)', async () => {
    listMock.mockResolvedValue([]);
    createMock.mockResolvedValue({ id: 'new-id', name: 'first', models: [] });
    waitMock.mockResolvedValue({ id: 'new-id', name: 'first', models: [READY] });
    stubAudioContext(16000, 16000 * 5);
    const { container } = mount();
    openManageDetails();
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput.multiple).toBe(false);
    fireEvent.change(fileInput, {
      target: { files: [fakeFile('first.wav'), fakeFile('second.wav')] },
    });
    // The name field never prefills — confirming it blank falls back to the
    // staged clip's suggested name, which proves the FIRST file won.
    const nameInput = await screen.findByPlaceholderText(nameInputPlaceholder);
    expect(nameInput).toHaveValue('');
    checkConsent();
    fireEvent.click(screen.getByRole('button', { name: confirmButtonName }));
    await waitFor(() => expect(createMock).toHaveBeenCalled());
    expect(createMock.mock.calls[0][0]).toBe('first');
  });

  it('importing a valid file opens the confirm modal with an empty name field; confirm calls create, refreshes the list BEFORE closing the modal, then finishes the ready-wait chain in the background', async () => {
    // Sequenced so each list() call is distinguishable: initial mount load,
    // then the post-create refresh (still processing — this is the one that
    // must land before the modal closes), then finishCreate's refresh once
    // waitUntilReady resolves.
    listMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([cloned({ id: 'new-id', name: 'Custom Name', models: [] })])
      .mockResolvedValueOnce([cloned({ id: 'new-id', name: 'Custom Name', models: [READY] })]);
    createMock.mockResolvedValue({ id: 'new-id', name: 'Custom Name', models: [] });
    // Held open deliberately: this proves the modal's close doesn't wait on
    // waitUntilReady (only on create + the one refresh), and lets us inspect
    // state at the "closed but not yet ready" midpoint before resolving it.
    let resolveWait: (v: unknown) => void = () => {};
    waitMock.mockReturnValue(new Promise((resolve) => { resolveWait = resolve; }));
    stubAudioContext(16000, 16000 * 5); // 5s — valid
    const { container, onUpdate } = mount();
    openManageDetails();
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = fakeFile('my-clip.wav');
    fireEvent.change(fileInput, { target: { files: [file] } });

    const nameInput = await screen.findByPlaceholderText(nameInputPlaceholder);
    expect(nameInput).toHaveValue(''); // no prefill — the placeholder shows instead
    expect(createMock).not.toHaveBeenCalled(); // staged, not yet uploaded

    fireEvent.change(nameInput, { target: { value: 'Custom Name' } });
    checkConsent();
    fireEvent.click(screen.getByRole('button', { name: confirmButtonName }));

    await waitFor(() => expect(createMock).toHaveBeenCalledWith('Custom Name', file, 'my-clip.wav'));
    // Modal closes only once create() AND the post-create refresh resolve.
    await waitFor(() => expect(screen.queryByPlaceholderText(nameInputPlaceholder)).toBeNull());
    expect(listMock).toHaveBeenCalledTimes(2); // mount load + the one refresh that gates the close

    // The refreshed (still-processing) list is already reflected in the
    // dropdown right after close — proving refresh() landed before the close,
    // not after.
    const select = container.querySelector('select')!;
    await waitFor(() => {
      const opt = [...select.querySelectorAll('option')].find((o) => o.value === 'new-id');
      expect(opt?.textContent).toMatch(/processing/i);
    });
    expect(onUpdate).not.toHaveBeenCalled(); // auto-select hasn't run yet — still awaiting waitUntilReady

    // Background chain continues after close: waitUntilReady resolves →
    // refresh (3rd list call) → auto-select.
    resolveWait({ id: 'new-id', name: 'Custom Name', models: [READY] });
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith({ voice: 'new-id' }));
    expect(listMock).toHaveBeenCalledTimes(3);
  });

  it('shows the busy spinner on the accept button while create() is pending, with both buttons disabled; resolving create → refresh closes the modal', async () => {
    listMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([cloned({ id: 'new-id', name: 'x', models: [] })]);
    let resolveCreate: (v: unknown) => void = () => {};
    createMock.mockReturnValue(new Promise((resolve) => { resolveCreate = resolve; }));
    // Never resolves: this test only cares about the create-then-refresh
    // handoff that closes the modal, not the background ready-wait chain —
    // leaving waitUntilReady pending keeps the post-close refresh count
    // (asserted below) deterministic instead of racing finishCreate's own
    // refresh.
    waitMock.mockReturnValue(new Promise(() => {}));
    stubAudioContext(16000, 16000 * 5);
    const { container } = mount();
    openManageDetails();
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [fakeFile('clip.wav')] } });
    await screen.findByPlaceholderText(nameInputPlaceholder);

    checkConsent();
    const acceptButton = screen.getByRole('button', { name: confirmButtonName });
    const cancelButton = screen.getByRole('button', { name: /^cancel$/i });
    fireEvent.click(acceptButton);

    expect(createMock).toHaveBeenCalled();
    expect(screen.getByTestId('soniox-clone-confirm-busy-spinner')).toBeInTheDocument();
    expect(acceptButton).toBeDisabled();
    expect(cancelButton).toBeDisabled();

    resolveCreate({ id: 'new-id', name: 'x', models: [] });
    await waitFor(() => expect(screen.queryByPlaceholderText(nameInputPlaceholder)).toBeNull());
    expect(listMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('soniox-clone-confirm-busy-spinner')).toBeNull();
  });

  it('renders a custom player for the staged clip instead of native <audio controls>; clicking play invokes HTMLMediaElement.play', async () => {
    listMock.mockResolvedValue([]);
    stubAudioContext(16000, 16000 * 5);
    const { container } = mount();
    openManageDetails();
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [fakeFile('clip.wav')] } });
    await screen.findByPlaceholderText(nameInputPlaceholder);

    // The object URL is created in an effect, so the player renders one commit
    // after the name input awaited above - which is already present on the
    // modal's first render. Anchoring on it therefore raced the player and this
    // test failed roughly one run in twelve. Wait for the player's own control.
    const playButton = await screen.findByRole('button', { name: /^play$/i });

    const audioEl = container.querySelector('audio');
    expect(audioEl).not.toBeNull();
    expect(audioEl!.hasAttribute('controls')).toBe(false); // custom player, not native chrome

    fireEvent.click(playButton);
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  it('importing a file whose basename strips to empty falls back to the "My Voice N" default in the modal', async () => {
    listMock.mockResolvedValue([]);
    createMock.mockResolvedValue({ id: 'new-id', name: 'x', models: [] });
    waitMock.mockResolvedValue({ id: 'new-id', name: 'x', models: [READY] });
    stubAudioContext(16000, 16000 * 5); // 5s — valid
    const { container } = mount();
    openManageDetails();
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    // ".wav" strips to an empty basename via the `.[^.]+$` replace.
    const file = fakeFile('.wav');
    fireEvent.change(fileInput, { target: { files: [file] } });

    const nameInput = await screen.findByPlaceholderText(nameInputPlaceholder);
    expect(nameInput).toHaveValue(''); // no prefill — fallback applies at confirm time

    checkConsent();
    fireEvent.click(screen.getByRole('button', { name: confirmButtonName }));
    await waitFor(() => expect(createMock).toHaveBeenCalled());
    expect(createMock.mock.calls[0][0]).toBe('My Voice {{n}}');
  });

  it('refuses to delete the selected voice while a session is active (banner, no API call)', async () => {
    listMock.mockResolvedValue([cloned()]);
    mount({ settings: { voice: 'uuid-1', apiKey: 'k', targetLanguage: 'ja', ttsSpeed: 1.0 }, isSessionActive: true });
    await waitFor(() => expect(listMock).toHaveBeenCalled());
    openManageDetails();
    fireEvent.click(await screen.findByRole('button', { name: /^delete$/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/active session/i));
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('surfaces a failed delete in the error banner', async () => {
    listMock.mockResolvedValue([cloned()]);
    deleteMock.mockRejectedValue(new Error('boom'));
    mount();
    await waitFor(() => expect(listMock).toHaveBeenCalled());
    openManageDetails();
    fireEvent.click(await screen.findByRole('button', { name: /^delete$/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/boom/));
  });

  it('renders processing/failed clones as disabled options; ready clones stay selectable', async () => {
    listMock.mockResolvedValue([
      cloned(),
      cloned({ id: 'proc', name: 'Cooking', models: [{ model: SONIOX_TTS_MODEL, status: 'processing' }] }),
      cloned({ id: 'bad', name: 'Broken', models: [{ model: SONIOX_TTS_MODEL, status: 'failed' }] }),
    ]);
    const { container } = mount();
    const select = container.querySelector('select')!;
    await waitFor(() => expect([...select.querySelectorAll('option')].some((o) => o.value === 'bad')).toBe(true));
    const byValue = (v: string) => [...select.querySelectorAll('option')].find((o) => o.value === v)!;
    expect(byValue('uuid-1').disabled).toBe(false);
    expect(byValue('proc').disabled).toBe(true);
    expect(byValue('bad').disabled).toBe(true);
  });

  it('clears the previous project\'s clones as soon as the API key changes', async () => {
    listMock.mockResolvedValueOnce([cloned()]).mockReturnValueOnce(new Promise(() => {}));
    const onUpdate = vi.fn();
    const props = { settings: { voice: SONIOX_DEFAULT_VOICE, apiKey: 'k' }, onUpdate, source: fakeSource(), managed: false, isSessionActive: false };
    const { container, rerender } = render(<SonioxVoiceSection {...props} />);
    const select = container.querySelector('select')!;
    await waitFor(() => expect([...select.querySelectorAll('option')].some((o) => o.value === 'uuid-1')).toBe(true));
    // A changed API key means a (possibly) different project — in production
    // this is a fresh SonioxVoicesClient instance behind a fresh memoized
    // source (ProviderSpecificSettings.tsx's useMemo keyed on the key
    // string); a new fakeSource() here plays that same role.
    rerender(<SonioxVoiceSection {...props} settings={{ voice: SONIOX_DEFAULT_VOICE, apiKey: 'other-key' }} source={fakeSource()} />);
    // The new key's fetch never resolves — the old project's clone must
    // already be gone rather than lingering selectable.
    await waitFor(() => expect([...select.querySelectorAll('option')].some((o) => o.value === 'uuid-1')).toBe(false));
  });

  it('a late auto-select does not overwrite a voice the user picked while the clone was processing', async () => {
    listMock.mockResolvedValue([]);
    createMock.mockResolvedValue({ id: 'new-id', name: 'x', models: [] });
    let resolveWait: (v: unknown) => void = () => {};
    waitMock.mockReturnValue(new Promise((resolve) => { resolveWait = resolve; }));
    stubAudioContext(16000, 16000 * 5);
    const onUpdate = vi.fn();
    const props = { settings: { voice: SONIOX_DEFAULT_VOICE, apiKey: 'k' }, onUpdate, source: fakeSource(), managed: false, isSessionActive: false };
    const { container, rerender } = render(<SonioxVoiceSection {...props} />);
    openManageDetails();
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [fakeFile('clip.wav')] } });
    await screen.findByPlaceholderText(nameInputPlaceholder);
    checkConsent();
    fireEvent.click(screen.getByRole('button', { name: confirmButtonName }));
    await waitFor(() => expect(createMock).toHaveBeenCalled());

    // The user picks a different voice while the clone is still processing.
    // The API key (and therefore the source) is unchanged — only `voice`
    // moves — so `source` is deliberately NOT replaced on this rerender.
    rerender(<SonioxVoiceSection {...props} settings={{ voice: 'Orion', apiKey: 'k' }} />);

    resolveWait({ id: 'new-id', name: 'x', models: [READY] });
    await waitFor(() => expect(listMock.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(onUpdate).not.toHaveBeenCalledWith({ voice: 'new-id' });
  });

  it('a late auto-select does not fire after the API key changed mid-processing', async () => {
    listMock.mockResolvedValue([]);
    createMock.mockResolvedValue({ id: 'new-id', name: 'x', models: [] });
    let resolveWait: (v: unknown) => void = () => {};
    waitMock.mockReturnValue(new Promise((resolve) => { resolveWait = resolve; }));
    stubAudioContext(16000, 16000 * 5);
    const onUpdate = vi.fn();
    const props = { settings: { voice: SONIOX_DEFAULT_VOICE, apiKey: 'k' }, onUpdate, source: fakeSource(), managed: false, isSessionActive: false };
    const { container, rerender } = render(<SonioxVoiceSection {...props} />);
    openManageDetails();
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [fakeFile('clip.wav')] } });
    await screen.findByPlaceholderText(nameInputPlaceholder);
    checkConsent();
    fireEvent.click(screen.getByRole('button', { name: confirmButtonName }));
    await waitFor(() => expect(createMock).toHaveBeenCalled());

    // The user swaps to a different project's key while the clone processes —
    // the old project's UUID must not be written under the new key. A new
    // fakeSource() mirrors the fresh memoized source a real key swap produces.
    rerender(<SonioxVoiceSection {...props} settings={{ voice: SONIOX_DEFAULT_VOICE, apiKey: 'other-key' }} source={fakeSource()} />);

    resolveWait({ id: 'new-id', name: 'x', models: [READY] });
    await waitFor(() => expect(listMock.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(onUpdate).not.toHaveBeenCalledWith({ voice: 'new-id' });
  });

  // NOTE(Task 3 — VoiceLibrarySource seam): before this refactor, `managed`
  // was special-cased in the deleted-voice-placeholder guard purely to
  // suppress the section's own internally-constructed client. The guard now
  // reacts to `source` — exactly like BYOK always did — so a stale UUID with
  // no source (this account's actual state today; a managed source arrives
  // in Task 4) renders as a disabled, raw-id placeholder instead of being
  // hidden outright. That state cannot exist today (the managed twin has
  // never been able to create a custom voice), and Task 4's real managed
  // source resolves it properly by actually finding the voice. This is a
  // documented, intentional consequence of the Task 3 plan (see
  // voiceLibrarySource.ts's task brief), not an unnoticed regression.
  it('managed mode with no source shows a stale UUID as a disabled raw-id placeholder (pre-Task-4 state)', async () => {
    const { container } = mount({ managed: true, source: null, settings: { voice: 'stale-uuid', apiKey: '' } });
    const select = container.querySelector('select')!;
    const opt = [...select.querySelectorAll('option')].find((o) => o.value === 'stale-uuid');
    expect(opt).toBeTruthy();
    expect(opt!.disabled).toBe(true);
    expect(opt!.textContent).toBe('stale-uuid');
    expect(container.querySelector('optgroup[label*="My Voices" i], optgroup[label="My Voices"]')).not.toBeNull();
  });

  // A managed account with a healthy voice cannot replace it by recording
  // again: the backend's POST /ensure returns the voice it already holds and
  // ignores the uploaded clip, rebuilding only when the voice is gone at
  // Soniox or terminally failed. Offering the affordance anyway would report
  // success and change nothing audible.
  it('managed mode withdraws record/import while a healthy voice exists, and says why', async () => {
    listMock.mockResolvedValue([cloned()]);
    mount({ managed: true, source: fakeSource({ canPreview: false }) });
    await waitFor(() => expect(listMock).toHaveBeenCalled());
    openManageDetails();
    await waitFor(() => expect(screen.queryByText(/delete this voice before recording a new one/i)).not.toBeNull());
    expect(screen.queryByRole('button', { name: /record voice/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /import voice/i })).toBeNull();
    // The delete button is the way forward, so it must still be there.
    expect(screen.queryByRole('button', { name: /^delete$/i })).not.toBeNull();
  });

  it('managed mode keeps record/import when the existing voice terminally failed', async () => {
    // The backend DOES rebuild from a fresh clip in this case, so withdrawing
    // the affordances here would strand the user with a dead voice.
    listMock.mockResolvedValue([cloned({ models: [{ model: SONIOX_TTS_MODEL, status: 'failed' }] })]);
    mount({ managed: true, source: fakeSource({ canPreview: false }) });
    await waitFor(() => expect(listMock).toHaveBeenCalled());
    openManageDetails();
    await waitFor(() => expect(screen.queryByRole('button', { name: /record voice/i })).not.toBeNull());
    expect(screen.queryByText(/delete this voice before recording a new one/i)).toBeNull();
  });

  it('BYOK keeps record/import with a healthy clone listed — the replace restriction is managed-only', async () => {
    listMock.mockResolvedValue([cloned()]);
    mount();
    await waitFor(() => expect(listMock).toHaveBeenCalled());
    openManageDetails();
    expect(screen.queryByRole('button', { name: /record voice/i })).not.toBeNull();
    expect(screen.queryByText(/delete this voice before recording a new one/i)).toBeNull();
  });

  // Eviction is the NORMAL outcome of a small LRU cache serving unbounded
  // users. Before this, the placeholder was `removable: false`, so the panel
  // showed "(deleted voice)" above "No imported voices yet." with no delete
  // button — the on-device recording stayed there forever and every later
  // Start silently re-uploaded it.
  it('managed mode lets an evicted voice\'s placeholder be deleted, clearing the stale setting', async () => {
    listMock.mockResolvedValue([]);
    const source = fakeSource({ canPreview: false });
    const { onUpdate } = mount({
      managed: true,
      source,
      settings: { voice: 'evicted-uuid', apiKey: '', targetLanguage: 'ja', ttsSpeed: 1.0 },
    });
    await waitFor(() => expect(listMock).toHaveBeenCalled());
    openManageDetails();
    const deleteBtn = await screen.findByRole('button', { name: /^delete$/i });
    fireEvent.click(deleteBtn);
    // DELETE /mine answers 200 with no row, so this is safe and idempotent.
    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith('evicted-uuid'));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith({ voice: SONIOX_DEFAULT_VOICE }));
  });

  it('BYOK still refuses to delete an unknown id — there it belongs to another project', async () => {
    listMock.mockResolvedValue([]);
    mount({ settings: { voice: 'someone-elses-uuid', apiKey: 'k', targetLanguage: 'ja', ttsSpeed: 1.0 } });
    await waitFor(() => expect(listMock).toHaveBeenCalled());
    openManageDetails();
    expect(screen.queryByRole('button', { name: /^delete$/i })).toBeNull();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('surfaces a half-completed managed delete instead of reporting success', async () => {
    // The voice is gone but its recording is still on this device. The banner
    // must say which half failed — silence here would leave biometric
    // material behind under a claim it was removed.
    listMock.mockResolvedValue([cloned()]);
    deleteMock.mockRejectedValue(new SonioxVoicesError('clip_clear_failed', 'denied', 0));
    mount({ managed: true, source: fakeSource({ canPreview: false }) });
    await waitFor(() => expect(listMock).toHaveBeenCalled());
    openManageDetails();
    fireEvent.click(await screen.findByRole('button', { name: /^delete$/i }));
    await waitFor(() =>
      expect(screen.queryByText(/could not be removed from this device/i)).not.toBeNull()
    );
  });

  it('a half-completed managed delete still refreshes the list and resets the stored voice', async () => {
    // clip_clear_failed is the ONE failure where the backend delete already
    // succeeded. Bailing out on it would leave the deleted voice listed and
    // still selected, so the next Start would 409 clip_required, upload the
    // surviving clip, and silently rebuild the voice the user just deleted.
    listMock.mockResolvedValueOnce([cloned()]).mockResolvedValue([]);
    deleteMock.mockRejectedValue(new SonioxVoicesError('clip_clear_failed', 'denied', 0));
    const { onUpdate } = mount({
      managed: true,
      source: fakeSource({ canPreview: false }),
      settings: { voice: 'uuid-1', apiKey: '', targetLanguage: 'ja', ttsSpeed: 1.0 },
    });
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(1));
    openManageDetails();
    fireEvent.click(await screen.findByRole('button', { name: /^delete$/i }));
    // The list is re-fetched...
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
    // ...and the setting stops pointing at a voice that no longer exists.
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith({ voice: SONIOX_DEFAULT_VOICE }));
    // The clip failure is still reported, just after the panel tells the truth.
    expect(screen.queryByText(/could not be removed from this device/i)).not.toBeNull();
  });

  // AN ERRORED LIST IS NOT AN EMPTY LIST. After a failed GET /mine the panel
  // knows nothing about the account's voice, and both managed-only
  // affordances decide on exactly that knowledge.
  it('managed mode offers no delete for the placeholder when the list fetch FAILED', async () => {
    // The healthy voice is invisible only because the fetch failed. `delete`
    // ignores the id and issues an unconditional DELETE /mine, so one click
    // would destroy the real voice at Soniox AND the reference clip that is
    // the only thing able to rebuild it.
    listMock.mockRejectedValue(new Error('offline'));
    mount({
      managed: true,
      source: fakeSource({ canPreview: false }),
      settings: { voice: 'real-uuid', apiKey: '', targetLanguage: 'ja', ttsSpeed: 1.0 },
    });
    await waitFor(() => expect(screen.queryByText(/could not load your voice/i)).not.toBeNull());
    // The manage block may not render at all once nothing inside it is
    // offered; open it only if it is there, so the assertion below is about
    // the button rather than about which of the two ways it is absent.
    const summary = screen.queryByText(/manage imported voices/i);
    if (summary) fireEvent.click(summary);
    expect(screen.queryByRole('button', { name: /^delete$/i })).toBeNull();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('managed mode withholds record/import when the list fetch FAILED', async () => {
    // `clones` is [] because nothing arrived, not because nothing exists —
    // so offering Record here reproduces the original no-op the C3 fix is
    // about: the backend hands back the existing voice and ignores the clip.
    listMock.mockRejectedValue(new Error('offline'));
    mount({ managed: true, source: fakeSource({ canPreview: false }) });
    await waitFor(() => expect(screen.queryByText(/could not load your voice/i)).not.toBeNull());
    const summary = screen.queryByText(/manage imported voices/i);
    if (summary) fireEvent.click(summary);
    expect(screen.queryByRole('button', { name: /record voice/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /import voice/i })).toBeNull();
  });

  it('BYOK keeps record/import after a failed list fetch — the unknown-list rule is managed-only', async () => {
    // BYOK's list error means "check the API key", and its create path does
    // not depend on knowing what the project already holds.
    listMock.mockRejectedValue(new Error('offline'));
    mount();
    await waitFor(() => expect(screen.queryByText(/could not load cloned voices/i)).not.toBeNull());
    openManageDetails();
    expect(screen.queryByRole('button', { name: /record voice/i })).not.toBeNull();
  });

  it('the confirm button stays disabled until the usage-rights checkbox is checked', async () => {
    listMock.mockResolvedValue([]);
    stubAudioContext(16000, 16000 * 5);
    const { container } = mount();
    openManageDetails();
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [fakeFile('clip.wav')] } });
    await screen.findByPlaceholderText(nameInputPlaceholder);

    const acceptButton = screen.getByRole('button', { name: confirmButtonName });
    expect(acceptButton).toBeDisabled();
    fireEvent.click(acceptButton);
    expect(createMock).not.toHaveBeenCalled();

    checkConsent();
    expect(acceptButton).not.toBeDisabled();
  });

  it('cancel discards the pending clip without calling create', async () => {
    listMock.mockResolvedValue([]);
    stubAudioContext(16000, 16000 * 5);
    const { container } = mount();
    openManageDetails();
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [fakeFile('clip.wav')] } });
    await screen.findByPlaceholderText(nameInputPlaceholder);

    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));

    expect(screen.queryByPlaceholderText(nameInputPlaceholder)).toBeNull();
    expect(createMock).not.toHaveBeenCalled();
  });

  it('a voice_name_conflict on confirm keeps the modal open with the mapped message, and a retry succeeds', async () => {
    listMock.mockResolvedValue([]);
    stubAudioContext(16000, 16000 * 5);
    createMock
      .mockRejectedValueOnce(new SonioxVoicesError('voice_name_conflict', 'conflict', 409))
      .mockResolvedValueOnce({ id: 'ok-id', name: 'Retry Name', models: [] });
    waitMock.mockResolvedValue({ id: 'ok-id', name: 'Retry Name', models: [READY] });
    const { container, onUpdate } = mount();
    openManageDetails();
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [fakeFile('clip.wav')] } });
    const nameInput = await screen.findByPlaceholderText(nameInputPlaceholder);

    checkConsent();
    fireEvent.click(screen.getByRole('button', { name: confirmButtonName }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/already exists/i));
    // Modal is still open with the clip intact — rename and retry.
    expect(screen.getByPlaceholderText(nameInputPlaceholder)).toBeInTheDocument();

    fireEvent.change(nameInput, { target: { value: 'Retry Name' } });
    fireEvent.click(screen.getByRole('button', { name: confirmButtonName }));

    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith({ voice: 'ok-id' }));
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByPlaceholderText(nameInputPlaceholder)).toBeNull();
  });

  it('recording a clip opens the confirm modal with the "My Voice N" default name', async () => {
    listMock.mockResolvedValue([]);
    const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
    const gum = vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] }));
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: gum } });
    // Plain mutable field (mirrors VoiceLibrarySection.test.tsx's own
    // FakeAudioContext) — VoiceLibrarySection assigns `processor.onaudioprocess
    // = fn` directly, so capturing the created processor object and reading
    // its property back is enough; no getter/setter indirection needed.
    // `any` sidesteps TS narrowing the closure-assigned variable to `null`
    // (it can't see the write, which happens inside a method invoked
    // indirectly by VoiceLibrarySection's own recording code).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let processorNode: any = null;
    class FakeAudioContext {
      sampleRate = 16000;
      destination = {};
      createMediaStreamSource() { return { connect: vi.fn(), disconnect: vi.fn() }; }
      createScriptProcessor() {
        processorNode = { connect: vi.fn(), disconnect: vi.fn(), onaudioprocess: null };
        return processorNode;
      }
      close = vi.fn().mockResolvedValue(undefined);
    }
    vi.stubGlobal('AudioContext', FakeAudioContext);

    try {
      mount();
      openManageDetails();
      fireEvent.click(screen.getByRole('button', { name: /record voice/i }));
      // findByRole (not a gum-called waitFor): the button relabels to "Stop
      // recording" only after startRecording's awaits finish and the state
      // update renders — awaiting the gum call alone is scheduling-dependent.
      const stopButton = await screen.findByRole('button', { name: /stop recording/i });
      // Feed one chunk so the captured clip isn't empty.
      processorNode?.onaudioprocess?.({ inputBuffer: { getChannelData: () => new Float32Array(1600).fill(0.1) } });
      fireEvent.click(stopButton);

      const nameInput = await screen.findByPlaceholderText(nameInputPlaceholder);
      expect(nameInput).toHaveValue(''); // no prefill; "My Voice N" applies only if confirmed blank
      expect(createMock).not.toHaveBeenCalled(); // staged, not yet uploaded
    } finally {
      if (originalMediaDevices) Object.defineProperty(navigator, 'mediaDevices', originalMediaDevices);
      else delete (navigator as { mediaDevices?: unknown }).mediaDevices;
      vi.unstubAllGlobals();
    }
  });

  it('previews a ready clone with the target language pair and the configured speed', async () => {
    listMock.mockResolvedValue([cloned()]);
    mount({ settings: { voice: SONIOX_DEFAULT_VOICE, apiKey: 'k', targetLanguage: 'ja', ttsSpeed: 1.2 } });
    openManageDetails();
    const playBtn = await screen.findByRole('button', { name: /^play$/i });
    fireEvent.click(playBtn);
    await waitFor(() => expect(synthesizeMock).toHaveBeenCalledTimes(1));
    expect(synthesizeMock.mock.calls[0][0]).toMatchObject({
      apiKey: 'k',
      voice: 'uuid-1',
      language: 'ja',
      text: 'こんにちは。これはこの声の短い試聴です。',
      speed: 1.2,
    });
  });

  it('falls back to the English pair for a target language with no seeded sentence', async () => {
    listMock.mockResolvedValue([cloned()]);
    mount({ settings: { voice: SONIOX_DEFAULT_VOICE, apiKey: 'k', targetLanguage: 'cy', ttsSpeed: 1.0 } });
    openManageDetails();
    fireEvent.click(await screen.findByRole('button', { name: /^play$/i }));
    await waitFor(() => expect(synthesizeMock).toHaveBeenCalledTimes(1));
    expect(synthesizeMock.mock.calls[0][0]).toMatchObject({
      language: 'en',
      text: 'Hello. This is a short preview of how this voice sounds.',
    });
  });

  it('reuses the cached clip on a second preview of the same voice', async () => {
    listMock.mockResolvedValue([cloned()]);
    mount();
    openManageDetails();
    fireEvent.click(await screen.findByRole('button', { name: /^play$/i }));
    await waitFor(() => expect(synthesizeMock).toHaveBeenCalledTimes(1));
    // Stop, then play again — no second synthesis, no second charge.
    fireEvent.click(await screen.findByRole('button', { name: /^stop$/i }));
    fireEvent.click(await screen.findByRole('button', { name: /^play$/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /^stop$/i })).toBeInTheDocument());
    expect(synthesizeMock).toHaveBeenCalledTimes(1);
  });

  it('does not replay a preview cached under a previous API key after the client changes', async () => {
    // A changed API key means a (possibly) different Soniox project: audio
    // cached against the old project's UUIDs must not replay under the new
    // key — that would mean hearing another project's cloned voice.
    listMock.mockResolvedValue([cloned()]);
    const onUpdate = vi.fn();
    const props = {
      settings: { voice: SONIOX_DEFAULT_VOICE, apiKey: 'k', targetLanguage: 'ja', ttsSpeed: 1.0 },
      onUpdate,
      source: fakeSource(),
      managed: false,
      isSessionActive: false,
    };
    const { rerender } = render(<SonioxVoiceSection {...props} />);
    openManageDetails();
    fireEvent.click(await screen.findByRole('button', { name: /^play$/i }));
    await waitFor(() => expect(synthesizeMock).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByRole('button', { name: /^stop$/i }));

    // A new fakeSource() mirrors the fresh memoized source a real key swap
    // produces in ProviderSpecificSettings.tsx.
    rerender(<SonioxVoiceSection {...props} settings={{ ...props.settings, apiKey: 'other-key' }} source={fakeSource()} />);
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
    fireEvent.click(await screen.findByRole('button', { name: /^play$/i }));
    await waitFor(() => expect(synthesizeMock).toHaveBeenCalledTimes(2));
  });

  it('discards a preview that resolves after the API key changed', async () => {
    // The in-flight case the clear-on-change effect cannot cover on its own:
    // it clears at swap time, but a request started under the OLD key lands
    // afterwards and would both play the old project's audio and reseed the
    // NEW key's cache with it.
    listMock.mockResolvedValue([cloned()]);
    let release: (v: { audio: Float32Array; sampleRate: number }) => void = () => {};
    synthesizeMock.mockImplementationOnce(() => new Promise((res) => { release = res; }));
    const props = {
      settings: { voice: SONIOX_DEFAULT_VOICE, apiKey: 'k', targetLanguage: 'ja', ttsSpeed: 1.0 },
      onUpdate: vi.fn(),
      source: fakeSource(),
      managed: false,
      isSessionActive: false,
    };
    const { rerender } = render(<SonioxVoiceSection {...props} />);
    openManageDetails();
    fireEvent.click(await screen.findByRole('button', { name: /^play$/i }));
    await waitFor(() => expect(synthesizeMock).toHaveBeenCalledTimes(1));

    // Swap the key while the synthesis is still in flight, then let it land.
    // A new fakeSource() mirrors the fresh memoized source a real key swap
    // produces in ProviderSpecificSettings.tsx.
    rerender(<SonioxVoiceSection {...props} settings={{ ...props.settings, apiKey: 'other-key' }} source={fakeSource()} />);
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
    release({ audio: new Float32Array(2048), sampleRate: 24000 });
    await waitFor(() => expect(screen.queryByRole('button', { name: /synthesizing/i })).toBeNull());

    // Neither played...
    expect(screen.queryByRole('button', { name: /^stop$/i })).toBeNull();
    // ...nor cached: the next click has to synthesize again.
    fireEvent.click(screen.getByRole('button', { name: /^play$/i }));
    await waitFor(() => expect(synthesizeMock).toHaveBeenCalledTimes(2));
  });

  it('renders no preview button for processing or failed clones', async () => {
    listMock.mockResolvedValue([
      cloned({ id: 'proc', name: 'Cooking', models: [{ model: SONIOX_TTS_MODEL, status: 'processing' }] }),
      cloned({ id: 'bad', name: 'Broken', models: [{ model: SONIOX_TTS_MODEL, status: 'failed' }] }),
    ]);
    mount();
    openManageDetails();
    // findAllByText, not findByText: the same label appears twice (the hidden
    // <option> and the manage-list row) — jsdom doesn't drop <option> text
    // content the way a real select's native chrome would. All this needs to
    // confirm is that the async list has landed.
    await screen.findAllByText(/Cooking/);
    expect(screen.queryByRole('button', { name: /^play$/i })).toBeNull();
  });

  it('surfaces a mapped synthesis failure in the capture-error banner', async () => {
    listMock.mockResolvedValue([cloned()]);
    synthesizeMock.mockRejectedValue(new SonioxVoicesError('unauthenticated', 'bad key', 401));
    mount();
    openManageDetails();
    fireEvent.click(await screen.findByRole('button', { name: /^play$/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/check the API key/i);
  });

  it('keeps the banner empty when the preview was cancelled by the user', async () => {
    listMock.mockResolvedValue([cloned()]);
    synthesizeMock.mockRejectedValue(new SonioxVoicesError('aborted', 'Preview cancelled', 0));
    mount();
    openManageDetails();
    fireEvent.click(await screen.findByRole('button', { name: /^play$/i }));
    await waitFor(() => expect(synthesizeMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('offers no preview affordance and no cost hint without an API key', async () => {
    mount({ settings: { voice: SONIOX_DEFAULT_VOICE, apiKey: '', targetLanguage: 'ja', ttsSpeed: 1.0 }, source: null });
    await waitFor(() => expect(screen.queryByRole('button', { name: /^play$/i })).toBeNull());
    expect(screen.queryByText(/your own Soniox quota/i)).toBeNull();
  });

  it('renders the cost hint inside the manage body, not as a standalone setting item', async () => {
    // The hint describes the per-row preview button, so it belongs with those
    // rows behind the "Manage imported voices" expander. Asserting mere
    // presence would not catch a regression here: <details> keeps its collapsed
    // content in the DOM, so a hint rendered anywhere in the section is still
    // findable. Only the ancestry assertions pin the placement.
    mount();
    const hint = await screen.findByText(/your own Soniox quota/i);
    expect(hint.closest('.voice-library-manage-body')).not.toBeNull();
    expect(hint.closest('.setting-item')).toBeNull();
  });

  it('keeps preview available during an active session', async () => {
    // Deliberate: VoiceLibrarySection's contract keeps import/rename/delete
    // open mid-session so users can stage voices for the next one, and preview
    // audio goes to the default output rather than the session's (possibly
    // virtual) device, so it cannot leak into a meeting.
    listMock.mockResolvedValue([cloned()]);
    mount({ isSessionActive: true });
    openManageDetails();
    fireEvent.click(await screen.findByRole('button', { name: /^play$/i }));
    await waitFor(() => expect(synthesizeMock).toHaveBeenCalledTimes(1));
  });
});
