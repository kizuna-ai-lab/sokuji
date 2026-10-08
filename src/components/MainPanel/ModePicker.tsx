import React, { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { SideMeIcon, SideOtherIcon, SideBothIcon } from '../Icons/SideIcons';
import './ModePicker.scss';

export type FooterMode = 'speaker' | 'participant' | 'both';

interface ModePickerProps {
  mode: FooterMode;
  locked: boolean;
  missingDeviceForMode: 'speaker' | 'participant' | 'both' | null;
  onSegmentClick: (segment: 'speaker' | 'participant' | 'both', el: HTMLElement) => void;
  /** Both runs face-to-face: the segment carries a tag. */
  faceToFace?: boolean;
}

const SEGMENTS: Array<'speaker' | 'participant' | 'both'> = ['speaker', 'participant', 'both'];

// The same three side glyphs the conversation toolbar's DisplayModeButton
// uses, so the footer and the toolbar name Me / Other with one drawing. Here
// they render in their default both form — the picker has no line state.
const SEGMENT_ICONS: Record<'speaker' | 'participant' | 'both', React.ComponentType<{ size?: number }>> = {
  speaker: SideMeIcon,
  participant: SideOtherIcon,
  both: SideBothIcon,
};

const ModePicker: React.FC<ModePickerProps> = ({ mode, locked, missingDeviceForMode, onSegmentClick, faceToFace }) => {
  const { t } = useTranslation();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  const labelFor = (seg: 'speaker' | 'participant' | 'both') => {
    if (seg === 'speaker') return t('modePicker.modeYou', 'Me');
    if (seg === 'participant') return t('modePicker.modeParticipants', 'Other');
    return t('modePicker.modeBoth', 'Both');
  };

  // Plain-language description of what each mode translates and in which
  // direction. Leads every tooltip so the mode's *meaning* is always
  // available on hover (the bare "You / Others / Both" labels don't convey it).
  const descFor = (seg: 'speaker' | 'participant' | 'both') => {
    if (seg === 'speaker') return t('modePicker.descYou', 'Your voice → translated for the other side. Translate what you say so they understand you.');
    if (seg === 'participant') return t('modePicker.descOthers', "The other side's voice → translated for you. Translate what they say so you understand them.");
    return t('modePicker.descBoth', "Two-way. Translate your voice and the other side's at the same time.");
  };

  const titleFor = (seg: 'speaker' | 'participant' | 'both') => {
    const isActive = seg === mode;
    const desc = descFor(seg);
    if (locked) {
      // In-session: only the active segment is clickable (to open the
      // device popover for the currently-running channels). Inactive
      // segments are visually locked.
      return isActive
        ? `${desc}\n${t('modePicker.configureDevices', 'Click to configure devices.')}`
        : `${desc}\n${t('modePicker.switchDisabled', 'Mode is locked during a session.')}`;
    }
    if (missingDeviceForMode === seg || (missingDeviceForMode === 'both' && (seg === 'speaker' || seg === 'participant'))) {
      return `${desc}\n${t('modePicker.missingDevice', 'Configure devices for this mode to start.')}`;
    }
    if (isActive) return `${desc}\n${t('modePicker.configureDevices', 'Click to configure devices.')}`;
    // Inactive + switchable: the description alone tells the user what they'd
    // get; the unselected segment already signals it's clickable.
    return desc;
  };

  return (
    <div className={`mode-picker${locked ? ' mode-picker--locked' : ''}`} role="group" data-tour="mode-picker" aria-label={t('modePicker.groupLabel', 'Translation mode')}>
      {SEGMENTS.map((seg) => {
        const isActive = mode === seg;
        const isWarn =
          missingDeviceForMode === seg ||
          (missingDeviceForMode === 'both' && (seg === 'speaker' || seg === 'participant'));
        const classes = [
          'mode-picker__segment',
          isActive ? 'mode-picker__segment--active' : '',
          isWarn ? 'mode-picker__segment--warn' : '',
        ].filter(Boolean).join(' ');
        const Icon = SEGMENT_ICONS[seg];
        const label = labelFor(seg);
        // When locked, only the active segment stays clickable (opens
        // the device popover). Inactive segments are disabled so the
        // user can't accidentally try to switch mid-session.
        const isDisabled = locked && !isActive;
        return (
          <button
            key={seg}
            ref={(el) => { refs.current[seg] = el; }}
            type="button"
            className={classes}
            aria-pressed={isActive}
            aria-label={label}
            disabled={isDisabled}
            title={titleFor(seg)}
            onClick={() => {
              if (isDisabled) return;
              const el = refs.current[seg];
              if (el) onSegmentClick(seg, el);
            }}
          >
            <Icon size={14} />
            <span className="mode-picker__label">{label}</span>
            {seg === 'both' && faceToFace && <span className="mode-picker__tag">{t('modePicker.faceToFaceTag', 'Face-to-face')}</span>}
          </button>
        );
      })}
    </div>
  );
};

export default ModePicker;
