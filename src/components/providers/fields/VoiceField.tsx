import { CircleHelp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Tooltip from '../../Tooltip/Tooltip';

export interface VoiceFieldProps {
  value: string;
  options: readonly { value: string; name: string }[];
  onChange(voice: string): void;
  disabled?: boolean;
}

/** A provider's prebuilt voice (F13): the old voice section. `#voice-settings-section` is Settings' `voice-settings` target (`Settings.tsx:51`). */
export function VoiceField({ value, options, onChange, disabled = false }: VoiceFieldProps) {
  const { t } = useTranslation();
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
