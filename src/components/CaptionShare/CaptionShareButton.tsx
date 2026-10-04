// src/components/CaptionShare/CaptionShareButton.tsx
/** The toolbar's caption-share button and its popover, wired like the ⚙ display-settings popover (PanelToolbar.tsx). */
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Cast } from 'lucide-react';
import {
  useFloating, autoUpdate, offset, flip, shift, size,
  useClick, useDismiss, useRole, useInteractions, FloatingPortal,
} from '@floating-ui/react';
import CaptionSharePanel from './CaptionSharePanel';
import { useCaptionShareStore } from '../../stores/captionShareStore';

const CaptionShareButton: React.FC = () => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const running = useCaptionShareStore((s) => s.status.running);
  const viewers = useCaptionShareStore((s) => s.status.viewers);
  const floating = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'bottom-end',
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(8),
      flip(),
      shift({ padding: 8 }),
      size({
        padding: 8,
        apply({ availableHeight, elements }) {
          Object.assign(elements.floating.style, { maxHeight: `${Math.max(0, availableHeight)}px` });
        },
      }),
    ],
  });
  const interactions = useInteractions([
    useClick(floating.context),
    useDismiss(floating.context),
    useRole(floating.context, { role: 'dialog' }),
  ]);
  const label = running
    ? t('captionShare.buttonActive', { count: viewers, defaultValue: 'Sharing captions: {{count}} watching' })
    : t('captionShare.button', 'Share captions');

  return (
    <>
      <button
        className={`font-size-btn caption-share-btn ${running ? 'active' : ''}`.trim()}
        ref={floating.refs.setReference}
        {...interactions.getReferenceProps()}
        title={label}
        aria-label={label}
        type="button"
      >
        <Cast size={14} />
        {running && <span className="caption-share-btn__count">{viewers}</span>}
      </button>
      {open && (
        <FloatingPortal>
          <div
            ref={floating.refs.setFloating}
            className="caption-share-floating"
            style={floating.floatingStyles}
            aria-label={t('captionShare.button', 'Share captions')}
            {...interactions.getFloatingProps()}
          >
            <CaptionSharePanel />
          </div>
        </FloatingPortal>
      )}
    </>
  );
};

export default CaptionShareButton;
