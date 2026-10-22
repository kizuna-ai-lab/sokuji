/**
 * The panel's side of screen context (spec 2026-10-22 §3.1, §3.4): the source
 * picker — for the settings when the switch goes on, for a Start that holds
 * nothing usable, for Choose again — and the chip while a run holds a source.
 *
 * On the desktop it hands the session `pickScreenSource` (`AppBridges`) and the
 * settings `pickSource` (the screen-context store): each call opens the picker
 * with what the main process offers — the mode, the windows and screens, or
 * macOS's refusal — and answers with the pick, the portal's button, or null on
 * Cancel. Every call settles: a second pick answers the first with null — but a
 * settings ask never takes the picker from a Start or Choose again, and is the
 * one answered null — and an unmount answers the open one with null and takes
 * both away. On Wayland the settings' ask answers the portal's button with no
 * modal: the system's chooser opens at Start. While the session
 * checks the area a Start-time pick chose for a first frame (the store's
 * `preparing`) the picker stays up, checking; the check of an area held from
 * before shows on Start alone, since nothing was asked. The extension has no
 * picker: it captures the meeting tab.
 *
 * The chip is drawn from the store's sampler state, its thumbnail an object URL
 * of the last frame sent, made here and revoked when the frame changes and on
 * unmount: the chip only ever receives the URL.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppSession } from '../../../app/session';
import { chooseAgain, type PickedSource, type PickReason } from '../../../app/screenContext';
import { describeCause, reportWarning } from '../../../lib/diagnostics/report';
import { captureSourceMode, listCaptureSources, openDesktopCapture, reaskScreenRecording, type Invoke } from '../../../lib/screen/desktopFrames';
import { useScreenContextStore } from '../../../stores/screenContextStore';
import { isElectron } from '../../../utils/environment';
import type { SourcePickerProps } from '../../ScreenContext/SourcePicker';
import type { ScreenContextChipProps } from './ScreenContextChip';

export interface ScreenContextView {
  /** The chip, but for `iconOnly` (the footer's site decides it); null while no run holds a source. */
  chip: Omit<ScreenContextChipProps, 'iconOnly'> | null;
  /** A chosen area is checked for its first frame before the run starts: Start shows it. */
  preparing: boolean;
  picker: SourcePickerProps;
}

type Choices = Pick<SourcePickerProps, 'mode' | 'screenRecording' | 'sources'>;
type Purpose = SourcePickerProps['purpose'];
interface OpenPicker extends Choices {
  reason?: PickReason;
  purpose: Purpose;
  /** A Refresh is out to the desktop: the list stays as it was until the answer lands. */
  refreshing: boolean;
  /** macOS was asked again and still reads denied: what is left is the restart a new grant needs. */
  asked: boolean;
}

const invoke: Invoke = (channel, data) => window.electron.invoke(channel, data);

export function useScreenContext(session: Pick<AppSession, 'setBridges'>): ScreenContextView {
  const desktop = isElectron();
  const sampler = useScreenContextStore((s) => s.sampler);
  const state = useScreenContextStore((s) => s.state);
  const preparing = useScreenContextStore((s) => s.preparing);
  const thumbnail = useObjectUrl(state?.lastJpeg ?? null);

  const [picker, setPicker] = useState<OpenPicker | null>(null);
  /** Answers the open pick; null when none is open. */
  const answer = useRef<((picked: PickedSource | null) => void) | null>(null);
  /** Who the open pick answers; null when none is open. */
  const openPurpose = useRef<Purpose | null>(null);
  /** A Start-time pick was answered, so its check shows in the picker; until that check settles. */
  const [startPicked, setStartPicked] = useState(false);

  const ask = useCallback((reason: PickReason | undefined, purpose: Purpose) => new Promise<PickedSource | null>((resolve) => {
    // The settings never take the picker from a Start or a Choose again: their ask is answered as a Cancel at once.
    if (purpose === 'settings' && answer.current && openPurpose.current !== 'settings') {
      resolve(null);
      return;
    }
    // One picker at a time: an open one is answered as a Cancel.
    answer.current?.(null);
    const settle = (picked: PickedSource | null) => {
      if (answer.current !== settle) return;
      answer.current = null;
      openPurpose.current = null;
      // The answer first: a pick's check (`preparing`) lands in the same render as the list closing, so the modal never blinks.
      resolve(picked);
      setStartPicked(picked !== null && purpose === 'start');
      setPicker(null);
    };
    answer.current = settle;
    openPurpose.current = purpose;
    const show = () => {
      setPicker({ reason, purpose, refreshing: false, asked: false, mode: 'list', screenRecording: 'granted', sources: null });
      void readChoices().then((choices) => {
        if (answer.current === settle) setPicker({ reason, purpose, refreshing: false, asked: false, ...choices });
      });
    };
    if (purpose !== 'settings') {
      show();
      return;
    }
    // Wayland: the system's chooser is the picker, and it opens at Start; the settings hold the portal's button without
    // a modal whose one button would choose nothing (and with no listing, which is what opens that chooser).
    void captureSourceMode(invoke).then(
      ({ mode }) => {
        if (answer.current !== settle) return;
        if (mode === 'portal') settle({ kind: 'portal' });
        else show();
      },
      // The list's own read asks again, and says why it failed.
      () => { if (answer.current === settle) show(); },
    );
  }), []);

  // A check that settles ends the Start-time pick's, so a later Start opening the held area (asking nothing) shows no
  // picker. Read off the store as it changes: a check that flips true then false before any render leaves no render to see.
  useEffect(() => useScreenContextStore.subscribe((now, before) => {
    if (before.preparing && !now.preparing) setStartPicked(false);
  }), []);

  /** The list again, for the picker still open: what is listed stays up while the desktop answers, then what it lists now. A closed picker asks nothing. */
  const refresh = useCallback(() => {
    const settle = answer.current;
    if (!settle) return;
    setPicker((open) => (open ? { ...open, refreshing: true } : open));
    void readChoices().then((choices) => {
      if (answer.current === settle) setPicker((open) => (open ? { ...open, ...choices, refreshing: false } : open));
    });
  }, []);

  /**
   * macOS refused: Sokuji's entry reset and the prompt raised (the main process's `reask-screen-recording`). A
   * permission that then reads granted is listed at once; one that still reads denied, as a new grant does until
   * Sokuji restarts, leaves the restart. The pick keeps waiting either way.
   */
  const reask = useCallback(() => {
    const settle = answer.current;
    if (!settle) return;
    const leaveRestart = () => {
      if (answer.current === settle) setPicker((open) => (open ? { ...open, asked: true } : open));
    };
    void reaskScreenRecording(invoke).then(
      (answered) => {
        if (answered.resetError) {
          reportWarning('ScreenContext', `Sokuji's Screen Recording entry could not be reset; macOS was asked anyway: ${answered.resetError}`);
        }
        if (answered.status !== 'granted') {
          leaveRestart();
          return;
        }
        void readChoices().then((choices) => {
          if (answer.current === settle) setPicker((open) => (open ? { ...open, ...choices, asked: false } : open));
        });
      },
      (error: unknown) => {
        reportWarning('ScreenContext', `Asking macOS for Screen Recording again failed: ${describeCause(error)}`, { cause: error });
        leaveRestart();
      },
    );
  }, []);

  /** macOS applies a new Screen Recording grant only after a restart. */
  const restart = useCallback(() => {
    invoke('relaunch-app').catch((error: unknown) => {
      reportWarning('ScreenContext', `Sokuji could not restart itself: ${describeCause(error)}`, { cause: error });
    });
  }, []);

  useEffect(() => {
    if (!desktop) return;
    session.setBridges({ pickScreenSource: (reason?: PickReason) => ask(reason, 'start') });
    useScreenContextStore.getState().setPickSource((reason?: PickReason) => ask(reason, 'settings'));
    return () => {
      // Every pick settles: an unmounted panel can never answer one.
      answer.current?.(null);
      session.setBridges({ pickScreenSource: null });
      useScreenContextStore.getState().setPickSource(null);
    };
  }, [session, desktop, ask]);

  const onChooseAgain = useCallback(() => {
    void chooseAgain({ pick: (reason) => ask(reason, 'choose-again'), invoke, openDesktop: openDesktopCapture });
  }, [ask]);

  const checking = desktop && preparing && picker === null && startPicked;
  const chip: ScreenContextView['chip'] = sampler !== null && state !== null && state.status !== 'idle'
    ? {
      name: state.name,
      kind: state.kind,
      status: state.status,
      sentCount: state.sent,
      lastSentAt: state.lastSentAt,
      // Read at render: the panel re-renders every second while a run is live (the session clock) and on every frame.
      now: Date.now(),
      thumbnail,
      onChooseAgain: desktop ? onChooseAgain : undefined,
    }
    : null;

  return {
    chip,
    preparing,
    picker: {
      open: picker !== null || checking,
      mode: picker?.mode ?? 'list',
      screenRecording: picker?.screenRecording ?? 'granted',
      sources: picker?.sources ?? null,
      reason: picker?.reason,
      checking,
      purpose: picker?.purpose ?? 'start',
      refreshing: picker?.refreshing ?? false,
      asked: picker?.asked ?? false,
      onReask: reask,
      onRestart: restart,
      onPick: (source) => answer.current?.({ kind: 'desktop', source }),
      onPortal: () => answer.current?.({ kind: 'portal' }),
      onCancel: () => answer.current?.(null),
      onOpenPrivacy: () => { void invoke('open-privacy-settings', 'screen-recording'); },
      onRefresh: refresh,
    },
  };
}

/**
 * What the main process offers. On a portal desktop nothing is listed: the listing is what opens the portal's own
 * chooser, which waits for the picker's button. A list is followed by a second read of the Screen Recording status,
 * since a first listing on a Mac never asked may have turned it to denied. Never rejects: a failure is a warning and
 * an empty list.
 */
async function readChoices(): Promise<Choices> {
  try {
    const before = await captureSourceMode(invoke);
    if (before.mode === 'portal') return { mode: 'portal', screenRecording: before.screenRecording, sources: [] };
    const listed = await listCaptureSources(invoke);
    if (!listed.ok && listed.error === 'screen-recording-denied') return { mode: 'list', screenRecording: 'denied', sources: [] };
    const after = await captureSourceMode(invoke);
    if (after.screenRecording === 'denied') return { mode: 'list', screenRecording: 'denied', sources: [] };
    if (!listed.ok) {
      reportWarning('ScreenContext', `The desktop listed no window or screen to share: ${listed.error}`);
      return { mode: 'list', screenRecording: after.screenRecording, sources: [] };
    }
    return { mode: 'list', screenRecording: after.screenRecording, sources: listed.sources };
  } catch (error) {
    reportWarning('ScreenContext', `The windows and screens to share could not be listed: ${describeCause(error)}`, { cause: error });
    return { mode: 'list', screenRecording: 'granted', sources: [] };
  }
}

/** An object URL of the frame, revoked when the frame changes and on unmount. */
function useObjectUrl(jpeg: Uint8Array | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!jpeg) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(new Blob([jpeg as BlobPart], { type: 'image/jpeg' }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [jpeg]);
  return url;
}
