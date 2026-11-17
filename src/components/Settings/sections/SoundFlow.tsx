// src/components/Settings/sections/SoundFlow.tsx
//
// The audio page's "where the sound goes" drawing (mock v18; the owner chose it for wide windows, 2026-11-15): my
// voice translated, then made into speech for the other side through the virtual microphone, heard on my side too with
// "I hear it too", my own voice mixed under it with passthrough; the other side's voice translated, then made into
// speech for me. Translating and making speech are two steps (owner, 2026-11-15): with a side's speech switch off the
// translation is still made, only no speech, so the line between the two is dashed. Lines are lit while their switch is
// on and dashed while off; a side the mode does not use is greyed. Drawn in SVG; a label too long for its box is
// squeezed to fit (the page hides the drawing in narrow windows).
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

function Leg({ name, on, d, tip, label, lx = 0, ly = 0, max = 0 }: { name: string; on: boolean; d: string; tip: string; label?: string; lx?: number; ly?: number; max?: number }) {
  return (
    <g className={`sound-flow__leg ${on ? 'is-on' : 'is-off'}`} data-leg={name}>
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.6} />
      <polygon points={tip} fill="currentColor" />
      {label !== undefined && <FitText x={lx} y={ly} max={max}>{label}</FitText>}
    </g>
  );
}

/** A line that is always on (the voice into its translation). */
const Feed = ({ y }: { y: number }) => (
  <g className="sound-flow__leg is-on"><path d={`M116 ${y}H129`} fill="none" stroke="currentColor" strokeWidth={1.6} /><polygon points={tipRight(136, y)} fill="currentColor" /></g>
);

export function SoundFlow({ mine, theirs, otherHears, meToo, iHear, passthrough, virtualBus = true }: SoundFlowProps) {
  const { t } = useTranslation();
  const translate = t('settingsPage.audio.flow.translate', 'Translate');
  const speech = t('settingsPage.audio.flow.speech', 'Speech');
  const passthroughName = t('audioPanel.realVoicePassthrough', 'Passthrough');
  return (
    <figure className="sound-flow">
      <svg viewBox="0 0 660 170" role="img" aria-label={t('settingsPage.audio.flow.ariaSteps', 'Where the sound goes: what I say is translated, then made into speech that goes into the virtual microphone for the other side, and plays on my side too when I hear it; what the other side says is translated, then made into speech that plays on my playback device. With a speech switch off, the translation is made but not spoken.')}>
        <g className={`sound-flow__side${mine ? '' : ' is-unused'}`} data-side="mine">
          <Box x={6} y={36} w={110} label={t('settingsPage.audio.flow.myMic', 'My microphone')} />
          <Box x={136} y={36} w={72} label={translate} />
          <Box x={230} y={36} w={100} label={speech} />
          <Box x={506} y={36} w={148} label={t('settingsPage.audio.flow.toThem', 'Virtual mic → the other side')} />
          <Feed y={53} />
          <Leg name="mineSpeech" on={otherHears} d="M208 53H223" tip={tipRight(230, 53)} />
          <Leg name="otherHears" on={otherHears} d="M330 53H499" tip={tipRight(506, 53)} label={t('audioPanel.otherHears', 'Translation the other side hears')} lx={418} ly={46} max={160} />
          <Leg name="meToo" on={otherHears && meToo} d="M380 53V98H560V119" tip={tipDown(560, 126)} label={t('audioPanel.meToo', 'I hear it too')} lx={470} ly={92} max={170} />
          {virtualBus && (
            <Leg name="passthrough" on={otherHears && passthrough !== null} d="M61 36V14H600V29" tip={tipDown(600, 36)}
              label={passthrough !== null ? `${passthroughName} ${passthrough}%` : passthroughName} lx={330} ly={27} max={260} />
          )}
        </g>
        <g className={`sound-flow__side${theirs ? '' : ' is-unused'}`} data-side="theirs">
          <Box x={6} y={126} w={110} label={t('settingsPage.audio.flow.theirVoice', "The other side's voice")} />
          <Box x={136} y={126} w={72} label={translate} />
          <Box x={230} y={126} w={100} label={speech} />
          <Feed y={143} />
          <Leg name="theirSpeech" on={iHear} d="M208 143H223" tip={tipRight(230, 143)} />
          <Leg name="iHear" on={iHear} d="M330 143H499" tip={tipRight(506, 143)} label={t('audioPanel.iHear', 'Translation I hear')} lx={418} ly={158} max={160} />
        </g>
        <Box x={506} y={126} w={148} label={t('settingsPage.audio.flow.myDevice', 'My playback device')} />
      </svg>
      <figcaption>{t('settingsPage.audio.flow.caption', 'Where the sound goes. Lit lines are on now, dashed ones off; they follow the switches below.')}</figcaption>
    </figure>
  );
}
