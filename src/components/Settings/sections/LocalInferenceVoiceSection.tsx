import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import VoiceLibrarySection, { type VoiceEntry } from './VoiceLibrarySection';
import { getManifestEntry } from '../../../lib/local-inference/modelManifest';
import type { DirectionVoice } from '../../../providers/localInference/settings';

export interface LocalInferenceVoiceSectionProps {
  ttsModel: string;
  isSessionActive?: boolean;
  // supertonic
  supertonicVoices: VoiceEntry[];
  supertonicSelectedId: string;
  onImportVoice: (file: File) => Promise<void>;
  onRenameVoice: (sid: number, name: string) => Promise<void>;
  onDeleteVoice: (sid: number) => Promise<void>;
  // other engines
  /** This direction's speaker id, the model default when none is set. */
  speakerId: number;
  numSpeakers: number;
  /** Writes this direction's voice (#619). */
  onUpdate: (patch: DirectionVoice) => void;
}

/** sid is encoded as the suffix after the ':' in a VoiceEntry id ('preset:7' → 7). */
const sidFromVoiceId = (id: string): number => Number(id.slice(id.indexOf(':') + 1));

/**
 * Voice control embedded in the selected local_inference TTS card. Mirrors
 * NativeVoiceSection: presentation only, switching on the selected TTS engine.
 * State (the Supertonic library) is owned by the parent.
 */
const LocalInferenceVoiceSection: React.FC<LocalInferenceVoiceSectionProps> = ({
  ttsModel, isSessionActive = false,
  supertonicVoices, supertonicSelectedId, onImportVoice, onRenameVoice, onDeleteVoice,
  speakerId, numSpeakers, onUpdate,
}) => {
  const { t } = useTranslation();
  const engine = getManifestEntry(ttsModel)?.engine;

  const onSupertonicSelect = useCallback(
    (id: string) => onUpdate({ speaker: sidFromVoiceId(id) }),
    [onUpdate],
  );

  if (engine === 'supertonic') {
    return (
      <VoiceLibrarySection
        voices={supertonicVoices}
        selectedId={supertonicSelectedId}
        onSelect={onSupertonicSelect}
        onImport={onImportVoice}
        onRename={(id, name) => onRenameVoice(sidFromVoiceId(id), name)}
        onDelete={(id) => onDeleteVoice(sidFromVoiceId(id))}
        capability={{ importModes: ['upload'] }}
        isSessionActive={isSessionActive}
      />
    );
  }

  // Other engines (matcha / piper / icefall …): a speaker-id slider.
  // Only render when there is more than one speaker to choose from.
  if (numSpeakers <= 1) return null;
  return (
    <div className="setting-item">
      <div className="setting-label">
        <span>{t('settings.ttsSpeakerId', 'Speaker ID')}</span>
        <span className="setting-value">{speakerId}</span>
      </div>
      <input
        type="range"
        min="0"
        max={numSpeakers - 1}
        step="1"
        value={Math.min(speakerId, numSpeakers - 1)}
        onChange={(e) => onUpdate({ speaker: parseInt(e.target.value) })}
        className="slider"
        disabled={isSessionActive}
      />
    </div>
  );
};

export default LocalInferenceVoiceSection;
