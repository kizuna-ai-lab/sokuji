// src/components/CaptionShare/QrCode.test.tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import QrCode from './QrCode';

describe('QrCode', () => {
  it('draws the modules on white with a quiet zone and an accessible label', () => {
    const { container } = render(<QrCode value="http://192.168.1.23:7788/" label="share address" size={96} />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('aria-label')).toBe('share address');
    expect(svg.getAttribute('width')).toBe('96');
    const [x, y, w, h] = svg.getAttribute('viewBox')!.split(' ').map(Number);
    expect(x).toBe(-4);
    expect(y).toBe(-4);
    expect(w).toBe(h);
    expect(container.querySelector('path')!.getAttribute('d')!.length).toBeGreaterThan(100);
  });
});
