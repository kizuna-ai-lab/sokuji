import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, d?: any, opts?: any) =>
    typeof d === 'string'
      ? d.replace(/\{\{(\w+)\}\}/g, (_m, n) => String(opts?.[n] ?? ''))
      : _k,
  }),
}));

import { SlotRow } from './SlotRow';

const resolvedAuto = { modelId: 'sensevoice-int8', source: 'auto' as const };
const resolvedExplicit = { modelId: 'opus-mt-ja-en', source: 'explicit' as const };

describe('SlotRow', () => {
  it("prefixes an auto result with 'auto ·' — required, not decorative", () => {
    render(<SlotRow slot={{ dir: 'ja→en', stage: 'asr' }} label="ASR" resolved={resolvedAuto}
      displayName={() => 'SenseVoice'} expanded={false} onToggle={() => {}} />);
    expect(screen.getByText('auto · SenseVoice')).toBeInTheDocument();
  });

  it('shows an explicit pick bare — no auto prefix', () => {
    render(<SlotRow slot={{ dir: 'ja→en', stage: 'translation' }} label="MT" resolved={resolvedExplicit}
      displayName={() => 'Opus-MT (ja→en)'} expanded={false} onToggle={() => {}} />);
    expect(screen.getByText('Opus-MT (ja→en)')).toBeInTheDocument();
    expect(screen.queryByText(/auto ·/)).not.toBeInTheDocument();
  });

  it('shows an em-dash when nothing resolves', () => {
    render(<SlotRow slot={{ dir: 'ja→en', stage: 'tts' }} label="TTS" resolved={null}
      displayName={() => ''} expanded={false} onToggle={() => {}} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders children only when expanded, and toggles via the header', () => {
    const onToggle = vi.fn();
    const { rerender } = render(
      <SlotRow slot={{ dir: 'ja→en', stage: 'asr' }} label="ASR" resolved={resolvedAuto}
        displayName={() => 'SenseVoice'} expanded={false} onToggle={onToggle}>
        <div data-testid="picker" />
      </SlotRow>);
    expect(screen.queryByTestId('picker')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /ASR/ }));
    expect(onToggle).toHaveBeenCalledOnce();
    rerender(
      <SlotRow slot={{ dir: 'ja→en', stage: 'asr' }} label="ASR" resolved={resolvedAuto}
        displayName={() => 'SenseVoice'} expanded={true} onToggle={onToggle}>
        <div data-testid="picker" />
      </SlotRow>);
    expect(screen.getByTestId('picker')).toBeInTheDocument();
  });

  // Finding 4: a chip click deep-links into the engine surface and should
  // flash THIS row, not the whole ProviderSection (the old, wrong target —
  // see Settings.highlight.test.tsx for the other half of the fix).
  describe('flashSlot (Finding 4)', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    const slot = { dir: 'ja→en', stage: 'asr' as const };

    it('renders the .highlight class when flashSlot matches this row, then drops it after the timeout', () => {
      const { container } = render(
        <SlotRow slot={slot} label="ASR" resolved={resolvedAuto} displayName={() => 'SenseVoice'}
          expanded={false} onToggle={() => {}} flashSlot={{ ...slot }} />);

      expect(container.querySelector('.engine-slot')).toHaveClass('highlight');

      act(() => { vi.advanceTimersByTime(3000); });
      expect(container.querySelector('.engine-slot')).not.toHaveClass('highlight');
    });

    it('does not flash a row flashSlot does not match (different stage)', () => {
      const { container } = render(
        <SlotRow slot={slot} label="ASR" resolved={resolvedAuto} displayName={() => 'SenseVoice'}
          expanded={false} onToggle={() => {}} flashSlot={{ dir: 'ja→en', stage: 'translation' }} />);

      expect(container.querySelector('.engine-slot')).not.toHaveClass('highlight');
    });

    it('re-flashes on a FRESH object with the identical dir/stage — the same chip fired twice', () => {
      const { container, rerender } = render(
        <SlotRow slot={slot} label="ASR" resolved={resolvedAuto} displayName={() => 'SenseVoice'}
          expanded={false} onToggle={() => {}} flashSlot={{ ...slot }} />);

      act(() => { vi.advanceTimersByTime(3000); });
      expect(container.querySelector('.engine-slot')).not.toHaveClass('highlight');

      // A NEW object, same dir/stage — mirrors EngineSurface always handing
      // down a freshly-allocated initialSlot on every deep-link.
      rerender(
        <SlotRow slot={slot} label="ASR" resolved={resolvedAuto} displayName={() => 'SenseVoice'}
          expanded={false} onToggle={() => {}} flashSlot={{ ...slot }} />);
      expect(container.querySelector('.engine-slot')).toHaveClass('highlight');
    });

    it('never flashes a slot the user expanded by hand (no flashSlot at all)', () => {
      const { container } = render(
        <SlotRow slot={slot} label="ASR" resolved={resolvedAuto} displayName={() => 'SenseVoice'}
          expanded={true} onToggle={() => {}} />);

      expect(container.querySelector('.engine-slot')).not.toHaveClass('highlight');
    });
  });
});
