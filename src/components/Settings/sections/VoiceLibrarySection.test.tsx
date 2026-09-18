/**
 * Tests for VoiceLibrarySection as a composition root (Task 6).
 *
 * VoicePicker (Tasks 3–4) and the two modals (VoiceCreateModal — Task 5,
 * VoiceDeleteModal — Task 6) each carry their own suite. This file covers
 * only what the composition root itself owns: the AudioContext-backed
 * preview plumbing (`togglePreview`/`stopPreview`, still local to this
 * component), wiring `onAskDelete` to the delete modal and `onConfirm` back
 * to `onDelete`, gating the picker's add-voice affordance on
 * `capability.importModes`, and opening the create modal.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import VoiceLibrarySection from './VoiceLibrarySection';

const base = {
  selectedId: 'builtin:Ava',
  onSelect: () => {},
  onRename: async () => {},
  onDelete: async () => {},
  onImport: async () => {},
};

/** Shared Web Audio stub — jsdom has no Web Audio API. */
function stubWebAudio() {
  const mockSource: any = { connect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null, buffer: null };
  const mockCtx: any = {
    state: 'running',
    resume: vi.fn().mockResolvedValue(undefined),
    destination: {},
    createBuffer: vi.fn(() => ({ copyToChannel: vi.fn() })),
    createBufferSource: vi.fn(() => mockSource),
    close: vi.fn().mockResolvedValue(undefined),
  };
  // regular function (not an arrow) so `new AudioContext()` is constructable
  (window as any).AudioContext = function AudioContext() { return mockCtx; };
  return { mockCtx, mockSource };
}

const openPicker = () => fireEvent.click(screen.getByRole('button', { expanded: false }));

describe('VoiceLibrarySection', () => {
  it('plays back a voice via onPreview and toggles play/stop on a second click', async () => {
    const { mockSource, mockCtx } = stubWebAudio();
    const onPreview = vi.fn().mockResolvedValue({ audio: new Float32Array(2048), sampleRate: 24000 });

    render(
      <VoiceLibrarySection
        {...base}
        selectedId=""
        voices={[{ id: 'custom:1', label: 'Mine', group: 'custom', removable: true }]}
        capability={{ importModes: ['record', 'upload'] }}
        onPreview={onPreview}
      />,
    );
    openPicker();

    fireEvent.click(screen.getByRole('button', { name: /^play$/i }));
    await waitFor(() =>
      expect(onPreview).toHaveBeenCalledWith('custom:1', expect.any(AbortSignal)));
    await waitFor(() => expect(mockSource.start).toHaveBeenCalled());
    expect(mockSource.connect).toHaveBeenCalledWith(mockCtx.destination);

    // now shows a Stop control; clicking it stops playback
    const stopBtn = await screen.findByRole('button', { name: /^stop$/i });
    fireEvent.click(stopBtn);
    expect(mockSource.stop).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /^play$/i })).toBeInTheDocument();
  });

  it('plays nothing when onPreview resolves null', async () => {
    stubWebAudio();
    const onPreview = vi.fn().mockResolvedValue(null);

    render(
      <VoiceLibrarySection
        {...base}
        selectedId=""
        voices={[{ id: 'custom:1', label: 'Mine', group: 'custom', removable: true }]}
        capability={{ importModes: ['upload'] }}
        onPreview={onPreview}
      />,
    );
    openPicker();

    fireEvent.click(screen.getByRole('button', { name: /^play$/i }));
    await waitFor(() => expect(onPreview).toHaveBeenCalled());
    // Never transitions to a Stop control — there was nothing to play.
    expect(screen.queryByRole('button', { name: /^stop$/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^play$/i })).toBeInTheDocument();
  });

  it('aborts an in-flight preview when the user starts another one', async () => {
    stubWebAudio();
    const signals: AbortSignal[] = [];
    const onPreview = vi.fn((_id: string, signal?: AbortSignal) => {
      if (signal) signals.push(signal);
      return new Promise<any>(() => {}); // never settles
    });

    render(
      <VoiceLibrarySection
        {...base}
        selectedId=""
        voices={[
          { id: 'custom:1', label: 'First', group: 'custom', removable: true },
          { id: 'custom:2', label: 'Second', group: 'custom', removable: true },
        ]}
        capability={{ importModes: ['record'] }}
        onPreview={onPreview}
      />,
    );
    openPicker();

    const [firstBtn, secondBtn] = screen.getAllByRole('button', { name: /^play$/i });
    fireEvent.click(firstBtn);
    await waitFor(() => expect(signals).toHaveLength(1));
    expect(signals[0].aborted).toBe(false);

    fireEvent.click(secondBtn);
    await waitFor(() => expect(signals[0].aborted).toBe(true));
  });

  it('aborts an in-flight preview on unmount', async () => {
    stubWebAudio();
    const signals: AbortSignal[] = [];
    const onPreview = vi.fn((_id: string, signal?: AbortSignal) => {
      if (signal) signals.push(signal);
      return new Promise<any>(() => {});
    });

    const { unmount } = render(
      <VoiceLibrarySection
        {...base}
        selectedId=""
        voices={[{ id: 'custom:1', label: 'Mine', group: 'custom', removable: true }]}
        capability={{ importModes: ['record'] }}
        onPreview={onPreview}
      />,
    );
    openPicker();

    fireEvent.click(screen.getByRole('button', { name: /^play$/i }));
    await waitFor(() => expect(signals).toHaveLength(1));
    unmount();
    expect(signals[0].aborted).toBe(true);
  });

  it('aborts an in-flight preview when the popover closes, and starts no playback once it resolves', async () => {
    // Fix round 3: the case the other two never covered. `VoicePicker`'s own
    // abort-on-unmount effect (`VoicePicker.tsx:92-94`) is scoped to
    // VoicePicker's OWN unmount, which does not happen when only its popover
    // content goes away — that needed a separate `open`-keyed effect there
    // (`VoicePicker.tsx`, right after `previewAbortRef`'s declaration),
    // wired to the `signal` this file's own `togglePreview` now listens for.
    const { mockSource } = stubWebAudio();
    const signals: AbortSignal[] = [];
    let resolvePreview: (v: { audio: Float32Array; sampleRate: number }) => void = () => {};
    const onPreview = vi.fn((_id: string, signal?: AbortSignal) => {
      if (signal) signals.push(signal);
      return new Promise<{ audio: Float32Array; sampleRate: number }>((resolve) => { resolvePreview = resolve; });
    });

    render(
      <VoiceLibrarySection
        {...base}
        selectedId=""
        voices={[{ id: 'custom:1', label: 'Mine', group: 'custom', removable: true }]}
        capability={{ importModes: ['upload'] }}
        onPreview={onPreview}
      />,
    );
    openPicker();
    fireEvent.click(screen.getByRole('button', { name: /^play$/i }));
    await waitFor(() => expect(signals).toHaveLength(1));
    expect(signals[0].aborted).toBe(false);

    // `document`, not the grid: this Escape is handled by floating-ui's
    // `useDismiss`, which binds its listener to the document (matches
    // VoicePicker.test.tsx's own "closes on Escape" case).
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    expect(signals[0].aborted).toBe(true);

    // The request was abandoned, not merely marked as such: resolving it
    // late must not start playback into a popover the user has already
    // dismissed, with no reachable Stop control.
    resolvePreview({ audio: new Float32Array(2048), sampleRate: 24000 });
    await Promise.resolve();
    await Promise.resolve();
    expect(mockSource.start).not.toHaveBeenCalled();
  });

  it('gates the play control on previewable, reaching the picker unchanged', () => {
    render(
      <VoiceLibrarySection
        {...base}
        selectedId=""
        voices={[
          // A builtin gets no play control by default...
          { id: 'builtin:Grace', label: 'Grace', group: 'builtin', removable: false },
          // ...unless the provider opts it in.
          { id: 'builtin:Opted', label: 'Opted', group: 'builtin', removable: false, previewable: true },
        ]}
        capability={{ importModes: [] }}
        onPreview={vi.fn()}
      />,
    );
    openPicker();
    expect(screen.getAllByRole('button', { name: /^play$/i })).toHaveLength(1);
  });

  it('offers the add-voice row iff importModes is non-empty', () => {
    const { rerender } = render(
      <VoiceLibrarySection
        {...base}
        voices={[{ id: 'builtin:Ava', label: 'Ava', group: 'builtin', removable: false }]}
        capability={{ importModes: [] }}
      />,
    );
    openPicker();
    expect(screen.queryByRole('button', { name: /add a voice/i })).not.toBeInTheDocument();

    rerender(
      <VoiceLibrarySection
        {...base}
        voices={[{ id: 'builtin:Ava', label: 'Ava', group: 'builtin', removable: false }]}
        capability={{ importModes: ['upload'] }}
      />,
    );
    expect(screen.getByRole('button', { name: /add a voice/i })).toBeInTheDocument();
  });

  it('shows manageNote inline when creation is withdrawn (importModes empty), instead of leaving it unreachable', () => {
    // Cross-task fix: managed Soniox mode with a healthy cloned voice sets
    // importModes to [], so the picker offers no add row and
    // VoiceCreateModal — where manageNote used to render exclusively — can
    // never open. The note explaining WHY creation is withdrawn must not
    // become unreachable along with the controls it would otherwise sit
    // beside.
    render(
      <VoiceLibrarySection
        {...base}
        voices={[{ id: 'custom:1', label: 'Mine', group: 'custom', removable: true }]}
        capability={{ importModes: [] }}
        manageNote="Delete your existing voice before recording a new one."
      />,
    );
    expect(screen.getByText('Delete your existing voice before recording a new one.')).toBeInTheDocument();
    openPicker();
    expect(screen.queryByRole('button', { name: /add a voice/i })).not.toBeInTheDocument();
  });

  it('renders manageNote only inside the create modal when creation IS reachable, never inline too', () => {
    render(
      <VoiceLibrarySection
        {...base}
        voices={[]}
        capability={{ importModes: ['upload'] }}
        manageNote="Costs quota."
      />,
    );
    // Not rendered inline while the modal is closed...
    expect(screen.queryByText('Costs quota.')).not.toBeInTheDocument();
    openPicker();
    fireEvent.click(screen.getByRole('button', { name: /add a voice/i }));
    // ...only inside the now-open create modal, and only once.
    expect(screen.getAllByText('Costs quota.')).toHaveLength(1);
  });

  it('onAskDelete opens the delete modal, and confirming calls onDelete exactly once', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(
      <VoiceLibrarySection
        {...base}
        onDelete={onDelete}
        voices={[{ id: 'custom:1', label: 'Mine', group: 'custom', removable: true }]}
        capability={{ importModes: ['upload'] }}
      />,
    );
    openPicker();
    // The row's own "Delete" is what opens the confirmation.
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));

    // An assertion, not an aside (final-review finding 2): the popover used
    // to stay open behind the modal's opaque overlay, so Tab kept walking its
    // voice rows while `aria-modal="true"` claimed the modal owned the view,
    // and a single Escape closed both.
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();

    // Still named rather than a bare `getByRole('dialog')`: the picker's
    // floating wrapper carries `role="dialog"` too (see VoicePicker's doc
    // comment), so this stays unambiguous even if it is ever left open again.
    const dialog = screen.getByRole('dialog', { name: /delete voice/i });
    expect(dialog).toHaveTextContent('Mine');
    fireEvent.click(within(dialog).getByRole('button', { name: /^delete$/i }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1));
    expect(onDelete).toHaveBeenCalledWith('custom:1');
  });

  it('opening the create modal renders its dialog', () => {
    render(
      <VoiceLibrarySection
        {...base}
        voices={[]}
        capability={{ importModes: ['upload'] }}
      />,
    );
    openPicker();
    fireEvent.click(screen.getByRole('button', { name: /add a voice/i }));
    expect(screen.getByRole('dialog', { name: /add a voice/i })).toBeInTheDocument();
    // And the popover closes as the modal opens — the add row's other half of
    // final-review finding 2, pinned the same way the delete flow above is.
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
  });
});
