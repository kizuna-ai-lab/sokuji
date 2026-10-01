import type { ComponentType } from 'react';
import { CircleHelp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { TtsSpeedControl } from '../../components/Settings/sections/LocalSettingsControls';
import { LinesField } from '../../components/providers/fields/LinesField';
import { VoicePreviewContext } from '../../components/providers/VoicePreviewContext';
import Tooltip from '../../components/Tooltip/Tooltip';
import type { SettingsProps } from '../../lib/provider/types';
import { asSonioxRegion, SONIOX_REGION_LABELS, SONIOX_REGIONS } from '../../lib/soniox/regions';
import { SonioxVoiceField, useByokVoiceSource, type VoiceSourceHook } from './SonioxVoiceField';
import type { SonioxSettings as S } from './settings';

const helpIcon = <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '8px' }} />;

export interface SonioxSettingsFlavour {
  /** Kizuna Soniox (Plan B): the managed copy — the region tooltip, the split's cost note, the voice library's variant. */
  managed: boolean;
  useVoiceSource: VoiceSourceHook;
}

/**
 * Soniox's own settings (D18), today's `renderSonioxSettings`
 * (`ProviderSpecificSettings.tsx:1721-2019`) recomposed from shared
 * fields: region, the voice library (previewing through the host's route,
 * ruling 6), TTS speed, vocabulary, background, and Both mode's
 * shared-session choice. The endpoint knobs are its `TurnDetection`. A
 * factory, so the managed twin reuses it with its own voice source (choice 12).
 */
export function createSonioxSettingsView({ managed, useVoiceSource }: SonioxSettingsFlavour): ComponentType<SettingsProps<S>> {
  return function SonioxSettingsView({ settings, update, disabled = false, pair, account, legs, preview }: SettingsProps<S>) {
    const { t } = useTranslation();
    const region = asSonioxRegion(settings.region);
    const inBoth = legs?.length === 2;
    const shared = settings.bothModeSharedSession;
    return (
      <VoicePreviewContext.Provider value={preview ?? null}>
        <div className="settings-section" id="soniox-region-section">
          <h2>
            {t('settings.sonioxRegion', 'Region')}
            <Tooltip
              content={managed
                ? t('settings.sonioxRegionTooltip', 'Soniox runs a separate deployment per region. Your audio is processed in the region you pick. Applies from the next session.')
                : t('settings.sonioxRegionTooltipOwnKey', 'Soniox runs a separate deployment per region, and each one is a separate Soniox project with its own API key. Your audio is processed in the region you pick. Applies from the next session.')}
              position="top"
            >
              {helpIcon}
            </Tooltip>
          </h2>
          <div className="setting-item">
            <select
              id="soniox-region-select"
              className="select-dropdown"
              aria-label={t('settings.sonioxRegion', 'Region')}
              value={region}
              disabled={disabled}
              onChange={(e) => update({ region: asSonioxRegion(e.target.value) })}
            >
              {SONIOX_REGIONS.map((r) => <option key={r} value={r}>{SONIOX_REGION_LABELS[r]}</option>)}
            </select>
          </div>
        </div>

        <SonioxVoiceField settings={settings} update={update} disabled={disabled} target={pair?.target ?? 'en'} account={account} managed={managed} useVoiceSource={useVoiceSource} />

        <TtsSpeedControl value={settings.ttsSpeed} onChange={(ttsSpeed) => update({ ttsSpeed })} disabled={disabled} min={0.7} max={1.3} step={0.05} />

        <div className="settings-section" id="soniox-vocabulary-section">
          <h2>
            {t('settings.sonioxVocabulary', 'Custom Vocabulary')}
            <Tooltip content={t('settings.sonioxVocabularyTooltip', 'Bias recognition toward important names and jargon, and steer how specific terms are translated. Applies from the next session.')} position="top">{helpIcon}</Tooltip>
          </h2>
          <LinesField
            id="soniox-vocabulary-terms"
            label={t('settings.sonioxVocabularyTerms', 'Terms')}
            tooltip={t('settings.sonioxVocabularyTermsTooltip', 'Improves recognition of uncommon words — names, jargon, product names.')}
            placeholder={t('settings.sonioxVocabularyTermsPlaceholder', 'One term per line')}
            value={settings.vocabularyTerms}
            onChange={(vocabularyTerms) => update({ vocabularyTerms })}
            disabled={disabled}
          />
          <LinesField
            id="soniox-vocabulary-translations"
            label={t('settings.sonioxVocabularyTranslations', 'Preferred Translations')}
            tooltip={t('settings.sonioxVocabularyTranslationsTooltip', "Biases how specific terms are translated — a preference, not a guaranteed replacement: names with an established rendering work best, while common words may keep the model's own wording. Entries are directional; the reverse direction only exists in Both mode, where you can add a reverse line.")}
            placeholder={t('settings.sonioxVocabularyTranslationsPlaceholder', 'One source=target per line')}
            value={settings.vocabularyTranslations}
            onChange={(vocabularyTranslations) => update({ vocabularyTranslations })}
            disabled={disabled}
          />
        </div>

        <div className="settings-section" id="soniox-background-section">
          <h2>
            {t('settings.sonioxBackground', 'Session Background')}
            <Tooltip content={t('settings.sonioxBackgroundTooltip', 'Free-form background for the next session — agenda, topic, or reference notes. Helps recognition and translation follow the domain. Trimmed first if the combined context exceeds the size limit.')} position="top">{helpIcon}</Tooltip>
          </h2>
          <LinesField
            id="soniox-context-text"
            ariaLabel={t('settings.sonioxBackground', 'Session Background')}
            placeholder={t('settings.sonioxBackgroundPlaceholder', 'Paste an agenda, topic, or background notes (optional)')}
            value={settings.contextText}
            onChange={(contextText) => update({ contextText })}
            disabled={disabled}
          />
        </div>

        <div className="settings-section" id="soniox-settings-section">
          <h2>
            {t('settings.sonioxSharedSession', 'Shared session in Both mode')}
            <Tooltip content={t('settings.sonioxSharedSessionTooltip', 'Both mode can run on one shared Soniox session or a separate session per direction.\n\nEnabled: a single session translates both sides with automatic speaker separation — lower cost and latency.\n\nDisabled: a separate session per direction — more reliable when both people talk at once, but about twice the cost.\n\nOnly affects Both mode.')} position="top">{helpIcon}</Tooltip>
          </h2>
          <div className="setting-item">
            <div className="turn-detection-options">
              {/* Only Both mode shares a session: outside it the choice is shown, inert (the old lock, `ProviderSpecificSettings.tsx:1741`). */}
              <button type="button" className={`option-button ${shared ? 'active' : ''}`} onClick={() => update({ bothModeSharedSession: true })} disabled={disabled || !inBoth}>
                {t('settings.enabled', 'Enabled')}
              </button>
              <button type="button" className={`option-button ${!shared ? 'active' : ''}`} onClick={() => update({ bothModeSharedSession: false })} disabled={disabled || !inBoth}>
                {t('settings.disabled', 'Disabled')}
              </button>
            </div>
          </div>
          {managed && (
            <div className="setting-item">
              <div className="setting-description">
                {t('settings.sonioxSharedSessionManagedCost', 'Kizuna AI supports both. Disabled runs two sessions at once — about twice the cost per minute, so your session allowance runs out in about half the time and a higher balance is needed to start.')}
              </div>
            </div>
          )}
        </div>
      </VoicePreviewContext.Provider>
    );
  };
}

/** An own key's settings. */
export const SonioxSettingsView = createSonioxSettingsView({ managed: false, useVoiceSource: useByokVoiceSource });
