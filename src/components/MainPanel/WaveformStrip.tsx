import React from 'react';
import './WaveformStrip.scss';

interface WaveformStripProps {
  kind: 'mic' | 'system' | 'output';
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
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

const WaveformStrip: React.FC<WaveformStripProps> = ({ kind, canvasRef, width = 'full', label, title }) => {
  const cls = `waveform-strip waveform-strip--${kind} waveform-strip--${width}`;
  return (
    <div className={cls} title={title}>
      <span className="waveform-strip__label">{label ?? DEFAULT_LABELS[kind]}</span>
      <canvas ref={canvasRef} className="waveform-strip__canvas" />
    </div>
  );
};

export default WaveformStrip;
