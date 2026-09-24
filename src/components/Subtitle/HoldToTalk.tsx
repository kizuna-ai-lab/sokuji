import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Mic } from 'lucide-react';

/**
 * Hold to talk, on the extension overlay: pointer down presses; up, leave and
 * cancel release — dragging off the button must release, which today's panel
 * button does not do. A held button that goes away releases too.
 */
export function HoldToTalk({ onPress, onRelease }: { onPress: () => void; onRelease: () => void }) {
  const { t } = useTranslation();
  const [held, setHeld] = useState(false);
  const heldRef = useRef(false);
  const releaseRef = useRef(onRelease);
  releaseRef.current = onRelease;
  const press = (event: ReactPointerEvent<HTMLButtonElement>) => {
    // A right- or middle-click can lose its pointerup to a context menu or
    // scroll gesture; only the primary mouse button presses. Touch and pen
    // have no meaningful `button` outside the primary contact, so this only
    // narrows `pointerType === 'mouse'`.
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (heldRef.current) return;
    heldRef.current = true;
    setHeld(true);
    onPress();
  };
  const release = () => {
    if (!heldRef.current) return;
    heldRef.current = false;
    setHeld(false);
    onRelease();
  };
  useEffect(() => () => {
    if (heldRef.current) releaseRef.current();
  }, []);
  return (
    <div className="subtitle-hold">
      <button
        type="button"
        className={`subtitle-idle__action subtitle-hold__button${held ? ' is-held' : ''}`}
        onPointerDown={press}
        onPointerUp={release}
        onPointerLeave={release}
        onPointerCancel={release}
      >
        <Mic size={15} />
        <span>{held ? t('simplePanel.release', 'Release') : t('simplePanel.holdToSpeak', 'Hold')}</span>
      </button>
    </div>
  );
}
