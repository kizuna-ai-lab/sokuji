import { CircleHelp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Tooltip from '../../Tooltip/Tooltip';
import type { ParticipantVoice } from './PresetVoiceField';

export interface VoiceFieldProps {
  value: string;
  options: readonly { value: string; name: string }[];
  onChange(voice: string): void;
  disabled?: boolean;
  /** The other party's row, while it is spoken: the same options, its own choice. */
  participant?: ParticipantVoice;
}

/** A provider's prebuilt voice (F13): the old voice section. `#voice-settings-section` is Settings' `voice-settings` target (`Settings.tsx:51`). */
export function VoiceField({ value, options, onChange, disabled = false, participant }: VoiceFieldProps) {
  const { t } = useTranslation();
  if (participant) {
    // Two rows named by who hears them, each a labelled select, as Palabra's other rows are.
    const row = (label: string, current: string, write: (voice: string) => void, note?: string) => (
      <div className="setting-item">
        <div className="setting-label">
          <span>{label}</span>
        </div>
        <select className="select-dropdown" aria-label={label} value={current} onChange={(e) => write(e.target.value)} disabled={disabled}>
          {options.map((o) => <option key={o.value} value={o.value}>{o.name}</option>)}
        </select>
        {note && <div className="setting-description">{note}</div>}
      </div>
    );
    const nameOf = (v: string) => options.find((o) => o.value === v)?.name ?? v;
    return (
      <div className="settings-section voice-settings-section" id="voice-settings-section">
        <h2>{t('settings.voiceSettings', 'Voice Settings')}</h2>
        {row(t('settings.voiceTheyHear', 'Voice the other side hears'), value, onChange)}
        {row(t('settings.voiceIHear', 'Voice I hear'), participant.value, participant.onChange, participant.effective !== participant.value
          ? t('settings.voiceIHearSame', 'Same as the voice the other side hears, so {{voice}} reads instead.', { voice: nameOf(participant.effective) })
          : undefined)}
      </div>
    );
  }
  return (
    <div className="settings-section voice-settings-section" id="voice-settings-section">
      <h2>
        {t('settings.voice')}
        <Tooltip content={t('settings.voiceTooltip')} position="top">
          <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '8px' }} />
        </Tooltip>
      </h2>
      <div className="setting-item">
        <select className="select-dropdown" aria-label={t('settings.voice')} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
          {options.map((o) => <option key={o.value} value={o.value}>{o.name}</option>)}
        </select>
      </div>
    </div>
  );
}
