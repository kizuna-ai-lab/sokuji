import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import WaveformStrip from './WaveformStrip';
import { WavRenderer } from '../../utils/wav_renderer';

// The strip's colour is a theme token (spec 2026-10-22 §5): the canvas cannot
// read a custom property, so the strip resolves it itself, every frame, and a
// scheme change shows on the next frame.
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

describe('WaveformStrip colour', () => {
  it('draws with the computed value of its token, and a changed value on the next frame', () => {
    const draw = vi.spyOn(WavRenderer, 'drawBars').mockImplementation(() => {});
    render(<WaveformStrip kind="mic" read={() => null} colorToken="--sk-waveform-speaker" />);
    expect(draw).toHaveBeenCalled();
    const colourOf = (call: unknown[]) => call[3];
    expect(colourOf(draw.mock.calls[draw.mock.calls.length - 1])).toBe('rgb(1, 2, 3)');
    tokenValue = ' #abcdef ';
    runFrame();
    expect(colourOf(draw.mock.calls[draw.mock.calls.length - 1])).toBe('#abcdef');
  });

  it('names its token on the element', () => {
    const { container } = render(<WaveformStrip kind="output" read={() => null} colorToken="--sk-waveform-output" />);
    expect(container.querySelector('.waveform-strip--output')?.getAttribute('data-color-token')).toBe('--sk-waveform-output');
  });
});
