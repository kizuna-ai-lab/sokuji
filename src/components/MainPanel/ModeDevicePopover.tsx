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
import { Mic, AudioLines, Volume2, Power, PowerOff, ChevronDown, ChevronUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { LucideIcon } from 'lucide-react';
import {
  useAudioContext,
  useIsMicMuted, useIsMonitorMuted, useIsParticipantMuted,
  useSetMicMuted, useSetMonitorMuted, useSetParticipantMuted,
} from '../../stores/audioStore';
import { isExtension } from '../../utils/environment';
import { useNavigateToSettings } from '../../stores/settingsStore';
import { isVirtualDevice, type AudioDevice } from '../Settings/shared/hooks';
import './ModeDevicePopover.scss';

interface ModeDevicePopoverProps {
  mode: 'speaker' | 'participant' | 'both';
  open: boolean;
  anchorEl: HTMLElement | null;
  onClose: () => void;
}

type ChannelKey = 'mic' | 'participant' | 'monitor';

interface ChannelRowSpec {
  key: ChannelKey;
  icon: LucideIcon;
  label: string;
  // Mic + monitor: device list + selected device. Participant: empty list, null device, subtitle text instead.
  devices: AudioDevice[];
  selectedDevice: AudioDevice | null;
  /** Participant only: descriptive subtitle in place of a device name. */
  subtitle?: string;
  isMuted: boolean;
  onMuteToggle: () => void;
  /** Mic + monitor only — participant has no device picker. */
  onSelectDevice?: (d: AudioDevice) => void;
  /** True when row is in scope and has no device picked. */
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
  } = useAudioContext();

  const isMicMuted = useIsMicMuted();
  const isMonitorMuted = useIsMonitorMuted();
  const isParticipantMuted = useIsParticipantMuted();
  const setMicMuted = useSetMicMuted();
  const setMonitorMuted = useSetMonitorMuted();
  const setParticipantMuted = useSetParticipantMuted();

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
          // Clamp to availableHeight so the popover never exceeds the viewport
          // (an internal scroll handles overflow). The Math.max with 0 guards
          // against floating-ui handing us a transient negative value.
          Object.assign(elements.floating.style, {
            maxHeight: `${Math.max(0, availableHeight)}px`,
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
  // Channel order: mic → monitor → participant
  const rows = useMemo<ChannelRowSpec[]>(() => {
    const list: ChannelRowSpec[] = [];

    const showMic = mode === 'speaker' || mode === 'both';
    // Speaker monitor is mutually exclusive with participant capture
    // (enforced in audioStore). In Both mode participant is always on,
    // so monitor cannot be on — hide the row entirely to avoid showing
    // a permanently-muted control.
    const showMonitor = mode === 'speaker';
    const showParticipant = mode === 'participant' || mode === 'both';

    // Hide Sokuji virtual devices from the device lists — they're not
    // user-selectable (they're internal routing). Mirrors what
    // AudioDeviceSection's DeviceList does in Settings.
    const filteredInputDevices = audioInputDevices.filter(d => !isVirtualDevice(d as any));
    const filteredMonitorDevices = audioMonitorDevices.filter(d => !isVirtualDevice(d as any));

    if (showMic) {
      list.push({
        key: 'mic',
        icon: Mic,
        label: t('modePicker.deviceMic', 'Microphone'),
        devices: filteredInputDevices,
        selectedDevice: selectedInputDevice,
        isMuted: isMicMuted,
        onMuteToggle: () => setMicMuted(!isMicMuted),
        onSelectDevice: (d) => { selectInputDevice(d); setMicMuted(false); },
        isMissing: !selectedInputDevice,
      });
    }

    if (showMonitor) {
      list.push({
        key: 'monitor',
        icon: Volume2,
        label: t('modePicker.deviceSpeakerMonitor', 'Speaker monitor'),
        devices: filteredMonitorDevices,
        selectedDevice: selectedMonitorDevice,
        isMuted: isMonitorMuted,
        onMuteToggle: () => setMonitorMuted(!isMonitorMuted),
        onSelectDevice: (d) => { selectMonitorDevice(d); setMonitorMuted(false); },
        isMissing: false, // monitor is optional
      });
    }

    if (showParticipant) {
      list.push({
        key: 'participant',
        icon: AudioLines,
        label: t('modePicker.deviceParticipantAudio', 'Participant audio'),
        devices: [],
        selectedDevice: null,
        subtitle: isExtension()
          ? t('popover.participantSubtitleExtension', 'Plays via system default')
          : t('popover.participantSubtitleElectron', 'All system audio'),
        isMuted: isParticipantMuted,
        onMuteToggle: () => setParticipantMuted(!isParticipantMuted),
        isMissing: false,
      });
    }

    return list;
  }, [
    mode,
    audioInputDevices, selectedInputDevice, isMicMuted,
    audioMonitorDevices, selectedMonitorDevice, isMonitorMuted,
    isParticipantMuted,
    selectInputDevice, selectMonitorDevice,
    setMicMuted, setMonitorMuted, setParticipantMuted,
    t,
  ]);

  if (!open || !anchorEl) return null;

  const headerLabel = mode === 'speaker'
    ? t('modePicker.popoverHeaderYou', 'You — devices')
    : mode === 'participant'
      ? t('modePicker.popoverHeaderParticipants', 'Participants — devices')
      : t('modePicker.popoverHeaderBoth', 'Both — devices');

  const summaryText = (row: ChannelRowSpec): { text: string; cls: string } => {
    // Participant: always show subtitle; status indicated by toggle icon
    if (row.subtitle) {
      return { text: row.subtitle, cls: row.isMuted ? 'mode-device-popover__summary--off' : '' };
    }
    if (row.isMuted) {
      return { text: t('popover.statusOff', 'Off'), cls: 'mode-device-popover__summary--off' };
    }
    if (!row.selectedDevice) {
      if (row.isMissing) {
        return { text: t('modePicker.notSelected', 'Not selected'), cls: 'mode-device-popover__summary--missing' };
      }
      return { text: t('modePicker.notSelected', 'Not selected'), cls: '' };
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

          return (
            <React.Fragment key={row.key}>
              <div className={`mode-device-popover__row${isExpanded ? ' mode-device-popover__row--expanded' : ''}${row.key === 'participant' ? ' mode-device-popover__row--participant' : ''}`}>
                <button
                  type="button"
                  className="mode-device-popover__row-main"
                  onClick={row.key === 'participant' ? undefined : () => setExpanded(isExpanded ? null : row.key)}
                  aria-expanded={row.key === 'participant' ? undefined : isExpanded}
                >
                  <Icon size={14} className="mode-device-popover__row-icon" />
                  <span className="mode-device-popover__row-label">{row.label}</span>
                  <span className={`mode-device-popover__summary ${summary.cls}`}>{summary.text}</span>
                  {row.key === 'participant' ? null : (isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
                </button>
                <button
                  type="button"
                  className={`mode-device-popover__mute-btn${row.isMuted ? ' mode-device-popover__mute-btn--off' : ''}`}
                  onClick={(e) => { e.stopPropagation(); row.onMuteToggle(); }}
                  aria-pressed={!row.isMuted}
                  aria-label={row.isMuted
                    ? t('popover.toggleOn', 'Turn on {{label}}', { label: row.label })
                    : t('popover.toggleOff', 'Turn off {{label}}', { label: row.label })}
                  title={row.isMuted
                    ? t('popover.toggleOn', 'Turn on {{label}}', { label: row.label })
                    : t('popover.toggleOff', 'Turn off {{label}}', { label: row.label })}
                >
                  {row.isMuted ? <PowerOff size={14} /> : <Power size={14} />}
                </button>
              </div>

              {isExpanded && row.key !== 'participant' && (
                <div className="mode-device-popover__device-list" role="listbox" aria-label={row.label}>
                  {row.devices.map((d) => {
                    const selected = row.selectedDevice?.deviceId === d.deviceId;
                    return (
                      <button
                        key={d.deviceId}
                        type="button"
                        className={`mode-device-popover__device-row${selected ? ' mode-device-popover__device-row--selected' : ''}`}
                        onClick={() => row.onSelectDevice!(d)}
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
          <button
            type="button"
            className="mode-device-popover__footer-link"
            onClick={() => {
              // navigateToSettings(null) is a no-op — MainLayout opens the
              // panel only on a truthy target. Pass the popover's current
              // mode as the section anchor so the user lands on the most
              // relevant section.
              const target = mode === 'speaker' ? 'microphone'
                : mode === 'participant' ? 'participant'
                : 'microphone';
              navigateToSettings(target);
              onClose();
            }}
          >
            {t('modePicker.popoverFooter', 'Full settings →')}
          </button>
        </div>
      </div>
    </FloatingPortal>
  );
};

export default ModeDevicePopover;
