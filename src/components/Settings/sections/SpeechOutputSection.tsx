// src/components/Settings/sections/SpeechOutputSection.tsx
import React, { useId, useMemo } from 'react';
import { Info, Play, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import SettingRow from '../shared/SettingRow';
import { useFilteredDevices } from '../shared/hooks';
import { ownProps, useSelectedProvider } from '../../providers/useSelectedProvider';
import { openLocalVoices } from '../../providers/openTtsSlot';
import { getAppAudio } from '../../../lib/audio/appAudio';
import type { OutletName } from '../../../lib/audio/outlets';
import { virtualMicrophoneName } from '../../../lib/audio/virtualSpeaker';
import type { LegName } from '../../../lib/conversation/types';
import { describeCause, reportError } from '../../../lib/diagnostics/report';
import { useAnalytics } from '../../../lib/analytics';
import { selectedFromStores } from '../../../lib/session/appShape';
import { useAudioContext, useMode } from '../../../stores/audioStore';
import { useProviderStore } from '../../../stores/providerStore';
import { presentProviders } from '../../../providers/registry';
import { useKeepReplayAudio, useNavigateToSettings, useSetKeepReplayAudio, useSetTextOnly, useTextOnly } from '../../../stores/settingsStore';
import { useTurnModeStore } from '../../../stores/turnModeStore';
import { getEnvironment } from '../../../utils/environment';
import { useFaceToFace } from '../../MainPanel/useFaceToFace';
import { useLanguageLabel } from '../../../lib/language/useLanguageLabel';
import { AUTO } from '../../../lib/provider/languages';
import VbCableNotice from '../../VbCable/VbCableNotice';
import { OutletSelect } from '../shared/OutletSelect';
import { useHearingRows } from '../../MainPanel/useHearingRows';
import { useVbCablePresence } from '../../../stores/vbCableStore';
import { SoundFlow } from './SoundFlow';

export interface SpeechOutputSectionProps {
  /** A run is live: Translation the other side hears and Translation I hear froze into its shape. */
  isSessionActive: boolean;
  className?: string;
}

/**
 * The voice a spoken row reads in (the provider's `VoiceSummary`), as a link
 * to the voice settings on Advanced's Provider tab: the turn-detection
 * summary's pattern (`SpeechSection.tsx`), its `settings_mode_switched`
 * event included when it leaves Simple. Nothing for a provider without one;
 * a summary that renders nothing leaves the link empty, and Settings.scss
 * hides the line. A provider whose voices sit with its engine (`voicesInEngine`)
 * opens them in the line-up's speech card instead (B-20). Usable during a run:
 * it only navigates.
 */
function VoiceLine({ leg, locked }: { leg: LegName; locked: boolean }) {
  const { t } = useTranslation();
  const providers = useMemo(() => presentProviders(), []);
  const selection = useSelectedProvider(providers);
  const navigateToSettings = useNavigateToSettings();
  const Summary = selection?.provider.VoiceSummary;
  if (!selection?.entry || !Summary) return null;

  const openVoices = () => {
    if (selection.provider.voicesInEngine) {
      // Its voices are in the line-up's speech card now (B-20), whichever leg asked.
      openLocalVoices();
      return;
    }
    // One settings page now (no Quick or Advanced layout): the voice settings are reached directly.
    navigateToSettings('voice-settings');
  };

  return (
    <div className="setting-row__voice">
      <span>{t('audioPanel.voiceLine', 'Voice')}</span>
      <button type="button" className="setting-row__voice-link" onClick={openVoices}>
        <Summary {...ownProps(selection, selection.entry, locked)} leg={leg} />
      </button>
    </div>
  );
}

/**
 * The Speech block (spec 2026-10-10 §1): who hears what, each row with its
 * own output. Every row reads and writes the stores slice 1 taught the
 * model to read, so what the page shows is what the routing does.
 */
const SpeechOutputSection: React.FC<SpeechOutputSectionProps> = ({ isSessionActive, className = '' }) => {
  const { t } = useTranslation();
  const { trackEvent } = useAnalytics();
  const platform = getEnvironment();
  const mode = useMode();
  const f2f = useFaceToFace();
  const faceToFace = f2f.active;
  const languageName = useLanguageLabel();
  // Subscribed to what the provider lookup reads, so the rows follow a selection or a load.
  useProviderStore((s) => s.selected);
  useProviderStore((s) => s.entries);
  const provider = selectedFromStores()?.provider;
  const speech = provider?.speech ?? 'optional';
  const participantOffered = provider?.participantSpeech !== false;

  const textOnly = useTextOnly();
  const setTextOnly = useSetTextOnly();
  const keepReplayAudio = useKeepReplayAudio();
  const setKeepReplayAudio = useSetKeepReplayAudio();
  const turnMode = useTurnModeStore((s) => s.turnMode);
  const {
    audioMonitorDevices, selectedMonitorDevice, selectMonitorDevice,
    isRealVoicePassthroughEnabled, realVoicePassthroughVolume, toggleRealVoicePassthrough, setRealVoicePassthroughVolume,
    refreshDevices, isLoading,
  } = useAudioContext();
  const devices = useFilteredDevices(audioMonitorDevices);
  const reasonId = useId();

  // The rows of what I hear follow the same rules here and in the toolbar's headphones entry.
  const hearing = useHearingRows(isSessionActive);
  // The drawing's parts take you to their rows (B-27).
  const navigateToSettings = useNavigateToSettings();
  const { myLegRuns, theirLegRuns, recaptured, otherOn, themLocked, themOn } = hearing;
  const vbCable = useVbCablePresence();
  // On Windows the virtual microphone is VB-CABLE, a driver the user installs: while it is
  // missing there is no device to name and nothing for Passthrough to mix into (spec 2026-10-17 §4).
  const hasVirtualBus = platform !== 'web' && vbCable !== 'missing';
  const pushToTranslate = turnMode === 'push-to-translate';

  const modeName = mode === 'speaker' ? t('modePicker.modeYou', 'Me') : mode === 'participant' ? t('modePicker.modeParticipants', 'Other') : t('modePicker.modeBoth', 'Both');
  const notInMode = t('audioPanel.lockedByMode', { mode: modeName, defaultValue: 'Not in "{{mode}}" mode. Your setting is kept.' });
  const blockedWholeSystem = t('audioPanel.blockedWholeSystem', 'All system sound is being captured: these playback options are off, so the translation is not translated again.');
  const lockedByRun = t('audioPanel.rowLockedByRun', 'Fixed for this session; stop it to change.');

  const previewOn = (outlet: OutletName) => {
    void getAppAudio()
      .then((app) => app.earPreview(outlet))
      .catch((error: unknown) => reportError('SpeechOutputSection', `The preview did not play: ${describeCause(error)}`, { cause: error }));
  };

  /** An outlet's device·channel select (spec §1.3), and face-to-face's Preview beside it. */
  const outletSelect = (name: OutletName, rowLabel: string, withPreview: boolean) => (
    <>
      <OutletSelect name={name} label={rowLabel} faceToFace={faceToFace} />
      {withPreview && (
        // Icon-only, as the voice list's and the popover's preview keys are (owner, 2026-10-11); the label is its name and title.
        <button type="button" className="setting-row__preview" aria-label={t('audioPanel.previewRow', { row: rowLabel, defaultValue: 'Preview {{row}}' })} title={t('audioPanel.previewRow', { row: rowLabel, defaultValue: 'Preview {{row}}' })} onClick={() => previewOn(name)}>
          <Play size={13} />
        </button>
      )}
    </>
  );

  // Face-to-face, each row picks where one language's translation plays — the adapter routes by the translation's
  // language — so it is named by it, and its tooltip says where that voice goes.
  // An auto source names no language (Both refuses it at start anyway): the generic name and tooltip stay.
  const named = (code: string | null): code is string => faceToFace && code !== null && code !== AUTO;
  const playsOn = (code: string | null, fallback: string) => (named(code) ? t('audioPanel.playsOn', '{{language}} translation plays on', { language: languageName(code) }) : fallback);
  const playsOnTip = (code: string | null): string | null => (named(code)
    ? t('audioPanel.playsOnTip', 'The {{language}} translation plays here: choose the device and side (left or right) the {{language}} listener wears.', { language: languageName(code) })
    : null);
  const otherLabel = playsOn(f2f.other, t('audioPanel.otherHears', 'Translation the other side hears'));
  const themLabel = playsOn(f2f.me, t('audioPanel.iHear', 'Translation I hear'));
  const meLabel = t('audioPanel.meToo', 'I hear it too');
  // The field is nowrap + ellipsis; its title keeps the full text reachable.
  const virtualMicField = platform === 'extension'
    ? t('audioPanel.virtualMicTabs', 'Virtual microphone · the meeting tab')
    : `${t('audioPanel.virtualMicrophone', 'Virtual microphone')} · ${virtualMicrophoneName()}`;
  const passthroughLabel = t('audioPanel.realVoicePassthrough', 'Passthrough');

  return (
    <div className={`config-section speech-section ${className}`} id="speech-section" data-tour="speech-section">
      {/* The mock's audio page (v18): a plain heading with its hint, then every row in one card, each help written under its label. */}
      <h3 className="settings-subhead">
        <span>{t('audioPanel.speechTitle', 'Speech')}</span>
        <small>{t('audioPanel.speechTooltip', 'Which translations are spoken, to whom, and on which device.')}</small>
        <button
          className="section-refresh-button"
          onClick={refreshDevices}
          disabled={isLoading}
          title={t('audioPanel.refreshDevices')}
          aria-label={t('audioPanel.refreshDevices')}
        >
          <RefreshCw size={14} className={isLoading ? 'spinning' : ''} />
        </button>
      </h3>

      {/* Where the sound goes (mock v18; the owner chose it for wide windows): not face to face, where there is no virtual microphone. */}
      {!faceToFace && (
        <SoundFlow
          mine={myLegRuns}
          theirs={theirLegRuns}
          otherHears={otherOn}
          meToo={hearing.meChecked}
          iHear={themOn}
          passthroughOn={hasVirtualBus && (isRealVoicePassthroughEnabled || pushToTranslate)}
          passthroughPercent={Math.round(realVoicePassthroughVolume * 100)}
          virtualBus={hasVirtualBus}
          onGo={navigateToSettings}
        />
      )}

      <div className="speech-card">
      <SettingRow
        layout="inline"
        label={t('audioPanel.defaultPlayback', 'Default playback device')}
        tooltip={t('audioPanel.defaultPlaybackAid', 'Sounds on my side play here unless a row names its own device; a sound whose own device is unplugged plays here too.')}
      >
        <select
          className="select-dropdown"
          aria-label={t('audioPanel.defaultPlayback', 'Default playback device')}
          value={selectedMonitorDevice?.deviceId ?? ''}
          onChange={(e) => {
            const device = devices.find((d) => d.deviceId === e.target.value);
            if (device) {
              selectMonitorDevice(device);
              trackEvent('audio_device_changed', { device_type: 'output', device_name: device.label, change_type: 'selected', during_session: isSessionActive });
            }
          }}
        >
          {devices.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}
        </select>
      </SettingRow>

      <p className="speech-section__caption">{t('audioPanel.captionMine', 'What I say, as speech')}</p>
      <SettingRow
        id="speech-other-hears-section"
        layout="inline"
        label={otherLabel}
        tooltip={playsOnTip(f2f.other) ?? (speech === 'always' ? t('audioPanel.otherHearsAlwaysSpeaks', 'This service always speaks.') : speech === 'never' ? t('audioPanel.otherHearsNeverSpeaks', 'This service never speaks.') : t('audioPanel.otherHearsTip', 'What I say, translated and read aloud to the other side. Into the virtual microphone: choose it as the microphone in your meeting app.'))}
        greyed={myLegRuns ? undefined : notInMode}
        switch={{ checked: otherOn, onChange: () => setTextOnly(!textOnly), disabled: isSessionActive || speech !== 'optional', title: isSessionActive ? lockedByRun : undefined }}
        footer={otherOn && (
          <>
            {!faceToFace && vbCable !== 'not-applicable' && <VbCableNotice variant="row" />}
            <VoiceLine leg="speaker" locked={isSessionActive} />
          </>
        )}
      >
        {faceToFace
          ? outletSelect('other', otherLabel, true)
          : hasVirtualBus && (
            <div className="setting-row__field" title={virtualMicField}>
              {platform === 'extension'
                ? virtualMicField
                : <>{t('audioPanel.virtualMicrophone', 'Virtual microphone')}<span className="muted"> · {virtualMicrophoneName()}</span></>}
            </div>
          )}
      </SettingRow>

      {!faceToFace && (
        <SettingRow
          id="speech-me-too-section"
          layout="inline"
          label={meLabel}
          tooltip={t('audioPanel.meTooTip', 'Also plays the translation the other side hears on my side (the spoken translation, not my own voice).')}
          sub
          greyed={!myLegRuns ? notInMode : recaptured ? blockedWholeSystem : !otherOn ? t('audioPanel.needsOtherHears', 'Nothing to hear while the translation is not spoken. Your setting is kept.') : undefined}
          switch={{ checked: hearing.meChecked, onChange: hearing.toggleMe, disabled: hearing.meDisabled, describedBy: hearing.meDisabled ? reasonId : undefined }}
        >
          {outletSelect('me', meLabel, false)}
        </SettingRow>
      )}

      {!faceToFace && hasVirtualBus && (
        <SettingRow
          id="speech-passthrough-section"
          layout="inline"
          label={passthroughLabel}
          tooltip={pushToTranslate ? t('audioPanel.passthroughManagedByPushToTranslate') : t('audioPanel.passthroughTip', 'Mixes my own voice, at a lower level, under the translation into the virtual microphone. 60% at most.')}
          sub
          greyed={!myLegRuns ? notInMode : !otherOn ? t('audioPanel.needsOtherHears', 'Nothing to hear while the translation is not spoken. Your setting is kept.') : undefined}
          switch={{
            checked: isRealVoicePassthroughEnabled || pushToTranslate,
            onChange: () => {
              if (pushToTranslate) return;
              toggleRealVoicePassthrough();
              trackEvent('audio_passthrough_toggled', { enabled: !isRealVoicePassthroughEnabled, volume_level: realVoicePassthroughVolume });
            },
            disabled: pushToTranslate,
            title: pushToTranslate ? t('audioPanel.passthroughManagedByPushToTranslate') : undefined,
          }}
        >
          {!pushToTranslate && (
            <div className="setting-row__slider">
              <input
                type="range" min="0" max="0.6" step="0.01"
                aria-label={t('audioPanel.realVoiceVolume', 'Original Audio Volume')}
                value={realVoicePassthroughVolume}
                onChange={(e) => setRealVoicePassthroughVolume(parseFloat(e.target.value))}
                onMouseUp={(e) => trackEvent('ui_interaction', { component: 'SpeechOutputSection', action: 'passthrough_volume_changed', element: 'volume_slider', value: parseFloat((e.target as HTMLInputElement).value) })}
              />
              {/* As Display's background opacity draws it (owner 2026-11-15): the native track, the percent on its right. */}
              <span className="setting-value">{Math.round(realVoicePassthroughVolume * 100)}%</span>
            </div>
          )}
        </SettingRow>
      )}

      <p className="speech-section__caption">{t('audioPanel.captionTheirs', 'What the other side says, as speech')}</p>
      <SettingRow
        id="speech-i-hear-section"
        layout="inline"
        label={themLabel}
        tooltip={playsOnTip(f2f.me) ?? (!participantOffered ? t('audioPanel.iHearNotOffered', "This service does not speak the other side's translation.") : t('audioPanel.iHearTip', 'What the other side says, translated and read aloud to me.'))}
        greyed={!theirLegRuns ? notInMode : recaptured ? blockedWholeSystem : undefined}
        switch={{
          checked: themOn,
          onChange: hearing.toggleThem,
          disabled: themLocked || recaptured || !participantOffered || speech !== 'optional',
          title: themLocked ? lockedByRun : undefined,
          describedBy: recaptured ? reasonId : undefined,
        }}
        footer={themOn && <VoiceLine leg="participant" locked={isSessionActive} />}
      >
        {outletSelect('them', themLabel, faceToFace)}
      </SettingRow>

      {recaptured && (
        <p className="setting-description setting-row__reason" id={reasonId}>
          <Info size={14} aria-hidden="true" />
          <span>{blockedWholeSystem}</span>
        </p>
      )}

      {faceToFace && (
        <p className="setting-description ears-hint">{t('faceToFace.speakersHint', 'Use headphones, one side each. Any speaker lets the microphone pick up the translation and translate it again.')}</p>
      )}

      {/* Replay keeps spoken clips: with no leg spoken, there is nothing to keep (owner, 2026-10-11). */}
      <p className="speech-section__caption">{t('audioPanel.captionReplay', 'Replay')}</p>
      <SettingRow
        layout="inline"
        label={t('audioPanel.keepReplay', 'Keep spoken translations for replay')}
        tooltip={t('audioPanel.keepReplayTip', "Keeps the spoken translations in memory so each message's ▶ works; a long session uses more memory.")}
        greyed={(myLegRuns && otherOn) || (theirLegRuns && themOn) ? undefined : t('audioPanel.keepReplayNothingSpoken', 'Nothing is spoken, so there is nothing to keep. Your setting is kept.')}
        switch={{ checked: keepReplayAudio, onChange: () => setKeepReplayAudio(!keepReplayAudio) }}
      />
      </div>
    </div>
  );
};

export default SpeechOutputSection;
