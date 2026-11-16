// src/components/SettingsPage/DisplayCategory.tsx
//
// "Display": the main window and caption mode keep their own values (design
// B, section 13 point 9). A switch picks the surface; a preview above its
// controls shows every change at once (ruling 20). The rows are the mock's
// (v18): each side's four choices side by side, A− size A+, switches, and the
// colour rows inline.
import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CONVERSATION_FONT_SIZE_MAX, CONVERSATION_FONT_SIZE_MIN, useConversationColours, useConversationDisplayStore,
} from '../../stores/conversationDisplayStore';
import { FONT_SIZE_MAX, FONT_SIZE_MIN, useSubtitleStore, type DisplayMode } from '../../stores/subtitleStore';
import useSettingsStore from '../../stores/settingsStore';
import DisplaySettingsPopover from '../Display/DisplaySettingsPopover';
import ToggleSwitch from '../Settings/shared/ToggleSwitch';
import { useReadingTargets } from '../../lib/reading/useReadingTargets';
import { isElectron } from '../../utils/environment';
import { DisplayPreview, type PreviewValues } from './DisplayPreview';
import { previewLanguages } from './displaySamples';
import { useProviderStore } from '../../stores/providerStore';
import type { CategoryBodyProps } from './SettingsPage';

type Surface = 'conversation' | 'subtitle';
const STEP = 2;
// The mock's order: both, then the translation alone, the original alone, nothing.
const MODES: readonly DisplayMode[] = ['both', 'translation', 'source', 'none'];
const MODE_TITLES: Record<DisplayMode, string> = { both: 'Original and translation', source: 'Original only', translation: 'Translation only', none: 'Nothing' };

function useSurface(surface: Surface): PreviewValues & {
  showReadings: boolean;
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
      bgColor: drawn.bgColor, sourceColor: drawn.sourceTextColor, translationColor: drawn.translationTextColor, showReadings: conv.showReadings,
      setFontSize: (n) => void conv.setFontSize(n), setCompact: (b) => void conv.setCompactMode(b),
      setMine: (m) => void settings.setSpeakerDisplayMode(m), setTheirs: (m) => void settings.setParticipantDisplayMode(m),
      min: CONVERSATION_FONT_SIZE_MIN, max: CONVERSATION_FONT_SIZE_MAX,
    };
  }
  return {
    fontSize: sub.fontSize, compact: sub.compactMode, mine: sub.speakerDisplayMode, theirs: sub.participantDisplayMode,
    bgColor: sub.bgColor, sourceColor: sub.sourceTextColor, translationColor: sub.translationTextColor, bgOpacity: sub.bgOpacity,
    highlight: sub.newItemHighlightEnabled, showReadings: sub.showReadings,
    setFontSize: (n) => void sub.setFontSize(n), setCompact: (b) => void sub.setCompactMode(b),
    setMine: (m) => void sub.setSpeakerDisplayMode(m), setTheirs: (m) => void sub.setParticipantDisplayMode(m),
    min: FONT_SIZE_MIN, max: FONT_SIZE_MAX,
  };
}

/** One side's four choices, side by side. */
function SideRow({ label, value, onChange }: { label: string; value: DisplayMode; onChange: (m: DisplayMode) => void }) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <div className="display-category__row">
      <span id={id}>{label}</span>
      <span className="settings-seg" role="group" aria-labelledby={id}>
        {MODES.map((m) => (
          <button key={m} type="button" aria-pressed={value === m} onClick={() => onChange(m)}>
            {t(`settingsPage.display.modes.${m}`, MODE_TITLES[m])}
          </button>
        ))}
      </span>
    </div>
  );
}

export function DisplayCategory(_props: CategoryBodyProps) {
  const { t, i18n } = useTranslation();
  const [surface, setSurface] = useState<Surface>('conversation');
  const s = useSurface(surface);
  // Readings follow each surface's own rule: always in the main window; in caption mode on the desktop, not compact.
  const readingTargets = useReadingTargets();
  const readingsHere = surface === 'conversation' || (isElectron() && !s.compact) ? readingTargets : undefined;
  // The sample speaks the selected provider's pair, as the surfaces do (B-22); a side without a sample takes the
  // interface language.
  const source = useProviderStore((st) => (st.selected ? st.entries[st.selected]?.pair?.source ?? null : null));
  const target = useProviderStore((st) => (st.selected ? st.entries[st.selected]?.pair?.target ?? null : null));
  const ui = i18n.resolvedLanguage ?? i18n.language;
  const languages = useMemo(() => previewLanguages(source && target ? { source, target } : null, ui), [source, target, ui]);
  const compactLabel = t('settingsPage.display.compact', 'Compact view');
  return (
    <div className="display-category">
      <div className="settings-seg display-category__surfaces" role="radiogroup" aria-label={t('settingsPage.display.surface', 'Which display')}
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
            onClick={() => setSurface(id)}>
            {id === 'conversation' ? t('settingsPage.display.main', 'Main window') : t('settingsPage.display.captions', 'Caption mode')}
          </button>
        ))}
      </div>
      <DisplayPreview surface={surface} values={s} languages={languages} readings={s.showReadings ? readingsHere : undefined} />
      <div className="display-category__rows">
        <SideRow label={t('settingsPage.display.mineSide', 'What my side shows')} value={s.mine} onChange={s.setMine} />
        <SideRow label={t('settingsPage.display.theirsSide', 'What the other side shows')} value={s.theirs} onChange={s.setTheirs} />
        <div className="display-category__row">
          <span>{t('settingsPage.display.fontSize', 'Text size')}</span>
          <span className="display-category__size">
            <button type="button" aria-label={t('settingsPage.display.smaller', 'Smaller text')} disabled={s.fontSize <= s.min} onClick={() => s.setFontSize(s.fontSize - STEP)}>A−</button>
            <output aria-live="polite">{s.fontSize}</output>
            <button type="button" aria-label={t('settingsPage.display.larger', 'Larger text')} disabled={s.fontSize >= s.max} onClick={() => s.setFontSize(s.fontSize + STEP)}>A+</button>
          </span>
        </div>
        <div className="display-category__row">
          <span>{compactLabel}</span>
          <ToggleSwitch checked={s.compact} onChange={() => s.setCompact(!s.compact)} label="" ariaLabel={compactLabel} />
        </div>
        <DisplaySettingsPopover source={surface} readingTargets={readingsHere} layout="page" />
      </div>
    </div>
  );
}
