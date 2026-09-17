import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import VoiceCreateModal, { type VoiceCreateModalProps } from './VoiceCreateModal';

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
    expect(screen.getByRole('button', { name: /record voice/i })).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: /transcript/i }), { target: { value: 'hello there' } });
    expect(screen.getByRole('button', { name: /import voice/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /record voice/i })).toBeEnabled();
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

  it('does not close on a click inside the dialog', () => {
    const onClose = vi.fn();
    render(<VoiceCreateModal {...base} onClose={onClose} onImport={vi.fn()} />);
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on a click on the backdrop', () => {
    const onClose = vi.fn();
    render(<VoiceCreateModal {...base} onClose={onClose} onImport={vi.fn()} />);
    // The overlay is the dialog's parent (`.voice-modal-overlay` wraps
    // `.voice-modal` — a frame shared with VoiceDeleteModal since Task 6)
    // — reached structurally through the accessibility
    // tree rather than a test-only attribute on production markup. A test
    // that clicked the dialog itself here would pass even with the overlay's
    // onClick deleted, which is exactly the bug this replaces.
    fireEvent.click(screen.getByRole('dialog').parentElement!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<VoiceCreateModal {...base} onClose={onClose} onImport={vi.fn()} />);
    // `window`, not `document`: this modal adds its own Escape listener the way
    // `ModelImportModal` does (`ModelImportModal.test.tsx:114` fires it the same
    // way). Nothing here goes through floating-ui.
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Cancel', () => {
    const onClose = vi.fn();
    render(<VoiceCreateModal {...base} onClose={onClose} onImport={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders the provider note', () => {
    render(<VoiceCreateModal {...base} onImport={vi.fn()} note="Previewing is charged to your balance." />);
    expect(screen.getByText(/charged to your balance/i)).toBeInTheDocument();
  });

  it('resets a typed transcript when reopened, rather than leaking it into the next attempt', () => {
    const capability = { importModes: ['upload'] as ('upload' | 'record')[], transcriptRequired: true };
    const { rerender } = render(<VoiceCreateModal {...base} capability={capability} onImport={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: /transcript/i }), { target: { value: 'stale text' } });
    expect(screen.getByRole('button', { name: /import voice/i })).toBeEnabled();

    // Cancel the attempt, then reopen — as Task 6's permanently-mounted usage
    // would (isOpen toggles, the component never unmounts in between).
    rerender(<VoiceCreateModal {...base} isOpen={false} capability={capability} onImport={vi.fn()} />);
    rerender(<VoiceCreateModal {...base} isOpen capability={capability} onImport={vi.fn()} />);

    expect(screen.getByRole('textbox', { name: /transcript/i })).toHaveValue('');
    expect(screen.getByRole('button', { name: /import voice/i })).toBeDisabled();
  });
});

/**
 * Stubs getUserMedia + AudioContext so a recording can actually start,
 * without pulling in real Web Audio (jsdom has none). Mirrors the shape
 * VoiceLibrarySection.test.tsx's installCaptureStubs uses for the same
 * capture graph, trimmed to what these tests need to observe: that
 * onRecord is never reached.
 */
function installCaptureStubs() {
  const stopTrack = vi.fn();
  const gum = vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] }));
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: gum },
  });
  // A stable processor object the test can drive `onaudioprocess` on
  // directly, so a case can prove a chunk was actually captured — and would
  // have been uploaded by the old, buggy close() — rather than only proving
  // the trivial "no audio, nothing to upload" path (stopRecording no-ops
  // when `chunks` is empty regardless of which code path reaches it).
  const processor = {
    onaudioprocess: null as null | ((e: { inputBuffer: { getChannelData: (ch: number) => Float32Array } }) => void),
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  class FakeAudioContext {
    sampleRate = 48000;
    destination = {};
    createMediaStreamSource() { return { connect: vi.fn(), disconnect: vi.fn() }; }
    createScriptProcessor() { return processor; }
    close = vi.fn(async () => {});
  }
  vi.stubGlobal('AudioContext', FakeAudioContext);
  return { stopTrack, processor };
}

/**
 * Review finding 1 (Task 5): close() used to route through stopRecording —
 * the SUBMITTING path — so cancelling mid-recording uploaded a half-finished
 * clip instead of discarding it. Each close path gets its own case so a
 * regression in any one of them is caught by name, not just by the group.
 */
describe('VoiceCreateModal — discards, rather than submits, a recording in progress', () => {
  const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
  const restoreMediaDevices = () => {
    if (originalMediaDevices) Object.defineProperty(navigator, 'mediaDevices', originalMediaDevices);
    else delete (navigator as { mediaDevices?: unknown }).mediaDevices;
    vi.unstubAllGlobals();
  };

  const startRecording = async (
    onRecord: NonNullable<VoiceCreateModalProps['onRecord']>,
    onClose: VoiceCreateModalProps['onClose'],
  ) => {
    const { processor } = installCaptureStubs();
    const utils = render(
      <VoiceCreateModal {...base} capability={{ importModes: ['record'] }} onRecord={onRecord} onClose={onClose} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /record voice/i }));
    await vi.waitFor(() => expect(screen.getByRole('button', { name: /stop recording/i })).toBeInTheDocument());
    // Feed one buffer of "captured" audio so `chunks` is non-empty — see the
    // comment on installCaptureStubs for why this matters.
    processor.onaudioprocess?.({ inputBuffer: { getChannelData: () => new Float32Array(10).fill(0.1) } });
    return utils;
  };

  // A parent that respects onClose would stop rendering the modal; simulated
  // here via rerender with isOpen={false} so "the modal is gone" is an
  // assertion, not an assumption about a caller this test doesn't have.
  const assertGone = (
    rerender: ReturnType<typeof render>['rerender'],
    onRecord: NonNullable<VoiceCreateModalProps['onRecord']>,
    onClose: VoiceCreateModalProps['onClose'],
  ) => {
    rerender(
      <VoiceCreateModal {...base} isOpen={false} capability={{ importModes: ['record'] }} onRecord={onRecord} onClose={onClose} />,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  };

  afterEach(restoreMediaDevices);

  // `close()`'s discard (releaseCapture) is synchronous, but the SUBMITTING
  // path it must not take (stopRecording) awaits `ctx.close()` before it
  // would reach `onRecord` — so asserting `onRecord` was not called right
  // after firing the close event proves nothing on its own (see the Task 5
  // review, finding 1: `onClose()` fires while `stopRecording` is still
  // suspended). A macrotask tick flushes every pending microtask first,
  // giving a still-buggy `close()` a real chance to reach `onRecord` before
  // the assertion below runs.
  const flushMicrotasks = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

  it('via Escape', async () => {
    const onRecord = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    const { rerender } = await startRecording(onRecord, onClose);

    fireEvent.keyDown(window, { key: 'Escape' });
    await flushMicrotasks();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onRecord).not.toHaveBeenCalled();
    assertGone(rerender, onRecord, onClose);
  });

  it('via Cancel', async () => {
    const onRecord = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    const { rerender } = await startRecording(onRecord, onClose);

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    await flushMicrotasks();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onRecord).not.toHaveBeenCalled();
    assertGone(rerender, onRecord, onClose);
  });

  it('via a backdrop click', async () => {
    const onRecord = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    const { rerender } = await startRecording(onRecord, onClose);

    fireEvent.click(screen.getByRole('dialog').parentElement!);
    await flushMicrotasks();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onRecord).not.toHaveBeenCalled();
    assertGone(rerender, onRecord, onClose);
  });
});
