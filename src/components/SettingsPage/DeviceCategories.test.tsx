// "Models and storage" lists what is downloaded whatever provider is selected (PR review).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

const scan = vi.hoisted(() => ({ initialize: vi.fn(async () => {}), initialized: false }));
vi.mock('../../stores/modelStore', () => ({
  useModelStore: { getState: () => ({ initialize: scan.initialize, initialized: scan.initialized }) },
}));
vi.mock('./ModelsPage', () => ({ ModelsPage: () => <div data-testid="storage" /> }));
vi.mock('../Settings/sections/AudioDeviceSection', () => ({ default: () => <div data-testid="microphone" /> }));
vi.mock('../Settings/sections/SpeechOutputSection', () => ({ default: () => <div data-testid="speech" /> }));
vi.mock('../Settings/sections/SystemAudioSection', () => ({ default: () => <div data-testid="their-audio" /> }));
vi.mock('./AudioModeSwitch', () => ({ AudioModeSwitch: ({ locked }: { locked: boolean }) => <div data-testid="mode-switch" data-locked={String(locked)} /> }));

import { AudioCategory, ModelsCategory } from './DeviceCategories';
import { useProviderStore } from '../../stores/providerStore';

afterEach(() => { cleanup(); scan.initialize.mockClear(); scan.initialized = false; });

describe('models and storage', () => {
  it('scans the downloaded models on opening, with a network provider selected', () => {
    useProviderStore.setState({ selected: 'soniox' });
    render(<ModelsCategory locked={false} />);
    expect(scan.initialize).toHaveBeenCalledTimes(1);
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
