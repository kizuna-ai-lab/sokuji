// src/components/CaptionShare/QrCode.tsx
import React, { useMemo } from 'react';
import { encode } from 'uqr';

interface QrCodeProps {
  value: string;
  size?: number;
  label: string;
  className?: string;
}

const QUIET = 4;

/** A QR code as SVG modules on white, with a 4-module quiet zone. */
const QrCode: React.FC<QrCodeProps> = ({ value, size = 128, label, className = '' }) => {
  const { path, n } = useMemo(() => {
    const { data } = encode(value, { ecc: 'M', border: 0 });
    let d = '';
    data.forEach((row, y) => row.forEach((on, x) => { if (on) d += `M${x} ${y}h1v1h-1z`; }));
    return { path: d, n: data.length };
  }, [value]);
  const box = n + 2 * QUIET;
  return (
    <svg
      className={`qr-code ${className}`.trim()}
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`${-QUIET} ${-QUIET} ${box} ${box}`}
      shapeRendering="crispEdges"
    >
      <rect x={-QUIET} y={-QUIET} width={box} height={box} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
};

export default QrCode;
