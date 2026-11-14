// src/components/SettingsPage/DisplayCategory.tsx
//
// "Display": the main window and caption mode keep their own values (design
// B, section 13 point 9). A switch picks the surface; a preview above its
// controls shows every change at once (ruling 20).
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Minus, Plus } from 'lucide-react';
import {
  CONVERSATION_FONT_SIZE_MAX, CONVERSATION_FONT_SIZE_MIN, useConversationColours, useConversationDisplayStore,
} from '../../stores/conversationDisplayStore';
import { FONT_SIZE_MAX, FONT_SIZE_MIN, useSubtitleStore, type DisplayMode } from '../../stores/subtitleStore';
import useSettingsStore from '../../stores/settingsStore';
import DisplaySettingsPopover from '../Display/DisplaySettingsPopover';
import { useReadingTargets } from '../../lib/reading/useReadingTargets';
import { isElectron } from '../../utils/environment';
import { DisplayPreview, type PreviewValues } from './DisplayPreview';
import type { CategoryBodyProps } from './SettingsPage';

type Surface = 'conversation' | 'subtitle';
const STEP = 2;
const MODES: readonly DisplayMode[] = ['both', 'source', 'translation', 'none'];
const MODE_TITLES: Record<DisplayMode, string> = { both: 'Original and translation', source: 'Original only', translation: 'Translation only', none: 'Nothing' };

function useSurface(surface: Surface): PreviewValues & {
  setFontSize(n: number): void; setCompact(b: boolean): void; setMine(m: DisplayMode): void; setTheirs(m: DisplayMode): void; min: number; max: number;
} {
  const conv = useConversationDisplayStore();
  // The conversation's colours as it draws them: a colour left unset follows the background and the scheme.
  const drawn = useConversationColours();
  const sub = useSubtitleStore();
  const settings = useSettingsStore();
  if (surface === 'conversation') {
    return {
      fontSize: conv.fontSize, compact: conv.compactMode, mine: settings.speakerDisplayMode, theirs: settings.participantDisplayMode,
      bgColor: drawn.bgColor, sourceColor: drawn.sourceTextColor, translationColor: drawn.translationTextColor,
      setFontSize: (n) => void conv.setFontSize(n), setCompact: (b) => void conv.setCompactMode(b),
      setMine: (m) => void settings.setSpeakerDisplayMode(m), setTheirs: (m) => void settings.setParticipantDisplayMode(m),
      min: CONVERSATION_FONT_SIZE_MIN, max: CONVERSATION_FONT_SIZE_MAX,
    };
  }
  return {
    fontSize: sub.fontSize, compact: sub.compactMode, mine: sub.speakerDisplayMode, theirs: sub.participantDisplayMode,
    bgColor: sub.bgColor, sourceColor: sub.sourceTextColor, translationColor: sub.translationTextColor, bgOpacity: sub.bgOpacity,
    setFontSize: (n) => void sub.setFontSize(n), setCompact: (b) => void sub.setCompactMode(b),
    setMine: (m) => void sub.setSpeakerDisplayMode(m), setTheirs: (m) => void sub.setParticipantDisplayMode(m),
    min: FONT_SIZE_MIN, max: FONT_SIZE_MAX,
  };
}

export function DisplayCategory(_props: CategoryBodyProps) {
  const { t } = useTranslation();
  const [surface, setSurface] = useState<Surface>('conversation');
  const s = useSurface(surface);
  // Readings follow each surface's own rule: always in the main window; in caption mode on the desktop, not compact.
  const readingTargets = useReadingTargets();
  const readingsHere = surface === 'conversation' || (isElectron() && !s.compact) ? readingTargets : undefined;
  const modeSelect = (label: string, value: DisplayMode, onChange: (m: DisplayMode) => void) => (
    <label className="display-category__row">
      <span>{label}</span>
      <select className="select-dropdown" value={value} aria-label={label} onChange={(e) => onChange(e.target.value as DisplayMode)}>
        {MODES.map((m) => <option key={m} value={m}>{t(`settingsPage.display.modes.${m}`, MODE_TITLES[m])}</option>)}
      </select>
    </label>
  );
  return (
    <div className="display-category">
      <div className="display-category__surfaces" role="radiogroup" aria-label={t('settingsPage.display.surface', 'Which display')}
        onKeyDown={(e) => {
          // A radio group: the arrow keys move the choice and the focus; only the chosen one is in the tab order.
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
          e.preventDefault();
          const next: Surface = surface === 'conversation' ? 'subtitle' : 'conversation';
          setSurface(next);
          e.currentTarget.querySelector<HTMLButtonElement>(`[data-surface="${next}"]`)?.focus();
        }}>
        {(['conversation', 'subtitle'] as const).map((id) => (
          <button key={id} type="button" role="radio" aria-checked={surface === id} data-surface={id} tabIndex={surface === id ? 0 : -1}
            className={`display-category__surface${surface === id ? ' is-on' : ''}`} onClick={() => setSurface(id)}>
            {id === 'conversation' ? t('settingsPage.display.main', 'Main window') : t('settingsPage.display.captions', 'Caption mode')}
          </button>
        ))}
      </div>
      <DisplayPreview surface={surface} values={s} />
      {modeSelect(t('settingsPage.display.mine', 'What I say'), s.mine, s.setMine)}
      {modeSelect(t('settingsPage.display.theirs', 'What the other side says'), s.theirs, s.setTheirs)}
      <div className="display-category__row">
        <span>{t('settingsPage.display.fontSize', 'Text size')}</span>
        <span className="display-category__size">
          <button type="button" aria-label={t('settingsPage.display.smaller', 'Smaller text')} disabled={s.fontSize <= s.min} onClick={() => s.setFontSize(s.fontSize - STEP)}><Minus size={14} /></button>
          <output aria-live="polite">{s.fontSize}</output>
          <button type="button" aria-label={t('settingsPage.display.larger', 'Larger text')} disabled={s.fontSize >= s.max} onClick={() => s.setFontSize(s.fontSize + STEP)}><Plus size={14} /></button>
        </span>
      </div>
      <label className="display-category__row">
        <span>{t('settingsPage.display.compact', 'Compact view')}</span>
        <input type="checkbox" role="switch" checked={s.compact} onChange={(e) => s.setCompact(e.target.checked)} />
      </label>
      <DisplaySettingsPopover source={surface} readingTargets={readingsHere} />
    </div>
  );
}
