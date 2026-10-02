import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { PreviewPort } from '../../../lib/provider/types';
import type { VoiceLibraryCapability } from '../../../types/VoiceLibrary';
import VoiceLibrarySection, { type VoiceEntry, type VoiceLibrarySectionProps } from '../../Settings/sections/VoiceLibrarySection';
import { VoicePreviewContext } from '../VoicePreviewContext';

/** Prebuilt voices only: none of the user's own to add, rename or delete, and too few to need the facet bar. */
const CAPABILITY: VoiceLibraryCapability = { importModes: [] };
const NO_DELETE = async () => {};

/** One of a provider's voices, as its list spells it: what the vendor documents, nothing more. */
export interface PresetVoice {
  value: string;
  name: string;
  gender?: 'female' | 'male';
  /** A facet value of `voiceLibrary.filter.style`. */
  style?: string;
  /** The vendor's own words, shown under the picker once chosen. */
  description?: string;
}

/** A list entry as the library takes it: prebuilt and auditionable, its row's subtitle from what is documented. */
export function presetVoice({ value, name, gender, style, description }: PresetVoice): VoiceEntry {
  const entry: VoiceEntry = { id: value, label: name, group: 'builtin', removable: false, previewable: true };
  if (!gender && !style && !description) return entry;
  return {
    ...entry,
    meta: {
      ...(gender ? { gender: gender === 'female' ? 'F' as const : 'M' as const } : {}),
      facets: { ...(gender ? { gender } : {}), ...(style ? { style: [style] } : {}), ...(description ? { description } : {}) },
    },
  };
}

export interface PresetVoiceFieldProps {
  voices: VoiceEntry[];
  value: string;
  onChange(voice: string): void;
  /** The audition; absent, no ▶ renders. */
  onPreview?: VoiceLibrarySectionProps['onPreview'];
  /** Why ▶ is greyed out, when it is (Gemini without a saved key). */
  previewUnavailableReason?: string;
  /** A footnote under the picker: what a preview costs. */
  note?: ReactNode;
  /** The host's voice-preview route (`SettingsProps.preview`). */
  preview?: PreviewPort;
  disabled?: boolean;
}

/**
 * A provider's prebuilt voices in the shared voice library (preset voice
 * preview): what AST2 and Soniox show, for a provider whose voices are a
 * fixed list — Gemini, OpenAI Realtime, OpenAI Live. Headed as those are;
 * `#voice-settings-section` is Settings' `voice-settings` target
 * (`Settings.tsx:51`), as the old select's section was.
 */
export function PresetVoiceField({ voices, value, onChange, onPreview, previewUnavailableReason, note, preview, disabled = false }: PresetVoiceFieldProps) {
  const { t } = useTranslation();
  return (
    <VoicePreviewContext.Provider value={preview ?? null}>
      <div className="settings-section voice-settings-section" id="voice-settings-section">
        <h2>{t('settings.voiceSettings', 'Voice Settings')}</h2>
        <VoiceLibrarySection
          voices={voices}
          selectedId={value}
          onSelect={onChange}
          onDelete={NO_DELETE}
          onPreview={onPreview}
          previewUnavailableReason={previewUnavailableReason}
          manageNote={note}
          capability={CAPABILITY}
          isSessionActive={disabled}
        />
      </div>
    </VoicePreviewContext.Provider>
  );
}
