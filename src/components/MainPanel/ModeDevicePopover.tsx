import React from 'react';
import {
  useFloating,
  useDismiss,
  useInteractions,
  FloatingPortal,
  offset,
  flip,
  shift,
} from '@floating-ui/react';
import { Mic, AudioLines, Volume2, Headphones } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAudioContext } from '../../stores/audioStore';
import { isExtension } from '../../utils/environment';
import { useNavigateToSettings } from '../../stores/settingsStore';
import './ModeDevicePopover.scss';

interface ModeDevicePopoverProps {
  mode: 'speaker' | 'participant' | 'both';
  open: boolean;
  anchorEl: HTMLElement | null;
  onClose: () => void;
}

const ModeDevicePopover: React.FC<ModeDevicePopoverProps> = ({ mode, open, anchorEl, onClose }) => {
  const { t } = useTranslation();
  const navigateToSettings = useNavigateToSettings();

  const {
    audioInputDevices,
    audioMonitorDevices,
    selectedInputDevice,
    selectedMonitorDevice,
    selectInputDevice,
    selectMonitorDevice,
    systemAudioSources,
    selectedSystemAudioSource,
    selectSystemAudioSource,
    participantAudioOutputDevice,
    selectParticipantAudioOutputDevice,
  } = useAudioContext();

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: (next) => { if (!next) onClose(); },
    placement: 'top',
    middleware: [offset(8), flip(), shift({ padding: 8 })],
    elements: { reference: anchorEl ?? undefined },
  });

  // Exclude clicks on the anchor (the active mode-picker segment) from
  // triggering dismiss. The segment's own onClick handler in MainPanel
  // toggles the popover open/closed — without this exclusion, clicking
  // the active segment would race against useDismiss's outsidePress
  // close, making the toggle behavior unpredictable.
  const dismiss = useDismiss(context, {
    outsidePress: (event) => {
      const target = event.target as Node | null;
      if (anchorEl && target && anchorEl.contains(target)) return false;
      return true;
    },
  });
  const { getFloatingProps } = useInteractions([dismiss]);

  if (!open || !anchorEl) return null;

  const showMic = mode === 'speaker' || mode === 'both';
  const showParticipant = mode === 'participant' || mode === 'both';
  const showSpeaker = mode === 'speaker' || mode === 'both';
  const showExtensionPassthrough = isExtension() && (mode === 'participant' || mode === 'both');

  const headerLabel = mode === 'speaker'
    ? t('modePicker.popoverHeaderYou', 'You — devices')
    : mode === 'participant'
      ? t('modePicker.popoverHeaderParticipants', 'Participants — devices')
      : t('modePicker.popoverHeaderBoth', 'Both — devices');

  return (
    <FloatingPortal>
      <div
        ref={refs.setFloating}
        className="mode-device-popover"
        style={floatingStyles}
        {...getFloatingProps()}
      >
        <div className="mode-device-popover__header">{headerLabel}</div>

        {showMic && (
          <div className="mode-device-popover__row">
            <Mic size={14} />
            <span className="label">{t('modePicker.deviceMic', 'Microphone')}</span>
            <select
              value={selectedInputDevice?.deviceId ?? ''}
              onChange={(e) => {
                const d = audioInputDevices.find((x) => x.deviceId === e.target.value);
                if (d) selectInputDevice(d);
              }}
            >
              <option value="" disabled>{t('modePicker.notSelected', 'Not selected')}</option>
              {audioInputDevices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId}</option>
              ))}
            </select>
          </div>
        )}

        {showParticipant && !isExtension() && (
          <div className="mode-device-popover__row">
            <AudioLines size={14} />
            <span className="label">{t('modePicker.deviceParticipantSource', 'Participant source')}</span>
            <select
              value={selectedSystemAudioSource?.deviceId ?? ''}
              onChange={(e) => {
                const s = (systemAudioSources ?? []).find((x) => x.deviceId === e.target.value);
                if (s) selectSystemAudioSource(s);
              }}
            >
              <option value="" disabled>{t('modePicker.notSelected', 'Not selected')}</option>
              {(systemAudioSources ?? []).map((s) => (
                <option key={s.deviceId} value={s.deviceId}>{s.label || s.deviceId}</option>
              ))}
            </select>
          </div>
        )}

        {showExtensionPassthrough && (
          <div className="mode-device-popover__row">
            <Headphones size={14} />
            <span className="label">{t('modePicker.devicePassthrough', 'Original audio passthrough')}</span>
            <select
              value={participantAudioOutputDevice?.deviceId ?? ''}
              onChange={(e) => {
                const d = audioMonitorDevices.find((x) => x.deviceId === e.target.value);
                if (d) selectParticipantAudioOutputDevice(d);
              }}
            >
              <option value="">{t('modePicker.useDefault', 'Default output')}</option>
              {audioMonitorDevices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId}</option>
              ))}
            </select>
          </div>
        )}

        {showSpeaker && (
          <div className="mode-device-popover__row">
            <Volume2 size={14} />
            <span className="label">{t('modePicker.deviceSpeakerMonitor', 'Speaker monitor')}</span>
            <select
              value={selectedMonitorDevice?.deviceId ?? ''}
              onChange={(e) => {
                const d = audioMonitorDevices.find((x) => x.deviceId === e.target.value);
                if (d) selectMonitorDevice(d);
              }}
            >
              <option value="" disabled>{t('modePicker.notSelected', 'Not selected')}</option>
              {audioMonitorDevices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId}</option>
              ))}
            </select>
          </div>
        )}

        <div className="mode-device-popover__divider" />
        <div className="mode-device-popover__footer">
          <a onClick={() => {
            // navigateToSettings(null) is a no-op — MainLayout opens the
            // panel only on a truthy target. Pass the popover's current
            // mode as the section anchor so the user lands on the most
            // relevant section.
            const target = mode === 'speaker' ? 'microphone'
              : mode === 'participant' ? 'participant'
              : 'microphone';
            navigateToSettings(target);
            onClose();
          }}>
            {t('modePicker.popoverFooter', 'Full settings →')}
          </a>
        </div>
      </div>
    </FloatingPortal>
  );
};

export default ModeDevicePopover;
