import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { InputWaveforms, OutputWaveform } from './Waveforms';
import { WavRenderer } from '../../../utils/wav_renderer';
import type { LevelMeter } from '../../../lib/audio/levelMeter';
import type { BusMeter } from '../../../lib/audio/graph';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

// A minimal `requestAnimationFrame` stub that collects callbacks instead of
// scheduling them, so a test drives the draw loop one frame at a time.
let frameQueue: FrameRequestCallback[] = [];
let rafId = 0;

function runFrame() {
  const queue = frameQueue;
  frameQueue = [];
  queue.forEach((cb) => cb(0));
}

let getContextSpy: ReturnType<typeof vi.spyOn>;
let drawBarsSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  frameQueue = [];
  rafId = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frameQueue.push(cb);
    return ++rafId;
  });
  getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    clearRect: vi.fn(),
    fillRect: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  drawBarsSpy = vi.spyOn(WavRenderer, 'drawBars').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  getContextSpy.mockRestore();
  drawBarsSpy.mockRestore();
});

const makeMeter = (values: Float32Array): LevelMeter => ({
  push: vi.fn(),
  read: vi.fn(() => values),
  reset: vi.fn(),
});

describe('InputWaveforms', () => {
  it("renders both strips in 'both' and only the mic strip in 'speaker'", () => {
    const { container, rerender } = render(<InputWaveforms mode="both" levels={null} />);
    expect(container.querySelectorAll('.waveform-strip--mic').length).toBe(1);
    expect(container.querySelectorAll('.waveform-strip--system').length).toBe(1);

    rerender(<InputWaveforms mode="speaker" levels={null} />);
    expect(container.querySelectorAll('.waveform-strip--mic').length).toBe(1);
    expect(container.querySelectorAll('.waveform-strip--system').length).toBe(0);
  });

  it("renders only the system strip in 'participant'", () => {
    const { container } = render(<InputWaveforms mode="participant" levels={null} />);
    expect(container.querySelectorAll('.waveform-strip--mic').length).toBe(0);
    expect(container.querySelectorAll('.waveform-strip--system').length).toBe(1);
  });

  it("running one frame calls both legs' read() in 'both'", () => {
    const speakerMeter = makeMeter(new Float32Array([0.5]));
    const participantMeter = makeMeter(new Float32Array([0.25]));
    render(<InputWaveforms mode="both" levels={{ speaker: speakerMeter, participant: participantMeter }} />);

    expect(frameQueue.length).toBeGreaterThan(0);
    (speakerMeter.read as ReturnType<typeof vi.fn>).mockClear();
    (participantMeter.read as ReturnType<typeof vi.fn>).mockClear();
    runFrame();
    expect(speakerMeter.read).toHaveBeenCalledTimes(1);
    expect(participantMeter.read).toHaveBeenCalledTimes(1);
  });

  it('draws flat and does not throw when levels is null', () => {
    expect(() => render(<InputWaveforms mode="both" levels={null} />)).not.toThrow();
    drawBarsSpy.mockClear();
    expect(() => runFrame()).not.toThrow();
    expect(drawBarsSpy).toHaveBeenCalled();
    for (const call of drawBarsSpy.mock.calls) {
      const data = call[2] as Float32Array;
      expect(Array.from(data)).toEqual([0]);
    }
  });

  it('a strip that comes back draws on its own new canvas', () => {
    getContextSpy.mockRestore();
    const contextsByCanvas = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>();
    getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
      this: HTMLCanvasElement,
    ) {
      let ctx = contextsByCanvas.get(this);
      if (!ctx) {
        ctx = { clearRect: vi.fn(), fillRect: vi.fn() } as unknown as CanvasRenderingContext2D;
        contextsByCanvas.set(this, ctx);
      }
      return ctx;
    });

    const speakerMeter = makeMeter(new Float32Array([0.5]));
    const participantMeter = makeMeter(new Float32Array([0.25]));
    const levels = { speaker: speakerMeter, participant: participantMeter };

    const { container, rerender } = render(<InputWaveforms mode="speaker" levels={levels} />);
    const firstCanvas = container.querySelector('.waveform-strip--mic canvas') as HTMLCanvasElement;
    runFrame();

    rerender(<InputWaveforms mode="participant" levels={levels} />);
    runFrame();

    rerender(<InputWaveforms mode="speaker" levels={levels} />);
    const secondCanvas = container.querySelector('.waveform-strip--mic canvas') as HTMLCanvasElement;
    expect(secondCanvas).not.toBe(firstCanvas);

    drawBarsSpy.mockClear();
    runFrame();

    type DrawBarsCall = Parameters<typeof WavRenderer.drawBars>;
    const micCalls = drawBarsSpy.mock.calls.filter((call: DrawBarsCall) => call[0] === secondCanvas);
    expect(micCalls.length).toBeGreaterThan(0);
    for (const call of micCalls) {
      expect(call[0]).toBe(secondCanvas);
      expect(call[1]).toBe(contextsByCanvas.get(secondCanvas));
    }
    const staleCalls = drawBarsSpy.mock.calls.filter((call: DrawBarsCall) => call[0] === firstCanvas);
    expect(staleCalls.length).toBe(0);
  });

  it('a hidden strip reads nothing', () => {
    const speakerMeter = makeMeter(new Float32Array([0.5]));
    const participantMeter = makeMeter(new Float32Array([0.25]));
    render(<InputWaveforms mode="speaker" levels={{ speaker: speakerMeter, participant: participantMeter }} />);

    (participantMeter.read as ReturnType<typeof vi.fn>).mockClear();
    runFrame();
    runFrame();
    runFrame();
    expect(participantMeter.read).not.toHaveBeenCalled();
  });
});

describe('OutputWaveform', () => {
  it('reads meter.read() each frame', () => {
    const meter: BusMeter = { read: vi.fn(() => new Float32Array([0.7])) };
    render(<OutputWaveform meter={meter} />);

    (meter.read as ReturnType<typeof vi.fn>).mockClear();
    runFrame();
    expect(meter.read).toHaveBeenCalledTimes(1);
  });

  it('draws flat when meter is null and does not throw', () => {
    expect(() => render(<OutputWaveform meter={null} />)).not.toThrow();
    drawBarsSpy.mockClear();
    expect(() => runFrame()).not.toThrow();
    expect(drawBarsSpy).toHaveBeenCalled();
    const data = drawBarsSpy.mock.calls[0][2] as Float32Array;
    expect(Array.from(data)).toEqual([0]);
  });

  it('stops the loop on unmount (no frame calls read again)', () => {
    const meter: BusMeter = { read: vi.fn(() => new Float32Array([0.4])) };
    const { unmount } = render(<OutputWaveform meter={meter} />);

    expect(frameQueue.length).toBe(1);
    const pending = frameQueue[0];
    unmount();
    (meter.read as ReturnType<typeof vi.fn>).mockClear();
    frameQueue = [];
    pending(0);
    expect(meter.read).not.toHaveBeenCalled();
    expect(frameQueue.length).toBe(0);
  });
});
