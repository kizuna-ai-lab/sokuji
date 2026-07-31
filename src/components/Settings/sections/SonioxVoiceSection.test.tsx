import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({ t: (_k: string, def?: string) => def ?? _k, i18n: { language: 'en' } }),
  };
});

const listMock = vi.fn();
const createMock = vi.fn();
const deleteMock = vi.fn();
const waitMock = vi.fn();
vi.mock('../../../services/clients/SonioxVoicesClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/clients/SonioxVoicesClient')>();
  return {
    ...actual, // keep encodeWavPcm16 + SonioxVoicesError real
    SonioxVoicesClient: vi.fn(function () {
      return { list: listMock, create: createMock, delete: deleteMock, waitUntilReady: waitMock, get: vi.fn() };
    }),
  };
});

const { default: SonioxVoiceSection } = await import('./SonioxVoiceSection');
const { SonioxVoicesError } = await import('../../../services/clients/SonioxVoicesClient');

const READY = { model: 'tts-rt-v1', status: 'ready', error_type: null, error_message: null };
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
      settings={{ voice: 'Maya', apiKey: 'k' }}
      onUpdate={onUpdate}
      managed={false}
      isSessionActive={false}
      {...over}
    />
  );
  return { onUpdate, ...utils };
}

const openManageDetails = () => fireEvent.click(screen.getByText(/manage imported voices/i));
const nameInputPlaceholder = /name for a new cloned voice/i;
const confirmButtonName = /i confirm i have the right/i;

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
  });

  it('renders the 28 built-ins immediately and cloned voices after fetch', async () => {
    listMock.mockResolvedValue([cloned()]);
    const { container } = mount();
    const select = container.querySelector('select')!;
    expect(select.querySelectorAll('option').length).toBeGreaterThanOrEqual(28);
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
    const { container } = mount({ settings: { voice: 'gone-uuid', apiKey: 'k' } });
    await waitFor(() => expect(listMock).toHaveBeenCalled());
    const select = container.querySelector('select')!;
    await waitFor(() => {
      const opt = [...select.querySelectorAll('option')].find((o) => o.value === 'gone-uuid');
      expect(opt).toBeTruthy();
    });
    expect(select.value).toBe('gone-uuid'); // stored setting is not rewritten
  });

  it('managed mode renders built-ins only: no fetch, no refresh/create affordances', () => {
    mount({ managed: true });
    expect(listMock).not.toHaveBeenCalled();
    expect(screen.queryByTitle(/refresh voice list/i)).toBeNull();
    expect(screen.queryByText(/manage imported voices/i)).toBeNull();
    expect(screen.queryByText(/Record/i)).toBeNull();
  });

  it('marks failed clones and offers no selection benefit (label carries the failed hint)', async () => {
    listMock.mockResolvedValue([cloned({ id: 'bad', name: 'Broken', models: [{ model: 'tts-rt-v1', status: 'failed' }] })]);
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
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTitle(/refresh voice list/i));
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
    stubAudioContext(16000, 16000 * 5);
    const { container } = mount();
    openManageDetails();
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput.multiple).toBe(false);
    fireEvent.change(fileInput, {
      target: { files: [fakeFile('first.wav'), fakeFile('second.wav')] },
    });
    const nameInput = await screen.findByPlaceholderText(nameInputPlaceholder);
    expect((nameInput as HTMLInputElement).value).toBe('first');
  });

  it('importing a valid file opens the confirm modal prefilled from the filename; confirm uploads with the (possibly edited) name and closes the modal', async () => {
    listMock.mockResolvedValue([]);
    createMock.mockResolvedValue({ id: 'new-id', name: 'Custom Name', models: [] });
    waitMock.mockResolvedValue({ id: 'new-id', name: 'Custom Name', models: [READY] });
    stubAudioContext(16000, 16000 * 5); // 5s — valid
    const { container, onUpdate } = mount();
    openManageDetails();
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = fakeFile('my-clip.wav');
    fireEvent.change(fileInput, { target: { files: [file] } });

    const nameInput = await screen.findByPlaceholderText(nameInputPlaceholder);
    expect(nameInput).toHaveValue('my-clip'); // stripped filename, not the raw upload name
    expect(createMock).not.toHaveBeenCalled(); // staged, not yet uploaded

    fireEvent.change(nameInput, { target: { value: 'Custom Name' } });
    fireEvent.click(screen.getByRole('button', { name: confirmButtonName }));

    await waitFor(() => expect(createMock).toHaveBeenCalledWith('Custom Name', file, 'my-clip.wav'));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith({ voice: 'new-id' }));
    expect(screen.queryByPlaceholderText(nameInputPlaceholder)).toBeNull(); // modal closed
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
    expect(nameInput).toHaveValue('My Voice {{n}}');

    fireEvent.click(screen.getByRole('button', { name: confirmButtonName }));
    await waitFor(() => expect(createMock).toHaveBeenCalled());
    expect(createMock.mock.calls[0][0]).toBe('My Voice {{n}}');
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
      await waitFor(() => expect(gum).toHaveBeenCalled());
      // Feed one chunk so the captured clip isn't empty.
      processorNode?.onaudioprocess?.({ inputBuffer: { getChannelData: () => new Float32Array(1600).fill(0.1) } });
      fireEvent.click(screen.getByRole('button', { name: /stop recording/i }));

      const nameInput = await screen.findByPlaceholderText(nameInputPlaceholder);
      expect(nameInput).toHaveValue('My Voice {{n}}');
      expect(createMock).not.toHaveBeenCalled(); // staged, not yet uploaded
    } finally {
      if (originalMediaDevices) Object.defineProperty(navigator, 'mediaDevices', originalMediaDevices);
      else delete (navigator as { mediaDevices?: unknown }).mediaDevices;
      vi.unstubAllGlobals();
    }
  });
});
