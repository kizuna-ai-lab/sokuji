import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SubtitleSessionEnded from './SubtitleSessionEnded';

describe('SubtitleSessionEnded', () => {
  it('renders the ended message and a return button', () => {
    render(<SubtitleSessionEnded onReturn={() => {}} />);
    expect(screen.getByText(/session ended|会话已结束/i)).toBeTruthy();
    expect(screen.getByRole('button')).toBeTruthy();
  });

  it('calls onReturn when the button is clicked', () => {
    const onReturn = vi.fn();
    render(<SubtitleSessionEnded onReturn={onReturn} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onReturn).toHaveBeenCalledOnce();
  });
});
