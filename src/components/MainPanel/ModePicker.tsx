import React, { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { User, Users, ArrowLeftRight } from 'lucide-react';
import './ModePicker.scss';

export type FooterMode = 'speaker' | 'participant' | 'both' | 'none';

interface ModePickerProps {
  mode: FooterMode;
  locked: boolean;
  missingDeviceForMode: 'speaker' | 'participant' | 'both' | null;
  onSegmentClick: (segment: 'speaker' | 'participant' | 'both', el: HTMLElement) => void;
}

const SEGMENTS: Array<'speaker' | 'participant' | 'both'> = ['speaker', 'participant', 'both'];

// Reuse the User / Users icons from DisplayModeButton for visual consistency
// with the subtitle display toggles. ArrowLeftRight for 'both' conveys
// bidirectional translation.
const SEGMENT_ICONS: Record<'speaker' | 'participant' | 'both', React.ComponentType<{ size?: number }>> = {
  speaker: User,
  participant: Users,
  both: ArrowLeftRight,
};

const ModePicker: React.FC<ModePickerProps> = ({ mode, locked, missingDeviceForMode, onSegmentClick }) => {
  const { t } = useTranslation();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  const labelFor = (seg: 'speaker' | 'participant' | 'both') => {
    if (seg === 'speaker') return t('modePicker.modeYou', 'You');
    if (seg === 'participant') return t('modePicker.modeParticipants', 'Others');
    return t('modePicker.modeBoth', 'Both');
  };

  const titleFor = (seg: 'speaker' | 'participant' | 'both') => {
    if (locked) return t('modePicker.switchDisabled', 'Mode is locked during a session.');
    if (missingDeviceForMode === seg || (missingDeviceForMode === 'both' && (seg === 'speaker' || seg === 'participant'))) {
      return t('modePicker.missingDevice', 'Configure devices for this mode to start.');
    }
    if (seg === mode) return t('modePicker.configureDevices', 'Click to configure devices.');
    return t('modePicker.switchTo', 'Switch to {{label}}', { label: labelFor(seg) });
  };

  return (
    <div className={`mode-picker${locked ? ' mode-picker--locked' : ''}`} role="group" aria-label={t('modePicker.groupLabel', 'Translation mode')}>
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
        return (
          <button
            key={seg}
            ref={(el) => { refs.current[seg] = el; }}
            type="button"
            className={classes}
            aria-pressed={isActive}
            aria-label={label}
            disabled={locked}
            title={titleFor(seg)}
            onClick={() => {
              if (locked) return;
              const el = refs.current[seg];
              if (el) onSegmentClick(seg, el);
            }}
          >
            <Icon size={14} />
            <span className="mode-picker__label">{label}</span>
          </button>
        );
      })}
    </div>
  );
};

export default ModePicker;
