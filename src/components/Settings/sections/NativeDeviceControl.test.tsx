/**
 * Tests for NativeDeviceControl — the per-stage Auto/CPU/GPU segmented
 * control: Auto / CPU / GPU per stage, writing 'gpu' for GPU.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NativeDeviceControl } from './NativeDeviceControl';
import type { NativeModelInfo } from '../../../lib/local-inference/native/nativeProtocol';

vi.mock('../../Tooltip/Tooltip', () => ({
  default: ({ children, content }: { children?: React.ReactNode; content?: React.ReactNode }) => (
    <>{children}{content}</>
  ),
}));

let mockSettings: { asrDevice: 'auto' | 'cpu' | 'gpu'; translationDevice: 'auto' | 'cpu' | 'gpu'; ttsDevice: 'auto' | 'cpu' | 'gpu' } = {
  asrDevice: 'auto', translationDevice: 'auto', ttsDevice: 'auto',
};
const mockUpdate = vi.fn();

vi.mock('../../../stores/settingsStore', () => ({
  useLocalNativeSettings: () => mockSettings,
  useUpdateLocalNative: () => mockUpdate,
}));

// A catalog with one model reporting an available non-cpu tier is enough for
// gpuTierAvailable() (the real implementation, not mocked) to light the GPU
// option. An empty catalog hides the GPU button entirely.
const gpuAvailableCatalog: Record<string, NativeModelInfo> = {
  'gpu-model': {
    id: 'gpu-model', name: 'GPU Model', languages: ['en'], recommended: false, order: 0,
    repo: 'gpu-model', kind: 'asr',
    tiers: [{ tier: 'gpu-vulkan', backend: 'native_asr', available: true }],
  },
};
let mockCatalog: Record<string, NativeModelInfo> = gpuAvailableCatalog;

vi.mock('../../../stores/nativeModelStore', () => ({
  useNativeCatalog: () => mockCatalog,
}));

beforeEach(() => {
  mockUpdate.mockClear();
  mockSettings = { asrDevice: 'auto', translationDevice: 'auto', ttsDevice: 'auto' };
  mockCatalog = gpuAvailableCatalog;
});

describe('NativeDeviceControl — gpu override value', () => {
  it('writes asrDevice: gpu when GPU is clicked for the asr stage', () => {
    render(<NativeDeviceControl stage="asr" />);
    fireEvent.click(screen.getByText('GPU'));
    expect(mockUpdate).toHaveBeenCalledWith({ asrDevice: 'gpu' });
  });

  it('writes translationDevice: gpu for the translation stage', () => {
    render(<NativeDeviceControl stage="translation" />);
    fireEvent.click(screen.getByText('GPU'));
    expect(mockUpdate).toHaveBeenCalledWith({ translationDevice: 'gpu' });
  });

  it('writes ttsDevice: gpu for the tts stage', () => {
    render(<NativeDeviceControl stage="tts" />);
    fireEvent.click(screen.getByText('GPU'));
    expect(mockUpdate).toHaveBeenCalledWith({ ttsDevice: 'gpu' });
  });

  it('marks the GPU option active when the stored value is already gpu', () => {
    mockSettings = { ...mockSettings, asrDevice: 'gpu' };
    render(<NativeDeviceControl stage="asr" />);
    expect(screen.getByText('GPU').className).toContain('active');
  });

  it('does not offer a GPU option when no GPU tier is available on this machine', () => {
    mockCatalog = {};
    render(<NativeDeviceControl stage="asr" />);
    expect(screen.queryByText('GPU')).toBeNull();
  });
});
