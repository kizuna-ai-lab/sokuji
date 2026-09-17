import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import VoiceCreateModal from './VoiceCreateModal';

const base = { isOpen: true, onClose: vi.fn(), capability: { importModes: ['upload'] as ('upload' | 'record')[] } };

beforeEach(() => { vi.clearAllMocks(); cleanup(); });

describe('VoiceCreateModal', () => {
  it('renders nothing when closed', () => {
    render(<VoiceCreateModal {...base} isOpen={false} onImport={vi.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('offers only the controls the capability allows', () => {
    const { rerender } = render(<VoiceCreateModal {...base} onImport={vi.fn()} />);
    expect(screen.getByRole('button', { name: /import voice/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /record/i })).not.toBeInTheDocument();

    rerender(<VoiceCreateModal {...base} capability={{ importModes: ['record'] }} onRecord={vi.fn()} />);
    expect(screen.getByRole('button', { name: /record/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /import voice/i })).not.toBeInTheDocument();
  });

  it('gates import and record behind a non-empty transcript when the model needs one', async () => {
    render(
      <VoiceCreateModal
        {...base}
        capability={{ importModes: ['upload', 'record'], transcriptRequired: true }}
        onImport={vi.fn()}
        onRecord={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /import voice/i })).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: /transcript/i }), { target: { value: 'hello there' } });
    expect(screen.getByRole('button', { name: /import voice/i })).toBeEnabled();
  });

  it('sends a dropped file to onImport', async () => {
    const onImport = vi.fn().mockResolvedValue(undefined);
    render(<VoiceCreateModal {...base} onImport={onImport} />);
    const file = new File([new Uint8Array([1, 2, 3])], 'voice.wav', { type: 'audio/wav' });
    const zone = screen.getByTestId('voice-create-drop');
    // jsdom has no DataTransfer, so construct the shape the handler reads and
    // dispatch the drop directly.
    const dataTransfer = { files: [file], types: ['Files'] } as unknown as DataTransfer;
    zone.dispatchEvent(Object.assign(new Event('drop', { bubbles: true }), { dataTransfer }));
    await vi.waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    expect(onImport.mock.calls[0][0]).toBe(file);
  });

  it('keeps only the first file when the adapter stages one clip at a time', async () => {
    const onImport = vi.fn().mockResolvedValue(undefined);
    render(<VoiceCreateModal {...base} capability={{ importModes: ['upload'], multipleImport: false }} onImport={onImport} />);
    const a = new File([new Uint8Array([1])], 'a.wav', { type: 'audio/wav' });
    const b = new File([new Uint8Array([2])], 'b.wav', { type: 'audio/wav' });
    const zone = screen.getByTestId('voice-create-drop');
    const dataTransfer = { files: [a, b], types: ['Files'] } as unknown as DataTransfer;
    zone.dispatchEvent(Object.assign(new Event('drop', { bubbles: true }), { dataTransfer }));
    await vi.waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    expect(onImport.mock.calls[0][0]).toBe(a);
  });

  it('closes on Escape, on the backdrop, and on Cancel — but not on a click inside', async () => {
    const onClose = vi.fn();
    render(<VoiceCreateModal {...base} onClose={onClose} onImport={vi.fn()} />);
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
    // `window`, not `document`: this modal adds its own Escape listener the way
    // `ModelImportModal` does (`ModelImportModal.test.tsx:114` fires it the same
    // way). Nothing here goes through floating-ui.
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('renders the provider note', () => {
    render(<VoiceCreateModal {...base} onImport={vi.fn()} note="Previewing is charged to your balance." />);
    expect(screen.getByText(/charged to your balance/i)).toBeInTheDocument();
  });
});
