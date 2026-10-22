/**
 * The screen-context chip in the control footer (spec 2026-10-22 §3.4, option
 * D): the required cue that Qwen sees a chosen area. An eye, the source's name
 * (hidden when icon-only: the basic layout and the extension's side panel), and
 * a dot — green that pulses once per frame sent, amber while the picture has
 * not changed, red when the source is lost. Hover or click opens a card with
 * the last frame sent, the time since, the frames sent and, on the desktop,
 * Choose again; the extension, which captures the meeting tab, has nothing to
 * choose again, so its card only says translation goes on on audio.
 *
 * The card is floating-ui's (the library `Tooltip` wraps) rather than
 * `Tooltip` itself: it opens on hover and on click at once — a click sticks it
 * open — and holds a button, so it is a non-modal dialog the keyboard can tab
 * into, where `Tooltip` takes one trigger and is always `role="tooltip"`.
 *
 * Presentational: it never makes the thumbnail's object URL (`MainPanel`
 * does, and revokes it), and never reads a store.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppWindow, Eye, Monitor, PanelsTopLeft } from 'lucide-react';
import {
  autoUpdate,
  flip,
  FloatingFocusManager,
  FloatingPortal,
  offset,
  safePolygon,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useHover,
  useInteractions,
  useRole,
} from '@floating-ui/react';
import './ScreenContextChip.scss';

export interface ScreenContextChipProps {
  name: string; kind: 'window' | 'screen' | 'tab';
  status: 'live' | 'stale' | 'lost';
  sentCount: number; lastSentAt: number | null; now: number;
  /** An object URL of the last frame sent, or null; the chip never makes one itself. */
  thumbnail: string | null;
  iconOnly: boolean;
  /** Absent where nothing can be chosen again (the extension captures the meeting tab): the card offers no button. */
  onChooseAgain?(): void;
}

const KIND_ICON = { window: AppWindow, screen: Monitor, tab: PanelsTopLeft } as const;

/**
 * The top of the card: the picture, then the source's kind and name. The
 * footer's card shows the last frame sent; the Screen context setting's card
 * (the same card, cut for the settings) shows the picker's still of the window.
 */
export function ScreenContextPicture({ thumbnail, name, kind }: { thumbnail: string | null; name: string; kind: ScreenContextChipProps['kind'] }) {
  const KindIcon = KIND_ICON[kind];
  return (
    <>
      {thumbnail && <img className="screen-context-card__thumb" src={thumbnail} alt={name} />}
      <div className="screen-context-card__name">
        <KindIcon size={14} aria-hidden="true" />
        <span>{name}</span>
      </div>
    </>
  );
}

export function ScreenContextChip(p: ScreenContextChipProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'top',
    middleware: [offset(8), flip({ fallbackAxisSideDirection: 'start', crossAxis: false }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
    strategy: 'fixed',
  });
  // Hover opens it, and the pointer can travel into it to press Choose again; a click opens it to stay.
  const hover = useHover(context, { delay: { open: 100, close: 0 }, handleClose: safePolygon() });
  const click = useClick(context);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: 'dialog' });
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, click, dismiss, role]);

  const statusWord = p.status === 'live'
    ? t('screenContext.chip.live', 'Live')
    : p.status === 'stale'
      ? t('screenContext.chip.stale', 'Unchanged')
      : t('screenContext.chip.lost', 'Not available');
  const ago =p.lastSentAt === null ? null : Math.max(0, Math.round((p.now - p.lastSentAt) / 1000));

  return (
    <>
      <button
        ref={refs.setReference}
        type="button"
        className={`screen-context-chip screen-context-chip--${p.status}${p.iconOnly ? ' screen-context-chip--icon-only' : ''}`}
        aria-label={t('screenContext.chip.label', 'Screen context: {{name}}, {{status}}', { name: p.name, status: statusWord })}
        {...getReferenceProps()}
      >
        <Eye size={14} aria-hidden="true" />
        {!p.iconOnly && <span className="screen-context-chip__name">{p.name}</span>}
        {!p.iconOnly && p.status !== 'live' && <span className="screen-context-chip__status">{statusWord}</span>}
        {/* Remounted on every frame sent, so its one-shot pulse plays again. */}
        <span key={p.sentCount} className={`screen-context-chip__dot ${p.status}`} aria-hidden="true" />
      </button>
      {open && (
        <FloatingPortal>
          {/* Hover never moves the focus into it; Tab from the chip does. */}
          <FloatingFocusManager context={context} modal={false} initialFocus={-1}>
            <div
              ref={refs.setFloating}
              className="screen-context-card"
              style={{ ...floatingStyles, zIndex: 9999 }}
              aria-label={p.name}
              {...getFloatingProps()}
            >
              <ScreenContextPicture thumbnail={p.thumbnail} name={p.name} kind={p.kind} />
              {p.status === 'lost' && (
                <p className="screen-context-card__hint">
                  {p.onChooseAgain
                    ? t('screenContext.card.lostHint', 'The source is gone; the last picture is kept until you choose again.')
                    : t('screenContext.card.lostExtension', "The meeting tab's picture is no longer available; translation continues on audio alone.")}
                </p>
              )}
              <div className="screen-context-card__meta">
                {ago !== null && <span>{t('screenContext.card.lastFrame', 'Last frame {{ago}} s ago', { ago })}</span>}
                <span>{t('screenContext.card.frames', 'Frames sent: {{count}}', { count: p.sentCount })}</span>
              </div>
              {p.onChooseAgain && (
                <button
                  type="button"
                  className="screen-context-card__choose"
                  onClick={() => {
                    setOpen(false);
                    p.onChooseAgain?.();
                  }}
                >
                  {t('screenContext.card.chooseAgain', 'Choose again')}
                </button>
              )}
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </>
  );
}
