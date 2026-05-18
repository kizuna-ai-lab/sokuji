import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
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
  SUBTITLE_DEFAULT_BG_COLOR,
  SUBTITLE_DEFAULT_SOURCE_TEXT_COLOR,
  SUBTITLE_DEFAULT_TRANSLATION_TEXT_COLOR,
} from '../../stores/subtitleStore';
import ToggleSwitch from '../Settings/shared/ToggleSwitch';
import {
  useConversationDisplayBgColor,
  useConversationDisplaySourceTextColor,
  useConversationDisplayTranslationTextColor,
  useSetConversationDisplayBgColor,
  useSetConversationDisplaySourceTextColor,
  useSetConversationDisplayTranslationTextColor,
  CONVERSATION_DISPLAY_DEFAULT_BG_COLOR,
  CONVERSATION_DISPLAY_DEFAULT_SOURCE_TEXT_COLOR,
  CONVERSATION_DISPLAY_DEFAULT_TRANSLATION_TEXT_COLOR,
} from '../../stores/conversationDisplayStore';
import './DisplaySettingsPopover.scss';

const BG_PRESETS = ['#000000', '#1a1a1a', '#0d2032', '#0f2419', '#FFFFFF', '#2a2a2a'];
const SOURCE_PRESETS = [
  '#FFFFFF', '#E8E8E8', '#FFD27D', '#FFAA66', '#9aa0a6', '#FF6B6B',
  '#000000', '#003B6F', '#1B5E20',
];
const TRANSLATION_PRESETS = [
  '#6CC5FF', '#10a37f', '#FFFFFF', '#A8E6CF', '#FFB86C', '#BD93F9',
  '#000000', '#003B6F', '#7B1FA2',
];

const PICKER_DEBOUNCE_MS = 150;

type Source = 'subtitle' | 'conversation';

export interface DisplaySettingsPopoverProps {
  source: Source;
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
}

const DisplaySettingsPopover: React.FC<DisplaySettingsPopoverProps> = ({ source }) =>
  source === 'subtitle' ? <SubtitleBoundPopover /> : <ConversationBoundPopover />;

export default DisplaySettingsPopover;

// ──────────── Source-bound wrappers ────────────
// Each wrapper subscribes ONLY to its own store. This keeps the rules
// of hooks satisfied: hooks are always called in the same order within
// a given wrapper component.

const SubtitleBoundPopover: React.FC = () => {
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
  };
  return <DisplaySettingsPopoverInner bindings={bindings} />;
};

const ConversationBoundPopover: React.FC = () => {
  const bindings: InnerBindings = {
    bgOpacity: undefined,
    bgColor: useConversationDisplayBgColor(),
    sourceTextColor: useConversationDisplaySourceTextColor(),
    translationTextColor: useConversationDisplayTranslationTextColor(),
    newItemHighlightEnabled: undefined,
    setBgOpacity: undefined,
    setBgColor: useSetConversationDisplayBgColor(),
    setSourceTextColor: useSetConversationDisplaySourceTextColor(),
    setTranslationTextColor: useSetConversationDisplayTranslationTextColor(),
    setNewItemHighlightEnabled: undefined,
    defaultBgColor: CONVERSATION_DISPLAY_DEFAULT_BG_COLOR,
    defaultSourceTextColor: CONVERSATION_DISPLAY_DEFAULT_SOURCE_TEXT_COLOR,
    defaultTranslationTextColor: CONVERSATION_DISPLAY_DEFAULT_TRANSLATION_TEXT_COLOR,
  };
  return <DisplaySettingsPopoverInner bindings={bindings} />;
};

// ──────────── Pure presentational inner ────────────

const DisplaySettingsPopoverInner: React.FC<{ bindings: InnerBindings }> = ({ bindings }) => {
  const { t } = useTranslation();
  const includeOpacity =
    bindings.bgOpacity !== undefined && bindings.setBgOpacity !== undefined;
  const includeHighlightToggle =
    bindings.newItemHighlightEnabled !== undefined &&
    bindings.setNewItemHighlightEnabled !== undefined;

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
        presets={BG_PRESETS}
        value={bindings.bgColor}
        onChange={bindings.setBgColor}
      />
      <ColorRow
        labelKey="subtitle.settings.sourceColor"
        labelDefault="Source text"
        defaultColor={bindings.defaultSourceTextColor}
        presets={SOURCE_PRESETS}
        value={bindings.sourceTextColor}
        onChange={bindings.setSourceTextColor}
      />
      <ColorRow
        labelKey="subtitle.settings.translationColor"
        labelDefault="Translation text"
        defaultColor={bindings.defaultTranslationTextColor}
        presets={TRANSLATION_PRESETS}
        value={bindings.translationTextColor}
        onChange={bindings.setTranslationTextColor}
      />
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
}

const ColorRow: React.FC<ColorRowProps> = ({
  labelKey,
  labelDefault,
  defaultColor,
  presets,
  value,
  onChange,
}) => {
  const { t } = useTranslation();
  const valueLower = value.toLowerCase();

  // First chip is always this surface's default. Drop any duplicate of the
  // default that appears later in the shared preset list.
  const orderedPresets = useMemo(() => {
    const defaultLower = defaultColor.toLowerCase();
    const rest = presets.filter((p) => p.toLowerCase() !== defaultLower);
    return [defaultColor, ...rest] as const;
  }, [defaultColor, presets]);

  const isCustom = !orderedPresets.some((p) => p.toLowerCase() === valueLower);

  // Debounce the high-frequency change events emitted while the user
  // drags inside the OS color picker.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onPickerChange = useCallback(
    (next: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onChange(next);
      }, PICKER_DEBOUNCE_MS);
    },
    [onChange],
  );
  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  return (
    <div className="field">
      <label>{t(labelKey, labelDefault)}</label>
      <div className="palette">
        {orderedPresets.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={c}
            className={`swatch ${valueLower === c.toLowerCase() ? 'selected' : ''}`}
            style={{ background: c }}
            onClick={() => onChange(c)}
          />
        ))}
        <label
          className={`swatch custom ${isCustom ? 'selected' : ''}`}
          style={{ background: value }}
          title={t('subtitle.settings.customColor', 'Custom color')}
          aria-label={t('subtitle.settings.customColor', 'Custom color')}
        >
          <Plus size={10} />
          <input
            type="color"
            value={value}
            aria-label={t('subtitle.settings.customColor', 'Custom color')}
            onChange={(e) => onPickerChange(e.target.value)}
          />
        </label>
      </div>
    </div>
  );
};
