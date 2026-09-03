import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { EngineStatusLine } from './EngineStatusLine';
import { useNativeModelStore } from '../../../stores/nativeModelStore';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, def: string, vars?: Record<string, unknown>) =>
      def.replace(/\{\{(\w+)\}\}/g, (_, v) => String(vars?.[v] ?? '')),
  }),
}));


const setNative = (patch: Record<string, unknown>) => useNativeModelStore.setState({ ...patch } as never);

const lineText = (container: HTMLElement) => container.querySelector('.engine-status-line')?.textContent ?? '';
const dotClass = (container: HTMLElement) =>
  container.querySelector('.engine-status-line__dot')?.className ?? '';

describe('EngineStatusLine', () => {
  beforeEach(() => {
    setNative({
      bundleStatus: 'unknown', bundleVersion: null, bundleRequiredVersion: null,
      bundleDevVenv: false, bundleProgress: { downloaded: 0, total: 0 }, bundlePhase: null,
      sidecarStatus: 'idle', engineInfo: null,
    });
  });

  it('hidden when bundleStatus is unknown', () => {
    const { container } = render(<EngineStatusLine />);
    expect(container.firstChild).toBeNull();
  });

  it('hidden when bundleStatus is unsupported', () => {
    setNative({ bundleStatus: 'unsupported' });
    const { container } = render(<EngineStatusLine />);
    expect(container.firstChild).toBeNull();
  });

  it('unsupported SKU with a dev venv: the venv is the engine — ready line, and "starting" while idle', () => {
    setNative({
      bundleStatus: 'unsupported', bundleDevVenv: true, sidecarStatus: 'ready',
      engineInfo: { nativeVersion: '1.0.1', engineVersions: {}, lane: 'cpu', preferredDevice: null },
    });
    const ready = render(<EngineStatusLine />);
    expect(lineText(ready.container)).toContain('dev venv');
    expect(lineText(ready.container)).toContain('native 1.0.1');
    ready.unmount();
    setNative({ bundleStatus: 'unsupported', bundleDevVenv: true, sidecarStatus: 'idle', engineInfo: null });
    const idle = render(<EngineStatusLine />);
    expect(lineText(idle.container)).toContain('starting');
  });

  it('ready: version, native, backend and device — green dot', () => {
    setNative({
      bundleStatus: 'ready', bundleVersion: '0.2.0', sidecarStatus: 'ready',
      engineInfo: {
        nativeVersion: '1.0.1', engineVersions: { ggml: '0.22.0' },
        lane: 'cpu-vulkan', preferredDevice: { kind: 'vulkan', name: 'gpu0', description: 'NVIDIA GB10' },
      },
    });
    const { container } = render(<EngineStatusLine />);
    const text = lineText(container);
    expect(text).toContain('Engine 0.2.0');
    expect(text).toContain('native 1.0.1');
    expect(text).toContain('Vulkan');
    expect(text).toContain('NVIDIA GB10');
    expect(dotClass(container)).toContain('engine-status-line__dot--ready');
  });

  it('ready: dev venv (no bundleVersion) uses the "dev venv" label', () => {
    setNative({
      bundleStatus: 'ready', bundleVersion: null, bundleDevVenv: true, sidecarStatus: 'ready',
      engineInfo: {
        nativeVersion: '1.0.1', engineVersions: null, lane: 'cpu',
        preferredDevice: { kind: 'cpu', name: 'cpu0', description: 'CPU' },
      },
    });
    const { container } = render(<EngineStatusLine />);
    const text = lineText(container);
    expect(text).toContain('Engine dev venv');
    expect(text).toContain('native 1.0.1');
    // device ("CPU") equals the backend label ("CPU") — omitted as redundant.
    expect(text.match(/CPU/g)?.length).toBe(1);
  });

  it('ready: device omitted when it duplicates the backend label', () => {
    setNative({
      bundleStatus: 'ready', bundleVersion: '0.2.0', sidecarStatus: 'ready',
      engineInfo: {
        nativeVersion: '1.0.1', engineVersions: null, lane: 'cpu',
        preferredDevice: { kind: 'cpu', name: 'cpu0', description: 'CPU' },
      },
    });
    const { container } = render(<EngineStatusLine />);
    expect(container.querySelector('.engine-status-line__device')).toBeNull();
  });

  it('starting (sidecarStatus starting): hollow dot, "starting…"', () => {
    setNative({ bundleStatus: 'ready', bundleVersion: '0.2.0', sidecarStatus: 'starting' });
    const { container } = render(<EngineStatusLine />);
    expect(lineText(container)).toContain('Engine 0.2.0 · starting…');
    expect(dotClass(container)).toContain('engine-status-line__dot--hollow');
  });

  it('starting (idle + bundle ready): same starting text', () => {
    setNative({ bundleStatus: 'ready', bundleVersion: '0.2.0', sidecarStatus: 'idle' });
    const { container } = render(<EngineStatusLine />);
    expect(lineText(container)).toContain('starting…');
  });

  it('absent: hollow dot, "Engine not installed"', () => {
    setNative({ bundleStatus: 'absent', sidecarStatus: 'idle' });
    const { container } = render(<EngineStatusLine />);
    expect(lineText(container)).toContain('Engine not installed');
    expect(dotClass(container)).toContain('engine-status-line__dot--hollow');
  });

  it('mismatch: amber dot, from → to versions', () => {
    setNative({ bundleStatus: 'mismatch', bundleVersion: '0.1.0', bundleRequiredVersion: '0.2.0' });
    const { container } = render(<EngineStatusLine />);
    const text = lineText(container);
    expect(text).toContain('Engine update');
    expect(text).toContain('0.1.0');
    expect(text).toContain('0.2.0');
    expect(dotClass(container)).toContain('engine-status-line__dot--warn');
  });

  it('paused: amber dot, "Download paused"', () => {
    setNative({ bundleStatus: 'paused' });
    const { container } = render(<EngineStatusLine />);
    expect(lineText(container)).toContain('Download paused');
    expect(dotClass(container)).toContain('engine-status-line__dot--warn');
  });

  it('installing/download: amber dot, percent', () => {
    setNative({
      bundleStatus: 'installing', bundlePhase: 'download',
      bundleProgress: { downloaded: 512 * 1024 ** 2, total: 2 * 1024 ** 3 },
    });
    const { container } = render(<EngineStatusLine />);
    expect(lineText(container)).toContain('Downloading 25%');
    expect(dotClass(container)).toContain('engine-status-line__dot--warn');
  });

  it('installing/verify: "Verifying…"', () => {
    setNative({ bundleStatus: 'installing', bundlePhase: 'verify' });
    const { container } = render(<EngineStatusLine />);
    expect(lineText(container)).toContain('Verifying…');
  });

  it('installing/extract: "Extracting…"', () => {
    setNative({ bundleStatus: 'installing', bundlePhase: 'extract' });
    const { container } = render(<EngineStatusLine />);
    expect(lineText(container)).toContain('Extracting…');
  });

  it('error: red dot, "Engine error"', () => {
    setNative({ bundleStatus: 'error' });
    const { container } = render(<EngineStatusLine />);
    expect(lineText(container)).toContain('Engine error');
    expect(dotClass(container)).toContain('engine-status-line__dot--error');
  });

  it('unavailable (bundle ready, sidecar unavailable): red dot, "Engine unavailable"', () => {
    setNative({ bundleStatus: 'ready', bundleVersion: '0.2.0', sidecarStatus: 'unavailable' });
    const { container } = render(<EngineStatusLine />);
    expect(lineText(container)).toContain('Engine unavailable');
    expect(dotClass(container)).toContain('engine-status-line__dot--error');
  });

  it('is display only in every state: no role, no tab stop, no chevron, and a click does nothing', () => {
    for (const status of ['absent', 'mismatch', 'error'] as const) {
      setNative({ bundleStatus: status, bundleVersion: '0.1.0', bundleRequiredVersion: '0.2.0' });
      const { container, unmount } = render(<EngineStatusLine />);
      const line = container.querySelector('.engine-status-line') as HTMLElement;
      expect(line.getAttribute('role')).toBeNull();
      expect(line.getAttribute('tabindex')).toBeNull();
      expect(line.className).toBe('engine-status-line');
      expect(container.querySelector('.engine-status-line__chevron')).toBeNull();
      expect(() => fireEvent.click(line)).not.toThrow();
      unmount();
    }
  });
});
