// src/components/Tour/TourOverlay.tsx
//
// Draws the current tour step (spec §2.1): a scrim with a cutout over the
// target, or a full scrim with a centred card when the step has no anchor,
// plus the popover with title, body, progress and controls. Nothing under the
// tour is clickable: centred steps are covered by the full scrim, anchored ones
// by a transparent blocker under the spotlight (whose box-shadow "scrim" is not
// itself hit-testable). Only the popover takes input.
import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useFloating, useDismiss, useRole, useInteractions, FloatingFocusManager, FloatingPortal,
  offset, flip, shift, autoUpdate,
} from '@floating-ui/react';
import { useAuthOverlay } from '../../stores/settingsStore';
import { useTour } from './TourProvider';
import { contentKey, titleKey } from './steps';
import './Tour.scss';

const PAD = 6;

const TourOverlay: React.FC = () => {
  const { t } = useTranslation();
  const tour = useTour();
  const { active, step, ctx, index, steps, target, resolving } = tour;
  const [rect, setRect] = useState<DOMRect | null>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();

  // Keep the cutout glued to the target through scrolls and resizes. autoUpdate
  // fires on every scroll frame, so only commit a rect that actually moved —
  // an identical DOMRect would re-render the whole overlay for nothing.
  useLayoutEffect(() => {
    if (!target) { setRect(null); return; }
    return autoUpdate(target, document.body, () => {
      const next = target.getBoundingClientRect();
      setRect((prev) => (prev
        && prev.top === next.top && prev.left === next.left
        && prev.width === next.width && prev.height === next.height
        ? prev : next));
    });
  }, [target]);

  const { refs, floatingStyles, context } = useFloating({
    open: active,
    onOpenChange: (isOpen) => { if (!isOpen) tour.skip(); },
    placement: step?.placement ?? 'bottom',
    // `fixed` to match the stylesheet (and the spotlight): with the default
    // absolute strategy floatingStyles are offset by the page scroll the
    // position: fixed rule then ignores.
    strategy: 'fixed',
    elements: { reference: target ?? undefined },
    // fallbackAxisSideDirection: every settings step asks for 'left', which
    // cannot fit beside a ~330px section in the 360px side panel. Plain flip()
    // only tries the opposite side, leaving shift() to park the popover on top
    // of the element it is pointing at; this lets it fall through to top/bottom.
    middleware: [offset(12), flip({ fallbackAxisSideDirection: 'start' }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  // The `account` step sends a signed-out user to the sign-in overlay mid-tour.
  // Escape there must close that form, not silently skip (and persist as
  // "skipped") the tour behind it. Same rule as SetupWizard's own useDismiss.
  const authOverlay = useAuthOverlay();
  const dismiss = useDismiss(context, { escapeKey: authOverlay === null, outsidePress: false });
  const role = useRole(context, { role: 'dialog' });
  const { getFloatingProps } = useInteractions([dismiss, role]);

  // Optional call: jsdom (and older embedders) do not implement scrollIntoView,
  // and a missing scroll must never take the whole overlay down.
  useEffect(() => { if (active && target) target.scrollIntoView?.({ block: 'center', inline: 'nearest' }); }, [active, target]);

  // Keyboard focus across the resolving state. While a step resolves the
  // popover goes inert, which can drop the active element to <body>; once the
  // anchor lands, put focus back on the primary button so Enter works without
  // a Tab first. Also covers stepping between steps, where the popover stays
  // mounted and a mount-time `autoFocus` would never fire again.
  useEffect(() => { if (active && !resolving) primaryRef.current?.focus(); }, [active, index, resolving]);

  if (!active || !step || !ctx) return null;

  const isLast = index >= steps.length - 1;
  // Keyed off the step, NOT the target: while an anchored step's anchor is
  // still being awaited, `target` is null too, and treating that as "centred"
  // would black the viewport out for the whole wait.
  const centred = !step.anchor;
  // Enter is the popover's own "advance" shortcut, but only when no button owns
  // it: with Skip or Back focused, Enter must run that button's native
  // activation, so the handler stands down and lets the click through.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    if ((e.target as HTMLElement | null)?.closest?.('button')) return;
    e.preventDefault();
    tour.next();
  };

  return (
    <FloatingPortal>
      {centred ? <div className="tour-scrim tour-scrim--full" /> : (
        <>
          {/* Transparent, and rendered even while the anchor resolves: the app
              must be inoperable for the whole step, not only once it is lit. */}
          <div className="tour-blocker" />
          {rect && !resolving && (
            // No spotlight at all while resolving: the previous step's rect is
            // stale and its scrim would darken the very panel `prepare` reveals.
            <div
              className="tour-spotlight"
              style={{ top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }}
            />
          )}
        </>
      )}
      <FloatingFocusManager context={context} modal returnFocus initialFocus={primaryRef}>
        <div
          ref={refs.setFloating}
          className={`tour-popover${centred ? ' tour-popover--centred' : ''}${resolving ? ' is-resolving' : ''}`}
          style={centred ? undefined : floatingStyles}
          // onKeyDown goes *through* getFloatingProps: useDismiss returns its
          // own onKeyDown (Escape), and spreading over ours would drop Enter.
          // The aria wiring comes after the spread so useRole's own (empty)
          // labelling cannot clear it.
          {...getFloatingProps({ onKeyDown })}
          aria-labelledby={titleId}
          aria-describedby={bodyId}
        >
          <h2 id={titleId} className="tour-popover__title">{t(titleKey(step), step.id)}</h2>
          <p id={bodyId} className="tour-popover__body">{t(contentKey(step, ctx), '')}</p>
          <div className="tour-popover__footer">
            <span className="tour-popover__progress">{`${index + 1} / ${steps.length}`}</span>
            <span className="tour-popover__spacer" />
            {!isLast && (
              <button type="button" className="tour-popover__btn tour-popover__btn--ghost" onClick={tour.skip}>{t('tour.skip', 'Skip')}</button>
            )}
            {index > 0 && (
              <button type="button" className="tour-popover__btn" onClick={tour.back}>{t('tour.back', 'Back')}</button>
            )}
            <button ref={primaryRef} type="button" className="tour-popover__btn tour-popover__btn--primary" onClick={tour.next}>
              {isLast ? t('tour.finish', 'Finish') : t('tour.next', 'Next')}
            </button>
          </div>
        </div>
      </FloatingFocusManager>
    </FloatingPortal>
  );
};

export default TourOverlay;
