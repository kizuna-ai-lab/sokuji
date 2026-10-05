import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

/** Within this many px of the bottom is the bottom (the viewer's live edge, `src/viewer/layout.ts`). */
export const FOLLOW_EDGE_PX = 48;
/** The Back to live row shows this long after following stops, so a nudge up and back never shows it. */
export const FOLLOW_DOCK_DELAY_MS = 250;

const UP_KEYS = new Set(['ArrowUp', 'PageUp', 'Home']);
const DOWN_KEYS = new Set(['ArrowDown', 'PageDown', 'End']);
/** A move down this soon after a downward intent is the reader's, even if a line landed on that frame. */
const DOWN_INTENT_MS = 500;

/**
 * Keeps a scrolling list on its newest line while the reader is there, and
 * lets them read back undisturbed.
 *
 * Any upward intent (a wheel up, a finger dragging down, ↑ / PageUp / Home in
 * the list) stops following at once: with streaming text the list changes
 * every few frames, so waiting until the reader has left the bottom loses the
 * race and pins them back. Only the reader moving down into the last
 * FOLLOW_EDGE_PX, the row's click, or the list emptying resumes it; a line
 * arriving never decides it either way, nor does scroll anchoring moving the
 * list down when a row above grows. While the scrollbar is held nothing pins;
 * the release decides.
 *
 * `docked` is true from FOLLOW_DOCK_DELAY_MS after following stops until it
 * resumes, when it goes at once.
 */
export function useFollowLatest(
  ref: RefObject<HTMLElement | null>,
  content: unknown,
  empty: boolean,
): { docked: boolean; resume(): void } {
  const following = useRef(true);
  const dragging = useRef(false);
  const dockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [docked, setDocked] = useState(false);

  const pin = useCallback(() => {
    const el = ref.current;
    if (el && following.current && !dragging.current) el.scrollTop = el.scrollHeight;
  }, [ref]);

  const setFollowing = useCallback((on: boolean) => {
    if (following.current === on) return;
    following.current = on;
    if (dockTimer.current) clearTimeout(dockTimer.current);
    dockTimer.current = null;
    if (on) setDocked(false);
    else dockTimer.current = setTimeout(() => { dockTimer.current = null; setDocked(true); }, FOLLOW_DOCK_DELAY_MS);
  }, []);

  const resume = useCallback(() => {
    setFollowing(true);
    pin();
  }, [pin, setFollowing]);

  // After every change; layout has run by the time this fires.
  useLayoutEffect(() => {
    if (empty) setFollowing(true);
    pin();
  }, [content, empty, pin, setFollowing]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let last = el.scrollTop;
    let height = el.scrollHeight;
    let client = el.clientHeight;
    let touchY: number | null = null;
    let downIntentAt = Number.NEGATIVE_INFINITY;
    const intendDown = () => { downIntentAt = performance.now(); };
    const atBottom = () => el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_EDGE_PX;

    // An intent arrives before the reader's own scroll starts, so it can also
    // cancel a pin still animating down (`scroll-behavior: smooth`), whose next
    // frame would read as the reader coming back. A scroll that already went up
    // needs no cancel: it has overridden the pin, and cancelling would cut it.
    const stop = (cancelPin: boolean) => {
      if (!following.current) return;
      setFollowing(false);
      if (cancelPin) {
        el.scrollTo?.({ top: el.scrollTop, behavior: 'instant' });
        last = el.scrollTop;
      }
    };
    // A list that fits cannot move, so upward input there is no reading back, and
    // no scroll event would ever resume following.
    const intendUp = () => { if (el.scrollHeight - el.clientHeight > 1) stop(true); };
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) intendUp();
      else if (e.deltaY > 0) intendDown();
    };
    const onTouchStart = (e: TouchEvent) => { touchY = e.touches[0]?.clientY ?? null; };
    const onTouchMove = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY ?? null;
      if (touchY !== null && y !== null && y > touchY + 2) intendUp();
      else if (touchY !== null && y !== null && y < touchY - 2) intendDown();
      touchY = y;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (UP_KEYS.has(e.key)) intendUp();
      else if (DOWN_KEYS.has(e.key)) intendDown();
    };
    // A press on the list itself, not on a row, is its scrollbar (or its padding).
    const onPointerDown = (e: PointerEvent) => { if (e.target === el) dragging.current = true; };
    const onPointerUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      if (atBottom()) resume();
      else stop(false);
    };
    const onScroll = () => {
      const top = el.scrollTop;
      // A box that changed (a line landed, a row above grew, the window resized) can
      // move scrollTop by itself — scroll anchoring moves it down by as much as a row
      // above grew — so a move reads as the reader's only within the same box, or, on
      // the way down, right after the reader asked to go down.
      const sameBox = el.scrollHeight === height && el.clientHeight === client;
      const readerDown = sameBox || performance.now() - downIntentAt < DOWN_INTENT_MS;
      if (top < last - 1 && (sameBox || dragging.current)) stop(false);
      else if (top > last && readerDown && !dragging.current && atBottom()) setFollowing(true);
      last = top;
      height = el.scrollHeight;
      client = el.clientHeight;
    };
    // Following keeps the newest line in view when the list's box changes too
    // (a status line or this row appearing above the footer).
    const resized = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => pin());

    el.addEventListener('wheel', onWheel, { passive: true });
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: true });
    el.addEventListener('keydown', onKeyDown);
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    resized?.observe(el);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('keydown', onKeyDown);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('scroll', onScroll);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      resized?.disconnect();
    };
  }, [ref, pin, resume, setFollowing]);

  useEffect(() => () => { if (dockTimer.current) clearTimeout(dockTimer.current); }, []);

  return { docked, resume };
}
