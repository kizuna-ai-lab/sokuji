import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import VoiceLibrarySection, { type VoiceEntry } from './VoiceLibrarySection';
import { getManifestEntry } from '../../../lib/local-inference/modelManifest';

export type EdgeVoiceStatus = 'idle' | 'loading' | 'loaded' | 'error';

export interface LocalInferenceVoiceSectionProps {
  ttsModel: string;
  isSessionActive?: boolean;
  // edge-tts
  edgeVoices: { ShortName: string; label: string }[];
  edgeVoiceStatus: EdgeVoiceStatus;
  edgeTtsVoice: string;
  // supertonic
  supertonicVoices: VoiceEntry[];
  supertonicSelectedId: string;
  onImportVoice: (file: File) => Promise<void>;
  onRenameVoice: (sid: number, name: string) => Promise<void>;
  onDeleteVoice: (sid: number) => Promise<void>;
  // other engines
  ttsSpeakerId: number;
  numSpeakers: number;
  // settings writes
  onUpdate: (patch: { edgeTtsVoice?: string; ttsSpeakerId?: number }) => void;
}

/** sid is encoded as the suffix after the ':' in a VoiceEntry id ('preset:7' → 7). */
const sidFromVoiceId = (id: string): number => Number(id.slice(id.indexOf(':') + 1));

/**
 * Voice control embedded in the selected local_inference TTS card. Mirrors
 * NativeVoiceSection: presentation only, switching on the selected TTS engine.
 * State (edge voice list, Supertonic library) is owned by the parent.
 */
const LocalInferenceVoiceSection: React.FC<LocalInferenceVoiceSectionProps> = ({
  ttsModel, isSessionActive = false,
  edgeVoices, edgeVoiceStatus, edgeTtsVoice,
  supertonicVoices, supertonicSelectedId, onImportVoice, onRenameVoice, onDeleteVoice,
  ttsSpeakerId, numSpeakers, onUpdate,
}) => {
  const { t } = useTranslation();
  const engine = getManifestEntry(ttsModel)?.engine;

  const onSupertonicSelect = useCallback(
    (id: string) => onUpdate({ ttsSpeakerId: sidFromVoiceId(id) }),
    [onUpdate],
  );

  if (engine === 'edge-tts') {
    let placeholder: string | null = null;
    if (edgeVoiceStatus === 'loading' || edgeVoiceStatus === 'idle') {
      placeholder = t('settings.loadingVoices', 'Loading voices...');
    } else if (edgeVoiceStatus === 'error') {
      placeholder = t('settings.edgeTtsVoiceLoadError', 'Failed to load voices — check LogsPanel');
    } else if (edgeVoices.length === 0) {
      placeholder = t('settings.edgeTtsNoVoicesForLanguage', 'No voices available for this language');
    }
    return (
      <div className="setting-item">
        <div className="setting-label">
          <span>{t('settings.edgeTtsVoice', 'Voice')}</span>
        </div>
        <select
          className="select-dropdown"
          value={edgeTtsVoice}
          onChange={(e) => onUpdate({ edgeTtsVoice: e.target.value })}
          disabled={isSessionActive || edgeVoices.length === 0}
        >
          {placeholder && <option value="">{placeholder}</option>}
          {edgeVoices.map((v) => (
            <option key={v.ShortName} value={v.ShortName}>{v.label}</option>
          ))}
        </select>
      </div>
    );
  }

  if (engine === 'supertonic') {
    return (
      <VoiceLibrarySection
        voices={supertonicVoices}
        selectedId={supertonicSelectedId}
        onSelect={onSupertonicSelect}
        onImport={onImportVoice}
        onRename={(id, name) => onRenameVoice(sidFromVoiceId(id), name)}
        onDelete={(id) => onDeleteVoice(sidFromVoiceId(id))}
        capability={{ importModes: ['upload'], curation: false, presentation: 'dropdown' }}
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
        <span className="setting-value">{ttsSpeakerId}</span>
      </div>
      <input
        type="range"
        min="0"
        max={numSpeakers - 1}
        step="1"
        value={Math.min(ttsSpeakerId, numSpeakers - 1)}
        onChange={(e) => onUpdate({ ttsSpeakerId: parseInt(e.target.value) })}
        className="slider"
        disabled={isSessionActive}
      />
    </div>
  );
};

export default LocalInferenceVoiceSection;
