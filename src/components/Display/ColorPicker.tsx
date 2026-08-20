import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Hsv, hexToHsv, hsvToHex, normalizeHex } from '../../utils/color';
import './ColorPicker.scss';

/**
 * A self-contained HSV color picker: a saturation/brightness area, a hue
 * slider and a hex field.
 *
 * This replaces `<input type="color">`, which delegates to the *OS* color
 * dialog. On Linux that is GTK's chooser, which opens on a fixed grid of
 * preset shades and hides free selection behind a "+ Custom" button most
 * users never find — so the app appeared to only offer variants of a handful
 * of colors. Drawing the picker ourselves also makes the three surfaces
 * (Electron, extension side panel, web) behave identically.
 *
 * `onChange` fires continuously while the user drags. Callers are expected to
 * debounce before persisting.
 */
export interface ColorPickerProps {
  /** Current color as `#rrggbb`. */
  value: string;
  onChange: (hex: string) => void;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

const STEP = 1;
const COARSE_STEP = 10;

const ColorPicker: React.FC<ColorPickerProps> = ({ value, onChange }) => {
  const { t } = useTranslation();

  const initialHex = normalizeHex(value) ?? '#000000';
  // hsv is mirrored into a ref so the window-level pointer listeners below
  // read current state without being re-registered on every move.
  const hsvRef = useRef<Hsv>(hexToHsv(initialHex));
  const [hsv, setHsvState] = useState<Hsv>(hsvRef.current);
  const [hexText, setHexText] = useState<string>(initialHex);
  // The last hex this component pushed out. Used to tell our own echo apart
  // from a genuine outside change (preset chip clicked, store hydrated).
  const lastEmittedRef = useRef<string>(initialHex);
  // Refreshed in a layout effect, not during render: React may render and
  // discard, and a render-phase write would leak that abandoned render's
  // callback to the committed pointer/keyboard handlers below. useLayoutEffect
  // (not useEffect) so it is current before any event can fire after a commit.
  const onChangeRef = useRef(onChange);
  useLayoutEffect(() => {
    onChangeRef.current = onChange;
  });

  const setHsv = useCallback((next: Hsv) => {
    hsvRef.current = next;
    setHsvState(next);
  }, []);

  /** Adopt a color without emitting it — used for outside-driven updates. */
  const adopt = useCallback(
    (normalized: string) => {
      const next = hexToHsv(normalized);
      // Black, white and the grays carry no hue of their own. Keep the slider
      // where the user left it, so sliding saturation back up returns to their
      // hue instead of snapping to red.
      if (next.s === 0) next.h = hsvRef.current.h;
      setHsv(next);
      setHexText(normalized);
      lastEmittedRef.current = normalized;
    },
    [setHsv],
  );

  const emit = useCallback(
    (next: Hsv) => {
      setHsv(next);
      const hex = hsvToHex(next);
      setHexText(hex);
      lastEmittedRef.current = hex;
      onChangeRef.current(hex);
    },
    [setHsv],
  );

  useEffect(() => {
    const normalized = normalizeHex(value) ?? '#000000';
    if (normalized === lastEmittedRef.current) return;
    adopt(normalized);
  }, [value, adopt]);

  // ── Saturation / brightness area ──

  const areaRef = useRef<HTMLDivElement>(null);

  const applyFromPoint = useCallback(
    (clientX: number, clientY: number) => {
      const rect = areaRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) return;
      emit({
        ...hsvRef.current,
        s: clamp(((clientX - rect.left) / rect.width) * 100, 0, 100),
        v: clamp(100 - ((clientY - rect.top) / rect.height) * 100, 0, 100),
      });
    },
    [emit],
  );

  // Tracked on the window rather than via setPointerCapture so a drag that
  // runs off the edge of the small area keeps updating instead of freezing.
  //
  // That window is deliberately NOT the bare global. On Electron, SubtitleBar
  // hosts this popover in a separate child window and reaches it through
  // createPortal, so the DOM lives in that window while this module's code
  // keeps running in the parent window's realm. Pointer events raised in the
  // child never reach the parent's `window`, so a bare listener would leave
  // the drag dead on exactly the surface this picker was built for.
  const detachRef = useRef<(() => void) | null>(null);
  useEffect(() => () => detachRef.current?.(), []);

  const onAreaPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      areaRef.current?.focus();
      applyFromPoint(e.clientX, e.clientY);

      const view = areaRef.current?.ownerDocument.defaultView ?? window;
      detachRef.current?.();
      const move = (ev: MouseEvent) => {
        // A release that happens outside the window never reaches us as a
        // pointerup, which would leave this listener armed and repaint the
        // color on plain hover once the pointer came back. No button held
        // means the drag is already over.
        if (ev.buttons === 0) {
          detachRef.current?.();
          return;
        }
        applyFromPoint(ev.clientX, ev.clientY);
      };
      const up = () => detachRef.current?.();
      detachRef.current = () => {
        view.removeEventListener('pointermove', move);
        view.removeEventListener('pointerup', up);
        view.removeEventListener('pointercancel', up);
        detachRef.current = null;
      };
      view.addEventListener('pointermove', move);
      view.addEventListener('pointerup', up);
      view.addEventListener('pointercancel', up);
    },
    [applyFromPoint],
  );

  const onAreaKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const step = e.shiftKey ? COARSE_STEP : STEP;
      const { h, s, v } = hsvRef.current;
      let next: Hsv | null = null;
      switch (e.key) {
        case 'ArrowLeft': next = { h, s: clamp(s - step, 0, 100), v }; break;
        case 'ArrowRight': next = { h, s: clamp(s + step, 0, 100), v }; break;
        case 'ArrowDown': next = { h, s, v: clamp(v - step, 0, 100) }; break;
        case 'ArrowUp': next = { h, s, v: clamp(v + step, 0, 100) }; break;
        case 'Home': next = { h, s: 0, v: 100 }; break;
        case 'End': next = { h, s: 100, v: 100 }; break;
        default: return;
      }
      e.preventDefault();
      emit(next);
    },
    [emit],
  );

  // ── Hex field ──

  const onHexChange = useCallback(
    (raw: string) => {
      setHexText(raw);
      const normalized = normalizeHex(raw);
      // Commit only a complete 6-digit value while typing: "#7f3ac1" passes
      // through "#7f3", a legal shorthand that would flash an unrelated color
      // mid-keystroke. Shorthand is still honoured on blur / Enter.
      if (normalized && raw.trim().replace(/^#/, '').length === 6) {
        adopt(normalized);
        onChangeRef.current(normalized);
      }
    },
    [adopt],
  );

  const commitHexText = useCallback(() => {
    const normalized = normalizeHex(hexText);
    if (!normalized) {
      setHexText(hsvToHex(hsvRef.current));
      return;
    }
    if (normalized === lastEmittedRef.current) {
      setHexText(normalized);
      return;
    }
    adopt(normalized);
    onChangeRef.current(normalized);
  }, [hexText, adopt]);

  const currentHex = hsvToHex(hsv);
  const hueHex = hsvToHex({ h: hsv.h, s: 100, v: 100 });
  const hueDegrees = Math.round(hsv.h);

  return (
    <div className="color-picker">
      <div
        ref={areaRef}
        className="color-picker__area"
        style={{ backgroundColor: hueHex }}
        role="slider"
        tabIndex={0}
        aria-label={t('subtitle.settings.colorArea', 'Saturation and brightness')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(hsv.s)}
        aria-valuetext={currentHex}
        onPointerDown={onAreaPointerDown}
        onKeyDown={onAreaKeyDown}
      >
        <div
          className="color-picker__thumb"
          style={{
            left: `${hsv.s}%`,
            top: `${100 - hsv.v}%`,
            backgroundColor: currentHex,
          }}
        />
      </div>

      <input
        type="range"
        className="color-picker__hue"
        min={0}
        max={360}
        step={1}
        value={hueDegrees}
        aria-label={t('subtitle.settings.colorHue', 'Hue')}
        onChange={(e) => emit({ ...hsvRef.current, h: Number(e.target.value) })}
      />

      <div className="color-picker__hex">
        <span
          className="color-picker__preview"
          style={{ backgroundColor: currentHex }}
          aria-hidden="true"
        />
        <input
          type="text"
          className="color-picker__hex-input"
          value={hexText}
          spellCheck={false}
          autoComplete="off"
          maxLength={7}
          placeholder="#RRGGBB"
          aria-label={t('subtitle.settings.colorHex', 'Hex color value')}
          onChange={(e) => onHexChange(e.target.value)}
          onBlur={commitHexText}
          onKeyDown={(e) => {
            // Enter also terminates an IME composition. Treating that as a
            // submit would reset the field out from under a user who was
            // mid-candidate — likely here, since CJK users often have an IME
            // armed in every text field.
            if (e.nativeEvent.isComposing) return;
            if (e.key === 'Enter') {
              e.preventDefault();
              commitHexText();
            }
          }}
        />
      </div>
    </div>
  );
};

export default ColorPicker;
