import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { clearPreviewCache } from '../../../lib/tts/previewCache';
import type { PalabraVoiceSource } from '../../../providers/palabraai/voiceSource';
import type { PalabraVoiceInfo } from '../../../providers/palabraai/voicesClient';
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

function fakeSource(over: Partial<PalabraVoiceSource> = {}): PalabraVoiceSource {
  return { list: listMock, get: getMock, create: createMock, delete: deleteMock, limits: limitsMock, preview: previewMock, cacheNamespace: 'palabra', ...over };
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
