/**
 * The subtitle window's own handling, shared by today's `SubtitleApp` and the
 * new `SubtitleView`: the bar hides after a quiet spell, Escape leaves
 * fullscreen and then subtitle mode, the Electron window's fullscreen and
 * bounds are mirrored into the stores, and the overlay gets its resize
 * handles. None of it touches conversation data. Moved out of `SubtitleApp`
 * unchanged.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type MutableRefObject, type ReactNode } from 'react';
import useSettingsStore, { useSetSubtitleFullscreen, useSubtitleFullscreen } from '../../stores/settingsStore';
import { useSaveSubtitleWindowBounds, useSubtitlePositionLocked, useSubtitleSettings } from '../../stores/subtitleStore';
import { useOverlayDragResize } from './useOverlayDragResize';

export type SubtitleSurfaceKind = 'electron' | 'extension-overlay';

const AUTO_HIDE_MS = 1500;

function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([a-fA-F0-9]{6})$/.exec(hex);
  if (!m) return `rgba(0,0,0,${alpha})`;
  const v = parseInt(m[1], 16);
  const r = (v >> 16) & 0xff;
  const g = (v >> 8) & 0xff;
  const b = v & 0xff;
  return `rgba(${r},${g},${b},${alpha})`;
}

const HIGHLIGHT_ALPHA = 0.3;

/**
 * Returns a CSS color for the "newly-arrived item" overlay, chosen so it
 * contrasts with the user-selected background. YIQ luminance < 128 means
 * the background is dark → use a light overlay; otherwise use dark.
 *
 * The user-set bgOpacity is intentionally not factored in. When opacity is
 * very low and the actual visible background is whatever sits behind the
 * subtitle window, this falls back to the bgColor's nominal lightness —
 * a known limitation accepted in the design spec.
 */
export function getHighlightOverlayForBg(hex: string): string {
  const m = /^#?([a-fA-F0-9]{6})$/.exec(hex);
  if (!m) return `rgba(255,255,255,${HIGHLIGHT_ALPHA})`;
  const v = parseInt(m[1], 16);
  const r = (v >> 16) & 0xff;
  const g = (v >> 8) & 0xff;
  const b = v & 0xff;
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq < 128
    ? `rgba(255,255,255,${HIGHLIGHT_ALPHA})`
    : `rgba(0,0,0,${HIGHLIGHT_ALPHA})`;
}

export interface SubtitleChrome {
  rootRef: MutableRefObject<HTMLDivElement | null>;
  rootProps: {
    className: string;
    style: CSSProperties;
    onMouseEnter: () => void;
    onMouseMove: () => void;
    onMouseLeave: () => void;
  };
  /** The overlay's eight resize handles, or null. */
  resizeHandles: ReactNode;
}

/** `onExit` should keep its identity across renders (a `useCallback`): the Escape listener re-attaches whenever it changes. */
export function useSubtitleChrome({ surface, onExit, forceVisible = false }: {
  surface: SubtitleSurfaceKind;
  onExit: () => void;
  /**
   * Keeps the bar visible (and skips the idle auto-hide) for as long as this
   * is true, regardless of mouse activity — the overlay's hold-to-talk
   * control lives in the bar (follow-up D), and a turn held with the mouse
   * motionless must not have its own bar hide out from under it.
   */
  forceVisible?: boolean;
}): SubtitleChrome {
  const subtitle = useSubtitleSettings();
  const fullscreen = useSubtitleFullscreen();
  const setFullscreen = useSetSubtitleFullscreen();
  const saveBounds = useSaveSubtitleWindowBounds();

  // Root ref — used to derive the owner document for keyboard listeners so
  // ESC works correctly when SubtitleApp is mounted inside an iframe.
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Auto-hide bar
  const [barVisible, setBarVisible] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Read from the hide-timeout closures below, always the latest value —
  // those closures are created once (inside a stable useCallback / a plain
  // handler) and must not hide the bar while a hold is forcing it open, even
  // if the timer was armed by mouse movement that happened during the hold.
  const forceVisibleRef = useRef(forceVisible);
  forceVisibleRef.current = forceVisible;
  // Reveal the bar and (re)arm an inactivity timer that hides it after
  // AUTO_HIDE_MS. Driven by mouse MOVEMENT, not just enter/leave: in
  // fullscreen the root fills the entire screen, so the pointer never
  // "leaves" and a leave-only hide would keep the bar stuck visible.
  // Movement-based inactivity hides correctly in both windowed and fullscreen.
  const revealBar = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setBarVisible(true);
    hideTimer.current = setTimeout(() => {
      if (forceVisibleRef.current) return;
      setBarVisible(false);
    }, AUTO_HIDE_MS);
  }, []);
  const onMouseLeave = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (forceVisibleRef.current) return;
      setBarVisible(false);
    }, AUTO_HIDE_MS);
  };
  // Clear the pending auto-hide timer on unmount so it can't fire after the
  // component is gone (movement-based revealBar arms one frequently).
  useEffect(() => () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
  }, []);
  // React to forceVisible's own transitions (not to mount): turning on
  // reveals the bar right away and cancels any pending hide, whichever state
  // it was in; turning off resumes the idle countdown, as if the user had
  // just moved the mouse. Skipped on mount so a surface that never uses
  // forceVisible (Electron, and the overlay outside a held turn) keeps
  // today's behaviour exactly — the bar starts visible and stays that way
  // until the first real mouse activity arms the very first hide timer.
  const mountedForceVisible = useRef(false);
  useEffect(() => {
    if (!mountedForceVisible.current) {
      mountedForceVisible.current = true;
      return;
    }
    if (forceVisible) {
      if (hideTimer.current) {
        clearTimeout(hideTimer.current);
        hideTimer.current = null;
      }
      setBarVisible(true);
    } else {
      revealBar();
    }
  }, [forceVisible, revealBar]);

  // ESC is layered: if we're in fullscreen, the first ESC drops back to the
  // windowed bar; otherwise (or on the next ESC) it exits subtitle mode.
  useEffect(() => {
    const target = rootRef.current?.ownerDocument ?? document;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (fullscreen) {
        void setFullscreen(false);
      } else {
        onExit();
      }
    };
    target.addEventListener('keydown', onKey);
    return () => target.removeEventListener('keydown', onKey);
  }, [onExit, fullscreen, setFullscreen]);

  // The OS fullscreen state can change outside our button (app menu, F11,
  // macOS gesture). Mirror it into the store so the bar button + layered ESC
  // stay correct. Electron surface only.
  useEffect(() => {
    if (surface !== 'electron') return;
    if (!window.electron?.receive) return;
    const handler = (flag: boolean) => {
      useSettingsStore.getState().__syncSubtitleFullscreen(Boolean(flag));
    };
    window.electron.receive('subtitle:fullscreen-changed', handler);
    return () => {
      window.electron?.removeListener?.('subtitle:fullscreen-changed', handler);
    };
  }, [surface]);

  // Bounds-changed listener (debounced 500 ms before persistence).
  // The main process emits this for any resize/move regardless of mode, so
  // we double-guard: only persist while subtitle mode is still active. This
  // prevents the resize event triggered by exiting (setBounds(restore))
  // from being saved as subtitle bounds.
  useEffect(() => {
    if (surface !== 'electron') return;
    if (!window.electron?.receive) return;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const handler = (bounds: { x: number; y: number; width: number; height: number }) => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        if (!useSettingsStore.getState().subtitleModeActive) return;
        void saveBounds(bounds);
      }, 500);
    };
    window.electron.receive('subtitle:window-bounds-changed', handler);
    return () => {
      if (debounce) clearTimeout(debounce);
      window.electron?.removeListener?.('subtitle:window-bounds-changed', handler);
    };
  }, [saveBounds, surface]);

  // Resize handles (extension-overlay only). Lock state from subtitleStore
  // gates rendering — locked = no handles, no cursor change.
  const positionLocked = useSubtitlePositionLocked();
  const { resizeHandleProps } = useOverlayDragResize({ surface });
  const showResizeHandles = surface === 'extension-overlay' && !positionLocked;

  // Build CSS variables for background. The intersection with
  // Record<string, string | number> lets us set CSS custom properties
  // without TS rejecting non-camelCase keys.
  const bgAlpha = subtitle.bgOpacity / 100;
  const rootStyle: CSSProperties & Record<string, string | number> = {
    background: hexToRgba(subtitle.bgColor, bgAlpha),
    '--bar-opacity': barVisible ? 1 : 0,
    '--bar-pointer-events': barVisible ? 'auto' : 'none',
    '--subtitle-highlight-overlay': getHighlightOverlayForBg(subtitle.bgColor),
    // SubtitleApp.scss reads this for `.subtitle-app`'s inherited text
    // colour. It had never been defined at the root, so that declaration
    // always resolved to its #FFFFFF fallback. Every chrome element below
    // (idle body, PTT hint, bar) sets its own colour and overrides this, so
    // defining it changes nothing that is on screen today — it just makes
    // the rule mean what it says for anything that inherits.
    '--subtitle-source-color': subtitle.sourceTextColor,
  };

  return {
    rootRef,
    rootProps: {
      className: `subtitle-app${fullscreen ? ' fullscreen' : ''}`,
      style: rootStyle,
      onMouseEnter: revealBar,
      onMouseMove: revealBar,
      onMouseLeave,
    },
    resizeHandles: showResizeHandles ? (
      <>
        <div className="subtitle-app__resize subtitle-app__resize--n"  {...resizeHandleProps.n} />
        <div className="subtitle-app__resize subtitle-app__resize--e"  {...resizeHandleProps.e} />
        <div className="subtitle-app__resize subtitle-app__resize--s"  {...resizeHandleProps.s} />
        <div className="subtitle-app__resize subtitle-app__resize--w"  {...resizeHandleProps.w} />
        <div className="subtitle-app__resize subtitle-app__resize--nw" {...resizeHandleProps.nw} />
        <div className="subtitle-app__resize subtitle-app__resize--ne" {...resizeHandleProps.ne} />
        <div className="subtitle-app__resize subtitle-app__resize--sw" {...resizeHandleProps.sw} />
        <div className="subtitle-app__resize subtitle-app__resize--se" {...resizeHandleProps.se} />
      </>
    ) : null,
  };
}
