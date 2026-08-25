// src/components/Tour/TourOverlay.tsx
//
// Draws the current tour step (spec §2.1): a scrim with a cutout over the
// target, or a full scrim with a centred card when the step has no anchor,
// plus the popover with title, body, progress and controls. The target is not
// interactive during the tour — the tour teaches, it does not operate.
import React, { useEffect, useLayoutEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useFloating, useDismiss, useRole, useInteractions, FloatingFocusManager, FloatingPortal,
  offset, flip, shift, autoUpdate,
} from '@floating-ui/react';
import { useTour } from './TourProvider';
import { contentKey, titleKey } from './steps';
import './Tour.scss';

const PAD = 6;

const TourOverlay: React.FC = () => {
  const { t } = useTranslation();
  const tour = useTour();
  const { active, step, ctx, index, steps, target, resolving } = tour;
  const [rect, setRect] = useState<DOMRect | null>(null);

  // Keep the cutout glued to the target through scrolls and resizes.
  useLayoutEffect(() => {
    if (!target) { setRect(null); return; }
    return autoUpdate(target, document.body, () => setRect(target.getBoundingClientRect()));
  }, [target]);

  const { refs, floatingStyles, context } = useFloating({
    open: active,
    onOpenChange: (isOpen) => { if (!isOpen) tour.skip(); },
    placement: step?.placement ?? 'bottom',
    elements: { reference: target ?? undefined },
    middleware: [offset(12), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  const dismiss = useDismiss(context, { escapeKey: true, outsidePress: false });
  const role = useRole(context, { role: 'dialog' });
  const { getFloatingProps } = useInteractions([dismiss, role]);

  // Optional call: jsdom (and older embedders) do not implement scrollIntoView,
  // and a missing scroll must never take the whole overlay down.
  useEffect(() => { if (active && target) target.scrollIntoView?.({ block: 'center', inline: 'nearest' }); }, [active, target]);

  if (!active || !step || !ctx) return null;

  const isLast = index >= steps.length - 1;
  const centred = !target;
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); tour.next(); }
  };

  return (
    <FloatingPortal>
      {centred
        ? <div className="tour-scrim tour-scrim--full" />
        : rect && (
          <div
            className="tour-spotlight"
            style={{ top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }}
          />
        )}
      <FloatingFocusManager context={context} modal returnFocus>
        <div
          ref={refs.setFloating}
          className={`tour-popover${centred ? ' tour-popover--centred' : ''}${resolving ? ' is-resolving' : ''}`}
          style={centred ? undefined : floatingStyles}
          aria-label={t(titleKey(step), step.id)}
          // onKeyDown goes *through* getFloatingProps: useDismiss returns its
          // own onKeyDown (Escape), and spreading over ours would drop Enter.
          {...getFloatingProps({ onKeyDown })}
        >
          <h2 className="tour-popover__title">{t(titleKey(step), step.id)}</h2>
          <p className="tour-popover__body">{t(contentKey(step, ctx), '')}</p>
          <div className="tour-popover__footer">
            <span className="tour-popover__progress">{`${index + 1} / ${steps.length}`}</span>
            <span className="tour-popover__spacer" />
            {!isLast && (
              <button type="button" className="tour-popover__btn tour-popover__btn--ghost" onClick={tour.skip}>{t('tour.skip', 'Skip')}</button>
            )}
            {index > 0 && (
              <button type="button" className="tour-popover__btn" onClick={tour.back}>{t('tour.back', 'Back')}</button>
            )}
            <button type="button" className="tour-popover__btn tour-popover__btn--primary" onClick={tour.next} autoFocus>
              {isLast ? t('tour.finish', 'Finish') : t('tour.next', 'Next')}
            </button>
          </div>
        </div>
      </FloatingFocusManager>
    </FloatingPortal>
  );
};

export default TourOverlay;
