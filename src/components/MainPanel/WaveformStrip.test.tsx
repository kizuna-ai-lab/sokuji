import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import WaveformStrip from './WaveformStrip';
import { WavRenderer } from '../../utils/wav_renderer';
import { installTheme, type ThemeSetting, type ThemeSource } from '../../lib/theme/theme';

// The strip's colour is a theme token (spec 2026-10-22 §5): the canvas cannot
// read a custom property, so the strip resolves it itself — once, and again
// after every scheme apply, not on every animation frame.
let frameQueue: FrameRequestCallback[] = [];
const runFrame = () => {
  const queue = frameQueue;
  frameQueue = [];
  queue.forEach((cb) => cb(0));
};
let tokenValue = 'rgb(1, 2, 3)';

beforeEach(() => {
  frameQueue = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frameQueue.push(cb); return 1; });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ clearRect: vi.fn(), fillRect: vi.fn() } as unknown as CanvasRenderingContext2D);
  vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({
    getPropertyValue: (name: string) => (name === '--sk-waveform-speaker' ? tokenValue : ''),
  } as unknown as CSSStyleDeclaration));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  tokenValue = 'rgb(1, 2, 3)';
});

function themeSource(initial: ThemeSetting) {
  let theme = initial;
  const listeners = new Set<() => void>();
  const source: ThemeSource & { set(next: ThemeSetting): void } = {
    getTheme: () => theme,
    isLoaded: () => true,
    subscribe: (l) => { listeners.add(l); return () => listeners.delete(l); },
    set(next) { theme = next; for (const l of [...listeners]) l(); },
  };
  return source;
}
const media = () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as MediaQueryList;

describe('WaveformStrip colour', () => {
  it('draws with the computed value of its token, and the new value after a scheme apply', () => {
    const source = themeSource('dark');
    const uninstall = installTheme({ source, matchMedia: media, storage: null });
    const draw = vi.spyOn(WavRenderer, 'drawBars').mockImplementation(() => {});
    render(<WaveformStrip kind="mic" read={() => null} colorToken="--sk-waveform-speaker" />);
    expect(draw).toHaveBeenCalled();
    const colourOf = (call: unknown[]) => call[3];
    const last = () => colourOf(draw.mock.calls[draw.mock.calls.length - 1]);
    expect(last()).toBe('rgb(1, 2, 3)');
    tokenValue = ' #abcdef ';
    source.set('light');
    runFrame();
    expect(last()).toBe('#abcdef');
    uninstall();
    document.documentElement.removeAttribute('data-theme');
  });

  it('reads its token once, not on every animation frame', () => {
    vi.spyOn(WavRenderer, 'drawBars').mockImplementation(() => {});
    render(<WaveformStrip kind="mic" read={() => null} colorToken="--sk-waveform-speaker" />);
    runFrame();
    runFrame();
    runFrame();
    expect(window.getComputedStyle).toHaveBeenCalledTimes(1);
  });

  it('names its token on the element', () => {
    const { container } = render(<WaveformStrip kind="output" read={() => null} colorToken="--sk-waveform-output" />);
    expect(container.querySelector('.waveform-strip--output')?.getAttribute('data-color-token')).toBe('--sk-waveform-output');
  });
});
