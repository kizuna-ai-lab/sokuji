// src/components/Settings/sections/SoundFlow.tsx
//
// The audio page's "where the sound goes" drawing (mock v18; the owner chose it for wide windows, 2026-11-15): my
// voice translated, then made into speech for the other side through the virtual microphone, heard on my side too with
// "I hear it too", my own voice mixed under it with passthrough; the other side's voice translated, then made into
// speech for me. Translating and making speech are two steps (owner, 2026-11-15): with a side's speech switch off the
// translation is still made, only no speech, so the line between the two is dashed. Lines are lit while their switch is
// on and dashed while off; a side the mode does not use is greyed. Drawn in SVG; a label too long for its box is
// squeezed to fit (the page hides the drawing in narrow windows). A part with a setting below — my microphone, the
// other side's voice and the four switches' names — takes you to that setting when clicked or chosen with the keyboard
// (B-27), whatever the setting's state; it changes nothing itself.
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/** Where a part of the drawing takes you: a `navigateToSettings` target (the page scrolls to `#<target>-section`). */
export type SoundFlowTarget = 'microphone' | 'participant' | 'speech-other-hears' | 'speech-me-too' | 'speech-passthrough' | 'speech-i-hear';

export interface SoundFlowProps {
  /** The mode uses my side / the other side. */
  mine: boolean;
  theirs: boolean;
  /** The switches below: the translation the other side hears, I hear it too, the translation I hear. */
  otherHears: boolean;
  meToo: boolean;
  iHear: boolean;
  /** Passthrough is on, and its volume in percent — named on the drawing either way, as its row shows it (B-28). */
  passthroughOn: boolean;
  passthroughPercent: number;
  /** There is a virtual microphone to mix my own voice into (absent: no passthrough line, as no Passthrough row). Default true. */
  virtualBus?: boolean;
  /** Takes you to a part's setting; absent, the drawing is a picture only. */
  onGo?: (target: SoundFlowTarget) => void;
}

/** A part that takes you to its setting: a button in the drawing, its hover tip saying where it goes. */
function Go({ target, name, onGo, children }: { target: SoundFlowTarget; name: string; onGo?: (target: SoundFlowTarget) => void; children: ReactNode }) {
  const { t } = useTranslation();
  if (!onGo) return <>{children}</>;
  const label = t('settingsPage.audio.flow.goTo', 'Go to the “{{name}}” setting', { name });
  return (
    <g className="sound-flow__go" role="button" tabIndex={0} aria-label={label}
      onClick={() => onGo(target)}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        onGo(target);
      }}>
      <title>{label}</title>
      {children}
    </g>
  );
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

interface LegGo { target: SoundFlowTarget; name: string; onGo?: (target: SoundFlowTarget) => void }

function Leg({ name, on, d, tip, label, lx = 0, ly = 0, max = 0, go }: { name: string; on: boolean; d: string; tip: string; label?: string; lx?: number; ly?: number; max?: number; go?: LegGo }) {
  const text = label !== undefined && <FitText x={lx} y={ly} max={max}>{label}</FitText>;
  return (
    <g className={`sound-flow__leg ${on ? 'is-on' : 'is-off'}`} data-leg={name}>
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.6} />
      <polygon points={tip} fill="currentColor" />
      {go && text ? <Go {...go}>{text}</Go> : text}
    </g>
  );
}

/** A line that is always on (the voice into its translation). */
const Feed = ({ y }: { y: number }) => (
  <g className="sound-flow__leg is-on"><path d={`M116 ${y}H129`} fill="none" stroke="currentColor" strokeWidth={1.6} /><polygon points={tipRight(136, y)} fill="currentColor" /></g>
);

export function SoundFlow({ mine, theirs, otherHears, meToo, iHear, passthroughOn, passthroughPercent, virtualBus = true, onGo }: SoundFlowProps) {
  const { t } = useTranslation();
  const translate = t('settingsPage.audio.flow.translate', 'Translate');
  const speech = t('settingsPage.audio.flow.speech', 'Speech');
  const passthroughName = t('audioPanel.realVoicePassthrough', 'Passthrough');
  const myMic = t('settingsPage.audio.flow.myMic', 'My microphone');
  const theirVoice = t('settingsPage.audio.flow.theirVoice', "The other side's voice");
  const otherHearsName = t('audioPanel.otherHears', 'Translation the other side hears');
  const meTooName = t('audioPanel.meToo', 'I hear it too');
  const iHearName = t('audioPanel.iHear', 'Translation I hear');
  return (
    <figure className="sound-flow">
      {/* A picture while nothing in it can be chosen; a group of its parts once they take you to their settings. */}
      <svg viewBox="0 0 660 170" role={onGo ? 'group' : 'img'} aria-label={t('settingsPage.audio.flow.ariaSteps', 'Where the sound goes: what I say is translated, then made into speech that goes into the virtual microphone for the other side, and plays on my side too when I hear it; what the other side says is translated, then made into speech that plays on my playback device. With a speech switch off, the translation is made but not spoken.')}>
        <g className={`sound-flow__side${mine ? '' : ' is-unused'}`} data-side="mine">
          <Go target="microphone" name={myMic} onGo={onGo}><Box x={6} y={36} w={110} label={myMic} /></Go>
          <Box x={136} y={36} w={72} label={translate} />
          <Box x={230} y={36} w={100} label={speech} />
          <Box x={506} y={36} w={148} label={t('settingsPage.audio.flow.toThem', 'Virtual mic → the other side')} />
          <Feed y={53} />
          <Leg name="mineSpeech" on={otherHears} d="M208 53H223" tip={tipRight(230, 53)} />
          <Leg name="otherHears" on={otherHears} d="M330 53H499" tip={tipRight(506, 53)} label={otherHearsName} lx={418} ly={46} max={160}
            go={{ target: 'speech-other-hears', name: otherHearsName, onGo }} />
          <Leg name="meToo" on={otherHears && meToo} d="M380 53V98H560V119" tip={tipDown(560, 126)} label={meTooName} lx={470} ly={92} max={170}
            go={{ target: 'speech-me-too', name: meTooName, onGo }} />
          {virtualBus && (
            <Leg name="passthrough" on={otherHears && passthroughOn} d="M61 36V14H600V29" tip={tipDown(600, 36)}
              label={`${passthroughName} ${passthroughPercent}%`} lx={330} ly={27} max={260}
              go={{ target: 'speech-passthrough', name: passthroughName, onGo }} />
          )}
        </g>
        <g className={`sound-flow__side${theirs ? '' : ' is-unused'}`} data-side="theirs">
          <Go target="participant" name={theirVoice} onGo={onGo}><Box x={6} y={126} w={110} label={theirVoice} /></Go>
          <Box x={136} y={126} w={72} label={translate} />
          <Box x={230} y={126} w={100} label={speech} />
          <Feed y={143} />
          <Leg name="theirSpeech" on={iHear} d="M208 143H223" tip={tipRight(230, 143)} />
          <Leg name="iHear" on={iHear} d="M330 143H499" tip={tipRight(506, 143)} label={iHearName} lx={418} ly={158} max={160}
            go={{ target: 'speech-i-hear', name: iHearName, onGo }} />
        </g>
        <Box x={506} y={126} w={148} label={t('settingsPage.audio.flow.myDevice', 'My playback device')} />
      </svg>
      <figcaption>{t('settingsPage.audio.flow.caption', 'Where the sound goes. Lit lines are on now, dashed ones off; they follow the switches below.')}</figcaption>
    </figure>
  );
}
