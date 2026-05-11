import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  useSubtitleSettings,
  useSetSubtitleBgOpacity,
  useSetSubtitleBgColor,
  useSetSubtitleSourceTextColor,
  useSetSubtitleTranslationTextColor,
} from '../../stores/settingsStore';
import './SubtitleSettingsPopover.scss';

const BG_PRESETS = ['#000000', '#1a1a1a', '#0d2032', '#0f2419', '#FFFFFF', '#2a2a2a'];
const SOURCE_PRESETS = ['#FFFFFF', '#E8E8E8', '#FFD27D', '#FFAA66', '#9aa0a6', '#FF6B6B'];
const TRANSLATION_PRESETS = ['#6CC5FF', '#10a37f', '#FFFFFF', '#A8E6CF', '#FFB86C', '#BD93F9'];

const SubtitleSettingsPopover: React.FC = () => {
  const { t } = useTranslation();
  const subtitle = useSubtitleSettings();
  const setBgOpacity = useSetSubtitleBgOpacity();
  const setBgColor = useSetSubtitleBgColor();
  const setSourceColor = useSetSubtitleSourceTextColor();
  const setTranslationColor = useSetSubtitleTranslationTextColor();

  return (
    <div className="subtitle-settings-popover" role="dialog">
      <div className="field">
        <label>{t('subtitle.settings.bgOpacity', 'Background opacity')} ({subtitle.bgOpacity}%)</label>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={subtitle.bgOpacity}
          onChange={(e) => setBgOpacity(Number(e.target.value))}
        />
      </div>

      <div className="field">
        <label>{t('subtitle.settings.bgColor', 'Background color')}</label>
        <div className="palette">
          {BG_PRESETS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              className={`swatch ${subtitle.bgColor === c ? 'selected' : ''}`}
              style={{ background: c }}
              onClick={() => setBgColor(c)}
            />
          ))}
        </div>
      </div>

      <div className="field">
        <label>{t('subtitle.settings.sourceColor', 'Source text color')}</label>
        <div className="palette">
          {SOURCE_PRESETS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              className={`swatch ${subtitle.sourceTextColor === c ? 'selected' : ''}`}
              style={{ background: c }}
              onClick={() => setSourceColor(c)}
            />
          ))}
        </div>
      </div>

      <div className="field">
        <label>{t('subtitle.settings.translationColor', 'Translation color')}</label>
        <div className="palette">
          {TRANSLATION_PRESETS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              className={`swatch ${subtitle.translationTextColor === c ? 'selected' : ''}`}
              style={{ background: c }}
              onClick={() => setTranslationColor(c)}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default SubtitleSettingsPopover;
