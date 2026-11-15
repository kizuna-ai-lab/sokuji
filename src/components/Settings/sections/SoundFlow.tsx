// src/components/Settings/sections/SoundFlow.tsx
//
// The audio page's "where the sound goes" drawing (mock v18; the owner chose it for wide windows, 2026-11-15): my
// voice turned into speech for the other side through the virtual microphone, heard on my side too with "I hear it
// too", my own voice mixed under it with passthrough; the other side's voice turned into speech for me. Lines are lit
// while their switch is on and dashed while off; a side the mode does not use is greyed. Drawn in SVG at the mock's
// proportions; a label too long for its box is squeezed to fit (the page hides the drawing in narrow windows).
import { useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

export interface SoundFlowProps {
  /** The mode uses my side / the other side. */
  mine: boolean;
  theirs: boolean;
  /** The switches below: the translation the other side hears, I hear it too, the translation I hear. */
  otherHears: boolean;
  meToo: boolean;
  iHear: boolean;
  /** Passthrough's volume in percent while it is on, else null. */
  passthrough: number | null;
  /** There is a virtual microphone to mix my own voice into (absent: no passthrough line, as no Passthrough row). Default true. */
  virtualBus?: boolean;
}

const BOX_H = 34;

/** A labelled box; its text is squeezed to the box when it would overflow. */
function Box({ x, y, w, label }: { x: number; y: number; w: number; label: string }) {
  return (
    <g className="sound-flow__box">
      <rect x={x} y={y} width={w} height={BOX_H} rx={6} fill="none" stroke="currentColor" />
      <FitText x={x + w / 2} y={y + 21} max={w - 12}>{label}</FitText>
    </g>
  );
}

/** Text centred at x, never wider than `max`. */
function FitText({ x, y, max, children }: { x: number; y: number; max: number; children: string }) {
  const ref = useRef<SVGTextElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof el.getComputedTextLength !== 'function') return;
    el.removeAttribute('textLength');
    el.removeAttribute('lengthAdjust');
    if (el.getComputedTextLength() > max) {
      el.setAttribute('textLength', String(max));
      el.setAttribute('lengthAdjust', 'spacingAndGlyphs');
    }
  }, [children, max]);
  return <text ref={ref} x={x} y={y} textAnchor="middle" fill="currentColor">{children}</text>;
}

const tipRight = (x: number, y: number) => `${x},${y} ${x - 7},${y - 4} ${x - 7},${y + 4}`;
const tipDown = (x: number, y: number) => `${x},${y} ${x - 4},${y - 7} ${x + 4},${y - 7}`;

function Leg({ name, on, d, tip, label, lx, ly, max }: { name: string; on: boolean; d: string; tip: string; label: string; lx: number; ly: number; max: number }) {
  return (
    <g className={`sound-flow__leg ${on ? 'is-on' : 'is-off'}`} data-leg={name}>
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.6} />
      <polygon points={tip} fill="currentColor" />
      <FitText x={lx} y={ly} max={max}>{label}</FitText>
    </g>
  );
}

export function SoundFlow({ mine, theirs, otherHears, meToo, iHear, passthrough, virtualBus = true }: SoundFlowProps) {
  const { t } = useTranslation();
  const toSpeech = t('settingsPage.audio.flow.toSpeech', 'Into speech');
  const passthroughName = t('audioPanel.realVoicePassthrough', 'Passthrough');
  return (
    <figure className="sound-flow">
      <svg viewBox="0 0 660 170" role="img" aria-label={t('settingsPage.audio.flow.aria', 'Where the sound goes: what I say, turned into speech, goes into the virtual microphone for the other side, and plays on my side too when I hear it; what the other side says, turned into speech, plays on my playback device.')}>
        <g className={`sound-flow__side${mine ? '' : ' is-unused'}`} data-side="mine">
          <Box x={6} y={36} w={118} label={t('settingsPage.audio.flow.myMic', 'My microphone')} />
          <Box x={176} y={36} w={104} label={toSpeech} />
          <Box x={506} y={36} w={148} label={t('settingsPage.audio.flow.toThem', 'Virtual mic → the other side')} />
          <g className="sound-flow__leg is-on"><path d="M124 53H169" fill="none" stroke="currentColor" strokeWidth={1.6} /><polygon points={tipRight(176, 53)} fill="currentColor" /></g>
          <Leg name="otherHears" on={otherHears} d="M280 53H499" tip={tipRight(506, 53)} label={t('audioPanel.otherHears', 'Translation the other side hears')} lx={392} ly={46} max={210} />
          <Leg name="meToo" on={otherHears && meToo} d="M330 53V98H560V119" tip={tipDown(560, 126)} label={t('audioPanel.meToo', 'I hear it too')} lx={445} ly={92} max={200} />
          {virtualBus && (
            <Leg name="passthrough" on={otherHears && passthrough !== null} d="M65 36V14H600V29" tip={tipDown(600, 36)}
              label={passthrough !== null ? `${passthroughName} ${passthrough}%` : passthroughName} lx={330} ly={27} max={260} />
          )}
        </g>
        <g className={`sound-flow__side${theirs ? '' : ' is-unused'}`} data-side="theirs">
          <Box x={6} y={126} w={118} label={t('settingsPage.audio.flow.theirVoice', "The other side's voice")} />
          <Box x={176} y={126} w={104} label={toSpeech} />
          <g className="sound-flow__leg is-on"><path d="M124 143H169" fill="none" stroke="currentColor" strokeWidth={1.6} /><polygon points={tipRight(176, 143)} fill="currentColor" /></g>
          <Leg name="iHear" on={iHear} d="M280 143H499" tip={tipRight(506, 143)} label={t('audioPanel.iHear', 'Translation I hear')} lx={392} ly={158} max={210} />
        </g>
        <Box x={506} y={126} w={148} label={t('settingsPage.audio.flow.myDevice', 'My playback device')} />
      </svg>
      <figcaption>{t('settingsPage.audio.flow.caption', 'Where the sound goes. Lit lines are on now, dashed ones off; they follow the switches below.')}</figcaption>
    </figure>
  );
}
