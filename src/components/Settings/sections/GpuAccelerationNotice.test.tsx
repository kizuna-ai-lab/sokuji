import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GpuAccelerationNotice } from './GpuAccelerationNotice';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, fb?: string) => fb ?? _k }),
}));

let mockAvailable = true;
let mockSoftwareOnly = false;
vi.mock('../../../stores/modelStore', () => ({
  useWebGPUAvailable: () => mockAvailable,
  useWebGPUSoftwareOnly: () => mockSoftwareOnly,
}));

let mockIsElectron = true;
let mockIsLinux = true;
vi.mock('../../../utils/environment', () => ({
  isElectron: () => mockIsElectron,
  isLinux: () => mockIsLinux,
}));

const DISMISSED_KEY = 'sokuji:gpu-acceleration-notice-dismissed';
const WARNING = /noticeably slower/i;
const REMEDY = /--ozone-platform=x11/;

beforeEach(() => {
  localStorage.clear();
  mockAvailable = true;
  mockSoftwareOnly = false;
  mockIsElectron = true;
  mockIsLinux = true;
});

describe('GpuAccelerationNotice (issue #389)', () => {
  it('stays out of the way when a real GPU is in use', () => {
    render(<GpuAccelerationNotice />);
    expect(screen.queryByText(WARNING)).toBeNull();
  });

  it('warns when WebGPU fell back to the CPU rasteriser', () => {
    mockSoftwareOnly = true;
    render(<GpuAccelerationNotice />);
    expect(screen.getByText(/running on the CPU/i)).toBeTruthy();
    expect(screen.getByText(WARNING)).toBeTruthy();
  });

  it('warns when WebGPU is missing entirely', () => {
    mockAvailable = false;
    render(<GpuAccelerationNotice />);
    expect(screen.getByText(WARNING)).toBeTruthy();
  });

  it('offers the Wayland remedy only on Linux desktop', () => {
    mockSoftwareOnly = true;
    const { unmount } = render(<GpuAccelerationNotice />);
    expect(screen.getByText(REMEDY)).toBeTruthy();
    unmount();

    mockIsLinux = false;
    render(<GpuAccelerationNotice />);
    expect(screen.queryByText(REMEDY)).toBeNull();
    expect(screen.getByText(WARNING)).toBeTruthy();   // fact still stated
  });

  it('does not offer the remedy outside Electron', () => {
    mockSoftwareOnly = true;
    mockIsElectron = false;
    render(<GpuAccelerationNotice />);
    expect(screen.queryByText(REMEDY)).toBeNull();
  });

  // "Show it once": dismissal is persisted, so it never nags again.
  it('hides on dismiss and records that in localStorage', () => {
    mockSoftwareOnly = true;
    render(<GpuAccelerationNotice />);
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(screen.queryByText(WARNING)).toBeNull();
    expect(localStorage.getItem(DISMISSED_KEY)).toBe('1');
  });

  it('stays hidden on later mounts once dismissed', () => {
    mockSoftwareOnly = true;
    localStorage.setItem(DISMISSED_KEY, '1');
    render(<GpuAccelerationNotice />);
    expect(screen.queryByText(WARNING)).toBeNull();
  });
});
