import React, { useState, useMemo } from 'react';
import { useRunParticipantSpeech } from '../../app/useRun';
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
import { Mic, AudioLines, Volume2, Power, PowerOff, Play, ChevronDown, ChevronUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { LucideIcon } from 'lucide-react';
import {
  useAudioContext,
  useIsMicMuted, useIsMonitorMuted, useIsParticipantMuted,
  useSetMicMuted, useSetMonitorMuted, useSetParticipantMuted,
  useParticipantCaptureWidened, useParticipantSources, useSelectedParticipantSource, useSelectParticipantSource,
  useOutlets, useSetOutletDevice, useSetOutletChannel, useSelectedMonitorDevice,
} from '../../stores/audioStore';
import { useFaceToFace } from './useFaceToFace';
import OtherSideChoice from '../FaceToFace/OtherSideChoice';
import { getAppAudio } from '../../lib/audio/appAudio';
import { entryValue, outletEntries, outletSelectValue, parseEntryValue } from '../../lib/audio/outletOptions';
import type { OutletName } from '../../lib/audio/outlets';
import { describeCause, reportError } from '../../lib/diagnostics/report';
import { heardFromStores, selectedFromStores } from '../../lib/session/appShape';
import { useProviderStore } from '../../stores/providerStore';
import { useRoutingStore } from '../../stores/routingStore';
import { isExtension } from '../../utils/environment';
import { useNavigateToSettings, useSettingsStore } from '../../stores/settingsStore';
import { isVirtualDevice, type AudioDevice } from '../Settings/shared/hooks';
import { describeDeviceOnHover } from '../../utils/audioDevices';
import './ModeDevicePopover.scss';

interface ModeDevicePopoverProps {
  mode: 'speaker' | 'participant' | 'both';
  open: boolean;
  anchorEl: HTMLElement | null;
  onClose: () => void;
  /**
   * A run is live, as the mode picker's `locked`: the other side is the run's
   * (its shape and capture froze at Start), so its choice is locked too, and so
   * is the Other mode's translation switch.
   */
  locked: boolean;
}

type ChannelKey = 'mic' | 'participant' | 'me' | 'other' | 'them';

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
  /** Absent: the row has no power switch — the outlet rows beside me have a preview instead. */
  onMuteToggle?: () => void;
  /** Absent on rows that have no picker (participant without a per-app helper). */
  onSelectDevice?: (d: AudioDevice) => void;
  /** A ▶ in the switch's column: plays the chime on this row's outlet (face-to-face). */
  onPreview?: () => void;
  /** The power button is disabled, and this is why (its title). */
  disabledReason?: string;
  /** True when row is in scope and has no device picked. */
  isMissing: boolean;
}

const ModeDevicePopover: React.FC<ModeDevicePopoverProps> = ({ mode, open, anchorEl, onClose, locked }) => {
  const { t } = useTranslation();
  const navigateToSettings = useNavigateToSettings();

  const {
    audioInputDevices,
    audioMonitorDevices,
    selectedInputDevice,
    selectInputDevice,
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
  const beside = mode === 'both' && f2f.active;

  const outlets = useOutlets();
  const setOutletDevice = useSetOutletDevice();
  const setOutletChannel = useSetOutletChannel();
  const defaultDevice = useSelectedMonitorDevice();
  // Subscribed so a provider change in settings reaches a popover that stays mounted while closed.
  useProviderStore((s) => s.selected);
  useProviderStore((s) => s.entries);
  const provider = selectedFromStores()?.provider;
  const participantSpeech = useRoutingStore((s) => s.participantSpeech);
  const setParticipantSpeech = useRoutingStore((s) => s.setParticipantSpeech);
  const textOnly = useSettingsStore((s) => s.textOnly);
  // The twin of the page's: a run's frozen 我听到的翻译 wins over the live stores.
  const runSpeech = useRunParticipantSpeech();
  // Subscribed so the blocked state follows a capture that widens mid-run.
  useParticipantCaptureWidened();
  const heard = heardFromStores(beside);
  const blockedReason = t('audioPanel.blockedWholeSystem', 'All system sound is being captured: these playback options are off, so the translation is not translated again.');
  const channelName = (c: 'left' | 'right') => (c === 'left' ? t('audioPanel.channelLeft', 'left channel') : t('audioPanel.channelRight', 'right channel'));
  const previewOn = (outlet: OutletName) => {
    void getAppAudio()
      .then((app) => app.earPreview(outlet))
      .catch((error: unknown) => reportError('ModeDevicePopover', `The preview did not play: ${describeCause(error)}`, { cause: error }));
  };

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
        apply({ availableWidth, availableHeight, elements }) {
          // Clamp to availableHeight so the popover never exceeds the viewport
          // (an internal scroll handles overflow). The Math.max with 0 guards
          // against floating-ui handing us a transient negative value. The
          // width too: on a panel narrower than the popover (300px) it keeps
          // 8px from each edge and its rows ellipsize; on a wider one it keeps
          // its own width.
          Object.assign(elements.floating.style, {
            maxHeight: `${Math.max(0, availableHeight)}px`,
            maxWidth: `${Math.max(0, availableWidth)}px`,
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

  // Hide Sokuji virtual devices from the device lists — they're not
  // user-selectable (they're internal routing). Mirrors what
  // AudioDeviceSection's DeviceList does in Settings.
  const filteredInputDevices = audioInputDevices.filter(d => !isVirtualDevice(d as any));
  const filteredMonitorDevices = audioMonitorDevices.filter(d => !isVirtualDevice(d as any));

  /** An outlet row's list: the page's device·channel entries as pseudo-devices, the selected one by its value. */
  const outletRow = (name: OutletName, key: ChannelKey, label: string, rest: Partial<ChannelRowSpec>): ChannelRowSpec => {
    const entries = outletEntries(filteredMonitorDevices).map((entry) => {
      const base = entry.device === null
        ? (entry.channel === 'auto' && defaultDevice ? t('audioPanel.followDefaultNamed', { device: defaultDevice.label, defaultValue: 'Follow default ({{device}})' }) : t('audioPanel.followDefault', 'Follow default'))
        : entry.label!;
      const text = entry.channel === 'left' || entry.channel === 'right' ? `${base} · ${channelName(entry.channel)}` : base;
      return { deviceId: entryValue(entry), label: text };
    });
    const value = outletSelectValue(name, outlets[name], beside, filteredMonitorDevices);
    return {
      key, icon: Volume2, label,
      devices: entries,
      selectedDevice: entries.find((d) => d.deviceId === value) ?? null,
      isMuted: false,
      onSelectDevice: (d) => {
        const { device, channel } = parseEntryValue(d.deviceId);
        setOutletDevice(name, device);
        setOutletChannel(name, channel);
      },
      isMissing: false,
      ...rest,
    };
  };

  // Build the list of rows the popover should render based on mode.
  // Channel order: mic → me → participant → them / other
  const rows = useMemo<ChannelRowSpec[]>(() => {
    const list: ChannelRowSpec[] = [];

    const showMic = mode === 'speaker' || mode === 'both';
    const showParticipant = mode === 'participant' || (mode === 'both' && !beside);

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

    if (mode === 'speaker') {
      // The twin of SpeechOutputSection's 我也听 row: off while the translation is not spoken (`otherOn` there).
      const speech = provider?.speech ?? 'optional';
      const otherOn = speech === 'always' ? true : speech === 'never' ? false : !textOnly;
      list.push(outletRow('me', 'me', t('audioPanel.meToo', 'I hear it too'), {
        isMuted: isMonitorMuted || !otherOn,
        onMuteToggle: () => setMonitorMuted(!isMonitorMuted),
        ...(otherOn ? {} : { disabledReason: t('audioPanel.needsOtherHears', 'Nothing to hear while the translation is not spoken. Your setting is kept.') }),
      }));
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

    if (mode === 'participant') {
      // The twin of SpeechOutputSection's 我听到的翻译 switch: keep the two in step.
      const speech = provider?.speech ?? 'optional';
      const offered = provider?.participantSpeech !== false;
      const on = runSpeech ?? (offered && heard && speech !== 'never' && (speech === 'always' || (participantSpeech ?? false)));
      const disabledReason = !heard ? blockedReason
        : locked ? t('audioPanel.rowLockedByRun', 'Fixed for this session; stop it to change.')
        : !offered ? t('audioPanel.iHearNotOffered', "This service does not speak the other side's translation.")
        : speech !== 'optional' ? (speech === 'always' ? t('audioPanel.otherHearsAlwaysSpeaks', 'This service always speaks.') : t('audioPanel.otherHearsNeverSpeaks', 'This service never speaks.'))
        : undefined;
      list.push(outletRow('them', 'them', t('audioPanel.iHear', 'Translation I hear'), {
        isMuted: !on,
        onMuteToggle: () => setParticipantSpeech(!(participantSpeech ?? false)),
        ...(disabledReason ? { disabledReason } : {}),
      }));
    }

    if (beside) {
      list.push(outletRow('other', 'other', t('audioPanel.otherHears', 'Translation the other side hears'), { onPreview: () => previewOn('other') }));
      list.push(outletRow('them', 'them', t('audioPanel.iHear', 'Translation I hear'), { onPreview: () => previewOn('them') }));
    }

    return list;
    // outletRow and previewOn close over the values listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    mode, beside, locked, provider, textOnly, outlets, defaultDevice, participantSpeech, heard, runSpeech,
    audioInputDevices, selectedInputDevice, isMicMuted,
    audioMonitorDevices, isMonitorMuted,
    isParticipantMuted, participantSources, selectedParticipantSource,
    selectInputDevice, selectParticipantSource,
    setMicMuted, setMonitorMuted, setParticipantMuted,
    setOutletDevice, setOutletChannel, setParticipantSpeech,
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

  // Both: where the other person is, between the microphone and the row it decides (board 1).
  const otherSideChoice = mode === 'both' && f2f.offered && <OtherSideChoice locked={locked} className="mode-device-popover__other-side" />;

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
              <div className={`mode-device-popover__row${isExpanded ? ' mode-device-popover__row--expanded' : ''}${row.key === 'participant' ? ' mode-device-popover__row--participant' : ''}${row.key === 'me' || row.key === 'other' || row.key === 'them' ? ' mode-device-popover__row--outlet' : ''}`}>
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
                  disabled={!!row.disabledReason}
                  aria-pressed={!row.isMuted}
                  aria-label={row.isMuted
                    ? t('popover.toggleOn', 'Turn on {{label}}', { label: row.label })
                    : t('popover.toggleOff', 'Turn off {{label}}', { label: row.label })}
                  title={row.disabledReason ?? (row.isMuted
                    ? t('popover.toggleOn', 'Turn on {{label}}', { label: row.label })
                    : t('popover.toggleOff', 'Turn off {{label}}', { label: row.label }))}
                >
                  {row.isMuted ? <PowerOff size={14} /> : <Power size={14} />}
                </button>
                )}
                {row.onPreview && (
                  <button
                    type="button"
                    className="mode-device-popover__mute-btn mode-device-popover__preview-btn"
                    onClick={(e) => { e.stopPropagation(); row.onPreview?.(); }}
                    aria-label={t('audioPanel.previewRow', { row: row.label, defaultValue: 'Preview {{row}}' })}
                    title={t('audioPanel.preview', 'Preview')}
                  >
                    <Play size={14} />
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

              {row.key === 'mic' && otherSideChoice}
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
              // panel only on a truthy target. The speech rows are what the
              // popover lacks, so every mode lands on them.
              navigateToSettings('speech');
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
