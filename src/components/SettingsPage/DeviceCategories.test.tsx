// "Local models and storage" lists what is downloaded whatever provider is selected (PR review).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

const scan = vi.hoisted(() => ({ initialize: vi.fn(async () => {}), initialized: false }));
vi.mock('../../stores/modelStore', () => ({
  useModelStore: { getState: () => ({ initialize: scan.initialize, initialized: scan.initialized }) },
}));
const pageProps = vi.hoisted(() => ({ last: null as null | { pair: unknown } }));
vi.mock('./ModelsPage', () => ({ ModelsPage: (props: { pair: unknown }) => { pageProps.last = props; return <div data-testid="storage" />; } }));
vi.mock('../Settings/sections/AudioDeviceSection', () => ({ default: () => <div data-testid="microphone" /> }));
vi.mock('../Settings/sections/SpeechOutputSection', () => ({ default: () => <div data-testid="speech" /> }));
vi.mock('../Settings/sections/SystemAudioSection', () => ({ default: () => <div data-testid="their-audio" /> }));
vi.mock('./AudioModeSwitch', () => ({ AudioModeSwitch: ({ locked }: { locked: boolean }) => <div data-testid="mode-switch" data-locked={String(locked)} /> }));

import { AudioCategory, ModelsCategory } from './DeviceCategories';

import { runsOn } from '../../stores/lineUpStore.testing';
import { useProviderStore } from '../../stores/providerStore';
afterEach(() => { cleanup(); scan.initialize.mockClear(); scan.initialized = false; });

describe('models and storage', () => {
  it('scans the downloaded models on opening, with a network provider selected', () => {
    runsOn('soniox');
    render(<ModelsCategory locked={false} />);
    expect(scan.initialize).toHaveBeenCalledTimes(1);
  });

  // PR review: translating what another provider hears, the session runs that provider's pair (the one its check asks
  // about), so the library a card's "Needs a model" opens lists the models for that pair, not this provider's own.
  it("lists the models for the pair a session runs: the transcriber's where another provider transcribes", () => {
    scan.initialized = true;
    useProviderStore.setState({
      stages: { soniox: ['transcription'], local_inference: ['translation'] }, intent: { source: 'ko', target: 'en' },
      entries: { soniox: { settings: {}, pair: { source: 'ko', target: 'en' } }, local_inference: { settings: {}, pair: { source: 'ja', target: 'en' } } } as never,
    });
    render(<ModelsCategory locked={false} />);
    expect(pageProps.last?.pair).toEqual({ source: 'ko', target: 'en' });
    cleanup();
    // Serving its own stages, its own pair.
    useProviderStore.setState({ stages: { local_inference: ['transcription', 'translation', 'speech'] } });
    render(<ModelsCategory locked={false} />);
    expect(pageProps.last?.pair).toEqual({ source: 'ja', target: 'en' });
  });

  it('does not scan again once the models are known', () => {
    scan.initialized = true;
    render(<ModelsCategory locked={false} />);
    expect(scan.initialize).not.toHaveBeenCalled();
  });
});

describe('audio', () => {
  it('starts with the mode switch, locked with the session, above the microphone, speech and their audio', () => {
    const { getAllByTestId, getByTestId } = render(<AudioCategory locked />);
    expect(getAllByTestId(/mode-switch|microphone|speech|their-audio/).map((e) => e.dataset.testid)).toEqual(['mode-switch', 'microphone', 'speech', 'their-audio']);
    expect(getByTestId('mode-switch').dataset.locked).toBe('true');
  });
});
