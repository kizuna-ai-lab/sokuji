import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ModePicker from './ModePicker';

describe('ModePicker', () => {
  it('renders three segments labeled by i18n keys (fallback to defaults)', () => {
    render(<ModePicker mode="speaker" locked={false} missingDeviceForMode={null} onSegmentClick={() => {}} />);
    expect(screen.getByRole('button', { name: /Me|我/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Other|对方/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Both|双向/ })).toBeInTheDocument();
  });

  it('marks the active segment with aria-pressed', () => {
    render(<ModePicker mode="participant" locked={false} missingDeviceForMode={null} onSegmentClick={() => {}} />);
    const active = screen.getByRole('button', { name: /Other|对方/ });
    expect(active).toHaveAttribute('aria-pressed', 'true');
  });

  it('calls onSegmentClick with the segment key when an inactive segment is clicked', () => {
    const onSegmentClick = vi.fn();
    render(<ModePicker mode="speaker" locked={false} missingDeviceForMode={null} onSegmentClick={onSegmentClick} />);
    fireEvent.click(screen.getByRole('button', { name: /Both|双向/ }));
    expect(onSegmentClick).toHaveBeenCalledWith('both', expect.any(HTMLElement));
  });

  it('calls onSegmentClick with the active segment key when the active segment is re-clicked', () => {
    const onSegmentClick = vi.fn();
    render(<ModePicker mode="both" locked={false} missingDeviceForMode={null} onSegmentClick={onSegmentClick} />);
    fireEvent.click(screen.getByRole('button', { name: /Both|双向/ }));
    expect(onSegmentClick).toHaveBeenCalledWith('both', expect.any(HTMLElement));
  });

  it('does not fire onSegmentClick when locked', () => {
    const onSegmentClick = vi.fn();
    render(<ModePicker mode="speaker" locked={true} missingDeviceForMode={null} onSegmentClick={onSegmentClick} />);
    fireEvent.click(screen.getByRole('button', { name: /Both|双向/ }));
    expect(onSegmentClick).not.toHaveBeenCalled();
  });

  it("adds the face-to-face sentence to Both's tooltip only when it is offered", () => {
    const { rerender } = render(<ModePicker mode="speaker" locked={false} missingDeviceForMode={null} onSegmentClick={() => {}} />);
    expect(screen.getByRole('button', { name: /Both|双向/ }).title).not.toContain('face-to-face');
    rerender(<ModePicker mode="speaker" locked={false} missingDeviceForMode={null} onSegmentClick={() => {}} faceToFaceOffered />);
    const title = screen.getByRole('button', { name: /Both|双向/ }).title;
    expect(title).toContain("Two-way. Translate your voice and the other side's at the same time.\nAlso for two people at one computer (face-to-face).");
  });

  // jsdom has no container queries: the tag's visibility at narrow widths is the stylesheet's.
  it('renders the tag whenever Both runs face-to-face', () => {
    const { container, rerender } = render(<ModePicker mode="both" locked={false} missingDeviceForMode={null} onSegmentClick={() => {}} faceToFace />);
    expect(container.querySelector('.mode-picker__tag')).not.toBeNull();
    rerender(<ModePicker mode="both" locked={false} missingDeviceForMode={null} onSegmentClick={() => {}} />);
    expect(container.querySelector('.mode-picker__tag')).toBeNull();
  });

  it('the tag carries the accessible name, with a word and an icon-only glyph', () => {
    const { container } = render(<ModePicker mode="both" locked={false} missingDeviceForMode={null} onSegmentClick={() => {}} faceToFace />);
    const tag = container.querySelector('.mode-picker__tag')!;
    expect(tag.getAttribute('aria-label')).toMatch(/Face-to-face|modePicker\.faceToFaceTag/);
    expect(tag.getAttribute('title')).toBe(tag.getAttribute('aria-label'));
    expect(tag.querySelector('.mode-picker__tag-word')).not.toBeNull();
    expect(tag.querySelector('.mode-picker__tag-glyph')?.getAttribute('aria-hidden')).toBe('true');
    expect(tag.querySelector('.mode-picker__tag-glyph svg')).not.toBeNull();
  });

  it('renders one side icon per segment, Me and Other in their both form', () => {
    render(<ModePicker mode="both" locked={false} missingDeviceForMode={null} onSegmentClick={() => {}} />);
    const iconIn = (name: RegExp) => screen.getByRole('button', { name }).querySelector('svg')!;
    expect(iconIn(/Me|我/).getAttribute('data-icon')).toBe('side-me');
    expect(iconIn(/Other|对方/).getAttribute('data-icon')).toBe('side-other');
    expect(iconIn(/Both|双向/).getAttribute('data-icon')).toBe('side-both');
    for (const name of [/Me|我/, /Other|对方/]) {
      for (const p of Array.from(iconIn(name).querySelectorAll('path'))) {
        expect(p).toHaveAttribute('fill', 'currentColor');
      }
      expect(iconIn(name).getAttribute('width')).toBe('14');
    }
  });

  it('adds a warn class on the segment indicated by missingDeviceForMode', () => {
    render(<ModePicker mode="both" locked={false} missingDeviceForMode="speaker" onSegmentClick={() => {}} />);
    const speakerSeg = screen.getByRole('button', { name: /Me|我/ });
    expect(speakerSeg.className).toMatch(/warn/);
  });

  it('tags Both as face-to-face when it runs so', () => {
    render(<ModePicker mode="both" locked={false} missingDeviceForMode={null} onSegmentClick={() => {}} faceToFace />);
    expect(screen.getByRole('button', { name: /Both|双向/ }).querySelector('.mode-picker__tag')?.textContent).toMatch(/Face-to-face|modePicker\.faceToFaceTag/);
  });

  it('shows no tag otherwise', () => {
    const { container } = render(<ModePicker mode="both" locked={false} missingDeviceForMode={null} onSegmentClick={() => {}} />);
    expect(container.querySelector('.mode-picker__tag')).toBeNull();
  });
});
