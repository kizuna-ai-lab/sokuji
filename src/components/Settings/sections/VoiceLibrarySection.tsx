import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink } from 'lucide-react';
import { getManifestEntry } from '../../../lib/local-inference/modelManifest';
import './VoiceLibrarySection.scss';

interface SupertonicVoice {
  sid: number;
  name: string;
  source: 'preset' | 'imported';
  gender?: 'M' | 'F';
}

interface VoiceLibrarySectionProps {
  /** All voices currently reported by the engine (presets + imported). */
  voices: SupertonicVoice[];
  /** Currently selected sid (from settings store). */
  selectedSid: number;
  /** Callback when the user picks a different voice. */
  onSelect: (sid: number) => void;
}

const VoiceLibrarySection: React.FC<VoiceLibrarySectionProps> = ({
  voices,
  selectedSid,
  onSelect,
}) => {
  const { t } = useTranslation();
  const entry = getManifestEntry('supertonic-3');

  const presets = useMemo(
    () => voices.filter((v) => v.source === 'preset').sort((a, b) => a.sid - b.sid),
    [voices],
  );
  const imported = useMemo(
    () => voices.filter((v) => v.source === 'imported').sort((a, b) => a.sid - b.sid),
    [voices],
  );

  if (!entry) return null;

  return (
    <div className="voice-library-section">
      <div className="voice-library-info">
        {t('voiceLibrary.customVoiceCta', 'Need a custom voice?')}{' '}
        <a
          href="https://supertonic.supertone.ai/voice-builder"
          target="_blank"
          rel="noopener noreferrer"
        >
          {t('voiceLibrary.openVoiceBuilder', 'Create one at Voice Builder')}
          <ExternalLink size={14} />
        </a>
        <div className="voice-library-info-sub">
          {t(
            'voiceLibrary.voiceBuilderDisclaimer',
            'Paid Supertone service. Sokuji is not involved in that transaction.',
          )}
        </div>
      </div>

      <h4>{t('voiceLibrary.presets', 'Presets')}</h4>
      <ul className="voice-list">
        {presets.map((v) => (
          <li
            key={v.sid}
            className={v.sid === selectedSid ? 'voice-row selected' : 'voice-row'}
            onClick={() => onSelect(v.sid)}
          >
            <span className="voice-name">{v.name}</span>
            {v.gender && <span className="voice-meta">({v.gender})</span>}
          </li>
        ))}
      </ul>

      <h4>{t('voiceLibrary.myVoices', 'My Voices')}</h4>
      {imported.length === 0 ? (
        <div className="voice-library-empty">
          {t('voiceLibrary.emptyHint', 'Drop a voice_style.json here, or click + to import.')}
        </div>
      ) : (
        <ul className="voice-list">
          {imported.map((v) => (
            <li
              key={v.sid}
              className={v.sid === selectedSid ? 'voice-row selected' : 'voice-row'}
              onClick={() => onSelect(v.sid)}
            >
              <span className="voice-name">{v.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default VoiceLibrarySection;
