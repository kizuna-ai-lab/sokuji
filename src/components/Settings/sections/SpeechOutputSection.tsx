// src/components/Settings/sections/SpeechOutputSection.tsx
import React, { useId } from 'react';
import { Info, Play, RefreshCw, Volume2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Tooltip from '../../Tooltip/Tooltip';
import SettingRow from '../shared/SettingRow';
import { useFilteredDevices } from '../shared/hooks';
import { useRunParticipantSpeech } from '../../../app/useRun';
import { getAppAudio } from '../../../lib/audio/appAudio';
import { entryValue, outletEntries, outletSelectValue, parseEntryValue } from '../../../lib/audio/outletOptions';
import type { OutletName } from '../../../lib/audio/outlets';
import { virtualMicrophoneName } from '../../../lib/audio/virtualSpeaker';
import { describeCause, reportError } from '../../../lib/diagnostics/report';
import { useAnalytics } from '../../../lib/analytics';
import { heardFromStores, selectedFromStores } from '../../../lib/session/appShape';
import { useAudioContext, useMode, useParticipantCaptureWidened, useOutlets, useSelectedParticipantSource, useSetOutletChannel, useSetOutletDevice } from '../../../stores/audioStore';
import { useProviderStore } from '../../../stores/providerStore';
import { useRoutingStore } from '../../../stores/routingStore';
import { useKeepReplayAudio, useSetKeepReplayAudio, useSetTextOnly, useTextOnly } from '../../../stores/settingsStore';
import { useTurnModeStore } from '../../../stores/turnModeStore';
import { getEnvironment } from '../../../utils/environment';
import { useFaceToFace } from '../../MainPanel/useFaceToFace';

export interface SpeechOutputSectionProps {
  /** A run is live: 对方听到的翻译 and 我听到的翻译 froze into its shape. */
  isSessionActive: boolean;
  className?: string;
}

/**
 * The 语音 block (spec 2026-10-10 §1): who hears what, each row with its
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
  const participantSpeech = useRoutingStore((s) => s.participantSpeech);
  const setParticipantSpeech = useRoutingStore((s) => s.setParticipantSpeech);
  const turnMode = useTurnModeStore((s) => s.turnMode);
  const {
    audioMonitorDevices, selectedMonitorDevice, selectMonitorDevice,
    isMonitorMuted, setMonitorMuted,
    isRealVoicePassthroughEnabled, realVoicePassthroughVolume, toggleRealVoicePassthrough, setRealVoicePassthroughVolume,
    refreshDevices, isLoading,
  } = useAudioContext();
  const outlets = useOutlets();
  const setOutletDevice = useSetOutletDevice();
  const setOutletChannel = useSetOutletChannel();
  // Subscribed: `heardFromStores` reads the source from the store, not from render.
  useSelectedParticipantSource();
  const devices = useFilteredDevices(audioMonitorDevices);
  const reasonId = useId();

  const myLegRuns = mode !== 'participant';
  const theirLegRuns = mode !== 'speaker';
  // Subscribed so the blocked state follows a capture that widens mid-run.
  useParticipantCaptureWidened();
  const heard = heardFromStores(faceToFace);
  // The recapture rule (D10): a whole-system capture would translate the playback again.
  const recaptured = theirLegRuns && !faceToFace && !heard;
  const otherOn = speech === 'always' ? true : speech === 'never' ? false : !textOnly;
  // A run's open participant leg froze its speech at Start; the source picker stays live, so the stores can say otherwise.
  const runSpeech = useRunParticipantSpeech();
  const themOn = runSpeech ?? (participantOffered && !recaptured && speech !== 'never' && (speech === 'always' || (participantSpeech ?? faceToFace)));
  const hasVirtualBus = platform !== 'web';
  const pushToTranslate = turnMode === 'push-to-translate';

  const modeName = mode === 'speaker' ? t('modePicker.modeYou', 'Me') : mode === 'participant' ? t('modePicker.modeParticipants', 'Other') : t('modePicker.modeBoth', 'Both');
  const notInMode = t('audioPanel.lockedByMode', { mode: modeName, defaultValue: 'Not in "{{mode}}" mode.' });
  const blockedWholeSystem = t('audioPanel.blockedWholeSystem', 'All system sound is being captured: these playback options are off, so the translation is not translated again.');
  const lockedByRun = t('audioPanel.rowLockedByRun', 'Fixed for this session; stop it to change.');
  const channelName = (channel: 'left' | 'right') => (channel === 'left' ? t('audioPanel.channelLeft', 'left channel') : t('audioPanel.channelRight', 'right channel'));

  const previewOn = (outlet: OutletName) => {
    void getAppAudio()
      .then((app) => app.earPreview(outlet))
      .catch((error: unknown) => reportError('SpeechOutputSection', `The preview did not play: ${describeCause(error)}`, { cause: error }));
  };

  /** An outlet's device·channel select (spec §1.3), and face-to-face's 试听 beside it. */
  const outletSelect = (name: OutletName, rowLabel: string, withPreview: boolean) => (
    <>
      <select
        className="select-dropdown"
        aria-label={rowLabel}
        value={outletSelectValue(name, outlets[name], faceToFace, devices)}
        onChange={(e) => {
          const { device, channel } = parseEntryValue(e.target.value);
          setOutletDevice(name, device);
          setOutletChannel(name, channel);
        }}
      >
        {outletEntries(devices).map((entry) => {
          const base = entry.device === null
            ? (entry.channel === 'auto'
              ? (selectedMonitorDevice ? t('audioPanel.followDefaultNamed', { device: selectedMonitorDevice.label, defaultValue: 'Follow default ({{device}})' }) : t('audioPanel.followDefault', 'Follow default'))
              : t('audioPanel.followDefault', 'Follow default'))
            : entry.label!;
          const text = entry.channel === 'left' || entry.channel === 'right' ? `${base} · ${channelName(entry.channel)}` : base;
          return <option key={entryValue(entry)} value={entryValue(entry)}>{text}</option>;
        })}
      </select>
      {withPreview && (
        <button type="button" className="setting-row__preview" aria-label={t('audioPanel.previewRow', { row: rowLabel, defaultValue: 'Preview {{row}}' })} onClick={() => previewOn(name)}>
          <Play size={12} />
          {t('audioPanel.preview', 'Preview')}
        </button>
      )}
    </>
  );

  const otherLabel = t('audioPanel.otherHears', 'Translation the other side hears');
  const themLabel = t('audioPanel.iHear', 'Translation I hear');
  const meLabel = t('audioPanel.meToo', 'I hear it too');
  // The field is nowrap + ellipsis; its title keeps the full text reachable.
  const virtualMicField = platform === 'extension'
    ? t('audioPanel.virtualMicTabs', 'Virtual microphone · the meeting tab')
    : `${t('audioPanel.virtualMicrophone', 'Virtual microphone')} · ${virtualMicrophoneName()}`;
  const passthroughLabel = t('audioPanel.realVoicePassthrough', 'Passthrough');

  return (
    <div className={`config-section speech-section ${className}`} id="speech-section" data-tour="speech-section">
      <h3>
        <Volume2 size={18} />
        <span>{t('audioPanel.speechTitle', 'Speech')}</span>
        <Tooltip content={t('audioPanel.speechTooltip', 'Which translations are spoken, to whom, and on which device.')} position="top" icon="help" maxWidth={300} />
        <button
          className="section-refresh-button"
          onClick={refreshDevices}
          disabled={isLoading}
          title={t('audioPanel.refreshDevices')}
        >
          <RefreshCw size={14} className={isLoading ? 'spinning' : ''} />
        </button>
      </h3>

      <SettingRow label={t('audioPanel.defaultPlayback', 'Default playback device')} tooltip={t('audioPanel.defaultPlaybackTip', 'Sounds with no device of their own play here.')}>
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

      <SettingRow
        label={otherLabel}
        tooltip={speech === 'always' ? t('audioPanel.otherHearsAlwaysSpeaks', 'This service always speaks.') : speech === 'never' ? t('audioPanel.otherHearsNeverSpeaks', 'This service never speaks.') : t('audioPanel.otherHearsTip', 'What I say, translated and read aloud to the other side. Into the virtual microphone: the other side picks it as the microphone in their own app.')}
        greyed={myLegRuns ? undefined : notInMode}
        switch={{ checked: otherOn, onChange: () => setTextOnly(!textOnly), disabled: isSessionActive || speech !== 'optional', title: isSessionActive ? lockedByRun : undefined }}
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
          label={meLabel}
          tooltip={t('audioPanel.meTooTip', 'Also plays the translation the other side hears on my side (the spoken translation, not my own voice).')}
          sub
          greyed={!myLegRuns ? notInMode : recaptured ? blockedWholeSystem : !otherOn ? t('audioPanel.needsOtherHears', 'Nothing to hear while the translation is not spoken.') : undefined}
          switch={{ checked: !isMonitorMuted && !(recaptured && mode === 'both'), onChange: () => setMonitorMuted(!isMonitorMuted), disabled: recaptured && mode === 'both', describedBy: recaptured && mode === 'both' ? reasonId : undefined }}
        >
          {outletSelect('me', meLabel, false)}
        </SettingRow>
      )}

      {!faceToFace && hasVirtualBus && (
        <SettingRow
          label={passthroughLabel}
          tooltip={pushToTranslate ? t('audioPanel.passthroughManagedByPushToTranslate') : t('audioPanel.passthroughTip', 'Mixes my own voice, at a lower level, under the translation into the virtual microphone. 60% at most.')}
          sub
          greyed={!myLegRuns ? notInMode : undefined}
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
                className="slider"
              />
              <span className="setting-value">{t('audioPanel.passthroughVolume', { percent: Math.round(realVoicePassthroughVolume * 100), defaultValue: 'Volume {{percent}}%' })}</span>
            </div>
          )}
        </SettingRow>
      )}

      <SettingRow
        label={themLabel}
        tooltip={!participantOffered ? t('audioPanel.iHearNotOffered', "This service does not speak the other side's translation.") : t('audioPanel.iHearTip', 'What the other side says, translated and read aloud to me.')}
        greyed={!theirLegRuns ? notInMode : recaptured ? blockedWholeSystem : undefined}
        switch={{
          checked: themOn,
          onChange: () => setParticipantSpeech(!(participantSpeech ?? faceToFace)),
          disabled: isSessionActive || recaptured || !participantOffered || speech !== 'optional',
          title: isSessionActive ? lockedByRun : undefined,
          describedBy: recaptured ? reasonId : undefined,
        }}
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

      <SettingRow
        label={t('audioPanel.keepReplay', 'Keep spoken translations for replay')}
        tooltip={t('audioPanel.keepReplayTip', "Keeps the spoken translations in memory so each message's ▶ works; a long session uses more memory.")}
        switch={{ checked: keepReplayAudio, onChange: () => setKeepReplayAudio(!keepReplayAudio) }}
      />
    </div>
  );
};

export default SpeechOutputSection;
