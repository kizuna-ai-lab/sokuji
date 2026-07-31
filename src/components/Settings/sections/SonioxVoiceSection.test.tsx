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

describe('SonioxVoiceSection', () => {
  beforeEach(() => {
    listMock.mockReset().mockResolvedValue([]);
    createMock.mockReset();
    deleteMock.mockReset().mockResolvedValue(undefined);
    waitMock.mockReset();
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

  it('managed mode renders built-ins only: no fetch, no consent/create affordances', () => {
    const { container } = mount({ managed: true });
    expect(listMock).not.toHaveBeenCalled();
    expect(container.querySelector('#soniox-voice-consent')).toBeNull();
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

  it('consent gates the create affordances: hidden until checked, then Record/Import appear', async () => {
    listMock.mockResolvedValue([]);
    const { container } = mount();
    await waitFor(() => expect(listMock).toHaveBeenCalled());
    // Unconsented: capability.importModes is empty, so VoiceLibrarySection
    // never renders the "Manage imported voices" details/summary at all.
    expect(screen.queryByText(/manage imported voices/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /import voice/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /record voice/i })).toBeNull();

    fireEvent.click(container.querySelector('#soniox-voice-consent')!);

    fireEvent.click(screen.getByText(/manage imported voices/i));
    expect(screen.getByRole('button', { name: /import voice/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /record voice/i })).toBeInTheDocument();
  });

  it('onImport rejects a file over 10MB before decoding or creating', async () => {
    listMock.mockResolvedValue([]);
    const { container } = mount();
    fireEvent.click(container.querySelector('#soniox-voice-consent')!);
    fireEvent.click(screen.getByText(/manage imported voices/i));
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const bigFile = fakeFile('big.wav', 11 * 1024 * 1024);
    fireEvent.change(fileInput, { target: { files: [bigFile] } });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/too large/i));
    expect(createMock).not.toHaveBeenCalled();
  });

  it('onImport rejects a decoded clip shorter than 3s with the localized message', async () => {
    listMock.mockResolvedValue([]);
    stubAudioContext(16000, 16000 * 1); // 1s — below the 3s minimum
    const { container } = mount();
    fireEvent.click(container.querySelector('#soniox-voice-consent')!);
    fireEvent.click(screen.getByText(/manage imported voices/i));
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = fakeFile('clip.wav');
    fireEvent.change(fileInput, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/too short/i));
    expect(createMock).not.toHaveBeenCalled();
  });

  it('onImport rejects a decoded clip longer than 20s with the localized message', async () => {
    listMock.mockResolvedValue([]);
    stubAudioContext(16000, 16000 * 25); // 25s — above the 20s maximum
    const { container } = mount();
    fireEvent.click(container.querySelector('#soniox-voice-consent')!);
    fireEvent.click(screen.getByText(/manage imported voices/i));
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = fakeFile('clip.wav');
    fireEvent.change(fileInput, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/too long/i));
    expect(createMock).not.toHaveBeenCalled();
  });

  it('onImport falls back to the nextName() default when the basename strips to empty', async () => {
    listMock.mockResolvedValue([]);
    createMock.mockResolvedValue({ id: 'new-id', name: 'x', models: [] });
    waitMock.mockResolvedValue({ id: 'new-id', name: 'x', models: [READY] });
    stubAudioContext(16000, 16000 * 5); // 5s — valid
    const { container } = mount();
    fireEvent.click(container.querySelector('#soniox-voice-consent')!);
    fireEvent.click(screen.getByText(/manage imported voices/i));
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    // ".wav" strips to an empty basename via the `.[^.]+$` replace.
    const file = fakeFile('.wav');
    fireEvent.change(fileInput, { target: { files: [file] } });
    await waitFor(() => expect(createMock).toHaveBeenCalled());
    const usedName = createMock.mock.calls[0][0];
    expect(usedName).not.toBe('');
    // The mocked t() returns the raw default string unfilled — this is
    // nextName()'s "My Voice {{n}}" fallback, not an empty/garbage name.
    expect(usedName).toContain('My Voice');
  });
});
