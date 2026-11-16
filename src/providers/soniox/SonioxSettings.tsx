import type { ComponentType } from 'react';
import { CircleHelp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { TtsSpeedControl } from '../../components/Settings/sections/LocalSettingsControls';
import { VoicePreviewContext } from '../../components/providers/VoicePreviewContext';
import Tooltip from '../../components/Tooltip/Tooltip';
import { useAnalytics } from '../../lib/analytics';
import type { SettingsProps } from '../../lib/provider/types';
import { regionOptionLabel, useRegionLatencies } from '../../components/Region/regionLatency';
import { requestRegionChange } from '../../lib/region/regionChange';
import { asSonioxRegion, SONIOX_REGION_LABELS, SONIOX_REGIONS } from '../../lib/soniox/regions';
import { SonioxVoiceField, useByokVoiceSource, type VoiceSourceHook } from './SonioxVoiceField';
import { sonioxSharedBoth, type SonioxSettings as S } from './settings';
import { ALL_STAGES, SP, TR, TR_TL } from '../../lib/lineup/types';
import { StagePart } from '../../components/providers/stageParts';

const helpIcon = <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '8px' }} />;

export interface SonioxSettingsFlavour {
  /** The provider this view belongs to: the region change path keys its question and "chose manually" on it. */
  providerId: 'soniox' | 'kizunaai_soniox';
  /** Kizuna Soniox (Plan B): the managed copy — the region tooltip, the split's cost note, the voice library's variant. */
  managed: boolean;
  useVoiceSource: VoiceSourceHook;
}

/**
 * Soniox's own settings (D18), today's `renderSonioxSettings`
 * (`ProviderSpecificSettings.tsx:1721-2019`) recomposed from shared
 * fields: region, the voice library (previewing through the host's route,
 * ruling 6), TTS speed, vocabulary, background, Both mode's
 * shared-session choice and, below it, agent text, which split Both locks
 * off. The endpoint knobs are its `TurnDetection`. A
 * factory, so the managed twin reuses it with its own voice source (choice 12).
 */
export function createSonioxSettingsView({ providerId, managed, useVoiceSource }: SonioxSettingsFlavour): ComponentType<SettingsProps<S>> {
  return function SonioxSettingsView({ settings, update, disabled = false, pair, account, legs, participantSpeaks, faceToFace, preview }: SettingsProps<S>) {
    const { t } = useTranslation();
    const { trackEvent } = useAnalytics();
    const region = asSonioxRegion(settings.region);
    const latencies = useRegionLatencies('soniox', !disabled);
    const inBoth = legs?.length === 2;
    const shared = sonioxSharedBoth(faceToFace === true, settings);
    // Split Both asks for no agent text (`startSplit`), so the setting shows off there.
    const splitBoth = inBoth && !shared;
    const agentTextOn = !splitBoth && settings.agentText;
    const agentTextHelp = t('settings.sonioxAgentTextTooltip', 'Tells the recognition service what is about to be read aloud, so it recognizes replies better and leaves the read-aloud out of the transcript if your speakers reach the microphone. When speech plays on this computer, this adds a small charge.');
    // The managed copy states what split costs as the help's last paragraph, not a block of its own.
    const sharedSessionHelp = [
      t('settings.sonioxSharedSessionTooltip', 'Both mode can run on one shared Soniox session or a separate session per direction.\n\nEnabled: a single session translates both sides with automatic speaker separation — lower cost and latency.\n\nDisabled: a separate session per direction — more reliable when both people talk at once, but about twice the cost.\n\nOnly affects Both mode.'),
      ...(managed ? [t('settings.sonioxSharedSessionManagedCost', 'Kizuna AI supports both. Disabled runs two sessions at once — about twice the cost per minute, so your session allowance runs out in about half the time and a higher balance is needed to start.')] : []),
    ].join('\n\n');
    const splitBothReason = t('settings.sonioxAgentTextSplitBoth', 'Off in two-way mode with separate sessions: there it did not keep the read-aloud out of recognition and made it harder to recognize someone talking over it. Your setting is kept.');
    // Only the other side's leg numbers its people, and face-to-face never shows them.
    const labelsPeople = !faceToFace && legs?.includes('participant') === true;
    return (
      <VoicePreviewContext.Provider value={preview ?? null}>
        {/* Each part names the stages it acts on, for the line-up page's stage cards (mock v19). */}
        <StagePart stages={ALL_STAGES}>
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
              onChange={(e) => { void requestRegionChange({ providerId, to: e.target.value, origin: 'select', auth: account?.auth, track: (ev) => trackEvent('region_recommendation', ev) }); }}
            >
              {SONIOX_REGIONS.map((r) => <option key={r} value={r}>{regionOptionLabel(t, SONIOX_REGION_LABELS[r], latencies?.[r])}</option>)}
            </select>
          </div>
        </div>

        </StagePart>

        <StagePart stages={SP}>
        <SonioxVoiceField settings={settings} update={update} disabled={disabled} target={pair?.target ?? 'en'} pairSource={pair?.source} participantSpeaks={participantSpeaks} account={account} managed={managed} useVoiceSource={useVoiceSource} />

        <TtsSpeedControl value={settings.ttsSpeed} onChange={(ttsSpeed) => update({ ttsSpeed })} disabled={disabled} min={0.7} max={1.3} step={0.05} />
        </StagePart>

        <StagePart stages={TR_TL}>

        <div className="settings-section" id="soniox-settings-section">
          <h2>
            {t('settings.sonioxSharedSession', 'Shared session in Both mode')}
            <Tooltip content={sharedSessionHelp} position="top">{helpIcon}</Tooltip>
          </h2>
          <div className="setting-item">
            <div className="turn-detection-options">
              {/* Only Both mode shares a session: outside it the choice is shown, inert (the old lock, `ProviderSpecificSettings.tsx:1741`). */}
              <button type="button" className={`option-button ${shared ? 'active' : ''}`} aria-pressed={shared} onClick={() => update({ bothModeSharedSession: true })} disabled={disabled || !inBoth || faceToFace}>
                {t('settings.enabled', 'Enabled')}
              </button>
              <button type="button" className={`option-button ${!shared ? 'active' : ''}`} aria-pressed={!shared} onClick={() => update({ bothModeSharedSession: false })} disabled={disabled || !inBoth || faceToFace}>
                {t('settings.disabled', 'Disabled')}
              </button>
            </div>
          </div>
          {faceToFace && (
            <div className="setting-item">
              <div className="setting-description">
                {t('settings.sonioxSharedSessionFaceToFace', 'Face-to-face always uses one shared session: both people speak into the same microphone.')}
              </div>
            </div>
          )}
        </div>

        {/* Agent text (spec 2026-11-05 §4.4), read at Start. Split Both sends none (§4.1): there it shows off and locked, the stored value kept. */}
        </StagePart>

        <StagePart stages={TR}>
        <div className="settings-section" id="soniox-agent-text-section">
          <h2>
            {t('settings.sonioxAgentText', 'Use the read-aloud text to improve recognition')}
            <Tooltip content={[agentTextHelp, ...(splitBoth ? [splitBothReason] : [])].join('\n')} position="top">{helpIcon}</Tooltip>
          </h2>
          <div className="setting-item">
            <div className="turn-detection-options" title={splitBoth ? splitBothReason : undefined}>
              <button type="button" className={`option-button ${agentTextOn ? 'active' : ''}`} aria-pressed={agentTextOn} onClick={() => update({ agentText: true })} disabled={disabled || splitBoth}>
                {t('settings.enabled', 'Enabled')}
              </button>
              <button type="button" className={`option-button ${!agentTextOn ? 'active' : ''}`} aria-pressed={!agentTextOn} onClick={() => update({ agentText: false })} disabled={disabled || splitBoth}>
                {t('settings.disabled', 'Disabled')}
              </button>
            </div>
          </div>
        </div>

        {labelsPeople && (
          <div className="settings-section" id="soniox-speaker-labels-section">
            <h2>
              {t('settings.sonioxSpeakerLabels', 'Speaker labels')}
              <Tooltip content={t('settings.sonioxSpeakerLabelsTooltip', "Numbers the other side's people — Speaker 1, Speaker 2… — once more than one voice is heard.\n\nIt can mistake one person for several. Disabled: no numbers are shown.\n\nApplies from the next session.")} position="top">{helpIcon}</Tooltip>
            </h2>
            <div className="setting-item">
              <div className="turn-detection-options">
                <button type="button" className={`option-button ${settings.speakerLabels ? 'active' : ''}`} aria-pressed={settings.speakerLabels} onClick={() => update({ speakerLabels: true })} disabled={disabled}>
                  {t('settings.enabled', 'Enabled')}
                </button>
                <button type="button" className={`option-button ${!settings.speakerLabels ? 'active' : ''}`} aria-pressed={!settings.speakerLabels} onClick={() => update({ speakerLabels: false })} disabled={disabled}>
                  {t('settings.disabled', 'Disabled')}
                </button>
              </div>
            </div>
          </div>
        )}
        </StagePart>
      </VoicePreviewContext.Provider>
    );
  };
}

/** An own key's settings. */
export const SonioxSettingsView = createSonioxSettingsView({ providerId: 'soniox', managed: false, useVoiceSource: useByokVoiceSource });
