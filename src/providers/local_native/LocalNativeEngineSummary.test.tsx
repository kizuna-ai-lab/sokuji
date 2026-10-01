import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { NativeModelInfo } from '../../lib/local-inference/native/nativeProtocol';
import { useNativeModelStore } from '../../stores/nativeModelStore';
import { LocalNativeEngineSummary } from './LocalNativeEngineSummary';
import { LOCAL_NATIVE_DEFAULTS } from './settings';

vi.mock('../../components/Settings/sections/EngineStatusLine', () => ({ EngineStatusLine: () => <div data-testid="engine-status-line" /> }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, fb?: string) => fb ?? _k }),
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
    asrResolved: null, translationResolved: null,
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
    render(<LocalNativeEngineSummary {...p} legs={['speaker']} />);
    fireEvent.click(screen.getByTestId('resolution-notes-use-auto'));
    expect(p.update).toHaveBeenCalledWith({ selections: { 'ja→en': { asr: { modelId: '' }, translation: { modelId: '' }, tts: { modelId: '' } } } });
  });
});
