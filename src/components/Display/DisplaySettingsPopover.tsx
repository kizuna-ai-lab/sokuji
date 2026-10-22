import React, { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import {
  useSubtitleBgOpacity,
  useSubtitleBgColor,
  useSubtitleSourceTextColor,
  useSubtitleTranslationTextColor,
  useSubtitleNewItemHighlightEnabled,
  useSetSubtitleBgOpacity,
  useSetSubtitleBgColor,
  useSetSubtitleSourceTextColor,
  useSetSubtitleTranslationTextColor,
  useSetSubtitleNewItemHighlightEnabled,
  useSubtitleShowReadings,
  useSetSubtitleShowReadings,
  SUBTITLE_DEFAULT_BG_COLOR,
  SUBTITLE_DEFAULT_SOURCE_TEXT_COLOR,
  SUBTITLE_DEFAULT_TRANSLATION_TEXT_COLOR,
} from '../../stores/subtitleStore';
import ToggleSwitch from '../Settings/shared/ToggleSwitch';
import ColorPicker from './ColorPicker';
import {
  useConversationDisplayBgColor,
  useConversationDisplaySourceTextColor,
  useConversationDisplayTranslationTextColor,
  useSetConversationDisplayBgColor,
  useSetConversationDisplaySourceTextColor,
  useSetConversationDisplayTranslationTextColor,
  useConversationDisplayShowReadings,
  useSetConversationDisplayShowReadings,
  CONVERSATION_SCHEME_COLOURS,
  resolveConversationColours,
} from '../../stores/conversationDisplayStore';
import { useScheme } from '../../lib/theme/useScheme';
import Button from '../Settings/shared/Button';
import { useAnalytics } from '../../lib/analytics';
import { useLanguageLabel } from '../../lib/language/useLanguageLabel';
import { formatBytes } from '../../lib/local-inference/formatBytes';
import { getJapaneseState, retryJapanese, subscribeJapanese, type JapaneseState } from '../../lib/reading/ja/runtime';
import { READING_SCHEME, type ReadingLanguage } from '../../lib/reading/types';
import './DisplaySettingsPopover.scss';

// Eight presets per row, in every row of both surfaces, so the three rows
// line up (the owner's ask, 2026-10-22): with the first chip (the surface's
// fixed default, or the conversation's follow-theme chip) and the custom chip,
// every row is ten. A surface's own fixed default is never also a preset
// here, so the row never folds one away — the subtitle's lists leave out its
// black background and white source text. The count is pinned by the test
// that renders every row.
type SurfacePresets = Readonly<Record<ColourRowKey, readonly string[]>>;
const PRESETS: Readonly<Record<Source, SurfacePresets>> = {
  conversation: {
    bg: ['#000000', '#1a1a1a', '#2a2a2a', '#0d2032', '#0f2419', '#fdf6e3', '#e8f0fe', '#FFFFFF'],
    source: ['#FFFFFF', '#E8E8E8', '#FFD27D', '#FFAA66', '#FF6B6B', '#000000', '#003B6F', '#1B5E20'],
    translation: ['#6CC5FF', '#10a37f', '#FFFFFF', '#A8E6CF', '#FFB86C', '#BD93F9', '#000000', '#7B1FA2'],
  },
  subtitle: {
    bg: ['#1a1a1a', '#2a2a2a', '#0d2032', '#0f2419', '#2b1d0e', '#fdf6e3', '#e8f0fe', '#FFFFFF'],
    source: ['#E8E8E8', '#9aa0a6', '#FFD27D', '#FFAA66', '#FF6B6B', '#000000', '#003B6F', '#1B5E20'],
    translation: ['#6CC5FF', '#10a37f', '#FFFFFF', '#A8E6CF', '#FFB86C', '#BD93F9', '#000000', '#7B1FA2'],
  },
};

const PICKER_DEBOUNCE_MS = 150;

type Source = 'subtitle' | 'conversation';

export interface DisplaySettingsPopoverProps {
  source: Source;
  /** The reading languages the switch names; absent or empty, no readings row (the subtitle passes them only in Electron while expanded; the overlay never). */
  readingTargets?: ReadonlySet<ReadingLanguage>;
}

interface InnerBindings {
  bgOpacity: number | undefined;
  bgColor: string;
  sourceTextColor: string;
  translationTextColor: string;
  // newItemHighlightEnabled is subtitle-only. Conversation-mode bindings
  // leave it undefined so the toggle row is suppressed.
  newItemHighlightEnabled: boolean | undefined;
  setBgOpacity: ((n: number) => Promise<void>) | undefined;
  setBgColor: (s: string) => Promise<void>;
  setSourceTextColor: (s: string) => Promise<void>;
  setTranslationTextColor: (s: string) => Promise<void>;
  setNewItemHighlightEnabled: ((b: boolean) => Promise<void>) | undefined;
  defaultBgColor: string;
  defaultSourceTextColor: string;
  defaultTranslationTextColor: string;
  // The conversation's colours follow the app's scheme until set (spec
  // 2026-10-22 §3): per row, the follow chip. The subtitle, whose defaults
  // are fixed, leaves it undefined and its rows start with `default*Color`.
  follow?: Record<ColourRowKey, FollowChip>;
  showReadings: boolean;
  setShowReadings: (b: boolean) => Promise<void>;
  surface: 'conversation' | 'subtitle';
}

type ColourRowKey = 'bg' | 'source' | 'translation';

/** A row's "Follow theme" chip: the two schemes' colours it is split between, whether it is the choice in force, and the way back to it. */
interface FollowChip {
  dark: string;
  light: string;
  following: boolean;
  follow: () => Promise<void>;
}

const DisplaySettingsPopover: React.FC<DisplaySettingsPopoverProps> = ({ source, readingTargets }) =>
  source === 'subtitle'
    ? <SubtitleBoundPopover readingTargets={readingTargets} />
    : <ConversationBoundPopover readingTargets={readingTargets} />;

export default DisplaySettingsPopover;

// ──────────── Source-bound wrappers ────────────
// Each wrapper subscribes ONLY to its own store. This keeps the rules
// of hooks satisfied: hooks are always called in the same order within
// a given wrapper component.

const SubtitleBoundPopover: React.FC<{ readingTargets?: ReadonlySet<ReadingLanguage> }> = ({ readingTargets }) => {
  const bindings: InnerBindings = {
    bgOpacity: useSubtitleBgOpacity(),
    bgColor: useSubtitleBgColor(),
    sourceTextColor: useSubtitleSourceTextColor(),
    translationTextColor: useSubtitleTranslationTextColor(),
    newItemHighlightEnabled: useSubtitleNewItemHighlightEnabled(),
    setBgOpacity: useSetSubtitleBgOpacity(),
    setBgColor: useSetSubtitleBgColor(),
    setSourceTextColor: useSetSubtitleSourceTextColor(),
    setTranslationTextColor: useSetSubtitleTranslationTextColor(),
    setNewItemHighlightEnabled: useSetSubtitleNewItemHighlightEnabled(),
    defaultBgColor: SUBTITLE_DEFAULT_BG_COLOR,
    defaultSourceTextColor: SUBTITLE_DEFAULT_SOURCE_TEXT_COLOR,
    defaultTranslationTextColor: SUBTITLE_DEFAULT_TRANSLATION_TEXT_COLOR,
    showReadings: useSubtitleShowReadings(),
    setShowReadings: useSetSubtitleShowReadings(),
    surface: 'subtitle',
  };
  return <DisplaySettingsPopoverInner bindings={bindings} readingTargets={readingTargets} />;
};

const ConversationBoundPopover: React.FC<{ readingTargets?: ReadonlySet<ReadingLanguage> }> = ({ readingTargets }) => {
  // A colour the user never set is null in the store and follows the scheme
  // (spec 2026-10-22 §3): the rows show what is drawn, and their first chip
  // is that choice, in the scheme's own colour.
  const scheme = useScheme();
  const stored = {
    bgColor: useConversationDisplayBgColor(),
    sourceTextColor: useConversationDisplaySourceTextColor(),
    translationTextColor: useConversationDisplayTranslationTextColor(),
  };
  const drawn = resolveConversationColours(stored, scheme);
  const follow = CONVERSATION_SCHEME_COLOURS[scheme];
  const setBgColor = useSetConversationDisplayBgColor();
  const setSourceTextColor = useSetConversationDisplaySourceTextColor();
  const setTranslationTextColor = useSetConversationDisplayTranslationTextColor();
  const bindings: InnerBindings = {
    bgOpacity: undefined,
    bgColor: drawn.bgColor,
    sourceTextColor: drawn.sourceTextColor,
    translationTextColor: drawn.translationTextColor,
    newItemHighlightEnabled: undefined,
    setBgOpacity: undefined,
    setBgColor,
    setSourceTextColor,
    setTranslationTextColor,
    setNewItemHighlightEnabled: undefined,
    defaultBgColor: follow.bgColor,
    defaultSourceTextColor: follow.sourceTextColor,
    defaultTranslationTextColor: follow.translationTextColor,
    follow: {
      bg: { dark: CONVERSATION_SCHEME_COLOURS.dark.bgColor, light: CONVERSATION_SCHEME_COLOURS.light.bgColor, following: stored.bgColor === null, follow: () => setBgColor(null) },
      source: { dark: CONVERSATION_SCHEME_COLOURS.dark.sourceTextColor, light: CONVERSATION_SCHEME_COLOURS.light.sourceTextColor, following: stored.sourceTextColor === null, follow: () => setSourceTextColor(null) },
      translation: { dark: CONVERSATION_SCHEME_COLOURS.dark.translationTextColor, light: CONVERSATION_SCHEME_COLOURS.light.translationTextColor, following: stored.translationTextColor === null, follow: () => setTranslationTextColor(null) },
    },
    showReadings: useConversationDisplayShowReadings(),
    setShowReadings: useSetConversationDisplayShowReadings(),
    surface: 'conversation',
  };
  return <DisplaySettingsPopoverInner bindings={bindings} readingTargets={readingTargets} />;
};

// ──────────── Pure presentational inner ────────────

const DisplaySettingsPopoverInner: React.FC<{ bindings: InnerBindings; readingTargets?: ReadonlySet<ReadingLanguage> }> = ({ bindings, readingTargets }) => {
  const { t } = useTranslation();
  const includeOpacity =
    bindings.bgOpacity !== undefined && bindings.setBgOpacity !== undefined;
  const includeHighlightToggle =
    bindings.newItemHighlightEnabled !== undefined &&
    bindings.setNewItemHighlightEnabled !== undefined;

  // Which row (if any) has its custom picker expanded. Held here rather than
  // per-row so opening one collapses the others — three stacked pickers would
  // make the popover taller than most of the surfaces it floats over.
  const [openPicker, setOpenPicker] = useState<string | null>(null);
  const togglePicker = useCallback(
    (key: string) => setOpenPicker((cur) => (cur === key ? null : key)),
    [],
  );

  // Note: role="dialog" + accessible name are intentionally NOT set on this
  // root. They live on the floating wrapper in SubtitleBar / MainPanel via
  // @floating-ui/react's useRole, which also wires aria-haspopup / aria-
  // expanded / aria-controls on the trigger. Keeping the role on a single
  // level avoids duplicate dialog announcements.
  return (
    <div className="display-settings-popover">
      {includeOpacity && (
        <OpacitySlider value={bindings.bgOpacity!} onCommit={bindings.setBgOpacity!} />
      )}

      <ColorRow
        labelKey="subtitle.settings.bgColor"
        labelDefault="Display background"
        defaultColor={bindings.defaultBgColor}
        presets={PRESETS[bindings.surface].bg}
        value={bindings.bgColor}
        onChange={bindings.setBgColor}
        pickerOpen={openPicker === 'bg'}
        onTogglePicker={() => togglePicker('bg')}
        follow={bindings.follow?.bg}
      />
      <ColorRow
        labelKey="subtitle.settings.sourceColor"
        labelDefault="Source text"
        defaultColor={bindings.defaultSourceTextColor}
        presets={PRESETS[bindings.surface].source}
        value={bindings.sourceTextColor}
        onChange={bindings.setSourceTextColor}
        pickerOpen={openPicker === 'source'}
        onTogglePicker={() => togglePicker('source')}
        follow={bindings.follow?.source}
      />
      <ColorRow
        labelKey="subtitle.settings.translationColor"
        labelDefault="Translation text"
        defaultColor={bindings.defaultTranslationTextColor}
        presets={PRESETS[bindings.surface].translation}
        value={bindings.translationTextColor}
        onChange={bindings.setTranslationTextColor}
        pickerOpen={openPicker === 'translation'}
        onTogglePicker={() => togglePicker('translation')}
        follow={bindings.follow?.translation}
      />
      {readingTargets && readingTargets.size > 0 && <ReadingsRow bindings={bindings} targets={readingTargets} />}
      {includeHighlightToggle && (
        <div className="field">
          <ToggleSwitch
            checked={bindings.newItemHighlightEnabled!}
            onChange={() =>
              void bindings.setNewItemHighlightEnabled!(
                !bindings.newItemHighlightEnabled,
              )
            }
            label={t(
              'subtitle.settings.newItemHighlight',
              'Highlight newly-arrived text',
            )}
          />
        </div>
      )}
    </div>
  );
};

const SCHEME_FALLBACK = { kana: 'kana', pinyin: 'pinyin', rr: 'romanization', latin: 'Latin letters' } as const;

/** The readings switch (spec 2026-10-15 §5): named by the target's reading language; absent when it has none. */
const ReadingsRow: React.FC<{ bindings: InnerBindings; targets: ReadonlySet<ReadingLanguage> }> = ({ bindings, targets }) => {
  const { t } = useTranslation();
  const languageName = useLanguageLabel();
  const { trackEvent } = useAnalytics();
  const japanese = useSyncExternalStore(subscribeJapanese, getJapaneseState);
  const lang = targets.values().next().value;
  if (!lang) return null;
  const scheme = READING_SCHEME[lang];
  const label = t('subtitle.settings.readings', {
    defaultValue: 'Show {{language}} readings ({{scheme}})',
    language: languageName(lang),
    scheme: t(`subtitle.settings.readingScheme.${scheme}`, SCHEME_FALLBACK[scheme]),
  });
  const toggle = () => {
    const next = !bindings.showReadings;
    void bindings.setShowReadings(next);
    trackEvent('readings_changed', { surface: bindings.surface, language: lang, enabled: next });
  };
  return (
    <div className="field readings-field">
      <ToggleSwitch checked={bindings.showReadings} onChange={toggle} label={label} ariaLabel={label} />
      {bindings.showReadings && lang === 'ja' && <JapaneseDictionaryStatus state={japanese} />}
    </div>
  );
};

const JapaneseDictionaryStatus: React.FC<{ state: JapaneseState }> = ({ state }) => {
  const { t } = useTranslation();
  if (state.phase === 'downloading') {
    return (
      <div className="readings-download" role="status">
        <div className="readings-download__bar"><i style={{ width: `${state.total > 0 ? Math.round((state.done / state.total) * 100) : 0}%` }} /></div>
        <div className="readings-download__text">
          {t('subtitle.settings.readingsDownloading', {
            defaultValue: 'Downloading the Japanese dictionary {{done}} / {{total}}',
            done: formatBytes(state.done),
            total: formatBytes(state.total),
          })}
        </div>
      </div>
    );
  }
  if (state.phase === 'failed') {
    return (
      <div className="readings-download readings-download--failed" role="alert">
        <span className="readings-download__text">
          {state.cause === 'download'
            ? t('subtitle.settings.readingsDownloadFailed', "Couldn't download the Japanese dictionary.")
            : t('subtitle.settings.readingsFailed', "Japanese readings aren't working.")}
        </span>
        <Button variant="secondary" size="sm" onClick={retryJapanese}>{t('common.retry', 'Retry')}</Button>
      </div>
    );
  }
  return null;
};

// ──────────── Opacity slider (subtitle-only) ────────────
// Local state during pointer drag so we don't fire setBgOpacity (and the
// async persist behind it) for every intermediate value. The store is
// updated only when the user releases the pointer or finishes a keyboard
// interaction.

const OpacitySlider: React.FC<{
  value: number;
  onCommit: (n: number) => Promise<void>;
}> = ({ value, onCommit }) => {
  const { t } = useTranslation();
  const id = useId();
  const [local, setLocal] = useState(value);

  // Sync local state if the bound value changes externally (hydration,
  // someone else's update).
  useEffect(() => {
    setLocal(value);
  }, [value]);

  const commit = useCallback(() => {
    if (local !== value) {
      void onCommit(local);
    }
  }, [local, value, onCommit]);

  return (
    <div className="field">
      <label htmlFor={id}>
        {t('subtitle.settings.bgOpacity', 'Background opacity')} ({local}%)
      </label>
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        step={1}
        value={local}
        onChange={(e) => setLocal(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
      />
    </div>
  );
};

// ──────────── Reusable row with presets + custom chip ────────────

interface ColorRowProps {
  labelKey: string;
  labelDefault: string;
  defaultColor: string;
  presets: readonly string[];
  value: string;
  onChange: (s: string) => Promise<void>;
  /** Whether this row's free-choice picker is expanded. */
  pickerOpen: boolean;
  onTogglePicker: () => void;
  /**
   * Given, the first chip is "Follow theme", split between the two schemes'
   * colours, selected while nothing is stored; clicking it clears the stored
   * colour, and `defaultColor` is not drawn. Absent, the first chip is the
   * fixed default.
   */
  follow?: FollowChip;
}

const ColorRow: React.FC<ColorRowProps> = ({
  labelKey,
  labelDefault,
  defaultColor,
  presets,
  value,
  onChange,
  pickerOpen,
  onTogglePicker,
  follow,
}) => {
  const { t } = useTranslation();
  const valueLower = value.toLowerCase();
  const following = follow?.following ?? false;

  // Without a follow chip, the first chip is this surface's fixed default,
  // and a duplicate of it later in the list is dropped (the lists leave the
  // defaults out, so this never fires; it is the safety net).
  const orderedPresets = useMemo(() => {
    if (follow) return presets;
    const defaultLower = defaultColor.toLowerCase();
    const rest = presets.filter((p) => p.toLowerCase() !== defaultLower);
    return [defaultColor, ...rest] as const;
  }, [defaultColor, presets, follow]);

  // A stored colour that happens to equal a scheme's is a custom colour, not
  // "follow": only the stored value's absence is that.
  const isCustom = !following && !orderedPresets.some((p) => p.toLowerCase() === valueLower);

  // Debounce the high-frequency change events emitted while the user
  // drags inside the picker.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelPendingPickerWrite = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = null;
  }, []);
  const onPickerChange = useCallback(
    (next: string) => {
      cancelPendingPickerWrite();
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        onChange(next);
      }, PICKER_DEBOUNCE_MS);
    },
    [onChange, cancelPendingPickerWrite],
  );
  useEffect(() => cancelPendingPickerWrite, [cancelPendingPickerWrite]);

  // A preset must supersede a picker write that is still in flight. The picker
  // is inline now, so both controls are on screen together and "drag, then
  // click a preset" is an ordinary sequence — without this the debounce fires
  // afterwards and silently reverts the preset.
  const onPresetClick = useCallback(
    (c: string) => {
      cancelPendingPickerWrite();
      onChange(c);
    },
    [onChange, cancelPendingPickerWrite],
  );
  const onFollowClick = useCallback(() => {
    cancelPendingPickerWrite();
    void follow?.follow();
  }, [follow, cancelPendingPickerWrite]);

  const followLabel = t('subtitle.settings.followTheme', 'Follow theme');

  return (
    <div className="field">
      <label>{t(labelKey, labelDefault)}</label>
      <div className="palette">
        {follow && (
          <button
            type="button"
            aria-label={followLabel}
            title={followLabel}
            className={`swatch follow ${following ? 'selected' : ''}`}
            style={{ '--follow-dark': follow.dark, '--follow-light': follow.light } as React.CSSProperties}
            onClick={onFollowClick}
          />
        )}
        {orderedPresets.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={c}
            className={`swatch ${!following && valueLower === c.toLowerCase() ? 'selected' : ''}`}
            style={{ background: c }}
            onClick={() => onPresetClick(c)}
          />
        ))}
        <button
          type="button"
          className={`swatch custom ${isCustom ? 'selected' : ''}`}
          style={{ background: value }}
          title={t('subtitle.settings.customColor', 'Custom color')}
          aria-label={t('subtitle.settings.customColor', 'Custom color')}
          aria-expanded={pickerOpen}
          onClick={onTogglePicker}
        >
          <Plus size={10} />
        </button>
      </div>
      {pickerOpen && <ColorPicker value={value} onChange={onPickerChange} />}
    </div>
  );
};
