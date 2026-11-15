import React, { useEffect, useId, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import DeviceSelect from '../shared/DeviceSelect';
import WarningModal from '../shared/WarningModal';
import { useFilteredDevices, WarningType, AudioDevice, isVirtualMic } from '../shared/hooks';
import { useAudioContext, useNoiseSuppressionMode, useSetNoiseSuppressionMode, NoiseSuppressionMode, useEchoCancellationMode, useSetEchoCancellationMode, EchoCancellationMode } from '../../../stores/audioStore';
import { useAnalytics } from '../../../lib/analytics';
import { isElectron, isLinux } from '../../../utils/environment';

interface AudioDeviceSectionProps {
  /** Real session-active state — used for analytics (during_session) only. */
  isSessionActive: boolean;
  /**
   * Per-channel lock — when true, disable interactive controls.
   * Defaults to isSessionActive for backward compatibility.
   * Callers that need finer-grained control (locking specific channels
   * while a session is active) should pass this explicitly.
   */
  isLocked?: boolean;
  /**
   * Why the microphone list is locked (i18n string): a run in progress, or the
   * participant-only mode. Rendered under the section heading while locked and
   * wired to the listbox as its aria-describedby, so a greyed list states its
   * reason rather than reading as broken.
   */
  lockedReason?: string;
  /** Additional class name */
  className?: string;
}

const AudioDeviceSection: React.FC<AudioDeviceSectionProps> = ({
  isSessionActive,
  isLocked,
  lockedReason,
  className = ''
}) => {
  const locked = isLocked ?? isSessionActive;
  const reactId = useId();
  // Only referenced (and only rendered) while locked, so an unlocked list stays
  // undescribed rather than pointing at an absent element.
  const showReason = locked && !!lockedReason;
  const reasonId = showReason ? `${reactId}-mic-locked-reason` : undefined;
  const renderReason = () => showReason && (
    <span className="setting-description section-locked-reason" id={reasonId}>
      {lockedReason}
    </span>
  );
  const { t } = useTranslation();
  const { trackEvent } = useAnalytics();
  const noiseSuppressionMode = useNoiseSuppressionMode();
  const setNoiseSuppressionMode = useSetNoiseSuppressionMode();
  const echoCancellationMode = useEchoCancellationMode();
  const setEchoCancellationMode = useSetEchoCancellationMode();
  // `true` cancels what the browser plays: the desktop app is the browser, the
  // extension shares Chrome with every other tab.
  const ownPlayout = isElectron() ? 'app' : 'browser';

  const {
    audioInputDevices,
    selectedInputDevice,
    isMicMuted,
    isLoading,
    selectInputDevice,
    setMicMuted,
    refreshDevices
  } = useAudioContext();

  // Filter out virtual devices
  const filteredInputDevices = useFilteredDevices(audioInputDevices);

  // Warning modal state
  const [warningType, setWarningType] = useState<WarningType | null>(null);

  // Close the warning modal when the panel hides (<Activity> runs effect
  // cleanups on hide); a hidden-but-open dialog would otherwise reappear on
  // the next reveal and swallow the visible panel's Escape key.
  useEffect(() => () => setWarningType(null), []);

  const handleInputDeviceSelect = (device: AudioDevice) => {
    if (isMicMuted) {
      setMicMuted(false);
    }
    selectInputDevice(device);
    trackEvent('audio_device_changed', {
      device_type: 'input',
      device_name: device.label,
      change_type: 'selected',
      during_session: isSessionActive
    });
  };

  const handleInputVirtualDeviceClick = (device: AudioDevice) => {
    // DeviceSelect routes two kinds of risky input picks here: Sokuji's own
    // virtual devices (selection blocked) and OS loopback-style inputs
    // (selection goes through, warned). Each gets its own explanation.
    setWarningType(isVirtualMic(device) ? 'virtual-mic' : 'loopback-mic');
    trackEvent('virtual_device_warning', {
      device_type: 'input',
      action_taken: 'ignored'
    });
  };

  return (
    <>
      <WarningModal
        isOpen={warningType !== null}
        onClose={() => setWarningType(null)}
        type={warningType}
      />

      {/* Microphone: the mock's audio page (v18) — a plain heading with its hint, then the device and two choices. */}
      <div className={`config-section microphone-section ${className}`} id="microphone-section" data-tour="microphone-section">
        <h3 className="settings-subhead">
          <span>{t('simpleConfig.microphone')}</span>
          <small>{t('settingsPage.audio.micHint', 'Where my voice comes in')}</small>
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

        {renderReason()}

        <label className="settings-field">
          <span className="settings-field__label">{t('settingsPage.audio.device', 'Device')}</span>
          <DeviceSelect
            label={t('settingsPage.audio.device', 'Device')}
            devices={filteredInputDevices}
            selectedDevice={selectedInputDevice}
            isDeviceOn={!isMicMuted}
            onSelect={handleInputDeviceSelect}
            onToggleOff={() => setMicMuted(!isMicMuted)}
            disabled={locked}
            showVirtualIndicators={true}
            onVirtualDeviceClick={handleInputVirtualDeviceClick}
            ariaDescribedBy={reasonId}
          />
        </label>

        {/* Noise suppression: each mode explained on hover, as the mock has no help marks. */}
        <div className="settings-field noise-suppression-control">
          <span className="settings-field__label noise-suppression-label">{t('settings.noiseSuppression')}</span>
          <span className="settings-seg noise-suppression-modes" role="group" aria-label={t('settings.noiseSuppression')}>
            {(['off', 'standard', 'enhanced'] as NoiseSuppressionMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                className={noiseSuppressionMode === mode ? 'active' : undefined}
                aria-pressed={noiseSuppressionMode === mode}
                title={t(`settings.noiseSuppressionTooltip.${mode}`)}
                onClick={() => {
                  setNoiseSuppressionMode(mode);
                  trackEvent('noise_suppression_toggled', {
                    enabled: mode !== 'off',
                    mode,
                    during_session: isSessionActive
                  });
                }}
              >
                {t(`settings.noiseSuppressionMode.${mode}`)}
              </button>
            ))}
          </span>
        </div>

        {/* Echo Cancellation: Chromium on Linux has no 'all', so nothing to choose there */}
        {!isLinux() && (
          <div className="settings-field noise-suppression-control">
            <span className="settings-field__label noise-suppression-label">{t('settings.echoCancellation')}</span>
            <span className="settings-seg noise-suppression-modes" role="group" aria-label={t('settings.echoCancellation')}>
              {(['app', 'all'] as EchoCancellationMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={echoCancellationMode === mode ? 'active' : undefined}
                  aria-pressed={echoCancellationMode === mode}
                  title={t(`settings.echoCancellationTooltip.${mode === 'app' ? ownPlayout : 'all'}`)}
                  onClick={() => {
                    setEchoCancellationMode(mode);
                    trackEvent('echo_cancellation_changed', {
                      mode,
                      during_session: isSessionActive
                    });
                  }}
                >
                  {t(`settings.echoCancellationMode.${mode === 'app' ? ownPlayout : 'all'}`)}
                </button>
              ))}
            </span>
          </div>
        )}
      </div>
    </>
  );
};

export default AudioDeviceSection;
