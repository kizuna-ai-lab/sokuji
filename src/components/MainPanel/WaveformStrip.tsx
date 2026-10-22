import React, { useEffect, useLayoutEffect, useRef } from 'react';
import './WaveformStrip.scss';
import { WavRenderer } from '../../utils/wav_renderer';
import { subscribeScheme } from '../../lib/theme/theme';

/** Drawn when a strip has nothing to show: muted, ended, or no meter at all. */
const FLAT = new Float32Array([0]);

interface WaveformStripProps {
  kind: 'mic' | 'system' | 'output';
  /** Read the current spectrum frame each animation frame; `null` draws flat. */
  read: () => Float32Array | null;
  /**
   * The bars' colour, as the name of a theme token (`--sk-waveform-…`). A
   * canvas cannot read a custom property, so the strip resolves it from the
   * computed style, once and again after every scheme apply: a scheme change
   * shows on the next frame (spec 2026-10-22 §5).
   */
  colorToken: string;
  width?: 'full' | 'half';
  label?: string;
  /** Optional hover tooltip describing what this strip shows. */
  title?: string;
}

const DEFAULT_LABELS: Record<WaveformStripProps['kind'], string> = {
  mic: 'mic',
  system: 'sys',
  output: 'out',
};

/**
 * The strip's own draw loop (`MainPanel.tsx:3878-3905` before the port):
 * sizes the canvas from its offset size on first draw, clears, and draws
 * today's bars. `read` is threaded through a ref so a fresh closure every
 * render (a new `levels`/`meter` object, or a new `read` callback) never
 * restarts the `requestAnimationFrame` loop — only unmount does. The ref is
 * written after commit, never during render: a render React discards must
 * not hand the running loop its callback. The loop's lifetime is the strip's
 * own: mounting `WaveformStrip` starts it against this canvas, unmounting
 * cancels its pending frame and stops it for good, so a strip that mounts
 * again later gets a brand-new canvas and a brand-new loop rather than
 * inheriting a stale context from the one that was removed.
 */
function useWaveform(read: () => Float32Array | null, colorToken: string): React.RefObject<HTMLCanvasElement | null> {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const readRef = useRef(read);
  useLayoutEffect(() => {
    readRef.current = read;
  }, [read]);

  useEffect(() => {
    let isLoaded = true;
    let frame = 0;
    let ctx: CanvasRenderingContext2D | null = null;
    // Resolved on the first frame and again after a scheme apply, not every
    // frame: a style read per frame per strip is wasted work for a value that
    // only a theme change moves.
    let colour: string | null = null;
    const unsubscribe = subscribeScheme(() => { colour = null; });
    const draw = () => {
      if (!isLoaded) return;
      const canvas = canvasRef.current;
      if (canvas) {
        if (!canvas.width || !canvas.height) {
          canvas.width = canvas.offsetWidth;
          canvas.height = canvas.offsetHeight;
        }
        ctx = ctx || canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          if (colour === null) colour = getComputedStyle(canvas).getPropertyValue(colorToken).trim();
          WavRenderer.drawBars(canvas, ctx, readRef.current() ?? FLAT, colour, 10, 0, 8);
        }
      }
      frame = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      isLoaded = false;
      unsubscribe();
      cancelAnimationFrame(frame);
    };
  }, [colorToken]);

  return canvasRef;
}

const WaveformStrip: React.FC<WaveformStripProps> = ({ kind, read, colorToken, width = 'full', label, title }) => {
  const canvasRef = useWaveform(read, colorToken);
  const cls = `waveform-strip waveform-strip--${kind} waveform-strip--${width}`;
  return (
    <div className={cls} title={title} data-color-token={colorToken}>
      <span className="waveform-strip__label">{label ?? DEFAULT_LABELS[kind]}</span>
      <canvas ref={canvasRef} className="waveform-strip__canvas" />
    </div>
  );
};

export default WaveformStrip;
