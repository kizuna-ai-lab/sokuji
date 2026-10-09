import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { EndOfTurnControl } from './LocalSettingsControls';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fb?: string, opts?: Record<string, unknown>) =>
      (fb ?? _k).replace(/\{\{(\w+)\}\}/g, (_m, n: string) => String(opts?.[n] ?? '')),
  }),
}));

const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;

describe('EndOfTurnControl', () => {
  it('shows Normal and Smart, the value active', () => {
    render(<EndOfTurnControl value="smart" onChange={() => {}} disabled={false} />);
    expect(button('Smart').className).toContain('active');
    expect(button('Normal').className).not.toContain('active');
  });

  it('reports a choice', () => {
    const onChange = vi.fn();
    render(<EndOfTurnControl value="normal" onChange={onChange} disabled={false} />);
    fireEvent.click(button('Smart'));
    expect(onChange).toHaveBeenCalledWith('smart');
  });

  it("shows the download's progress and holds both buttons meanwhile", () => {
    const { container } = render(
      <EndOfTurnControl value="normal" onChange={() => {}} disabled={false} download={{ done: 16_205_599, total: 32_411_198 }} />,
    );
    expect(screen.getByText('Downloading the Smart Turn model: 15.5 MB of 30.9 MB')).toBeTruthy();
    expect((container.querySelector('.end-of-turn__progress-fill') as HTMLElement).style.width).toBe('50%');
    expect(button('Normal')).toBeDisabled();
    expect(button('Smart')).toBeDisabled();
  });

  it('shows a failed download with a retry', () => {
    const onRetry = vi.fn();
    render(<EndOfTurnControl value="normal" onChange={() => {}} disabled={false} error="offline" onRetry={onRetry} />);
    expect(screen.getByText('Smart Turn model download failed: offline')).toBeTruthy();
    fireEvent.click(button('Retry'));
    expect(onRetry).toHaveBeenCalled();
  });

  it('disables everything while a session runs', () => {
    render(<EndOfTurnControl value="normal" onChange={() => {}} disabled error="offline" onRetry={() => {}} />);
    expect(button('Normal')).toBeDisabled();
    expect(button('Smart')).toBeDisabled();
    expect(button('Retry')).toBeDisabled();
  });

  it('shows the model on disk with its size and a Delete, disabled while a session runs', () => {
    const onDelete = vi.fn();
    const { rerender } = render(
      <EndOfTurnControl value="smart" onChange={() => {}} disabled={false} deletable={{ bytes: 32_411_198, onDelete }} />,
    );
    const line = screen.getByText('Smart Turn model: 30.9 MB').closest('.setting-item')!;
    fireEvent.click(within(line as HTMLElement).getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    rerender(<EndOfTurnControl value="smart" onChange={() => {}} disabled deletable={{ bytes: 32_411_198, onDelete }} />);
    expect(button('Delete')).toBeDisabled();
  });

  it('shows no model line unless told the model can go', () => {
    render(<EndOfTurnControl value="smart" onChange={() => {}} disabled={false} />);
    expect(screen.queryByText(/Smart Turn model:/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });
});
