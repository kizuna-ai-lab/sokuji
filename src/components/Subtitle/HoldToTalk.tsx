import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Mic } from 'lucide-react';

/** The keys that hold the button while it has focus (plan 1e-4 ruling 9). */
const HOLD_KEYS = new Set([' ', 'Enter']);

/**
 * Hold to talk, on the extension overlay: pointer down presses; up, leave and
 * cancel release — dragging off the button must release, which today's panel
 * button does not do. While it has focus, Space or Enter held down holds it
 * too (plan 1e-4 ruling 9). A held button that goes away, or loses focus,
 * releases. After every release the button gives up focus: the overlay sits
 * inside a meeting page, and a focused button would take the page's own
 * Space — Google Meet's push-to-unmute — as a hold of Sokuji's.
 */
export function HoldToTalk({ onPress, onRelease }: { onPress: () => void; onRelease: () => void }) {
  const { t } = useTranslation();
  const [held, setHeld] = useState(false);
  const heldRef = useRef(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const releaseRef = useRef(onRelease);
  releaseRef.current = onRelease;
  const begin = () => {
    if (heldRef.current) return;
    heldRef.current = true;
    setHeld(true);
    onPress();
  };
  const end = () => {
    if (!heldRef.current) return;
    heldRef.current = false;
    setHeld(false);
    onRelease();
    // Hand the keyboard back (choice 4). The blur fires `onBlur`, which finds nothing held.
    buttonRef.current?.blur();
  };
  const press = (event: ReactPointerEvent<HTMLButtonElement>) => {
    // A right- or middle-click can lose its pointerup to a context menu or
    // scroll gesture; only the primary mouse button presses. Touch and pen
    // have no meaningful `button` outside the primary contact, so this only
    // narrows `pointerType === 'mouse'`.
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    begin();
  };
  const keyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!HOLD_KEYS.has(event.key)) return;
    // The key holds; it does not also activate the button or scroll.
    event.preventDefault();
    // A held key's auto-repeat finds the button held already.
    begin();
  };
  const keyUp = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!HOLD_KEYS.has(event.key)) return;
    event.preventDefault();
    end();
  };
  useEffect(() => () => {
    if (heldRef.current) releaseRef.current();
  }, []);
  return (
    <div className="subtitle-hold">
      <button
        ref={buttonRef}
        type="button"
        className={`subtitle-idle__action subtitle-hold__button${held ? ' is-held' : ''}`}
        onPointerDown={press}
        onPointerUp={end}
        onPointerLeave={end}
        onPointerCancel={end}
        onKeyDown={keyDown}
        onKeyUp={keyUp}
        // A key hold whose keyup went elsewhere would strand the turn (choice 4; the panel's usePushToTalk does the same).
        onBlur={end}
      >
        <Mic size={15} />
        <span>{held ? t('simplePanel.release', 'Release') : t('simplePanel.holdToSpeak', 'Hold')}</span>
      </button>
    </div>
  );
}
