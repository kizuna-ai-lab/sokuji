// src/components/SettingsPage/DisplayPreview.tsx
//
// A fixed sample conversation drawn with one surface's values, in that
// surface's own markup: the main window's rows (avatar and name, a language
// badge, the text), and caption mode's floating box over another window — the
// same rows when expanded, the four bands when compact. Sample text in the
// user's languages (displaySamples.ts), never the user's content (the mock's
// display page, v18; B-22).
import { Fragment, useMemo, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { User, Users } from 'lucide-react';
import type { DisplayMode } from '../../stores/subtitleStore';
import { getHighlightOverlayForBg } from '../Subtitle/useSubtitleChrome';
import { readingLanguage } from '../../lib/reading/languages';
import { useReading } from '../../lib/reading/useReading';
import type { ReadingLanguage } from '../../lib/reading/types';
import { SAMPLE_LINES, badgeCode, type PreviewLanguages } from './displaySamples';
import '../MainPanel/ConversationRow.scss';
import '../Subtitle/SubtitleStream.scss';

export interface PreviewValues {
  fontSize: number;
  compact: boolean;
  mine: DisplayMode;
  theirs: DisplayMode;
  bgColor?: string;
  sourceColor?: string;
  translationColor?: string;
  /** Caption mode only, 0–100. */
  bgOpacity?: number;
  /** Caption mode only: the newest text lit as it arrives. */
  highlight?: boolean;
}

type Leg = 'speaker' | 'participant';
interface Sample {
  leg: Leg;
  time: string;
  source: { lang: string; text: string };
  translation: { lang: string; text: string };
}

/** The three lines, both sides of each: I ask in my language, they answer in theirs, I ask again. */
function samplesIn({ mine, theirs }: PreviewLanguages): readonly Sample[] {
  const m = SAMPLE_LINES[mine];
  const o = SAMPLE_LINES[theirs];
  return [
    { leg: 'speaker', time: '10:02', source: { lang: mine, text: m[0] }, translation: { lang: theirs, text: o[0] } },
    { leg: 'participant', time: '10:02', source: { lang: theirs, text: o[1] }, translation: { lang: mine, text: m[1] } },
    { leg: 'speaker', time: '10:03', source: { lang: mine, text: m[2] }, translation: { lang: theirs, text: o[2] } },
  ];
}

const shows = (mode: DisplayMode, side: 'source' | 'translation') => mode === 'both' || mode === side;

/** A line, with its readings when they are on for its language, read as the conversation's rows read theirs. */
function Text({ text, lang, readings }: { text: string; lang: string; readings?: ReadonlySet<ReadingLanguage> }) {
  const own = readingLanguage(lang);
  const pieces = useReading(text, own && readings?.has(own) ? own : null, false);
  if (!pieces) return <>{text}</>;
  return (
    <>
      {pieces.map((piece, i) => piece.reading === undefined
        ? <Fragment key={i}>{piece.text}</Fragment>
        : <ruby key={i}>{piece.text}<rt aria-hidden="true">{piece.reading}</rt></ruby>)}
    </>
  );
}

function Rows({ v, samples, readings }: { v: PreviewValues; samples: readonly Sample[]; readings?: ReadonlySet<ReadingLanguage> }) {
  const { t } = useTranslation();
  return (
    <>
      {samples.map((row, i) => {
        const mode = row.leg === 'speaker' ? v.mine : v.theirs;
        if (mode === 'none') return null;
        const name = t(row.leg === 'speaker' ? 'mainPanel.displayMode.speaker' : 'mainPanel.displayMode.participant', row.leg === 'speaker' ? 'Me' : 'Other');
        const sides = (['source', 'translation'] as const).filter((side) => shows(mode, side));
        return (
          <div key={i} className={`conversation-row source-${row.leg} with-header ${v.compact ? 'compact' : 'expanded'}`}>
            {!v.compact && (
              <div className="row-header">
                <div className={`row-avatar avatar-${row.leg}`}>{row.leg === 'speaker' ? <User size={12} /> : <Users size={12} />}</div>
                <div className="row-name"><span className="row-name-text">{name}</span><span className="row-time">{row.time}</span></div>
              </div>
            )}
            {sides.map((side, j) => (
              <div key={side} className="row-body">
                {v.compact && j === 0 && <span className={`row-role-dot source-${row.leg}`} role="img" aria-label={name} />}
                {!v.compact && <span className={`lang-badge ${side === 'translation' ? 'tr' : 'src'} source-${row.leg}`}>{badgeCode(row[side].lang)}</span>}
                <span className={`row-text ${side === 'translation' ? 'tr' : 'src'}`}><Text text={row[side].text} lang={row[side].lang} readings={readings} /></span>
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}

/**
 * Caption mode, compact: up to four bands, each leg's source and translation. A band shows its leg's latest
 * sentence alone, so it reads whole on one line at the default size (the real bands flow and keep the newest).
 */
function Bands({ v, samples }: { v: PreviewValues; samples: readonly Sample[] }) {
  const newest = samples.length - 1;
  const latest = (leg: Leg) => samples.reduce((at, row, i) => (row.leg === leg ? i : at), -1);
  const bands = (['speaker', 'participant'] as const).flatMap((leg) => {
    const mode = leg === 'speaker' ? v.mine : v.theirs;
    return (['source', 'translation'] as const).filter((side) => shows(mode, side)).map((side) => ({ leg, side }));
  });
  return (
    <div className="subtitle-stream compact" style={{ height: `calc(${bands.length * 1.4}em + ${Math.max(0, bands.length - 1) * 8 + 18}px)` }}>
      {bands.map(({ leg, side }) => (
        <div key={`${leg}-${side}`} className={`subtitle-stream__line subtitle-stream__line--${side} subtitle-stream__line--${leg}`}>
          <p>
            {samples.map((row, i) => i !== latest(leg) ? null : (
              <span key={i} className={`subtitle-stream__item${v.highlight && i === newest ? ' subtitle-stream__item--lit' : ''}`}>
                {row[side].text}
              </span>
            ))}
          </p>
        </div>
      ))}
    </div>
  );
}

export function DisplayPreview({ surface, values: v, languages, readings }: {
  surface: 'conversation' | 'subtitle';
  values: PreviewValues;
  /** The sample's two languages: mine and the other side's. */
  languages: PreviewLanguages;
  /** The reading languages to draw (the switch is on and this surface shows them); none when absent. */
  readings?: ReadonlySet<ReadingLanguage>;
}) {
  const { t } = useTranslation();
  const samples = useMemo(() => samplesIn(languages), [languages]);
  const caption = surface === 'subtitle';
  const empty = v.mine === 'none' && v.theirs === 'none';
  const opacity = caption && v.bgOpacity !== undefined ? v.bgOpacity : 100;
  const style: CSSProperties & Record<string, string | number> = { fontSize: v.fontSize, '--conversation-font-size': `${v.fontSize}px` };
  if (v.sourceColor) { style['--conversation-source-color'] = v.sourceColor; style['--subtitle-source-color'] = v.sourceColor; }
  if (v.translationColor) { style['--conversation-translation-color'] = v.translationColor; style['--subtitle-translation-color'] = v.translationColor; }
  if (v.bgColor) {
    style.background = caption ? `color-mix(in srgb, ${v.bgColor} ${opacity}%, transparent)` : v.bgColor;
    if (caption) style['--subtitle-highlight-overlay'] = getHighlightOverlayForBg(v.bgColor);
  }
  let body: ReactNode;
  if (empty) body = <div className="display-preview__empty">{t('settingsPage.display.empty', 'Nothing shows here now: both sides are set to “Nothing”.')}</div>;
  else if (caption && v.compact) body = <Bands v={v} samples={samples} />;
  else body = <div className="display-preview__rows"><Rows v={v} samples={samples} readings={readings} /></div>;
  const surfaceBox = <div className="display-preview__surface" style={style}>{body}</div>;
  return (
    <div
      className={`display-preview display-preview--${surface}`}
      data-testid="display-preview"
      data-font-size={v.fontSize}
    >
      <span className="display-preview__tag">
        {caption
          ? t('settingsPage.display.previewCaptions', 'Preview: caption mode, over another window')
          : t('settingsPage.display.previewMain', 'Preview: the conversation in the main window')}
      </span>
      {caption ? <div className="display-preview__backdrop">{surfaceBox}</div> : surfaceBox}
    </div>
  );
}
