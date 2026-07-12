import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EngineSection } from './EngineSection';
import { useNativeModelStore } from '../../../stores/nativeModelStore';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, def: string, vars?: Record<string, unknown>) =>
      def.replace(/\{\{(\w+)\}\}/g, (_, v) => String(vars?.[v] ?? '')),
  }),
}));

const setBundle = (patch: Record<string, unknown>) =>
  useNativeModelStore.setState({
    refreshBundle: async () => {}, fetchBundleEntry: async () => {},
    installBundle: async () => {}, cancelBundle: async () => {}, removeBundle: async () => {},
    ...patch,
  } as never);

describe('EngineSection states (spec S10)', () => {
  beforeEach(() => setBundle({
    bundleStatus: 'unknown', bundleDevVenv: false, bundleGpuName: null,
    bundleSku: null, bundleVersion: null, bundleRequiredVersion: null,
    bundleSize: null, bundleInstalledSize: null, bundleStagedBytes: 0,
    bundlePhase: null, bundleProgress: { downloaded: 0, total: 0 }, bundleError: '',
    sidecarStatus: 'idle',
  }));

  it('renders nothing while unknown', () => {
    const { container } = render(<EngineSection />);
    expect(container.firstChild).toBeNull();
  });

  it('unsupported: explanatory note only', () => {
    setBundle({ bundleStatus: 'unsupported' });
    render(<EngineSection />);
    expect(screen.getByText(/not supported/)).toBeTruthy();
  });

  it('dev venv without a bundle: quiet dev note, no download nag', () => {
    setBundle({ bundleStatus: 'absent', bundleDevVenv: true });
    render(<EngineSection />);
    expect(screen.getByText(/Development mode/)).toBeTruthy();
    expect(screen.queryByText(/Download engine/)).toBeNull();
  });

  it('dev venv on an unsupported-SKU machine (ARM dev box): dev note, not "unsupported"', () => {
    setBundle({ bundleStatus: 'unsupported', bundleDevVenv: true });
    render(<EngineSection />);
    expect(screen.getByText(/Development mode/)).toBeTruthy();
    expect(screen.queryByText(/not supported/)).toBeNull();
  });

  it('absent: download CTA with sku, gpu and size', () => {
    setBundle({
      bundleStatus: 'absent', bundleSku: 'linux-nvidia',
      bundleGpuName: 'NVIDIA GeForce RTX 4070', bundleSize: 2 * 1024 ** 3,
    });
    render(<EngineSection />);
    expect(screen.getByText(/Download engine/)).toBeTruthy();
    expect(screen.getByText(/linux-nvidia/)).toBeTruthy();
    expect(screen.getByText(/RTX 4070/)).toBeTruthy();
    expect(screen.getByText(/2\.0 GB/)).toBeTruthy();
  });

  it('mismatch: update CTA with both versions', () => {
    setBundle({ bundleStatus: 'mismatch', bundleVersion: '0.1.0', bundleRequiredVersion: '0.2.0' });
    render(<EngineSection />);
    expect(screen.getByText(/0\.1\.0 → 0\.2\.0/)).toBeTruthy();
    expect(screen.getByText(/Update engine/)).toBeTruthy();
  });

  it('installing/download: percent + cancel', () => {
    setBundle({
      bundleStatus: 'installing', bundlePhase: 'download',
      bundleProgress: { downloaded: 512 * 1024 ** 2, total: 2 * 1024 ** 3 },
    });
    render(<EngineSection />);
    expect(screen.getByText(/25%/)).toBeTruthy();
    expect(screen.getByText(/Cancel/)).toBeTruthy();
  });

  it('installing/verify: indeterminate, no cancel', () => {
    setBundle({
      bundleStatus: 'installing', bundlePhase: 'verify',
      bundleProgress: { downloaded: 1, total: 1 },
    });
    render(<EngineSection />);
    expect(screen.getByText(/Verifying/)).toBeTruthy();
    expect(screen.queryByText(/Cancel/)).toBeNull();
  });

  it('paused: resume CTA with staged MB', () => {
    setBundle({ bundleStatus: 'paused', bundleStagedBytes: 812 * 1024 ** 2 });
    render(<EngineSection />);
    expect(screen.getByText(/812 MB/)).toBeTruthy();
    expect(screen.getByText(/Resume download/)).toBeTruthy();
  });

  it('error: message + retry', () => {
    setBundle({ bundleStatus: 'error', bundleError: 'not enough disk space: need ~7.4 GB free, have 3.1 GB' });
    render(<EngineSection />);
    expect(screen.getByText(/disk space/)).toBeTruthy();
    expect(screen.getByText(/Retry/)).toBeTruthy();
  });

  it('ready: version badge + remove affordance', () => {
    setBundle({ bundleStatus: 'ready', bundleVersion: '0.1.0', bundleInstalledSize: 4.9 * 1e9 });
    render(<EngineSection />);
    expect(screen.getByText(/Engine 0\.1\.0/)).toBeTruthy();
    expect(screen.getByText(/Remove engine/)).toBeTruthy();
  });

  it('ready + sidecar unavailable: runtime error + retry live inside the card', () => {
    const retrySidecar = vi.fn(async () => {});
    setBundle({
      bundleStatus: 'ready', bundleVersion: '0.1.0',
      sidecarStatus: 'unavailable', retrySidecar,
    });
    render(<EngineSection />);
    expect(screen.getByText(/unavailable/)).toBeTruthy();
    fireEvent.click(screen.getByText(/Retry/));
    expect(retrySidecar).toHaveBeenCalled();
  });

  it('dev venv + sidecar unavailable: error + retry inside the quiet dev card', () => {
    setBundle({
      bundleStatus: 'absent', bundleDevVenv: true,
      sidecarStatus: 'unavailable', retrySidecar: vi.fn(async () => {}),
    });
    render(<EngineSection />);
    expect(screen.getByText(/Development mode/)).toBeTruthy();
    expect(screen.getByText(/unavailable/)).toBeTruthy();
  });
});
