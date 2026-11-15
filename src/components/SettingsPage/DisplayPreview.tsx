// src/components/SettingsPage/DisplayPreview.tsx
//
// A fixed sample conversation drawn with one surface's values, in that
// surface's own markup: the main window's rows (avatar and name, a language
// badge, the text), and caption mode's floating box over another window — the
// same rows when expanded, the four bands when compact. Fixed sample text,
// never the user's content (the mock's display page, v18).
import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { User, Users } from 'lucide-react';
import type { DisplayMode } from '../../stores/subtitleStore';
import { getHighlightOverlayForBg } from '../Subtitle/useSubtitleChrome';
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

/** Plain text, or a word with its reading above it. */
type Piece = string | readonly [base: string, reading: string];
type Leg = 'speaker' | 'participant';
interface Sample {
  leg: Leg;
  time: string;
  source: { lang: string; text: readonly Piece[] };
  translation: { lang: string; text: readonly Piece[] };
}

// The mock's sample: Chinese on my side, Japanese on the other, with the Japanese readings.
const SAMPLES: readonly Sample[] = [
  {
    leg: 'speaker', time: '10:02',
    source: { lang: 'zh', text: ['下周三之前能交货吗？'] },
    translation: { lang: 'ja', text: [['来週', 'らいしゅう'], 'の', ['水曜日', 'すいようび'], 'までに', ['納品', 'のうひん'], 'できますか？'] },
  },
  {
    leg: 'participant', time: '10:02',
    source: { lang: 'ja', text: [['認証試験', 'にんしょうしけん'], 'の', ['結果次第', 'けっかしだい'], 'です。'] },
    translation: { lang: 'zh', text: ['要看认证测试的结果。'] },
  },
  {
    leg: 'speaker', time: '10:03',
    source: { lang: 'zh', text: ['结果什么时候出来？'] },
    translation: { lang: 'ja', text: [['結果', 'けっか'], 'はいつ', ['出', 'で'], 'ますか？'] },
  },
];

const shows = (mode: DisplayMode, side: 'source' | 'translation') => mode === 'both' || mode === side;

function Text({ pieces, ruby }: { pieces: readonly Piece[]; ruby: boolean }) {
  return (
    <>
      {pieces.map((p, i) => typeof p === 'string'
        ? p
        : ruby ? <ruby key={i}>{p[0]}<rt>{p[1]}</rt></ruby> : p[0])}
    </>
  );
}

function Rows({ v, ruby }: { v: PreviewValues; ruby: boolean }) {
  const { t } = useTranslation();
  return (
    <>
      {SAMPLES.map((row, i) => {
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
                {!v.compact && <span className={`lang-badge ${side === 'translation' ? 'tr' : 'src'} source-${row.leg}`}>{row[side].lang.toUpperCase()}</span>}
                <span className={`row-text ${side === 'translation' ? 'tr' : 'src'}`}><Text pieces={row[side].text} ruby={ruby} /></span>
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
function Bands({ v }: { v: PreviewValues }) {
  const newest = SAMPLES.length - 1;
  const latest = (leg: Leg) => SAMPLES.reduce((at, row, i) => (row.leg === leg ? i : at), -1);
  const bands = (['speaker', 'participant'] as const).flatMap((leg) => {
    const mode = leg === 'speaker' ? v.mine : v.theirs;
    return (['source', 'translation'] as const).filter((side) => shows(mode, side)).map((side) => ({ leg, side }));
  });
  return (
    <div className="subtitle-stream compact" style={{ height: `calc(${bands.length * 1.4}em + ${Math.max(0, bands.length - 1) * 8 + 18}px)` }}>
      {bands.map(({ leg, side }) => (
        <div key={`${leg}-${side}`} className={`subtitle-stream__line subtitle-stream__line--${side} subtitle-stream__line--${leg}`}>
          <p>
            {SAMPLES.map((row, i) => i !== latest(leg) ? null : (
              <span key={i} className={`subtitle-stream__item${v.highlight && i === newest ? ' subtitle-stream__item--lit' : ''}`}>
                <Text pieces={row[side].text} ruby={false} />
              </span>
            ))}
          </p>
        </div>
      ))}
    </div>
  );
}

export function DisplayPreview({ surface, values: v, ruby = false }: {
  surface: 'conversation' | 'subtitle';
  values: PreviewValues;
  /** Draw the Japanese readings (the switch is on and this surface shows them). */
  ruby?: boolean;
}) {
  const { t } = useTranslation();
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
  else if (caption && v.compact) body = <Bands v={v} />;
  else body = <div className="display-preview__rows"><Rows v={v} ruby={ruby} /></div>;
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
