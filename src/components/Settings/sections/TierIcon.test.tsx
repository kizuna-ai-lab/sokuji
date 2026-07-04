import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { TierIcon } from './TierIcon';

describe('TierIcon', () => {
  // Query the wrapper span by its data-tier and assert aria-label + that a glyph rendered.
  // (Robust against react-icons/lucide a11y quirks — avoids ambiguous getByRole('img').)
  const cases: [string, string][] = [
    ['gpu-cuda', 'NVIDIA CUDA'],
    ['gpu-metal', 'Apple Metal'],
    ['gpu-vulkan', 'Vulkan'],
    ['gpu-dml', 'DirectML'],
    ['gpu-rocm', 'GPU'],            // unknown gpu-* -> neutral chip fallback
  ];
  it.each(cases)('renders tier %s labeled "%s"', (tier, label) => {
    const { container } = render(<TierIcon tier={tier} />);
    const el = container.querySelector(`[data-tier="${tier}"]`);
    expect(el).not.toBeNull();
    expect(el).toHaveAttribute('aria-label', label);
    expect(el!.querySelector('svg')).not.toBeNull();   // an actual glyph rendered
  });

  it('uses a compact glyph for vulkan, not the wordmark', () => {
    // Simple Icons' Vulkan mark is the horizontal "VULKAN" WORDMARK — six
    // letter outlines that turn into an unreadable smudge at tag size (10px).
    // The tag text already says "Vulkan", so the icon slot renders lucide's
    // Gpu card glyph (stroke-based, like every other lucide icon here).
    const { container } = render(<TierIcon tier="gpu-vulkan" />);
    const svg = container.querySelector('svg')!;
    // lucide icons are stroke-drawn; the Simple Icons wordmark is fill-drawn
    expect(svg.getAttribute('stroke')).toBe('currentColor');
    expect(svg.getAttribute('fill')).toBe('none');
  });

  it('renders nothing for cpu', () => {
    const { container } = render(<TierIcon tier="cpu" />);
    expect(container).toBeEmptyDOMElement();
  });
});
