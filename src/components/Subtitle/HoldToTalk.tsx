import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Mic } from 'lucide-react';

/** The keys that hold the button while it has focus (plan 1e-4 ruling 9). */
const HOLD_KEYS = new Set([' ', 'Enter']);

export interface UseHoldToTalkArgs {
  onPress: () => void;
  onRelease: () => void;
  /**
   * Told whenever `held` changes — begin and end, whichever of pointer,
   * keyboard, blur or unmount caused it. Lets a container (the overlay's
   * bar) keep itself visible for as long as a turn is held (follow-up D).
   */
  onHeldChange?: (held: boolean) => void;
}

/**
 * Hold to talk's own logic, over any button: pointer down presses; up, leave
 * and cancel release — dragging off the button must release, which today's
 * panel button does not do. While it has focus, Space or Enter held down
 * holds it too (plan 1e-4 ruling 9). A held button that goes away, or loses
 * focus, releases. After every release the button gives up focus: the
 * overlay sits inside a meeting page, and a focused button would take the
 * page's own Space — Google Meet's push-to-unmute — as a hold of Sokuji's.
 *
 * Pulled out of the `HoldToTalk` component (plan follow-up D) so the
 * overlay's bar can render its own button over the same behaviour, with
 * nothing duplicated.
 */
export function useHoldToTalk({ onPress, onRelease, onHeldChange }: UseHoldToTalkArgs) {
  const [held, setHeld] = useState(false);
  const heldRef = useRef(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const releaseRef = useRef(onRelease);
  releaseRef.current = onRelease;
  const heldChangeRef = useRef(onHeldChange);
  heldChangeRef.current = onHeldChange;
  const begin = () => {
    if (heldRef.current) return;
    heldRef.current = true;
    setHeld(true);
    heldChangeRef.current?.(true);
    onPress();
  };
  const end = () => {
    if (!heldRef.current) return;
    heldRef.current = false;
    setHeld(false);
    heldChangeRef.current?.(false);
    onRelease();
    // Hand the keyboard back (choice 4). The blur fires `onBlur`, which finds nothing held.
    buttonRef.current?.blur();
  };
  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    // A right- or middle-click can lose its pointerup to a context menu or
    // scroll gesture; only the primary mouse button presses. Touch and pen
    // have no meaningful `button` outside the primary contact, so this only
    // narrows `pointerType === 'mouse'`.
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    begin();
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!HOLD_KEYS.has(event.key)) return;
    // The key holds; it does not also activate the button or scroll.
    event.preventDefault();
    // A held key's auto-repeat finds the button held already.
    begin();
  };
  const onKeyUp = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!HOLD_KEYS.has(event.key)) return;
    event.preventDefault();
    end();
  };
  useEffect(() => () => {
    if (heldRef.current) {
      heldRef.current = false;
      heldChangeRef.current?.(false);
      releaseRef.current();
    }
  }, []);
  return {
    held,
    buttonRef,
    buttonProps: {
      onPointerDown,
      onPointerUp: end,
      onPointerLeave: end,
      onPointerCancel: end,
      onKeyDown,
      onKeyUp,
      // A key hold whose keyup went elsewhere would strand the turn (choice 4; the panel's usePushToTalk does the same).
      onBlur: end,
    },
  };
}

/**
 * Hold to talk, on the extension overlay: a button in the overlay's bar
 * (plan follow-up D — it used to sit under the bands, in its own row). The
 * hold behaviour is `useHoldToTalk`'s; this component only renders the bar's
 * button markup over it.
 */
export function HoldToTalk({ onPress, onRelease, onHeldChange }: UseHoldToTalkArgs) {
  const { t } = useTranslation();
  const { held, buttonRef, buttonProps } = useHoldToTalk({ onPress, onRelease, onHeldChange });
  const label = held ? t('simplePanel.release', 'Release') : t('simplePanel.holdToSpeak', 'Hold');
  return (
    <button
      ref={buttonRef}
      type="button"
      className={`subtitle-bar__hold${held ? ' is-held' : ''}`}
      aria-pressed={held}
      title={label}
      aria-label={label}
      {...buttonProps}
    >
      <Mic size={14} />
      <span className="subtitle-bar__hold-label">{label}</span>
    </button>
  );
}
