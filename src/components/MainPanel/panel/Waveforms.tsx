import { useEffect, useRef, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { WavRenderer } from '../../../utils/wav_renderer';
import WaveformStrip from '../WaveformStrip';
import type { LegName } from '../../../lib/conversation/types';
import type { LevelMeter } from '../../../lib/audio/levelMeter';
import type { BusMeter } from '../../../lib/audio/graph';
import type { AudioMode } from '../../../stores/audioStore';

/** Drawn when a strip has nothing to show: muted, ended, or no meter at all. */
const FLAT = new Float32Array([0]);

/**
 * One strip's draw loop (`MainPanel.tsx:3878-3905`): sizes the canvas from
 * its offset size on first draw, clears, and draws today's bars.
 * `read` is threaded through a ref so a fresh closure every render (a new
 * `levels`/`meter` object, or a new `read` callback) never restarts the
 * `requestAnimationFrame` loop — only unmount does.
 */
function useWaveform(read: () => Float32Array | null, color: string): RefObject<HTMLCanvasElement | null> {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const readRef = useRef(read);
  readRef.current = read;

  useEffect(() => {
    let isLoaded = true;
    let ctx: CanvasRenderingContext2D | null = null;
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
          WavRenderer.drawBars(canvas, ctx, readRef.current() ?? FLAT, color, 10, 0, 8);
        }
      }
      requestAnimationFrame(draw);
    };
    draw();
    return () => { isLoaded = false; };
  }, [color]);

  return canvasRef;
}

/**
 * The advanced footer's mic + system strips (`MainPanel.tsx:4801-4822`):
 * mic while `mode` includes the speaker leg, system while it includes the
 * participant leg. Each draws its leg's spectrum — the same frequency bars as
 * the output strip, moving as smoothly: the meter emulates the output's
 * analyser and moves its window with time between chunks. Both draw loops
 * run every render regardless of which strip is visible (Rules of Hooks) —
 * only their strips' visibility follows `mode`, as today's condition did.
 */
export function InputWaveforms({ mode, levels }: { mode: AudioMode; levels: Readonly<Record<LegName, LevelMeter>> | null }) {
  const { t } = useTranslation();
  const micRef = useWaveform(() => levels?.speaker.read() ?? null, '#0099ff');
  const systemRef = useWaveform(() => levels?.participant.read() ?? null, '#f59e0b');
  const showMic = mode === 'speaker' || mode === 'both';
  const showSystem = mode === 'participant' || mode === 'both';

  return (
    <div className="waveform-input-group">
      {showMic && (
        <WaveformStrip
          kind="mic"
          canvasRef={micRef}
          width={mode === 'both' ? 'half' : 'full'}
          title={t('mainPanel.waveformMicTooltip', 'Your microphone — your voice being captured for translation')}
        />
      )}
      {showSystem && (
        <WaveformStrip
          kind="system"
          canvasRef={systemRef}
          width={mode === 'both' ? 'half' : 'full'}
          title={t('mainPanel.waveformSystemTooltip', "Other's audio captured for translation (browser tab / system audio)")}
        />
      )}
    </div>
  );
}

/** The advanced footer's output strip (`MainPanel.tsx:4895`): what is sent to the virtual microphone. */
export function OutputWaveform({ meter }: { meter: BusMeter | null }) {
  const { t } = useTranslation();
  const outputRef = useWaveform(() => meter?.read() ?? null, '#ff9900');

  return (
    <WaveformStrip
      kind="output"
      canvasRef={outputRef}
      width="full"
      title={t('mainPanel.waveformOutputTooltip', 'Audio sent to the virtual microphone (translation + passthrough)')}
    />
  );
}
