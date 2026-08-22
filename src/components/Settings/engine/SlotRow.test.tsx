import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

import { SlotRow } from './SlotRow';

const slot = { dir: 'ja→en', stage: 'asr' as const };

const row = (flashSlot: { dir: string; stage: 'asr' | 'translation' | 'tts' } | null = null) => (
  <SlotRow slot={slot} label="ASR" flashSlot={flashSlot}>
    <div data-testid="control" />
  </SlotRow>
);

describe('SlotRow (dropdown form: label + caller control + deep-link flash)', () => {
  it('renders the label and the caller-provided control', () => {
    render(row());
    expect(screen.getByText('ASR')).toBeInTheDocument();
    expect(screen.getByTestId('control')).toBeInTheDocument();
  });

  // Finding 4: a chip click deep-links into the engine surface and should
  // flash THIS row, not the whole ProviderSection (the old, wrong target).
  describe('flashSlot', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('renders the .highlight class when flashSlot matches this row, then drops it after the timeout', () => {
      render(row({ ...slot }));
      expect(document.querySelector('.engine-slot.highlight')).toBeInTheDocument();
      act(() => { vi.advanceTimersByTime(3100); });
      expect(document.querySelector('.engine-slot.highlight')).not.toBeInTheDocument();
    });

    it('does not flash a row flashSlot does not match (different stage)', () => {
      render(
        <SlotRow slot={slot} label="ASR" flashSlot={{ dir: 'ja→en', stage: 'translation' }}>
          <div />
        </SlotRow>);
      expect(document.querySelector('.engine-slot.highlight')).not.toBeInTheDocument();
    });

    it('re-flashes on a FRESH object with the identical dir/stage — the same chip fired twice', () => {
      const { rerender } = render(row({ ...slot }));
      act(() => { vi.advanceTimersByTime(3100); });
      expect(document.querySelector('.engine-slot.highlight')).not.toBeInTheDocument();
      rerender(row({ ...slot }));
      expect(document.querySelector('.engine-slot.highlight')).toBeInTheDocument();
    });

    it('the owner clearing the signal mid-flash ends the flash instead of latching it on', () => {
      const { rerender } = render(row({ ...slot }));
      expect(document.querySelector('.engine-slot.highlight')).toBeInTheDocument();
      rerender(row(null));
      expect(document.querySelector('.engine-slot.highlight')).not.toBeInTheDocument();
    });

    it('never flashes without a signal', () => {
      render(row());
      expect(document.querySelector('.engine-slot.highlight')).not.toBeInTheDocument();
    });
  });
});
