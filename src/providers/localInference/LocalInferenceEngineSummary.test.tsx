import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, def?: any, opts?: any) => {
      const str = typeof def === 'string' ? def : _k;
      const o = typeof def === 'object' && def !== null ? def : opts;
      return str.replace(/\{\{(\w+)\}\}/g, (_m: string, n: string) => String(o?.[n] ?? ''));
    },
  }),
}));

const mockResolve = vi.fn();
vi.mock('../../stores/modelStore', () => ({
  useModelStore: Object.assign(
    (select: (s: { deviceFeatures: string[]; modelStatuses: Record<string, string> }) => unknown) =>
      select({ deviceFeatures: [], modelStatuses: {} }),
    { getState: () => ({ resolve: mockResolve }) },
  ),
}));

const mockEstimate = vi.fn((_ids: (string | undefined | null)[], _deviceFeatures: string[]) => ({ vramMb: 0, ramMb: 0 }));
const MANIFEST: Record<string, { name: string; shortName?: string; isCloudModel?: boolean }> = {
  'asr-model': { name: 'Asr Model' },
  'old-asr': { name: 'Old Asr' },
  'cloud-tts': { name: 'Cloud Voice', isCloudModel: true },
};
vi.mock('../../lib/local-inference/modelManifest', () => ({
  getManifestEntry: (id: string) => MANIFEST[id],
  estimateModelMemoryByDevice: (ids: (string | undefined | null)[], deviceFeatures: string[]) => mockEstimate(ids, deviceFeatures),
}));

import { LocalInferenceEngineSummary } from './LocalInferenceEngineSummary';
import { LOCAL_INFERENCE_DEFAULTS } from './settings';

const noNotes = { notes: [], prunes: [] };

beforeEach(() => {
  mockResolve.mockReset();
  mockEstimate.mockReset();
  mockEstimate.mockReturnValue({ vramMb: 0, ramMb: 0 });
});

describe('LocalInferenceEngineSummary', () => {
  it('declares the tour anchor on its wrapper', () => {
    mockResolve.mockReturnValue({ asr: null, translation: null, tts: null, ...noNotes });
    const { container } = render(
      <LocalInferenceEngineSummary settings={LOCAL_INFERENCE_DEFAULTS} update={vi.fn()} legs={['speaker']} openSlot={vi.fn()} />,
    );
    const wrapper = container.querySelector('.local-inference-info');
    expect(wrapper?.getAttribute('data-tour')).toBe('engine-chips');
  });

  it('shows three chips for the speaker leg alone (ja→en)', () => {
    mockResolve.mockImplementation((src: string, tgt: string) =>
      src === 'ja' && tgt === 'en'
        ? { asr: { modelId: 'asr-model' }, translation: { modelId: 'asr-model' }, tts: { modelId: 'asr-model' }, ...noNotes }
        : { asr: null, translation: null, tts: null, ...noNotes },
    );
    const { container } = render(
      <LocalInferenceEngineSummary settings={LOCAL_INFERENCE_DEFAULTS} update={vi.fn()} legs={['speaker']} openSlot={vi.fn()} />,
    );
    expect(container.querySelectorAll('.model-chip')).toHaveLength(3);
  });

  it('shows two chips for the participant leg alone (en→ja, no TTS)', () => {
    mockResolve.mockImplementation((src: string, tgt: string) =>
      src === 'en' && tgt === 'ja'
        ? { asr: { modelId: 'asr-model' }, translation: { modelId: 'asr-model' }, tts: { modelId: 'asr-model' }, ...noNotes }
        : { asr: null, translation: null, tts: null, ...noNotes },
    );
    const { container } = render(
      <LocalInferenceEngineSummary settings={LOCAL_INFERENCE_DEFAULTS} update={vi.fn()} legs={['participant']} openSlot={vi.fn()} />,
    );
    expect(container.querySelectorAll('.model-chip')).toHaveLength(2);
  });

  it('shows two labelled groups (Me / Other) when both legs run', () => {
    mockResolve.mockReturnValue({ asr: null, translation: null, tts: null, ...noNotes });
    render(
      <LocalInferenceEngineSummary
        settings={LOCAL_INFERENCE_DEFAULTS}
        update={vi.fn()}
        legs={['speaker', 'participant']}
        openSlot={vi.fn()}
      />,
    );
    expect(screen.getByText('Me')).toBeInTheDocument();
    expect(screen.getByText('Other')).toBeInTheDocument();
  });

  it('shows a resolved stage as its short name with model-ok, and a missing stage as None with model-warn', () => {
    mockResolve.mockReturnValue({ asr: { modelId: 'asr-model' }, translation: null, tts: null, ...noNotes });
    const { container } = render(
      <LocalInferenceEngineSummary settings={LOCAL_INFERENCE_DEFAULTS} update={vi.fn()} legs={['speaker']} openSlot={vi.fn()} />,
    );
    const values = container.querySelectorAll('.model-chip-value');
    expect(values[0].textContent).toBe('Asr Model');
    expect(values[0].className).toContain('model-ok');
    expect(values[1].textContent).toBe('None');
    expect(values[1].className).toContain('model-warn');
  });

  it('clicking a chip calls openSlot with its own direction and stage', () => {
    const openSlot = vi.fn();
    mockResolve.mockImplementation((src: string, tgt: string) =>
      src === 'ja' && tgt === 'en'
        ? { asr: { modelId: 'asr-model' }, translation: { modelId: 'asr-model' }, tts: { modelId: 'asr-model' }, ...noNotes }
        : { asr: { modelId: 'asr-model' }, translation: { modelId: 'asr-model' }, tts: { modelId: 'asr-model' }, ...noNotes },
    );
    const { container, rerender } = render(
      <LocalInferenceEngineSummary settings={LOCAL_INFERENCE_DEFAULTS} update={vi.fn()} legs={['speaker']} openSlot={openSlot} />,
    );
    const chips = container.querySelectorAll('.model-chip');
    fireEvent.click(chips[0]);
    expect(openSlot).toHaveBeenCalledWith({ dir: 'ja→en', stage: 'asr' });

    rerender(
      <LocalInferenceEngineSummary settings={LOCAL_INFERENCE_DEFAULTS} update={vi.fn()} legs={['participant']} openSlot={openSlot} />,
    );
    const participantChips = container.querySelectorAll('.model-chip');
    fireEvent.click(participantChips[0]);
    expect(openSlot).toHaveBeenCalledWith({ dir: 'en→ja', stage: 'asr' });
  });

  it('shows the estimated memory, counting the participant direction only when it runs, and skipping a cloud TTS model', () => {
    mockResolve.mockReturnValue({ asr: { modelId: 'asr-model' }, translation: { modelId: 'asr-model' }, tts: { modelId: 'cloud-tts' }, ...noNotes });
    mockEstimate.mockReturnValue({ vramMb: 1536, ramMb: 300 });
    const { rerender } = render(
      <LocalInferenceEngineSummary settings={LOCAL_INFERENCE_DEFAULTS} update={vi.fn()} legs={['speaker']} openSlot={vi.fn()} />,
    );
    expect(screen.getByText('VRAM ~1.5 GB')).toBeInTheDocument();
    expect(screen.getByText('RAM ~300 MB')).toBeInTheDocument();
    expect(mockEstimate).toHaveBeenLastCalledWith(['asr-model', 'asr-model', undefined], []);

    rerender(
      <LocalInferenceEngineSummary
        settings={LOCAL_INFERENCE_DEFAULTS}
        update={vi.fn()}
        legs={['speaker', 'participant']}
        openSlot={vi.fn()}
      />,
    );
    expect(mockEstimate).toHaveBeenLastCalledWith(['asr-model', 'asr-model', undefined, 'asr-model', 'asr-model'], []);
  });

  it('names the stale model in the resolution notes line; Review opens its slot, Switch to Auto clears it', () => {
    const update = vi.fn();
    const openSlot = vi.fn();
    mockResolve.mockImplementation((src: string, tgt: string) =>
      src === 'ja' && tgt === 'en'
        ? {
            asr: { modelId: 'asr-model' }, translation: null, tts: null,
            notes: [{ direction: 'ja→en', stage: 'asr', from: 'old-asr', to: 'asr-model', reason: 'not-downloaded' }],
            prunes: [],
          }
        : { asr: null, translation: null, tts: null, ...noNotes },
    );
    render(
      <LocalInferenceEngineSummary settings={LOCAL_INFERENCE_DEFAULTS} update={update} legs={['speaker']} openSlot={openSlot} />,
    );
    const notes = screen.getByTestId('language-resolution-notes');
    expect(notes.textContent).toContain('Old Asr');

    fireEvent.click(screen.getByTestId('resolution-notes-review'));
    expect(openSlot).toHaveBeenCalledWith({ dir: 'ja→en', stage: 'asr' });

    fireEvent.click(screen.getByTestId('resolution-notes-use-auto'));
    expect(update).toHaveBeenCalledWith({
      selections: { 'ja→en': { asr: { modelId: '' }, translation: { modelId: '' }, tts: { modelId: '' } } },
    });
  });

  it('excludes a no-candidate note from the resolution notes line', () => {
    mockResolve.mockReturnValue({
      asr: null, translation: null, tts: null,
      notes: [{ direction: 'ja→en', stage: 'asr', from: null, to: null, reason: 'no-candidate' }],
      prunes: [],
    });
    render(
      <LocalInferenceEngineSummary settings={LOCAL_INFERENCE_DEFAULTS} update={vi.fn()} legs={['speaker']} openSlot={vi.fn()} />,
    );
    expect(screen.queryByTestId('language-resolution-notes')).not.toBeInTheDocument();
  });

  it('a note for the reverse direction shows only with the participant leg', () => {
    mockResolve.mockImplementation((src: string, tgt: string) =>
      src === 'ja' && tgt === 'en'
        ? { asr: { modelId: 'asr-model' }, translation: null, tts: null, ...noNotes }
        : {
            asr: null, translation: null, tts: null,
            notes: [{ direction: 'en→ja', stage: 'asr', from: 'old-asr', to: 'asr-model', reason: 'not-downloaded' }],
            prunes: [],
          },
    );
    const { rerender } = render(
      <LocalInferenceEngineSummary settings={LOCAL_INFERENCE_DEFAULTS} update={vi.fn()} legs={['speaker']} openSlot={vi.fn()} />,
    );
    expect(screen.queryByTestId('language-resolution-notes')).not.toBeInTheDocument();

    rerender(
      <LocalInferenceEngineSummary
        settings={LOCAL_INFERENCE_DEFAULTS}
        update={vi.fn()}
        legs={['speaker', 'participant']}
        openSlot={vi.fn()}
      />,
    );
    expect(screen.getByTestId('language-resolution-notes')).toBeInTheDocument();
  });

  it('disabled leaves the chips clickable (they navigate) and disables Switch to Auto', () => {
    const openSlot = vi.fn();
    mockResolve.mockImplementation((src: string, tgt: string) =>
      src === 'ja' && tgt === 'en'
        ? {
            asr: { modelId: 'asr-model' }, translation: null, tts: null,
            notes: [{ direction: 'ja→en', stage: 'asr', from: 'old-asr', to: 'asr-model', reason: 'not-downloaded' }],
            prunes: [],
          }
        : { asr: null, translation: null, tts: null, ...noNotes },
    );
    const { container } = render(
      <LocalInferenceEngineSummary settings={LOCAL_INFERENCE_DEFAULTS} update={vi.fn()} legs={['speaker']} openSlot={openSlot} disabled />,
    );
    const chips = container.querySelectorAll('.model-chip');
    fireEvent.click(chips[0]);
    expect(openSlot).toHaveBeenCalledWith({ dir: 'ja→en', stage: 'asr' });
    expect(screen.getByTestId('resolution-notes-use-auto')).toBeDisabled();
  });
});
