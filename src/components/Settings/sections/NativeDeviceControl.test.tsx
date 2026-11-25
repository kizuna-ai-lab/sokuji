/**
 * Tests for NativeDeviceControl — the per-stage Auto/CPU/GPU segmented
 * control over the value its host hands it: Auto / CPU / GPU per stage,
 * reporting 'gpu' for GPU.
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
const mockUpdateDevice = vi.fn();

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
  mockUpdateDevice.mockClear();
  mockSettings = { asrDevice: 'auto', translationDevice: 'auto', ttsDevice: 'auto' };
  mockCatalog = gpuAvailableCatalog;
});

describe('NativeDeviceControl — gpu override value', () => {
  it('reports gpu through onChange when GPU is clicked for the asr stage', () => {
    render(<NativeDeviceControl stage="asr" value={mockSettings.asrDevice} onChange={mockUpdateDevice} />);
    fireEvent.click(screen.getByText('GPU'));
    expect(mockUpdateDevice).toHaveBeenCalledWith('gpu');
  });

  it('reports gpu through onChange for the translation stage', () => {
    render(<NativeDeviceControl stage="translation" value={mockSettings.translationDevice} onChange={mockUpdateDevice} />);
    fireEvent.click(screen.getByText('GPU'));
    expect(mockUpdateDevice).toHaveBeenCalledWith('gpu');
  });

  it('reports gpu through onChange for the tts stage', () => {
    render(<NativeDeviceControl stage="tts" value={mockSettings.ttsDevice} onChange={mockUpdateDevice} />);
    fireEvent.click(screen.getByText('GPU'));
    expect(mockUpdateDevice).toHaveBeenCalledWith('gpu');
  });

  it('marks the GPU option active when the value it is handed is already gpu', () => {
    mockSettings = { ...mockSettings, asrDevice: 'gpu' };
    render(<NativeDeviceControl stage="asr" value={mockSettings.asrDevice} onChange={mockUpdateDevice} />);
    expect(screen.getByText('GPU').className).toContain('active');
  });

  it('does not report the mode it already shows', () => {
    mockSettings = { ...mockSettings, asrDevice: 'cpu' };
    render(<NativeDeviceControl stage="asr" value={mockSettings.asrDevice} onChange={mockUpdateDevice} />);
    fireEvent.click(screen.getByText('CPU'));
    expect(mockUpdateDevice).not.toHaveBeenCalled();
  });

  it('does not offer a GPU option when no GPU tier is available on this machine', () => {
    mockCatalog = {};
    render(<NativeDeviceControl stage="asr" value={mockSettings.asrDevice} onChange={mockUpdateDevice} />);
    expect(screen.queryByText('GPU')).toBeNull();
  });
});
