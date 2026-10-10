import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { FaceToFaceIcon } from './FaceToFaceIcon';

describe('FaceToFaceIcon', () => {
  it('is a 24-grid stroke icon of two faces and two shoulders, sized like a lucide icon', () => {
    const { container } = render(<FaceToFaceIcon size={12} className="x" aria-hidden="true" />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg.getAttribute('width')).toBe('12');
    expect(svg.getAttribute('stroke')).toBe('currentColor');
    expect(svg.getAttribute('fill')).toBe('none');
    expect(svg.getAttribute('class')).toBe('x');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.querySelectorAll('path')).toHaveLength(4);
  });
});
