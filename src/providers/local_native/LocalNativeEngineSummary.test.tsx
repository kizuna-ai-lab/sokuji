import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { NativeModelInfo } from '../../lib/local-inference/native/nativeProtocol';
import { useNativeModelStore } from '../../stores/nativeModelStore';
import { LocalNativeEngineSummary } from './LocalNativeEngineSummary';
import { LOCAL_NATIVE_DEFAULTS } from './settings';

vi.mock('../../components/Settings/sections/EngineStatusLine', () => ({ EngineStatusLine: () => <div data-testid="engine-status-line" /> }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, def?: string, opts?: Record<string, unknown>) =>
      (def ?? k).replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(opts?.[name] ?? '')),
  }),
}));

const cpu = [{ tier: 'cpu', backend: 'ct2', available: true }];
const M = (id: string, kind: NativeModelInfo['kind'], languages: string[]): NativeModelInfo =>
  ({ id, name: id, kind, languages, recommended: true, tiers: cpu, order: 1, repo: id, sizeBytes: 104_857_600 }) as NativeModelInfo;
const CATALOG = { 'asr-a': M('asr-a', 'asr', ['ja', 'en']), 'mt-a': M('mt-a', 'translate', ['multi']), 'tts-a': M('tts-a', 'tts', ['en']) };

const props = (over: Record<string, unknown> = {}) => ({
  settings: LOCAL_NATIVE_DEFAULTS, update: vi.fn(), pair: { source: 'ja', target: 'en' }, legs: ['speaker'] as const, openSlot: vi.fn(), ...over,
});

beforeEach(() => {
  useNativeModelStore.setState({
    sidecarStatus: 'ready', catalog: CATALOG,
    statuses: { 'asr-a': 'ready', 'mt-a': 'ready', 'tts-a': 'ready' },
    sizes: { 'asr-a': 104_857_600, 'mt-a': 104_857_600, 'tts-a': 104_857_600 },
    asrResolved: null, translationResolved: null, lastResolutionNotes: [],
  });
});

describe('LocalNativeEngineSummary', () => {
  it('shows three chips for the speaker, the status line, and the tour anchor', () => {
    const { container } = render(<LocalNativeEngineSummary {...props()} legs={['speaker']} />);
    expect(screen.getByTestId('engine-status-line')).toBeTruthy();
    expect(container.querySelector('[data-tour="engine-chips"]')).toBeTruthy();
    expect(container.querySelectorAll('.model-chip')).toHaveLength(3);
  });

  it('two chips for the participant alone, and a chip opens its slot', () => {
    const p = props({ legs: ['participant'] });
    const { container } = render(<LocalNativeEngineSummary {...p} legs={['participant']} />);
    expect(container.querySelectorAll('.model-chip')).toHaveLength(2);
    fireEvent.click(container.querySelectorAll('.model-chip')[0]);
    expect(p.openSlot).toHaveBeenCalledWith({ dir: 'en→ja', stage: 'asr' });
  });

  it('a missing model is a None chip', () => {
    useNativeModelStore.setState({ statuses: { 'asr-a': 'absent', 'mt-a': 'ready', 'tts-a': 'ready' } });
    render(<LocalNativeEngineSummary {...props()} legs={['speaker']} />);
    expect(screen.getAllByText('None').length).toBeGreaterThan(0);
  });

  it('while the sidecar starts, says so instead of chips', () => {
    useNativeModelStore.setState({ sidecarStatus: 'starting' });
    const { container } = render(<LocalNativeEngineSummary {...props()} legs={['speaker']} />);
    expect(container.querySelector('.local-native-status.is-loading')).toBeTruthy();
    expect(container.querySelectorAll('.model-chip')).toHaveLength(0);
  });

  it('an estimate before a run, what is in use after one', () => {
    const { rerender } = render(<LocalNativeEngineSummary {...props()} legs={['speaker']} />);
    expect(screen.getByText('Estimated')).toBeTruthy();
    useNativeModelStore.setState({
      asrResolved: { model: 'asr-a', device: 'cpu', memoryBytes: 104_857_600 },
      translationResolved: { model: 'mt-a', device: 'cpu', memoryBytes: 104_857_600 },
    });
    rerender(<LocalNativeEngineSummary {...props()} legs={['speaker']} />);
    expect(screen.getByText('In use')).toBeTruthy();
  });

  it('names a stale pick and switches it to Auto through update', () => {
    const p = props({ settings: { ...LOCAL_NATIVE_DEFAULTS, selections: { 'ja→en': { asr: { modelId: 'gone' }, translation: { modelId: '' }, tts: { modelId: '' } } } } });
    useNativeModelStore.setState({ lastResolutionNotes: [{ direction: 'ja→en', stage: 'asr', from: 'gone', to: 'asr-a', reason: 'not-in-catalog' }] });
    const { container } = render(<LocalNativeEngineSummary {...p} legs={['speaker']} />);
    expect(container.textContent).toContain('gone unavailable');
    fireEvent.click(screen.getByTestId('resolution-notes-use-auto'));
    expect(p.update).toHaveBeenCalledWith({ selections: { 'ja→en': { asr: { modelId: '' }, translation: { modelId: '' }, tts: { modelId: '' } } } });
  });

  it.each(['starting', 'unavailable'] as const)('while the sidecar is %s, no fallback note is worded or offered (#578)', (sidecarStatus) => {
    const selections = { 'ja→en': { asr: { modelId: 'gone' }, translation: { modelId: '' }, tts: { modelId: '' } } };
    useNativeModelStore.setState({
      sidecarStatus,
      lastResolutionNotes: [{ direction: 'ja→en', stage: 'asr', from: 'gone', to: 'asr-a', reason: 'not-in-catalog' }],
    });
    const { container } = render(<LocalNativeEngineSummary {...props({ settings: { ...LOCAL_NATIVE_DEFAULTS, selections } })} legs={['speaker']} />);
    expect(screen.queryByTestId('language-resolution-notes')).toBeNull();
    expect(screen.queryByTestId('resolution-notes-use-auto')).toBeNull();
    expect(container.textContent).not.toContain('gone');
  });

  describe('the notes follow the legs the summary shows', () => {
    const selections = {
      'ja→en': { asr: { modelId: 'gone-fwd' }, translation: { modelId: '' }, tts: { modelId: '' } },
      'en→ja': { asr: { modelId: '' }, translation: { modelId: 'gone-rev' }, tts: { modelId: '' } },
    };
    const notes = [
      { direction: 'ja→en', stage: 'asr', from: 'gone-fwd', to: 'asr-a', reason: 'not-in-catalog' },
      { direction: 'en→ja', stage: 'translation', from: 'gone-rev', to: 'mt-a', reason: 'not-in-catalog' },
      { direction: 'en→ja', stage: 'asr', from: 'gone-rev-asr', to: 'asr-a', reason: 'not-in-catalog' },
    ] as const;
    beforeEach(() => useNativeModelStore.setState({ lastResolutionNotes: [...notes] }));

    it('participant alone: only the reverse direction is named, and Switch to Auto clears only its slots', () => {
      const p = props({ settings: { ...LOCAL_NATIVE_DEFAULTS, selections } });
      const { container } = render(<LocalNativeEngineSummary {...p} legs={['participant']} />);
      expect(container.textContent).toContain('gone-rev, gone-rev-asr unavailable');
      expect(container.textContent).not.toContain('gone-fwd');
      fireEvent.click(screen.getByTestId('resolution-notes-use-auto'));
      expect(p.update).toHaveBeenCalledWith({
        selections: {
          'ja→en': selections['ja→en'],
          'en→ja': { asr: { modelId: '' }, translation: { modelId: '' }, tts: { modelId: '' } },
        },
      });
    });

    it('Review opens the first note of a direction the legs show', () => {
      const p = props({ settings: { ...LOCAL_NATIVE_DEFAULTS, selections } });
      render(<LocalNativeEngineSummary {...p} legs={['participant']} />);
      fireEvent.click(screen.getByTestId('resolution-notes-review'));
      expect(p.openSlot).toHaveBeenCalledWith({ dir: 'en→ja', stage: 'translation' });
    });
  });

  describe('the direction that runs', () => {
    const mb = (n: number) => n * 1_048_576;
    const withModels = () => useNativeModelStore.setState({
      catalog: {
        'asr-a': M('asr-a', 'asr', ['ja', 'en']),
        'asr-b': { ...M('asr-b', 'asr', ['ja', 'en']), sizeBytes: mb(300) },
        'mt-a': M('mt-a', 'translate', ['multi']),
        'tts-a': M('tts-a', 'tts', ['en']),
        'tts-ja': M('tts-ja', 'tts', ['ja']),
      },
      statuses: { 'asr-a': 'ready', 'asr-b': 'ready', 'mt-a': 'ready', 'tts-a': 'ready', 'tts-ja': 'ready' },
      sizes: { 'asr-a': mb(100), 'asr-b': mb(300), 'mt-a': mb(100), 'tts-a': mb(100), 'tts-ja': mb(100) },
    });
    const selections = {
      'ja→en': { asr: { modelId: 'asr-a' }, translation: { modelId: '' }, tts: { modelId: '' } },
      'en→ja': { asr: { modelId: 'asr-b' }, translation: { modelId: '' }, tts: { modelId: '' } },
    };

    it("the estimate is the participant direction's models when the participant runs alone, without a voice nobody hears", () => {
      withModels();
      const settings = { ...LOCAL_NATIVE_DEFAULTS, selections };
      const { container, rerender } = render(<LocalNativeEngineSummary {...props({ settings })} legs={['participant']} />);
      expect(container.textContent).toContain('RAM ~400 MB');
      rerender(<LocalNativeEngineSummary {...props({ settings })} legs={['speaker']} />);
      expect(container.textContent).toContain('RAM ~300 MB');
    });

    it("what is in use is matched against the participant direction's picks when it runs alone", () => {
      withModels();
      const settings = { ...LOCAL_NATIVE_DEFAULTS, selections };
      useNativeModelStore.setState({
        asrResolved: { model: 'asr-b', device: 'cpu', memoryBytes: mb(300) },
        translationResolved: { model: 'mt-a', device: 'cpu', memoryBytes: mb(100) },
      });
      const { rerender } = render(<LocalNativeEngineSummary {...props({ settings })} legs={['participant']} />);
      expect(screen.getByText('In use')).toBeTruthy();
      rerender(<LocalNativeEngineSummary {...props({ settings })} legs={['speaker']} />);
      expect(screen.getByText('Estimated')).toBeTruthy();
    });
  });
});
