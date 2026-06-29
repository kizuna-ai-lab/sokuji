import React, { useMemo } from 'react';
import VoiceLibrarySection, { type VoiceEntry } from './VoiceLibrarySection';
import {
  curatedBuiltinVoices,
  defaultTtsVoice,
  BUILTIN_VOICE_META,
} from '../../../lib/local-inference/native/nativeCatalog';
import type { StoredNativeVoice } from '../../../lib/local-inference/nativeVoiceStorage';

/**
 * Native (Electron sidecar) adapter over the generalized VoiceLibrarySection.
 * Builds a normalized VoiceEntry[] for MOSS voices — built-in presets (curated
 * first, the rest behind the "show all" expander; ids `builtin:<Name>`) plus the
 * user's recorded/imported custom voices (ids `custom:<id>`) — and writes the
 * chosen opaque id back as `ttsVoice`.
 *
 * Built-in NAMES come from the sidecar (`list_tts_voices`, fetched by the
 * parent); `[]` when the model isn't downloaded yet, in which case only the
 * (empty) presets group renders and the parent surfaces a download hint.
 *
 * Capture (record/upload) lands in Task 11 — this component only forwards the
 * `onImport`/`onRecord` callbacks the parent supplies; `onRename`/`onDelete`
 * operate on the opaque custom id and are likewise forwarded.
 */
export interface NativeVoiceSectionProps {
  /** Built-in voice names from the sidecar (empty when the model isn't downloaded). */
  builtinVoices: string[];
  /** User-owned custom voices from nativeVoiceStorage. */
  customVoices: StoredNativeVoice[];
  /** Current settings.ttsVoice (opaque id); empty → default voice for the language. */
  selected: string;
  /** Target language, drives curation ordering + the default voice. */
  targetLanguage: string;
  /** Disables voice selection while a session is active. */
  isSessionActive?: boolean;
  /** Write the picked voice id to settings.ttsVoice. */
  onSelect: (id: string) => void;
  /** Forwarded import handler (capture wired in Task 11). */
  onImport: (file: File) => Promise<void>;
  /** Forwarded record handler (capture wired in Task 11). */
  onRecord: (clip: Float32Array, sampleRate: number) => Promise<void>;
  /** Forwarded rename of a custom voice (id is the opaque `custom:<id>`). */
  onRename: (id: string, name: string) => Promise<void>;
  /** Forwarded delete of a custom voice (id is the opaque `custom:<id>`). */
  onDelete: (id: string) => Promise<void>;
}

const NativeVoiceSection: React.FC<NativeVoiceSectionProps> = ({
  builtinVoices,
  customVoices,
  selected,
  targetLanguage,
  isSessionActive = false,
  onSelect,
  onImport,
  onRecord,
  onRename,
  onDelete,
}) => {
  const voices = useMemo<VoiceEntry[]>(() => {
    const { curated, rest } = curatedBuiltinVoices(targetLanguage, builtinVoices);
    const toBuiltin = (name: string, isCurated: boolean): VoiceEntry => ({
      id: `builtin:${name}`,
      label: name,
      group: 'builtin',
      removable: false,
      meta: {
        curated: isCurated,
        unstable: BUILTIN_VOICE_META[name]?.unstable,
        language: BUILTIN_VOICE_META[name]?.language,
      },
    });
    const builtinEntries = [
      ...curated.map((n) => toBuiltin(n, true)),
      ...rest.map((n) => toBuiltin(n, false)),
    ];
    const customEntries: VoiceEntry[] = customVoices.map((v) => ({
      id: `custom:${v.id}`,
      label: v.name,
      group: 'custom',
      removable: true,
    }));
    return [...builtinEntries, ...customEntries];
  }, [builtinVoices, customVoices, targetLanguage]);

  // Reconcile for display: an empty choice shows the language default as selected.
  const selectedId = selected || defaultTtsVoice(targetLanguage);

  return (
    <VoiceLibrarySection
      voices={voices}
      selectedId={selectedId}
      onSelect={onSelect}
      onImport={onImport}
      onRecord={onRecord}
      onRename={onRename}
      onDelete={onDelete}
      capability={{ importModes: ['record', 'upload'], curation: true }}
      isSessionActive={isSessionActive}
    />
  );
};

export default NativeVoiceSection;
