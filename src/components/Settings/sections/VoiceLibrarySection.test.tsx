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
    // The picker's own row also has a "Delete" button, still on screen once
    // the confirmation dialog opens over it — scope to the dialog so the
    // second click cannot land back on the row.
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));

    // Named, not bare `getByRole('dialog')`: the picker's own floating
    // wrapper carries `role="dialog"` too (see VoicePicker's doc comment) and
    // stays open behind this one, so an unnamed query would match both.
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
  });
});
