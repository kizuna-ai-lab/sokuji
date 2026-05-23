import React, { useState, useMemo } from 'react';
import {
  useFloating,
  useDismiss,
  useInteractions,
  FloatingPortal,
  offset,
  flip,
  shift,
  size,
  autoUpdate,
} from '@floating-ui/react';
import { Mic, AudioLines, Volume2, Headphones, ChevronDown, ChevronUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { LucideIcon } from 'lucide-react';
import { useAudioContext } from '../../stores/audioStore';
import { isExtension } from '../../utils/environment';
import { useNavigateToSettings } from '../../stores/settingsStore';
import type { AudioDevice } from '../Settings/shared/hooks';
import './ModeDevicePopover.scss';

interface ModeDevicePopoverProps {
  mode: 'speaker' | 'participant' | 'both';
  open: boolean;
  anchorEl: HTMLElement | null;
  onClose: () => void;
}

type ChannelKey = 'mic' | 'participant' | 'monitor' | 'passthrough';

interface ChannelRowSpec {
  key: ChannelKey;
  icon: LucideIcon;
  label: string;
  devices: AudioDevice[];
  selectedDevice: AudioDevice | null;
  /**
   * For the 3 main channels: whether the channel is unmuted.
   * For passthrough (extension): always treated as "on" because it has
   * no mute toggle — it's optional and defaults to the default output.
   */
  isOn: boolean;
  /** Mute the channel (preserves device selection). */
  onMute?: () => void;
  /** Pick a device. For the 3 main channels also unmutes. */
  onSelectDevice: (d: AudioDevice) => void;
  /** True when no device is selected AND channel is unmuted — show warning. */
  isMissing: boolean;
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
    isInputDeviceOn,
    isMonitorDeviceOn,
    setInputDeviceOn,
    setMonitorDeviceOn,
    systemAudioSources,
    selectedSystemAudioSource,
    selectSystemAudioSource,
    isSystemAudioCaptureEnabled,
    setSystemAudioCaptureEnabled,
    participantAudioOutputDevice,
    selectParticipantAudioOutputDevice,
  } = useAudioContext();

  // Only one row expanded at a time. Default: none expanded.
  const [expanded, setExpanded] = useState<ChannelKey | null>(null);

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: (next) => { if (!next) onClose(); },
    placement: 'top',
    // autoUpdate watches anchor/floating size changes so expanding a row
    // (which grows the popover) triggers a re-position and re-clamp.
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(8),
      flip(),
      shift({ padding: 8 }),
      // size clamps the popover's max-height to the available space so a
      // tall expansion can't push the bottom off-screen. The popover's
      // scrollable middle section handles overflow internally.
      size({
        padding: 8,
        apply({ availableHeight, elements }) {
          Object.assign(elements.floating.style, {
            maxHeight: `${Math.max(availableHeight, 200)}px`,
          });
        },
      }),
    ],
    elements: { reference: anchorEl ?? undefined },
  });

  // Exclude clicks on the anchor (the active mode-picker segment) from
  // triggering dismiss. The segment's own onClick handler in MainPanel
  // toggles the popover open/closed.
  const dismiss = useDismiss(context, {
    outsidePress: (event) => {
      const target = event.target as Node | null;
      if (anchorEl && target && anchorEl.contains(target)) return false;
      return true;
    },
  });
  const { getFloatingProps } = useInteractions([dismiss]);

  // Build the list of rows the popover should render based on mode.
  // Channel order: mic → monitor → participant source → (extension) passthrough
  // Rationale: the user's own I/O (mic + monitor) groups first, then the
  // participant-side I/O (capture source + optional original passthrough).
  const rows = useMemo<ChannelRowSpec[]>(() => {
    const list: ChannelRowSpec[] = [];

    const showMic = mode === 'speaker' || mode === 'both';
    // Speaker monitor is mutually exclusive with participant capture
    // (enforced in audioStore). In Both mode participant is always on,
    // so monitor cannot be on — hide the row entirely to avoid showing
    // a permanently-Off control.
    const showMonitor = mode === 'speaker';
    const showParticipantSource = !isExtension() && (mode === 'participant' || mode === 'both');
    const showPassthrough = isExtension() && (mode === 'participant' || mode === 'both');

    if (showMic) {
      list.push({
        key: 'mic',
        icon: Mic,
        label: t('modePicker.deviceMic', 'Microphone'),
        devices: audioInputDevices,
        selectedDevice: selectedInputDevice,
        isOn: isInputDeviceOn,
        onMute: () => setInputDeviceOn(false),
        onSelectDevice: (d) => {
          selectInputDevice(d);
          if (!isInputDeviceOn) setInputDeviceOn(true);
        },
        isMissing: isInputDeviceOn && !selectedInputDevice,
      });
    }

    if (showMonitor) {
      list.push({
        key: 'monitor',
        icon: Volume2,
        label: t('modePicker.deviceSpeakerMonitor', 'Speaker monitor'),
        devices: audioMonitorDevices,
        selectedDevice: selectedMonitorDevice,
        isOn: isMonitorDeviceOn,
        onMute: () => setMonitorDeviceOn(false),
        onSelectDevice: (d) => {
          selectMonitorDevice(d);
          setMonitorDeviceOn(true);
        },
        isMissing: false, // monitor is never required
      });
    }

    if (showParticipantSource) {
      list.push({
        key: 'participant',
        icon: AudioLines,
        label: t('modePicker.deviceParticipantSource', 'Participant source'),
        devices: (systemAudioSources ?? []) as AudioDevice[],
        selectedDevice: (selectedSystemAudioSource ?? null) as AudioDevice | null,
        isOn: isSystemAudioCaptureEnabled,
        onMute: () => setSystemAudioCaptureEnabled(false),
        onSelectDevice: (d) => {
          selectSystemAudioSource(d as any);
          if (!isSystemAudioCaptureEnabled) setSystemAudioCaptureEnabled(true);
        },
        isMissing: isSystemAudioCaptureEnabled && !selectedSystemAudioSource,
      });
    }

    if (showPassthrough) {
      // Extension-only optional row, grouped with participant source.
      // No mute toggle — "Off" means use the default output.
      list.push({
        key: 'passthrough',
        icon: Headphones,
        label: t('modePicker.devicePassthrough', 'Original audio passthrough'),
        devices: audioMonitorDevices,
        selectedDevice: participantAudioOutputDevice,
        isOn: true,
        onSelectDevice: (d) => selectParticipantAudioOutputDevice(d),
        isMissing: false,
      });
    }

    return list;
  }, [
    mode,
    audioInputDevices, selectedInputDevice, isInputDeviceOn,
    audioMonitorDevices, selectedMonitorDevice, isMonitorDeviceOn,
    systemAudioSources, selectedSystemAudioSource, isSystemAudioCaptureEnabled,
    participantAudioOutputDevice,
    selectInputDevice, selectMonitorDevice, selectSystemAudioSource, selectParticipantAudioOutputDevice,
    setInputDeviceOn, setSystemAudioCaptureEnabled, setMonitorDeviceOn,
    t,
  ]);

  if (!open || !anchorEl) return null;

  const headerLabel = mode === 'speaker'
    ? t('modePicker.popoverHeaderYou', 'You — devices')
    : mode === 'participant'
      ? t('modePicker.popoverHeaderParticipants', 'Participants — devices')
      : t('modePicker.popoverHeaderBoth', 'Both — devices');

  const summaryText = (row: ChannelRowSpec): { text: string; cls: string } => {
    if (row.key === 'passthrough') {
      return row.selectedDevice
        ? { text: row.selectedDevice.label || row.selectedDevice.deviceId, cls: '' }
        : { text: t('modePicker.useDefault', 'Default output'), cls: 'mode-device-popover__summary--default' };
    }
    if (!row.isOn) {
      return { text: t('common.off', 'Off'), cls: 'mode-device-popover__summary--off' };
    }
    if (!row.selectedDevice) {
      return { text: t('modePicker.notSelected', 'Not selected'), cls: 'mode-device-popover__summary--missing' };
    }
    return { text: row.selectedDevice.label || row.selectedDevice.deviceId, cls: '' };
  };

  return (
    <FloatingPortal>
      <div
        ref={refs.setFloating}
        className="mode-device-popover"
        style={floatingStyles}
        {...getFloatingProps()}
      >
        <div className="mode-device-popover__header">{headerLabel}</div>

        <div className="mode-device-popover__scroll">
        {rows.map((row) => {
          const Icon = row.icon;
          const summary = summaryText(row);
          const isExpanded = expanded === row.key;
          // For passthrough: "off" in the device list represents the null
          // (default output) state. For the 3 main channels: "off" represents
          // the muted state.
          const offSelected = row.key === 'passthrough'
            ? !row.selectedDevice
            : !row.isOn;

          return (
            <React.Fragment key={row.key}>
              <button
                type="button"
                className={`mode-device-popover__row${isExpanded ? ' mode-device-popover__row--expanded' : ''}`}
                onClick={() => setExpanded(isExpanded ? null : row.key)}
                aria-expanded={isExpanded}
              >
                <Icon size={14} className="mode-device-popover__row-icon" />
                <span className="mode-device-popover__row-label">{row.label}</span>
                <span className={`mode-device-popover__summary ${summary.cls}`}>{summary.text}</span>
                {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>

              {isExpanded && (
                <div className="mode-device-popover__device-list" role="listbox" aria-label={row.label}>
                  <button
                    type="button"
                    className={`mode-device-popover__device-row mode-device-popover__device-row--off${offSelected ? ' mode-device-popover__device-row--selected' : ''}`}
                    onClick={() => {
                      if (row.key === 'passthrough') {
                        // Extension passthrough: "Off" = pick the default output
                        // by passing null. (The action signature accepts null
                        // to clear the selection.)
                        selectParticipantAudioOutputDevice(null as any);
                      } else if (row.onMute) {
                        row.onMute();
                      }
                    }}
                  >
                    <span>{row.key === 'passthrough'
                      ? t('modePicker.useDefault', 'Default output')
                      : t('common.off', 'Off')}</span>
                    {offSelected && <span className="mode-device-popover__indicator" />}
                  </button>
                  {row.devices.map((d) => {
                    const selected = !offSelected && row.selectedDevice?.deviceId === d.deviceId;
                    return (
                      <button
                        key={d.deviceId}
                        type="button"
                        className={`mode-device-popover__device-row${selected ? ' mode-device-popover__device-row--selected' : ''}`}
                        onClick={() => row.onSelectDevice(d)}
                      >
                        <span>{d.label || d.deviceId}</span>
                        {selected && <span className="mode-device-popover__indicator" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </React.Fragment>
          );
        })}
        </div>

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
