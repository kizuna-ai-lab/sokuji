import React from 'react';
import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import ToggleSwitch from '../shared/ToggleSwitch';
import {
  useIsParticipantMuted, useSetParticipantMuted,
  useParticipantSources, useSelectedParticipantSource, useSelectParticipantSource,
  useRefreshDevices, useIsAudioLoading, useMode,
  type AudioDevice,
} from '../../../stores/audioStore';
import DeviceSelect from '../shared/DeviceSelect';
import { useAnalytics } from '../../../lib/analytics';
import { isExtension, isElectron } from '../../../utils/environment';
import { useFaceToFace } from '../../MainPanel/useFaceToFace';
import OtherSideChoice from '../../FaceToFace/OtherSideChoice';

interface SystemAudioSectionProps {
  /** Real session-active state. Locks the other-side choice for the run's
   *  whole shape — unlike `isLocked` below, this one never varies by mode
   *  scope. */
  isSessionActive: boolean;
  /**
   * Lock the picker. Callers pass a mode-scope lock; the participant channel is
   * only selectable in participant/both mode.
   *
   * It deliberately does NOT default to isSessionActive: sources can be
   * switched during a live session, and defaulting to the session state
   * contradicted that for any caller that left this out.
   * Callers that need per-channel locking (lock participant but not others)
   * pass this explicitly.
   */
  isLocked?: boolean;
  /** Additional class name */
  className?: string;
}

const SystemAudioSection: React.FC<SystemAudioSectionProps> = ({
  isSessionActive,
  isLocked,
  className = ''
}) => {
  const { t } = useTranslation();
  const isParticipantMuted = useIsParticipantMuted();
  const setParticipantMuted = useSetParticipantMuted();
  const participantSources = useParticipantSources();
  const selectedParticipantSource = useSelectedParticipantSource();
  const selectParticipantSource = useSelectParticipantSource();
  const { trackEvent } = useAnalytics();
  const refreshDevices = useRefreshDevices();
  const isLoading = useIsAudioLoading();
  const locked = isLocked ?? false;
  const mode = useMode();
  const faceToFace = useFaceToFace();
  const besideMe = faceToFace.active;

  // On Electron the source list replaces the on/off toggle entirely: its own
  // "Off" row is the control, so it must render even when the only source is
  // whole-system capture, or the channel could never be turned back on.
  // The extension has no source concept (tab capture is already scoped), so it
  // keeps the plain toggle.
  const showSourcePicker = !besideMe && isElectron() && participantSources.length > 0;

  const handleSourceSelect = (device: AudioDevice) => {
    // `locked` is about mode scope, not the session: picking a source during
    // a live session is supported — the app capture follows the source live
    // (`systemAudioSettings()`, appCapture.ts:40-47), so nothing here needs
    // to rebuild it.
    if (locked) return;
    selectParticipantSource(device);
    // Picking a source is also how the channel is switched back on, mirroring
    // the microphone and speaker lists.
    setParticipantMuted(false);
    trackEvent('participant_source_selected', { deviceId: device.deviceId });
  };

  // What the participant channel captures, beside its switch where there is
  // no source to pick. Platform-conditional because Extension captures the
  // active tab while Electron captures all system audio.
  const description = isExtension()
    ? t('settings.participantSectionDescriptionExtension', 'Translate audio from the active browser tab. The original audio plays through your system default output.')
    : t('settings.participantSectionDescriptionElectron', 'Translate audio from any application playing on this system.');

  const handleToggle = () => {
    if (locked) return;
    setParticipantMuted(!isParticipantMuted);
  };

  return (
    <div
      className={`config-section system-audio-section ${className}`}
      id="participant-section"
      data-tour="participant-section"
      data-section-aliases="system-audio-section"
    >
      <h3 className="settings-subhead">
        <span>{t('settings.participantSectionHeader', "Other's audio")}</span>
        <small>{t('settingsPage.audio.otherHint', "Where the other side's voice comes in")}</small>
        {/* Applications come and go far more often than sound cards do, so this
            list goes stale faster than the mic/speaker ones. */}
        {showSourcePicker && (
          <button
            className="section-refresh-button"
            onClick={refreshDevices}
            disabled={isLoading}
            title={t('audioPanel.refreshDevices')}
            aria-label={t('audioPanel.refreshDevices')}
          >
            <RefreshCw size={14} className={isLoading ? 'spinning' : ''} />
          </button>
        )}
      </h3>
      {mode === 'both' && faceToFace.offered && <OtherSideChoice locked={isSessionActive} />}
      {besideMe ? (
        <p className="setting-description">{t('audioPanel.otherSideBesideNote', 'The other person shares your microphone; no system audio is captured.')}</p>
      ) : showSourcePicker ? (
        <label className="settings-field">
          <span className="settings-field__label">{t('settingsPage.audio.source', 'Source')}</span>
          <DeviceSelect
            label={t('settingsPage.audio.source', 'Source')}
            devices={participantSources}
            selectedDevice={selectedParticipantSource}
            isDeviceOn={!isParticipantMuted}
            onSelect={handleSourceSelect}
            onToggleOff={() => { if (!locked) setParticipantMuted(true); }}
            disabled={locked}
            showVirtualIndicators={false}
          />
        </label>
      ) : (
        // Nothing to pick (the extension's tab, or no source list): a row that says what is captured, and its switch.
        <div className="settings-switch-row">
          <span className="settings-switch-row__text">{description}</span>
          <ToggleSwitch
            checked={!isParticipantMuted}
            onChange={handleToggle}
            label=""
            ariaLabel={t('settings.participantSectionHeader', "Other's audio")}
            disabled={locked}
          />
        </div>
      )}
    </div>
  );
};

export default SystemAudioSection;
