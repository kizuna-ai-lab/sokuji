import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import VoiceDeleteModal from './VoiceDeleteModal';

beforeEach(() => { vi.clearAllMocks(); cleanup(); });

describe('VoiceDeleteModal', () => {
  it('renders nothing without a target', () => {
    render(<VoiceDeleteModal target={null} onClose={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('names the voice and warns that the local recording goes too', () => {
    render(<VoiceDeleteModal target={{ id: 'custom:1', label: 'Mine' }} onClose={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByRole('dialog')).toHaveTextContent('Mine');
    expect(screen.getByRole('dialog')).toHaveTextContent(/reference recording stored on this device/i);
  });

  it('deletes once on confirm and not at all on cancel', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    const { rerender } = render(
      <VoiceDeleteModal target={{ id: 'custom:1', label: 'Mine' }} onClose={onClose} onConfirm={onConfirm} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(<VoiceDeleteModal target={{ id: 'custom:1', label: 'Mine' }} onClose={onClose} onConfirm={onConfirm} />);
    // `/^delete$/i` and not `/delete/i`: the dialog's own accessible name is
    // "Delete voice", so a loose matcher hits two elements and throws.
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    expect(onConfirm).toHaveBeenCalledWith('custom:1');
  });
});
