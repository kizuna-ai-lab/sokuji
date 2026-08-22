import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

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
});
