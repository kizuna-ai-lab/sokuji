import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
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
    // The count, not just the argument: spec §9 asks for "Delete calls
    // onDelete once", and `toHaveBeenCalledWith` alone passes a double-fire.
    // (The section-level equivalent is pinned at
    // VoiceLibrarySection.test.tsx's "confirming calls onDelete exactly
    // once"; this is the same guarantee at this modal's own seam.)
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

/**
 * Spec §7: "focus moves in on open and returns to the invoking control on
 * close". Final review, finding 2 — neither was implemented. Driven through a
 * harness with a real control outside the dialog, for the reason spelled out
 * in VoiceCreateModal.test.tsx's matching describe.
 */
describe('VoiceDeleteModal — focus', () => {
  const Harness = () => {
    const [target, setTarget] = useState<{ id: string; label: string } | null>(null);
    return (
      <>
        <button type="button" onClick={() => setTarget({ id: 'custom:1', label: 'Mine' })}>Open</button>
        <VoiceDeleteModal target={target} onClose={() => setTarget(null)} onConfirm={vi.fn()} />
      </>
    );
  };

  const dialog = () => screen.getByRole('dialog', { name: /delete voice/i });

  it('moves focus into the dialog when it opens, and not onto Delete', async () => {
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open' });
    opener.focus();
    expect(opener).toHaveFocus();

    fireEvent.click(opener);
    // Awaited because FloatingFocusManager defers its initial focus by a
    // frame — see the sibling suite's comment.
    await vi.waitFor(() => expect(dialog().contains(document.activeElement)).toBe(true));
    expect(opener).not.toHaveFocus();
    // Initial focus is the first tabbable control, the header's Close button.
    // That the DESTRUCTIVE control is not focused is the part worth pinning:
    // a stray Enter on open must not delete the voice.
    expect(screen.getByRole('button', { name: /^delete$/i })).not.toHaveFocus();
  });

  it('returns focus to the invoking control when it closes', async () => {
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open' });
    opener.focus();
    fireEvent.click(opener);
    await vi.waitFor(() => expect(dialog().contains(document.activeElement)).toBe(true));

    // `window`, not `document`: this modal adds its own Escape listener.
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: /delete voice/i })).not.toBeInTheDocument();
    await vi.waitFor(() => expect(opener).toHaveFocus());
  });
});
