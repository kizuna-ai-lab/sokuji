/**
 * Tests for VoiceLibrarySection as a composition root (Task 6).
 *
 * VoicePicker (Tasks 3–4) and the two modals (VoiceCreateModal — Task 5,
 * VoiceDeleteModal — Task 6) each carry their own suite. This file covers
 * only what the composition root itself owns: the preview plumbing
 * (`togglePreview`/`stopPreview`, still local to this component) on both of
 * its paths — its own AudioContext, and the host's preview route when a
 * `VoicePreviewContext` provides one (the second `describe`) — wiring
 * `onAskDelete` to the delete modal and `onConfirm` back to `onDelete`,
 * gating the picker's add-voice affordance on `capability.importModes`, and
 * opening the create modal.
 */
import { describe, it, expect, vi } from 'vitest';
import { act, render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import VoiceLibrarySection from './VoiceLibrarySection';
import { VoicePreviewContext } from '../../providers/VoicePreviewContext';

const { reportErrorSpy, reportWarningSpy } = vi.hoisted(() => ({ reportErrorSpy: vi.fn(), reportWarningSpy: vi.fn() }));
vi.mock('../../../lib/diagnostics/report', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/diagnostics/report')>()),
  reportError: reportErrorSpy,
  reportWarning: reportWarningSpy,
}));

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

// Task 10a (choice 13): under a provider of VoicePreviewContext, the section
// plays through that route instead of its own AudioContext — no Web Audio
// stub needed here, since that path is never reached while a port is
// provided.
describe('through the preview route', () => {
  it("plays a voice's sample through the route, shows Stop while it plays, and Play once it ends", async () => {
    let finish: () => void = () => {};
    const port = { play: vi.fn(() => new Promise<void>((r) => { finish = r; })), stop: vi.fn() };
    const onPreview = vi.fn().mockResolvedValue({ audio: new Float32Array(2048), sampleRate: 24000 });

    render(
      <VoicePreviewContext.Provider value={port}>
        <VoiceLibrarySection
          {...base}
          selectedId=""
          voices={[{ id: 'custom:1', label: 'Mine', group: 'custom', removable: true }]}
          capability={{ importModes: ['upload'] }}
          onPreview={onPreview}
        />
      </VoicePreviewContext.Provider>,
    );
    openPicker();

    fireEvent.click(screen.getByRole('button', { name: /^play$/i }));
    await waitFor(() => expect(onPreview).toHaveBeenCalledWith('custom:1', expect.any(AbortSignal)));
    await waitFor(() => expect(port.play).toHaveBeenCalledWith({ audio: expect.any(Float32Array), sampleRate: 24000 }));
    expect(await screen.findByRole('button', { name: /^stop$/i })).toBeInTheDocument();

    act(() => finish());
    await waitFor(() => expect(screen.getByRole('button', { name: /^play$/i })).toBeInTheDocument());
  });

  it('a second click stops the route', async () => {
    const port = { play: vi.fn(() => new Promise<void>(() => {})), stop: vi.fn() };
    const onPreview = vi.fn().mockResolvedValue({ audio: new Float32Array(2048), sampleRate: 24000 });

    render(
      <VoicePreviewContext.Provider value={port}>
        <VoiceLibrarySection
          {...base}
          selectedId=""
          voices={[{ id: 'custom:1', label: 'Mine', group: 'custom', removable: true }]}
          capability={{ importModes: ['upload'] }}
          onPreview={onPreview}
        />
      </VoicePreviewContext.Provider>,
    );
    openPicker();

    fireEvent.click(screen.getByRole('button', { name: /^play$/i }));
    const stopBtn = await screen.findByRole('button', { name: /^stop$/i });
    fireEvent.click(stopBtn);
    expect(port.stop).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /^play$/i })).toBeInTheDocument();
  });

  it('unmounting while a sample plays stops the route', async () => {
    const port = { play: vi.fn(() => new Promise<void>(() => {})), stop: vi.fn() };
    const onPreview = vi.fn().mockResolvedValue({ audio: new Float32Array(2048), sampleRate: 24000 });

    const { unmount } = render(
      <VoicePreviewContext.Provider value={port}>
        <VoiceLibrarySection
          {...base}
          selectedId=""
          voices={[{ id: 'custom:1', label: 'Mine', group: 'custom', removable: true }]}
          capability={{ importModes: ['upload'] }}
          onPreview={onPreview}
        />
      </VoicePreviewContext.Provider>,
    );
    openPicker();

    fireEvent.click(screen.getByRole('button', { name: /^play$/i }));
    await screen.findByRole('button', { name: /^stop$/i });
    unmount();
    expect(port.stop).toHaveBeenCalledTimes(1);
  });

  it('a toggle or an unmount with nothing of its own playing leaves the route alone', async () => {
    // The route is shared: the test tone and other sections' previews play
    // through it too. A stopPreview that called port.stop() unconditionally
    // would cut them on a toggle or an unmount with nothing of this
    // section's own playing.
    const port = { play: vi.fn(), stop: vi.fn() };
    const onPreview = vi.fn().mockResolvedValue({ audio: new Float32Array(2048), sampleRate: 24000 });
    const voices = [
      { id: 'custom:1', label: 'First', group: 'custom' as const, removable: true },
      { id: 'custom:2', label: 'Second', group: 'custom' as const, removable: true },
    ];

    const { unmount } = render(
      <VoicePreviewContext.Provider value={port}>
        <VoiceLibrarySection
          {...base}
          selectedId=""
          voices={voices}
          capability={{ importModes: ['upload'] }}
          onPreview={onPreview}
        />
      </VoicePreviewContext.Provider>,
    );
    unmount();
    expect(port.stop).not.toHaveBeenCalled();

    let finish: () => void = () => {};
    port.play.mockImplementation(() => new Promise<void>((r) => { finish = r; }));

    render(
      <VoicePreviewContext.Provider value={port}>
        <VoiceLibrarySection
          {...base}
          selectedId=""
          voices={voices}
          capability={{ importModes: ['upload'] }}
          onPreview={onPreview}
        />
      </VoicePreviewContext.Provider>,
    );
    openPicker();
    const [firstBtn] = screen.getAllByRole('button', { name: /^play$/i });
    fireEvent.click(firstBtn);
    await waitFor(() => expect(port.play).toHaveBeenCalledTimes(1));

    // The sample ended on its own — nothing of this section's own is
    // playing any more.
    act(() => finish());
    await waitFor(() => expect(screen.getAllByRole('button', { name: /^play$/i })).toHaveLength(2));

    port.play.mockImplementation(() => new Promise<void>(() => {}));
    const [, secondBtn] = screen.getAllByRole('button', { name: /^play$/i });
    fireEvent.click(secondBtn);
    await waitFor(() => expect(port.play).toHaveBeenCalledTimes(2));
    expect(port.stop).not.toHaveBeenCalled();
  });

  it('a sample the route could not play shows Play again and is recorded as an error', async () => {
    reportErrorSpy.mockClear();
    reportWarningSpy.mockClear();
    const failure = new Error('the output device went away');
    const port = { play: vi.fn(() => Promise.reject(failure)), stop: vi.fn() };
    const onPreview = vi.fn().mockResolvedValue({ audio: new Float32Array(2048), sampleRate: 24000 });

    render(
      <VoicePreviewContext.Provider value={port}>
        <VoiceLibrarySection
          {...base}
          selectedId=""
          voices={[{ id: 'custom:1', label: 'Mine', group: 'custom', removable: true }]}
          capability={{ importModes: ['upload'] }}
          onPreview={onPreview}
        />
      </VoicePreviewContext.Provider>,
    );
    openPicker();

    fireEvent.click(screen.getByRole('button', { name: /^play$/i }));
    await waitFor(() => expect(port.play).toHaveBeenCalledTimes(1));
    // What the user asked for did not happen: an error, not a warning (CLAUDE.md's severity rule).
    await waitFor(() => expect(reportErrorSpy).toHaveBeenCalledTimes(1));
    expect(reportErrorSpy).toHaveBeenCalledWith(
      'VoiceLibrary',
      expect.stringContaining('The voice preview did not play'),
      { cause: failure },
    );
    expect(reportWarningSpy).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /^play$/i })).toBeInTheDocument();
    expect(port.stop).not.toHaveBeenCalled();
  });
});
