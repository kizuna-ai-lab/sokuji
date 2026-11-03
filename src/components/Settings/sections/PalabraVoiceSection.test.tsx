import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { clearPreviewCache } from '../../../lib/tts/previewCache';
import type { PalabraVoiceSource } from '../../../providers/palabraai/voiceSource';
import { PalabraVoicesError, type PalabraVoiceInfo } from '../../../providers/palabraai/voicesClient';
import PalabraVoiceSection, { type PalabraVoiceSectionProps } from './PalabraVoiceSection';

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (_k: string, def?: unknown, opts?: Record<string, unknown>) =>
        typeof def === 'string' ? def.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(opts?.[k] ?? '')) : _k,
      i18n: { language: 'en' },
    }),
  };
});

const listMock = vi.fn();
const getMock = vi.fn();
const createMock = vi.fn();
const deleteMock = vi.fn();
const limitsMock = vi.fn();
const previewMock = vi.fn();
const cachedMock = vi.fn();

function fakeSource(over: Partial<PalabraVoiceSource> = {}): PalabraVoiceSource {
  return { list: listMock, get: getMock, create: createMock, delete: deleteMock, limits: limitsMock, preview: previewMock, cached: cachedMock, cacheNamespace: 'palabra', ...over };
}

const voice = (over: Partial<PalabraVoiceInfo> = {}): PalabraVoiceInfo => ({
  id: 'v', name: 'V', language: 'en', facets: {}, status: 'ready', sample: 'https://cdn.palabra.ai/blob/v.mp3', ...over,
});
const HU_MALE = voice({ id: 'hu-m', name: 'Hungarian Male', language: 'hu', facets: { gender: 'male' }, sample: 'https://cdn.palabra.ai/blob/hu-m.mp3' });
const HU_FEMALE = voice({ id: 'hu-f', name: 'Hungarian Female', language: 'hu', facets: { gender: 'female' }, sample: 'https://cdn.palabra.ai/blob/hu-f.mp3' });
const JA_FEMALE = voice({ id: 'ja-f', name: 'Japanese Female', language: 'ja', facets: { gender: 'female' }, sample: 'https://cdn.palabra.ai/blob/ja-f.mp3' });
const MINE_READY = voice({ id: 'mine-1', name: 'István', language: 'hu', sample: 'https://cdn.palabra.ai/blob/mine-1.mp3' });

const SETTINGS = { voiceId: 'default_low', voiceName: '', participantVoiceId: 'default_high', participantVoiceName: '' };

function mount(over: Partial<PalabraVoiceSectionProps> = {}) {
  const onSelect = vi.fn();
  const props: PalabraVoiceSectionProps = {
    settings: SETTINGS, onSelect, source: fakeSource(), target: 'hu', pairSource: 'en', isSessionActive: false, ...over,
  };
  const utils = render(<PalabraVoiceSection {...props} />);
  return { ...utils, onSelect, props };
}

// By class: while the popover is open, floating-ui's focus guards sit beside the trigger.
const triggerIn = (name: string) => screen.getByRole('group', { name }).querySelector('.voice-picker__trigger') as HTMLElement;
const openPicker = () => fireEvent.click(screen.getByRole('button', { expanded: false }));
const inGrid = () => within(screen.getByRole('grid'));
const rowFor = (label: string | RegExp): HTMLElement => inGrid().getByRole('button', { name: label }).closest('[role="row"]') as HTMLElement;
const headers = () => inGrid().queryAllByRole('columnheader').map((h) => h.textContent?.trim());

beforeEach(() => {
  clearPreviewCache();
  listMock.mockReset().mockResolvedValue({ builtin: [HU_MALE, JA_FEMALE, HU_FEMALE], mine: [] });
  getMock.mockReset();
  createMock.mockReset();
  deleteMock.mockReset().mockResolvedValue(undefined);
  limitsMock.mockReset().mockResolvedValue({ used: 1, limit: 10, remaining: 9 });
  previewMock.mockReset().mockResolvedValue({ audio: new Float32Array(2048), sampleRate: 24000 });
  cachedMock.mockReset().mockReturnValue(null);
  (window as any).AudioContext = function AudioContext() {
    return {
      state: 'running', resume: vi.fn().mockResolvedValue(undefined), destination: {},
      createBuffer: vi.fn(() => ({ copyToChannel: vi.fn() })),
      createBufferSource: vi.fn(() => ({ connect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null, buffer: null })),
      close: vi.fn().mockResolvedValue(undefined), decodeAudioData: vi.fn(),
    };
  };
});

describe('PalabraVoiceSection: the list', () => {
  it('with no source, lists only Default Low and Default High, with no refresh, add or preview', () => {
    mount({ source: null });
    expect(listMock).not.toHaveBeenCalled();
    openPicker();
    expect(inGrid().getByRole('button', { name: 'Default Low' })).toBeInTheDocument();
    expect(inGrid().getByRole('button', { name: 'Default High' })).toBeInTheDocument();
    expect(inGrid().queryByRole('button', { name: /refresh voice list/i })).toBeNull();
    expect(inGrid().queryByRole('button', { name: /add a voice/i })).toBeNull();
    expect(inGrid().queryByRole('button', { name: /^play$/i })).toBeNull();
  });

  it("lists built-ins in two sections, the target's language first", async () => {
    mount({ target: 'hu' });
    openPicker();
    await waitFor(() => expect(inGrid().getByRole('button', { name: 'Japanese Female' })).toBeInTheDocument());
    const h = headers();
    expect(h.indexOf('Hungarian')).toBeGreaterThan(-1);
    expect(h.indexOf('Other languages')).toBeGreaterThan(h.indexOf('Hungarian'));
    const order = inGrid().getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? '').filter((l) => /Male|Female/.test(l));
    expect(order.indexOf('Hungarian Female')).toBeLessThan(order.indexOf('Japanese Female'));
    expect(order.indexOf('Hungarian Male')).toBeLessThan(order.indexOf('Japanese Female'));
  });

  it('the gender facet works and no age facet is offered', async () => {
    mount();
    openPicker();
    await waitFor(() => expect(inGrid().getByRole('button', { name: 'Hungarian Male' })).toBeInTheDocument());
    expect(screen.queryByRole('combobox', { name: 'Age' })).toBeNull();
    fireEvent.change(screen.getByRole('combobox', { name: 'Gender' }), { target: { value: 'female' } });
    await waitFor(() => expect(inGrid().queryByRole('button', { name: 'Hungarian Male' })).toBeNull());
    expect(inGrid().getByRole('button', { name: 'Hungarian Female' })).toBeInTheDocument();
  });

  it('account voices: processing and failed are badged, disabled and removable', async () => {
    listMock.mockResolvedValue({ builtin: [], mine: [MINE_READY, voice({ id: 'p', name: 'Busy', status: 'processing', sample: null }), voice({ id: 'f', name: 'Broken', status: 'failed', sample: null })] });
    mount();
    openPicker();
    await waitFor(() => expect(inGrid().getByRole('button', { name: 'István' })).toBeInTheDocument());
    expect(inGrid().getByRole('button', { name: /Busy — processing…/ })).toBeDisabled();
    expect(inGrid().getByRole('button', { name: /Broken — failed/ })).toBeDisabled();
    expect(within(rowFor('István')).getByRole('button', { name: /delete/i })).toBeInTheDocument();
  });

  it('selecting writes id and name together', async () => {
    const { onSelect } = mount();
    openPicker();
    await waitFor(() => expect(inGrid().getByRole('button', { name: 'Hungarian Male' })).toBeInTheDocument());
    fireEvent.click(inGrid().getByRole('button', { name: 'Hungarian Male' }));
    expect(onSelect).toHaveBeenCalledWith({ voiceId: 'hu-m', voiceName: 'Hungarian Male' });
  });

  it('a stored id missing after a successful fetch shows "(deleted voice)"', async () => {
    const { onSelect } = mount({ settings: { ...SETTINGS, voiceId: 'gone', voiceName: 'Old Voice' } });
    await waitFor(() => expect(listMock).toHaveBeenCalled());
    openPicker();
    await waitFor(() => expect(inGrid().getByRole('button', { name: /deleted voice/i })).toBeInTheDocument());
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('a stored id after a FAILED fetch shows the stored name, not "(deleted voice)"', async () => {
    listMock.mockRejectedValue(new Error('offline'));
    mount({ settings: { ...SETTINGS, voiceId: 'hu-m', voiceName: 'Hungarian Male' } });
    await waitFor(() => expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument());
    expect(triggerIn('Voice')).toHaveTextContent('Hungarian Male');
    openPicker();
    expect(inGrid().queryByRole('button', { name: /deleted voice/i })).toBeNull();
  });

  it('a failed fetch shows the Retry banner and Retry refetches', async () => {
    listMock.mockRejectedValueOnce(new Error('offline'));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /retry/i }));
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('button', { name: /retry/i })).toBeNull());
  });

  it('the second row lists defaults and built-ins only, sectioned by pairSource, and writes participantVoiceId/participantVoiceName', async () => {
    listMock.mockResolvedValue({ builtin: [HU_MALE, JA_FEMALE], mine: [MINE_READY] });
    const { onSelect } = mount({ target: 'hu', pairSource: 'ja', participant: { effective: 'default_high' } });
    expect(triggerIn('Voice the other side hears')).toBeInTheDocument();
    fireEvent.click(triggerIn('Voice I hear'));
    await waitFor(() => expect(inGrid().getByRole('button', { name: 'Japanese Female' })).toBeInTheDocument());
    expect(inGrid().queryByRole('button', { name: 'István' })).toBeNull();
    const h = headers();
    expect(h.indexOf('Japanese')).toBeGreaterThan(-1);
    expect(h.indexOf('Other languages')).toBeGreaterThan(h.indexOf('Japanese'));
    fireEvent.click(inGrid().getByRole('button', { name: 'Japanese Female' }));
    expect(onSelect).toHaveBeenCalledWith({ participantVoiceId: 'ja-f', participantVoiceName: 'Japanese Female' });
  });

  it('previewing a built-in calls source.preview with its sample; the defaults have no preview button', async () => {
    mount();
    openPicker();
    await waitFor(() => expect(inGrid().getByRole('button', { name: 'Hungarian Male' })).toBeInTheDocument());
    expect(within(rowFor('Default Low')).queryByRole('button', { name: /^play$/i })).toBeNull();
    fireEvent.click(within(rowFor('Hungarian Male')).getByRole('button', { name: /^play$/i }));
    await waitFor(() => expect(previewMock).toHaveBeenCalledTimes(1));
    expect(previewMock.mock.calls[0][0]).toMatchObject({ id: 'hu-m', sample: 'https://cdn.palabra.ai/blob/hu-m.mp3' });
  });

  it('quota shows used/limit; a failed limits call hides it without a banner', async () => {
    listMock.mockResolvedValue({ builtin: [HU_MALE], mine: [MINE_READY] });
    const { unmount } = mount();
    openPicker();
    await waitFor(() => expect(screen.getByText(/1\s*\/\s*10/)).toBeInTheDocument());
    unmount();
    limitsMock.mockRejectedValue(new Error('nope'));
    mount();
    openPicker();
    await waitFor(() => expect(inGrid().getByRole('button', { name: 'Hungarian Male' })).toBeInTheDocument());
    expect(screen.queryByText(/\d+\s*\/\s*10/)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Creating, polling and deleting (spec §4 "Creating a voice", "Delete").
// ---------------------------------------------------------------------------

function fakeFile(name: string, size = 10, type = 'audio/mpeg'): File {
  return { name, size, type, arrayBuffer: async () => new ArrayBuffer(size) } as unknown as File;
}

/** Decoding resolves a mono buffer of the given length, loud enough to pass the silence check. */
function stubDecode(seconds: number, sampleRate = 16000) {
  const n = Math.round(seconds * sampleRate);
  const ctx = {
    decodeAudioData: vi.fn().mockResolvedValue({ numberOfChannels: 1, length: n, sampleRate, getChannelData: () => new Float32Array(n).fill(0.5) }),
    close: vi.fn().mockResolvedValue(undefined),
  };
  (window as any).AudioContext = function AudioContext() { return ctx; };
  return ctx;
}

/** A sleep the test drives: every wait is recorded; `resolveAll` lets them finish; an abort rejects. */
function manualSleep() {
  const waits: Array<{ ms: number; resolve: () => void }> = [];
  const sleep = vi.fn((ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
    waits.push({ ms, resolve });
    signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
  }));
  return { sleep, waits, next: () => waits.shift()?.resolve() };
}
/** A sleep that never waits, recording what it was asked for. */
const instantSleep = () => vi.fn(async (_ms: number, _signal: AbortSignal) => {});

const createDialog = () => screen.getByRole('dialog', { name: /add a voice/i });
const openCreateModal = () => {
  openPicker();
  fireEvent.click(screen.getByRole('button', { name: /add a voice/i }));
};
const importFile = (file: File) => {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
};
const confirmButton = () => within(createDialog()).getByRole('button', { name: /^clone voice$/i });
const checkConsent = () => fireEvent.click(within(createDialog()).getByRole('checkbox'));
const languageSelect = () => within(createDialog()).getByRole('combobox', { name: 'Language of the recording' }) as HTMLSelectElement;

describe('PalabraVoiceSection: creating a voice', () => {
  beforeEach(() => {
    (URL as any).createObjectURL = vi.fn(() => 'blob:mock');
    (URL as any).revokeObjectURL = vi.fn();
    (window.HTMLMediaElement.prototype as any).play = vi.fn().mockResolvedValue(undefined);
    (window.HTMLMediaElement.prototype as any).pause = vi.fn();
    listMock.mockResolvedValue({ builtin: [HU_MALE], mine: [] });
  });

  it('an imported file over 10 MB, or decoding to more than 90 s, is refused', async () => {
    stubDecode(120);
    mount();
    await waitFor(() => expect(listMock).toHaveBeenCalled());
    openCreateModal();
    importFile(fakeFile('big.mp3', 10_000_001));
    await waitFor(() => expect(within(createDialog()).getByRole('alert')).toHaveTextContent(/too large/i));
    importFile(fakeFile('long.mp3', 1000));
    await waitFor(() => expect(within(createDialog()).getByRole('alert')).toHaveTextContent(/too long/i));
    expect(screen.queryByRole('combobox', { name: 'Language of the recording' })).toBeNull();
    expect(createMock).not.toHaveBeenCalled();
  });

  it('an imported clip shorter than 30 s is refused with the "too short" message and stages nothing', async () => {
    stubDecode(12);
    mount();
    await waitFor(() => expect(listMock).toHaveBeenCalled());
    openCreateModal();
    importFile(fakeFile('short.mp3', 1000));
    await waitFor(() => expect(within(createDialog()).getByRole('alert')).toHaveTextContent(/too short/i));
    expect(screen.queryByRole('combobox', { name: 'Language of the recording' })).toBeNull();
  });

  it('an imported MP3 is re-encoded: create receives a WAV Blob and denoise false', async () => {
    stubDecode(40);
    createMock.mockResolvedValue(voice({ id: 'new-1', name: 'Hello', status: 'processing', sample: null }));
    getMock.mockResolvedValue(voice({ id: 'new-1', name: 'Hello', status: 'processing', sample: null }));
    mount({ pairSource: 'hu', sleep: manualSleep().sleep });
    await waitFor(() => expect(listMock).toHaveBeenCalled());
    openCreateModal();
    importFile(fakeFile('Hello.mp3', 1000));
    await waitFor(() => expect(languageSelect()).toBeInTheDocument());
    checkConsent();
    fireEvent.click(confirmButton());
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    const args = createMock.mock.calls[0][0];
    expect(args).toMatchObject({ name: 'Hello', langCode: 'hu', denoise: false });
    expect(args.wav).toBeInstanceOf(Blob);
    expect(args.wav.type).toBe('audio/wav');
  });

  it("the review offers the clone languages, preselected from pairSource ('hu' → 'hu')", async () => {
    stubDecode(40);
    mount({ pairSource: 'hu' });
    await waitFor(() => expect(listMock).toHaveBeenCalled());
    openCreateModal();
    importFile(fakeFile('clip.mp3', 1000));
    await waitFor(() => expect(languageSelect()).toBeInTheDocument());
    expect(languageSelect().value).toBe('hu');
    expect(Array.from(languageSelect().options).filter((o) => o.value)).toHaveLength(50);
  });

  it('names every clone language in words, never as its raw code', async () => {
    stubDecode(40);
    mount({ pairSource: 'hu' });
    await waitFor(() => expect(listMock).toHaveBeenCalled());
    openCreateModal();
    importFile(fakeFile('clip.mp3', 1000));
    await waitFor(() => expect(languageSelect()).toBeInTheDocument());
    const options = Array.from(languageSelect().options).filter((o) => o.value);
    expect(options.filter((o) => o.textContent === o.value).map((o) => o.value)).toEqual([]);
    expect(options.find((o) => o.value === 'es-la')?.textContent).toMatch(/Latin America/);
    expect(options.find((o) => o.value === 'es-ch')?.textContent).toMatch(/Chile/);
  });

  it("with pairSource 'auto' the language falls back to the interface language, and an empty choice disables Confirm", async () => {
    stubDecode(40);
    mount({ pairSource: 'auto' });
    await waitFor(() => expect(listMock).toHaveBeenCalled());
    openCreateModal();
    importFile(fakeFile('clip.mp3', 1000));
    await waitFor(() => expect(languageSelect()).toBeInTheDocument());
    // The interface language (en) is a clone language, so it is the fallback; clear it to see the empty state.
    expect(languageSelect().value).toBe('en');
    fireEvent.change(languageSelect(), { target: { value: '' } });
    checkConsent();
    expect(confirmButton()).toBeDisabled();
    expect(createMock).not.toHaveBeenCalled();
  });

  it('a name outside the pattern is refused inline before any request', async () => {
    stubDecode(40);
    mount({ pairSource: 'hu' });
    await waitFor(() => expect(listMock).toHaveBeenCalled());
    openCreateModal();
    importFile(fakeFile('clip.mp3', 1000));
    await waitFor(() => expect(languageSelect()).toBeInTheDocument());
    fireEvent.change(within(createDialog()).getByRole('textbox'), { target: { value: "it's" } });
    checkConsent();
    fireEvent.click(confirmButton());
    await waitFor(() => expect(within(createDialog()).getByRole('alert')).toHaveTextContent(/3–64/));
    expect(createMock).not.toHaveBeenCalled();
  });

  it('create failing with limit_reached keeps the dialog open with the limit message', async () => {
    stubDecode(40);
    createMock.mockRejectedValue(new PalabraVoicesError('limit_reached', 'HTTP 422: limit', 422));
    mount({ pairSource: 'hu' });
    await waitFor(() => expect(listMock).toHaveBeenCalled());
    openCreateModal();
    importFile(fakeFile('clip.mp3', 1000));
    await waitFor(() => expect(languageSelect()).toBeInTheDocument());
    checkConsent();
    fireEvent.click(confirmButton());
    await waitFor(() => expect(within(createDialog()).getByRole('alert')).toHaveTextContent(/voice limit/i));
  });

  it('remaining 0 withdraws record and upload', async () => {
    limitsMock.mockResolvedValue({ used: 10, limit: 10, remaining: 0 });
    listMock.mockResolvedValue({ builtin: [HU_MALE], mine: [MINE_READY] });
    mount();
    openPicker();
    await waitFor(() => expect(screen.getByText(/10\s*\/\s*10/)).toBeInTheDocument());
    expect(inGrid().queryByRole('button', { name: /add a voice/i })).toBeNull();
  });

  it('confirm calls create, refreshes, closes, then polls get every 5 s, then 15 s after a minute', async () => {
    stubDecode(40);
    const processing = voice({ id: 'new-1', name: 'clip', status: 'processing', sample: null });
    createMock.mockResolvedValue(processing);
    listMock
      .mockResolvedValueOnce({ builtin: [HU_MALE], mine: [] })
      .mockResolvedValue({ builtin: [HU_MALE], mine: [processing] });
    let polls = 0;
    getMock.mockImplementation(async () => (++polls < 15 ? processing : { ...processing, status: 'ready' }));
    const sleep = instantSleep();
    mount({ pairSource: 'hu', sleep });
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(1));
    openCreateModal();
    importFile(fakeFile('clip.mp3', 1000));
    await waitFor(() => expect(languageSelect()).toBeInTheDocument());
    checkConsent();
    fireEvent.click(confirmButton());
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /add a voice/i })).toBeNull());
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(15));
    const delays = sleep.mock.calls.map(([ms]) => ms);
    expect(delays.slice(0, 12)).toEqual(Array(12).fill(5000));
    expect(delays.slice(12, 15)).toEqual([15000, 15000, 15000]);
  });

  it('when get turns ready, the list refreshes and the new voice is selected with its name', async () => {
    stubDecode(40);
    const processing = voice({ id: 'new-1', name: 'clip', status: 'processing', sample: null });
    createMock.mockResolvedValue(processing);
    listMock.mockResolvedValueOnce({ builtin: [HU_MALE], mine: [] }).mockResolvedValue({ builtin: [HU_MALE], mine: [processing] });
    getMock.mockResolvedValue({ ...processing, status: 'ready', sample: 'https://cdn.palabra.ai/blob/new-1.mp3' });
    const { onSelect } = mount({ pairSource: 'hu', sleep: instantSleep() });
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(1));
    openCreateModal();
    importFile(fakeFile('clip.mp3', 1000));
    await waitFor(() => expect(languageSelect()).toBeInTheDocument());
    checkConsent();
    fireEvent.click(confirmButton());
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith({ voiceId: 'new-1', voiceName: 'clip' }));
    expect(listMock.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('no auto-select if the user picked another voice meanwhile, or a session started, or the section unmounted', async () => {
    const processing = voice({ id: 'new-1', name: 'clip', status: 'processing', sample: null });
    const run = async (after: (utils: ReturnType<typeof mount>) => void) => {
      stubDecode(40);
      createMock.mockReset().mockResolvedValue(processing);
      listMock.mockReset().mockResolvedValueOnce({ builtin: [HU_MALE], mine: [] }).mockResolvedValue({ builtin: [HU_MALE], mine: [processing] });
      getMock.mockReset().mockResolvedValue({ ...processing, status: 'ready' });
      const clock = manualSleep();
      const utils = mount({ pairSource: 'hu', sleep: clock.sleep });
      await waitFor(() => expect(listMock).toHaveBeenCalledTimes(1));
      openCreateModal();
      importFile(fakeFile('clip.mp3', 1000));
      await waitFor(() => expect(languageSelect()).toBeInTheDocument());
      checkConsent();
      fireEvent.click(confirmButton());
      await waitFor(() => expect(clock.waits.length).toBe(1));
      after(utils);
      clock.next();
      await new Promise((r) => setTimeout(r, 20));
      return utils;
    };
    // Picked another voice meanwhile.
    let u = await run((utils) => utils.rerender(<PalabraVoiceSection {...utils.props} settings={{ ...SETTINGS, voiceId: 'hu-m', voiceName: 'Hungarian Male' }} />));
    expect(u.onSelect).not.toHaveBeenCalledWith(expect.objectContaining({ voiceId: 'new-1' }));
    u.unmount();
    // A session started.
    u = await run((utils) => utils.rerender(<PalabraVoiceSection {...utils.props} isSessionActive />));
    expect(u.onSelect).not.toHaveBeenCalledWith(expect.objectContaining({ voiceId: 'new-1' }));
    u.unmount();
    // Unmounted: polling stops.
    u = await run((utils) => utils.unmount());
    expect(getMock).not.toHaveBeenCalled();
    expect(u.onSelect).not.toHaveBeenCalled();
  });

  it('a section mounting with a processing voice in the list polls it and refreshes when it settles, without selecting it', async () => {
    const processing = voice({ id: 'old-1', name: 'Earlier', status: 'processing', sample: null });
    listMock.mockResolvedValueOnce({ builtin: [HU_MALE], mine: [processing] }).mockResolvedValue({ builtin: [HU_MALE], mine: [{ ...processing, status: 'ready' }] });
    getMock.mockResolvedValueOnce(processing).mockResolvedValue({ ...processing, status: 'ready' });
    const { onSelect } = mount({ sleep: instantSleep() });
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('get → not_found while polling: refresh and show the "could not process" message', async () => {
    const processing = voice({ id: 'old-1', name: 'Earlier', status: 'processing', sample: null });
    listMock.mockResolvedValueOnce({ builtin: [HU_MALE], mine: [processing] }).mockResolvedValue({ builtin: [HU_MALE], mine: [] });
    getMock.mockRejectedValue(new PalabraVoicesError('not_found', 'HTTP 404: gone', 404));
    mount({ sleep: instantSleep() });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/could not process this recording/i));
    expect(listMock).toHaveBeenCalledTimes(2);
  });

  it('polling gives up after 15 minutes with the timeout message', async () => {
    const processing = voice({ id: 'old-1', name: 'Earlier', status: 'processing', sample: null });
    listMock.mockResolvedValue({ builtin: [HU_MALE], mine: [processing] });
    getMock.mockResolvedValue(processing);
    const sleep = instantSleep();
    mount({ sleep });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/still processing/i));
    const total = sleep.mock.calls.reduce((n, [ms]) => n + ms, 0);
    expect(total).toBe(15 * 60 * 1000);
  });
});

describe('PalabraVoiceSection: recording a voice', () => {
  /** Drives the shared recorder: one chunk of `seconds` at 16 kHz, then Stop. */
  async function record(seconds: number) {
    const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] })) } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let processorNode: any = null;
    class FakeAudioContext {
      sampleRate = 16000;
      destination = {};
      createMediaStreamSource() { return { connect: vi.fn(), disconnect: vi.fn() }; }
      createScriptProcessor() { processorNode = { connect: vi.fn(), disconnect: vi.fn(), onaudioprocess: null }; return processorNode; }
      close = vi.fn().mockResolvedValue(undefined);
    }
    vi.stubGlobal('AudioContext', FakeAudioContext);
    try {
      fireEvent.click(screen.getByRole('button', { name: /record voice/i }));
      const stop = await screen.findByRole('button', { name: /stop recording/i });
      processorNode?.onaudioprocess?.({ inputBuffer: { getChannelData: () => new Float32Array(Math.round(16000 * seconds)).fill(0.1) } });
      fireEvent.click(stop);
    } finally {
      if (originalMediaDevices) Object.defineProperty(navigator, 'mediaDevices', originalMediaDevices);
      else delete (navigator as { mediaDevices?: unknown }).mediaDevices;
    }
  }

  beforeEach(() => {
    (URL as any).createObjectURL = vi.fn(() => 'blob:mock');
    (URL as any).revokeObjectURL = vi.fn();
    (window.HTMLMediaElement.prototype as any).play = vi.fn().mockResolvedValue(undefined);
    (window.HTMLMediaElement.prototype as any).pause = vi.fn();
    listMock.mockResolvedValue({ builtin: [HU_MALE], mine: [] });
  });

  it('a recording shorter than 30 s is refused with the "too short" message and stages nothing', async () => {
    mount({ pairSource: 'hu' });
    await waitFor(() => expect(listMock).toHaveBeenCalled());
    openCreateModal();
    try {
      await record(0.5);
      await waitFor(() => expect(within(createDialog()).getByRole('alert')).toHaveTextContent(/too short/i));
      expect(screen.queryByRole('combobox', { name: 'Language of the recording' })).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a recording is uploaded with denoise true', async () => {
    createMock.mockResolvedValue(voice({ id: 'rec-1', name: 'My Voice 1', status: 'processing', sample: null }));
    getMock.mockResolvedValue(voice({ id: 'rec-1', name: 'My Voice 1', status: 'processing', sample: null }));
    mount({ pairSource: 'hu', sleep: manualSleep().sleep });
    await waitFor(() => expect(listMock).toHaveBeenCalled());
    openCreateModal();
    try {
      await record(31);
      await waitFor(() => expect(languageSelect()).toBeInTheDocument());
      checkConsent();
      fireEvent.click(confirmButton());
      await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
      expect(createMock.mock.calls[0][0]).toMatchObject({ name: 'My Voice 1', langCode: 'hu', denoise: true });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('PalabraVoiceSection: deleting a voice', () => {
  it('delete is refused while a session uses that voice; otherwise deletes, refreshes, and resets a selected voice', async () => {
    listMock.mockResolvedValue({ builtin: [HU_MALE], mine: [MINE_READY] });
    const busy = mount({ settings: { ...SETTINGS, voiceId: 'mine-1', voiceName: 'István' }, isSessionActive: true });
    openPicker();
    await waitFor(() => expect(inGrid().getByRole('button', { name: 'István' })).toBeInTheDocument());
    fireEvent.click(within(rowFor('István')).getByRole('button', { name: /delete/i }));
    fireEvent.click(within(screen.getByRole('dialog', { name: /delete voice/i })).getByRole('button', { name: /^delete$/i }));
    await waitFor(() => expect(within(screen.getByRole('dialog', { name: /delete voice/i })).getByRole('alert')).toHaveTextContent(/active session/i));
    expect(deleteMock).not.toHaveBeenCalled();
    busy.unmount();

    const idle = mount({ settings: { ...SETTINGS, voiceId: 'mine-1', voiceName: 'István' } });
    openPicker();
    await waitFor(() => expect(inGrid().getByRole('button', { name: 'István' })).toBeInTheDocument());
    const listedBefore = listMock.mock.calls.length;
    fireEvent.click(within(rowFor('István')).getByRole('button', { name: /delete/i }));
    fireEvent.click(within(screen.getByRole('dialog', { name: /delete voice/i })).getByRole('button', { name: /^delete$/i }));
    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith('mine-1'));
    await waitFor(() => expect(idle.onSelect).toHaveBeenCalledWith({ voiceId: 'default_low', voiceName: '' }));
    expect(listMock.mock.calls.length).toBeGreaterThan(listedBefore);
  });
});

describe('PalabraVoiceSection: final-review fixes', () => {
  beforeEach(() => {
    (URL as any).createObjectURL = vi.fn(() => 'blob:mock');
    (URL as any).revokeObjectURL = vi.fn();
    (window.HTMLMediaElement.prototype as any).play = vi.fn().mockResolvedValue(undefined);
    (window.HTMLMediaElement.prototype as any).pause = vi.fn();
  });

  it('deleting a voice that is still processing raises no "could not process" alert', async () => {
    const processing = voice({ id: 'p-1', name: 'Pending', status: 'processing', sample: null });
    listMock.mockResolvedValueOnce({ builtin: [HU_MALE], mine: [processing] }).mockResolvedValue({ builtin: [HU_MALE], mine: [] });
    getMock.mockRejectedValue(new PalabraVoicesError('not_found', 'HTTP 404: gone', 404));
    const clock = manualSleep();
    mount({ sleep: clock.sleep });
    openPicker();
    await waitFor(() => expect(clock.waits.length).toBe(1));
    fireEvent.click(within(rowFor(/Pending/)).getByRole('button', { name: /delete/i }));
    fireEvent.click(within(screen.getByRole('dialog', { name: /delete voice/i })).getByRole('button', { name: /^delete$/i }));
    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith('p-1'));
    clock.next();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText(/could not process this recording/i)).toBeNull();
  });

  it('a delete answered 404 (already gone) counts as done: refresh, reset the selection, no error', async () => {
    listMock.mockResolvedValueOnce({ builtin: [HU_MALE], mine: [MINE_READY] }).mockResolvedValue({ builtin: [HU_MALE], mine: [] });
    deleteMock.mockRejectedValue(new PalabraVoicesError('not_found', 'HTTP 404: gone', 404));
    const { onSelect } = mount({ settings: { ...SETTINGS, voiceId: 'mine-1', voiceName: 'István' } });
    openPicker();
    await waitFor(() => expect(inGrid().getByRole('button', { name: 'István' })).toBeInTheDocument());
    fireEvent.click(within(rowFor('István')).getByRole('button', { name: /delete/i }));
    fireEvent.click(within(screen.getByRole('dialog', { name: /delete voice/i })).getByRole('button', { name: /^delete$/i }));
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith({ voiceId: 'default_low', voiceName: '' }));
    expect(screen.queryByText(/could not process this recording/i)).toBeNull();
  });

  it('a create request that times out says Palabra did not answer, not that the voice is still processing', async () => {
    stubDecode(40);
    listMock.mockResolvedValue({ builtin: [HU_MALE], mine: [] });
    createMock.mockRejectedValue(new PalabraVoicesError('timeout', 'Palabra did not answer within 15 s.', 408));
    mount({ pairSource: 'hu' });
    await waitFor(() => expect(listMock).toHaveBeenCalled());
    openCreateModal();
    importFile(fakeFile('clip.mp3', 1000));
    await waitFor(() => expect(languageSelect()).toBeInTheDocument());
    checkConsent();
    fireEvent.click(confirmButton());
    await waitFor(() => expect(within(createDialog()).getByRole('alert')).toHaveTextContent(/did not answer in time/i));
    expect(within(createDialog()).getByRole('alert')).not.toHaveTextContent(/still processing/i);
  });

  it('a recording that ran a moment past the 90 s auto-stop is kept, trimmed to 90 s', async () => {
    listMock.mockResolvedValue({ builtin: [HU_MALE], mine: [] });
    createMock.mockResolvedValue(voice({ id: 'rec-90', name: 'My Voice 1', status: 'processing', sample: null }));
    getMock.mockResolvedValue(voice({ id: 'rec-90', name: 'My Voice 1', status: 'processing', sample: null }));
    const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] })) } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let processorNode: any = null;
    class FakeAudioContext {
      sampleRate = 16000;
      destination = {};
      createMediaStreamSource() { return { connect: vi.fn(), disconnect: vi.fn() }; }
      createScriptProcessor() { processorNode = { connect: vi.fn(), disconnect: vi.fn(), onaudioprocess: null }; return processorNode; }
      close = vi.fn().mockResolvedValue(undefined);
    }
    vi.stubGlobal('AudioContext', FakeAudioContext);
    try {
      mount({ pairSource: 'hu', sleep: manualSleep().sleep });
      await waitFor(() => expect(listMock).toHaveBeenCalled());
      openCreateModal();
      fireEvent.click(screen.getByRole('button', { name: /record voice/i }));
      const stop = await screen.findByRole('button', { name: /stop recording/i });
      processorNode?.onaudioprocess?.({ inputBuffer: { getChannelData: () => new Float32Array(Math.round(16000 * 90.05)).fill(0.1) } });
      fireEvent.click(stop);
      await waitFor(() => expect(languageSelect()).toBeInTheDocument());
      checkConsent();
      fireEvent.click(confirmButton());
      await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
      const wav = createMock.mock.calls[0][0].wav as Blob;
      expect(wav.size).toBe(44 + 16000 * 90 * 2);
    } finally {
      if (originalMediaDevices) Object.defineProperty(navigator, 'mediaDevices', originalMediaDevices);
      else delete (navigator as { mediaDevices?: unknown }).mediaDevices;
      vi.unstubAllGlobals();
    }
  });
});

describe('PalabraVoiceSection: the remembered list (owner, 2026-11-03)', () => {
  it('with a remembered list, shows it at once and sends no request', () => {
    cachedMock.mockReturnValue({ builtin: [HU_MALE, JA_FEMALE], mine: [MINE_READY], limits: { used: 1, limit: 10, remaining: 9 } });
    mount();
    expect(listMock).not.toHaveBeenCalled();
    expect(limitsMock).not.toHaveBeenCalled();
    openPicker();
    expect(inGrid().getByRole('button', { name: 'Hungarian Male' })).toBeInTheDocument();
    expect(inGrid().getByRole('button', { name: 'István' })).toBeInTheDocument();
    expect(screen.getByText(/1\s*\/\s*10/)).toBeInTheDocument();
  });

  it('Refresh asks Palabra again even with a remembered list', async () => {
    cachedMock.mockReturnValue({ builtin: [HU_MALE], mine: [], limits: null });
    mount();
    openPicker();
    fireEvent.click(inGrid().getByRole('button', { name: /refresh voice list/i }));
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(1));
  });

  it('a remembered voice still processing is followed without a list request', async () => {
    const processing = voice({ id: 'old-1', name: 'Earlier', status: 'processing', sample: null });
    cachedMock.mockReturnValue({ builtin: [HU_MALE], mine: [processing], limits: null });
    getMock.mockResolvedValue({ ...processing, status: 'ready' });
    listMock.mockResolvedValue({ builtin: [HU_MALE], mine: [{ ...processing, status: 'ready' }] });
    mount({ sleep: instantSleep() });
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(1));
    // Settling refreshes once, as before.
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(1));
  });
});

describe('PalabraVoiceSection: PR #684 review', () => {
  it('a credentials change during the post-settle refresh does not auto-select the old account\'s voice', async () => {
    (URL as any).createObjectURL = vi.fn(() => 'blob:mock');
    (URL as any).revokeObjectURL = vi.fn();
    stubDecode(40);
    const processing = voice({ id: 'new-1', name: 'clip', status: 'processing', sample: null });
    createMock.mockResolvedValue(processing);
    let releaseRefresh: (v: unknown) => void = () => {};
    listMock
      .mockResolvedValueOnce({ builtin: [HU_MALE], mine: [] })
      .mockResolvedValueOnce({ builtin: [HU_MALE], mine: [processing] })
      .mockReturnValueOnce(new Promise((r) => { releaseRefresh = r; }));
    getMock.mockResolvedValue({ ...processing, status: 'ready' });
    const other = fakeSource({ list: vi.fn(async () => ({ builtin: [HU_MALE], mine: [] })), cached: () => null });
    const clock = manualSleep();
    const utils = mount({ pairSource: 'hu', sleep: clock.sleep });
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(1));
    openCreateModal();
    importFile(fakeFile('clip.mp3', 1000));
    await waitFor(() => expect(languageSelect()).toBeInTheDocument());
    checkConsent();
    fireEvent.click(confirmButton());
    await waitFor(() => expect(clock.waits.length).toBe(1));
    clock.next();
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(3));
    utils.rerender(<PalabraVoiceSection {...utils.props} source={other} />);
    releaseRefresh({ builtin: [HU_MALE], mine: [{ ...processing, status: 'ready' }] });
    await new Promise((r) => setTimeout(r, 20));
    expect(utils.onSelect).not.toHaveBeenCalledWith(expect.objectContaining({ voiceId: 'new-1' }));
  });

  it('a failed delete of a processing voice refreshes the list, so its poll can resume', async () => {
    const processing = voice({ id: 'p-2', name: 'Pending', status: 'processing', sample: null });
    listMock.mockResolvedValue({ builtin: [HU_MALE], mine: [processing] });
    deleteMock.mockRejectedValue(new PalabraVoicesError('network', 'Could not reach Palabra.', 0));
    const clock = manualSleep();
    mount({ sleep: clock.sleep });
    openPicker();
    await waitFor(() => expect(clock.waits.length).toBe(1));
    const listed = listMock.mock.calls.length;
    fireEvent.click(within(rowFor(/Pending/)).getByRole('button', { name: /delete/i }));
    fireEvent.click(within(screen.getByRole('dialog', { name: /delete voice/i })).getByRole('button', { name: /^delete$/i }));
    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith('p-2'));
    await waitFor(() => expect(listMock.mock.calls.length).toBeGreaterThan(listed));
  });
});
