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
import { Mic, AudioLines, Volume2, Headphones, ArrowLeftRight, Play, Power, PowerOff, ChevronDown, ChevronUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { LucideIcon } from 'lucide-react';
import {
  useAudioContext,
  useIsMicMuted, useIsMonitorMuted, useIsParticipantMuted,
  useSetMicMuted, useSetMonitorMuted, useSetParticipantMuted,
  useParticipantSources, useSelectedParticipantSource, useSelectParticipantSource,
  useOtherSide, useSetOtherSide,
} from '../../stores/audioStore';
import { useRoutingStore } from '../../stores/routingStore';
import { useFaceToFace } from './useFaceToFace';
import { getAppAudio } from '../../lib/audio/appAudio';
import { earsFor } from '../../lib/audio/routes';
import { useLanguageLabel } from '../../lib/language/useLanguageLabel';
import { isExtension } from '../../utils/environment';
import { useNavigateToSettings } from '../../stores/settingsStore';
import { isVirtualDevice, type AudioDevice } from '../Settings/shared/hooks';
import { describeDeviceOnHover } from '../../utils/audioDevices';
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
  // Mic, monitor, and per-application participant capture: device list +
  // selected device. Participant without a per-app helper: empty list, null
  // device, subtitle text instead.
  devices: AudioDevice[];
  selectedDevice: AudioDevice | null;
  /** Shown in place of a device name when the row has no picker. */
  subtitle?: string;
  isMuted: boolean;
  /** Absent: the row has no power switch — face-to-face's headphones play whenever a translation is spoken. */
  onMuteToggle?: () => void;
  /** Absent on rows that have no picker (participant without a per-app helper). */
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
  const participantSources = useParticipantSources();
  const selectedParticipantSource = useSelectedParticipantSource();
  const selectParticipantSource = useSelectParticipantSource();
  const setMicMuted = useSetMicMuted();
  const setMonitorMuted = useSetMonitorMuted();
  const setParticipantMuted = useSetParticipantMuted();

  const f2f = useFaceToFace();
  const otherSide = useOtherSide();
  const setOtherSide = useSetOtherSide();
  const setSwap = useRoutingStore((s) => s.setFaceToFaceSwap);
  const label = useLanguageLabel();
  const beside = mode === 'both' && f2f.active;

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
    // Face-to-face (beside me) is the exception: the translation plays on the
    // headphones and the other person is not captured from system audio.
    const showMonitor = mode === 'speaker' || beside;
    const showParticipant = mode === 'participant' || (mode === 'both' && !beside);

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
      list.push(beside
        ? {
          key: 'monitor',
          icon: Headphones,
          label: t('popover.headphones', 'Headphones'),
          devices: filteredMonitorDevices,
          selectedDevice: selectedMonitorDevice,
          isMuted: false,
          onSelectDevice: (d) => selectMonitorDevice(d),
          isMissing: false,
        }
        : {
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
      // Participant capture used to be all-or-nothing, so this row showed a
      // fixed subtitle. It can now be scoped to one application, in which case
      // it gets a real picker like the mic and monitor rows. Without a per-app
      // helper the list holds only the whole-system entry and the old subtitle
      // is still the honest answer.
      const canPickSource = !isExtension() && participantSources.length > 1;
      list.push({
        key: 'participant',
        icon: AudioLines,
        label: t('modePicker.deviceParticipantAudio', "Other's audio"),
        devices: canPickSource ? participantSources : [],
        selectedDevice: canPickSource ? selectedParticipantSource : null,
        subtitle: canPickSource
          ? undefined
          : isExtension()
            ? t('popover.participantSubtitleExtension', 'Plays via system default')
            : t('popover.participantSubtitleElectron', 'All system audio'),
        isMuted: isParticipantMuted,
        onMuteToggle: () => setParticipantMuted(!isParticipantMuted),
        onSelectDevice: canPickSource
          ? (d) => { selectParticipantSource(d); setParticipantMuted(false); }
          : undefined,
        isMissing: false,
      });
    }

    return list;
  }, [
    mode, beside,
    audioInputDevices, selectedInputDevice, isMicMuted,
    audioMonitorDevices, selectedMonitorDevice, isMonitorMuted,
    isParticipantMuted, participantSources, selectedParticipantSource,
    selectInputDevice, selectMonitorDevice, selectParticipantSource,
    setMicMuted, setMonitorMuted, setParticipantMuted,
    t,
  ]);

  if (!open || !anchorEl) return null;

  const headerLabel = mode === 'speaker'
    ? t('modePicker.popoverHeaderYou', 'Me — devices')
    : mode === 'participant'
      ? t('modePicker.popoverHeaderParticipants', 'Other — devices')
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
          // A row is expandable when it actually has something to pick. This
          // used to be hardcoded as "every row except participant"; participant
          // capture can now be scoped to one application, so the capability -
          // not the channel - decides.
          const canExpand = !!row.onSelectDevice && row.devices.length > 0;

          return (
            <React.Fragment key={row.key}>
              <div className={`mode-device-popover__row${isExpanded ? ' mode-device-popover__row--expanded' : ''}${row.key === 'participant' ? ' mode-device-popover__row--participant' : ''}`}>
                <button
                  type="button"
                  className="mode-device-popover__row-main"
                  onClick={canExpand ? () => setExpanded(isExpanded ? null : row.key) : undefined}
                  aria-expanded={canExpand ? isExpanded : undefined}
                >
                  <Icon size={14} className="mode-device-popover__row-icon" />
                  <span className="mode-device-popover__row-label">{row.label}</span>
                  <span className={`mode-device-popover__summary ${summary.cls}`}>{summary.text}</span>
                  {canExpand ? (isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />) : null}
                </button>
                {row.onMuteToggle && (
                <button
                  type="button"
                  className={`mode-device-popover__mute-btn${row.isMuted ? ' mode-device-popover__mute-btn--off' : ''}`}
                  onClick={(e) => { e.stopPropagation(); row.onMuteToggle?.(); }}
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
                )}
              </div>

              {isExpanded && canExpand && (
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
                        <span title={describeDeviceOnHover(d)}>{d.label || d.deviceId}</span>
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

        {mode === 'both' && f2f.offered && (
          <div className="mode-device-popover__other-side" role="radiogroup" aria-label={t('popover.otherSide', 'Other side')}>
            {(['meeting', 'beside'] as const).map((side) => (
              <label key={side} className={`mode-device-popover__side${otherSide === side ? ' mode-device-popover__side--active' : ''}`}>
                <input type="radio" name="other-side" checked={otherSide === side} onChange={() => setOtherSide(side)} />
                <span className="mode-device-popover__side-title">
                  {side === 'meeting' ? t('popover.otherSideMeeting', 'In a meeting') : t('popover.otherSideBeside', 'Beside me')}
                </span>
                <span className="mode-device-popover__side-hint">
                  {side === 'meeting' ? t('popover.otherSideMeetingHint', 'Captures the system audio or an app') : t('popover.otherSideBesideHint', 'Two people at one microphone')}
                </span>
              </label>
            ))}
          </div>
        )}

        {beside && f2f.me && f2f.other && (
          <div className="mode-device-popover__ears">
            <div className="mode-device-popover__ears-title">{t('faceToFace.earsTitle', 'Left and right · each person hears the translation into their own language')}</div>
            {(['left', 'right'] as const).map((ear) => {
              const mine = earsFor(f2f.swap).participant === ear;
              const pan = ear === 'left' ? -1 : 1;
              const earName = ear === 'left' ? t('faceToFace.leftEar', 'Left ear') : t('faceToFace.rightEar', 'Right ear');
              return (
                <div key={ear} className={`mode-device-popover__ear mode-device-popover__ear--${mine ? 'me' : 'other'}`}>
                  <span className="mode-device-popover__ear-letter">{ear === 'left' ? t('faceToFace.earLeft', 'L') : t('faceToFace.earRight', 'R')}</span>
                  <span className="mode-device-popover__ear-name">{earName}</span>
                  <span className="mode-device-popover__ear-who">
                    {mine
                      ? t('faceToFace.meListens', 'Me ({{language}})', { language: label(f2f.me!) })
                      : t('faceToFace.otherListens', 'Other person ({{language}})', { language: label(f2f.other!) })}
                  </span>
                  <button
                    type="button"
                    className="mode-device-popover__ear-preview"
                    aria-label={t('faceToFace.previewEar', 'Preview the {{ear}}', { ear: earName.toLowerCase() })}
                    onClick={() => { void getAppAudio().then((app) => app.testTone(undefined, pan)); }}
                  >
                    <Play size={12} />
                  </button>
                </div>
              );
            })}
            <div className="mode-device-popover__ears-actions">
              <button type="button" className="mode-device-popover__swap" onClick={() => setSwap(!f2f.swap)}>
                <ArrowLeftRight size={14} />
                {t('faceToFace.swap', 'Swap left and right')}
              </button>
              <span className="mode-device-popover__ears-hint">{t('faceToFace.speakersHint', 'One earbud each works best. On speakers, the microphone picks up the translation and translates it again.')}</span>
            </div>
          </div>
        )}

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
