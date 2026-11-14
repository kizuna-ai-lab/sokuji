// src/components/SettingsPage/DisplayPreview.tsx
//
// Three fixed sample rows drawn with the values of one surface (the main
// window or caption mode): one of mine, one of the other side, one more with
// a translation. Fixed sample text, never the user's content.
import { useTranslation } from 'react-i18next';
import type { DisplayMode } from '../../stores/subtitleStore';

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
}

const SAMPLES = [
  { side: 'mine', source: 'Shall we start with the schedule?', translation: '我们先从日程开始吧？' },
  { side: 'theirs', source: '好的，下周三之前要定下来。', translation: 'Sure, it has to be settled before next Wednesday.' },
  { side: 'theirs', source: '测试的结果我稍后发给你。', translation: "I'll send you the test results later." },
] as const;

export function DisplayPreview({ surface, values: v }: { surface: 'conversation' | 'subtitle'; values: PreviewValues }) {
  const { t } = useTranslation();
  const opacity = surface === 'subtitle' && v.bgOpacity !== undefined ? v.bgOpacity / 100 : 1;
  return (
    <div
      className={`display-preview display-preview--${surface}${v.compact ? ' is-compact' : ''}`}
      data-testid="display-preview"
      data-font-size={v.fontSize}
      aria-label={t('settingsPage.display.preview', 'Preview')}
      style={{ fontSize: v.fontSize, background: v.bgColor ? `color-mix(in srgb, ${v.bgColor} ${Math.round(opacity * 100)}%, transparent)` : undefined }}
    >
      {SAMPLES.map((row, i) => {
        const mode = row.side === 'mine' ? v.mine : v.theirs;
        if (mode === 'none') return null;
        return (
          <div className={`display-preview__row display-preview__row--${row.side}`} key={i}>
            {(mode === 'both' || mode === 'source') && <div className="display-preview__source" style={{ color: v.sourceColor }}>{row.source}</div>}
            {(mode === 'both' || mode === 'translation') && <div className="display-preview__translation" style={{ color: v.translationColor }}>{row.translation}</div>}
          </div>
        );
      })}
    </div>
  );
}
