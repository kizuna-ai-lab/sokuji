// src/components/SettingsPage/LocalVoices.tsx
//
// The local engine's voices under the line-up's speech card (B-20; the owner, 2026-11-17: voices are chosen in the
// speech card, as every provider's are). Out of the old in-panel model library: one voice per direction that speaks,
// from the speech model that direction runs — Supertonic's library (its presets and the imported voices), or the
// speaker of a model with several; nothing for a model with one voice.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import LocalInferenceVoiceSection from '../Settings/sections/LocalInferenceVoiceSection';
import type { VoiceEntry } from '../Settings/sections/VoiceLibrarySection';
import * as voiceStorage from '../../lib/local-inference/voiceStorage';
import { dbKeyFromImportedSid, importedSidFromDbKey } from '../../lib/local-inference/sidMapping';
import { getManifestEntry, type ModelManifestEntry } from '../../lib/local-inference/modelManifest';
import { directionKey, splitDirection } from '../../lib/local-inference/selection/types';
import { describeCause, reportError } from '../../lib/diagnostics/report';
import { localInferenceProvider } from '../../providers/localInference/provider';
import type { DirectionVoice, LocalInferenceSettings } from '../../providers/localInference/settings';
import { directionVoice, speakerIdFor, voicesWithoutImported, withDirectionVoice } from '../../providers/localInference/voices';
import { useProviderStore } from '../../stores/providerStore';
import { useDeviceFeatures, useModelStatuses, useModelStore, useWebGPUAvailable } from '../../stores/modelStore';
import { storedLocalStages, useStoredLocalStages } from '../../stores/lineUpStore';
import { languageNameFor } from '../Settings/engine/languageName';

/** Supertonic's imported voices are kept under this engine name. */
const SUPERTONIC_VOICES = 'supertonic-3';

interface Row { dir: string; language: string; who: string; modelId: string; model: ModelManifestEntry }

export function LocalVoices({ disabled }: { disabled: boolean }) {
  const { t } = useTranslation();
  const entry = useProviderStore((s) => s.entries.local_inference);
  const legs = useProviderStore((s) => s.legs);
  const participantSpeech = useProviderStore((s) => s.speech.participantSpeech);
  // What each direction's speech stage runs follows the models on disk, this computer, and the line-up.
  const statuses = useModelStatuses();
  const webgpu = useWebGPUAvailable();
  const features = useDeviceFeatures();
  const stages = useStoredLocalStages();
  const resolve = useModelStore((s) => s.resolve);
  const [imported, setImported] = useState<voiceStorage.StoredVoice[]>([]);
  const [importError, setImportError] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);

  const settings = entry?.settings as LocalInferenceSettings | undefined;
  const pair = entry?.pair;
  // The directions that speak, as a session opens them (EdgeVoices' rule), each with the speech model it runs — kept
  // only where there is a voice to choose.
  const rows = useMemo(() => {
    if (!pair || !settings) return [];
    const { source, target } = pair;
    const speaking: Array<Omit<Row, 'modelId' | 'model'>> = [];
    if (legs.includes('speaker')) speaking.push({ dir: directionKey(source, target), language: target, who: t('audioPanel.otherHears', 'Translation the other side hears') });
    if (legs.includes('participant') && participantSpeech && localInferenceProvider.participantSpeech !== false) {
      speaking.push({ dir: directionKey(target, source), language: source, who: t('audioPanel.iHear', 'Translation I hear') });
    }
    const out: Row[] = [];
    for (const row of speaking) {
      const [src, tgt] = splitDirection(row.dir);
      const modelId = resolve(src, tgt, settings.selections, stages).tts?.modelId;
      const model = modelId ? getManifestEntry(modelId) : undefined;
      if (!modelId || !model) continue;
      if (model.engine === 'supertonic' || (model.numSpeakers ?? 1) > 1) out.push({ ...row, modelId, model });
    }
    return out;
    // statuses, webgpu and features are what resolve() reads from its store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pair, settings, legs, participantSpeech, stages, resolve, statuses, webgpu, features, t]);

  const hasSupertonic = rows.some((r) => r.model.engine === 'supertonic');
  const refreshImported = useCallback(async () => {
    try {
      setImported(await voiceStorage.listVoices(SUPERTONIC_VOICES));
    } catch (error) {
      reportError('LocalVoices', `Listing the imported voices failed: ${describeCause(error)}`, { cause: error });
    }
  }, []);
  useEffect(() => {
    if (hasSupertonic) void refreshImported();
  }, [hasSupertonic, refreshImported]);

  if (!settings || rows.length === 0) return null;

  const write = (dir: string, patch: DirectionVoice) =>
    useProviderStore.getState().updateSettings(localInferenceProvider, withDirectionVoice(settings.voices, dir, patch));

  const importVoice = async (file: File) => {
    try {
      await voiceStorage.addVoice(SUPERTONIC_VOICES, file.name.replace(/\.json$/i, ''), file);
      setImportError(null);
      await refreshImported();
      setChanged(true);
    } catch (error) {
      setImportError(error instanceof voiceStorage.VoiceImportError ? `${error.code}: ${error.message}`
        : error instanceof Error ? error.message : String(error));
      throw error;
    }
  };
  const renameVoice = async (sid: number, name: string) => {
    const dbKey = dbKeyFromImportedSid(sid);
    if (dbKey === null) return;
    try {
      await voiceStorage.renameVoice(dbKey, name);
    } catch (error) {
      // The picker shows a failed rename as is, so what leaves here is copy; the cause goes to the logs.
      reportError('LocalVoices', `Failed to rename voice: ${describeCause(error)}`, { cause: error });
      throw new Error(t('voiceLibrary.renameFailed', 'Could not rename this voice.'));
    }
    await refreshImported();
    setChanged(true);
  };
  const deleteVoice = async (sid: number) => {
    const dbKey = dbKeyFromImportedSid(sid);
    if (dbKey === null) return;
    await voiceStorage.deleteVoice(dbKey);
    // Every direction that spoke in it goes back to the model's default speaker (#619), as Models and storage does.
    // From the settings as they are now: a choice made while the voice was being deleted stays.
    const now = useProviderStore.getState().entries.local_inference?.settings as LocalInferenceSettings | undefined;
    const voices = now && voicesWithoutImported(now.voices, sid, (dir) => {
      const [src, tgt] = splitDirection(dir);
      return useModelStore.getState().resolve(src, tgt, now.selections, storedLocalStages()).tts?.modelId;
    });
    if (voices) useProviderStore.getState().updateSettings(localInferenceProvider, { voices });
    await refreshImported();
    setChanged(true);
  };

  return (
    <div className="local-voices" id="local-voices-section">
      <p className="local-voices__hint">{t('settingsPage.lineup.edgeVoices.hint', 'Voices are kept per language: these are the ones this language pair uses.')}</p>
      {rows.map(({ dir, language, who, modelId, model }) => {
        const label = t('settingsPage.lineup.edgeVoices.voiceFor', '{{who}} ({{language}})', { who, language: languageNameFor(language) });
        const speakerId = speakerIdFor(directionVoice(settings.voices, dir), modelId);
        // Supertonic's presets, then the imported voices; ids carry the speaker number the picker hands back.
        const library: VoiceEntry[] = model.engine !== 'supertonic' ? [] : [
          ...(model.ttsConfig?.presetVoices ?? []).map((p) => ({
            id: `preset:${p.sid}`, label: p.name, group: 'builtin' as const, removable: false, meta: { gender: p.gender as 'M' | 'F' },
          })),
          ...imported.map((v) => ({ id: `custom:${importedSidFromDbKey(v.id)}`, label: v.name, group: 'custom' as const, removable: true })),
        ];
        const selected = library.find((v) => v.id.endsWith(`:${speakerId}`))?.id ?? `preset:${speakerId}`;
        return (
          <div className="local-voices__row" key={dir}>
            <span className="local-voices__label">{label}</span>
            <LocalInferenceVoiceSection ttsModel={modelId} isSessionActive={disabled}
              edgeVoices={[]} edgeVoiceStatus="loaded" edgeVoice=""
              supertonicVoices={library} supertonicSelectedId={selected}
              onImportVoice={importVoice} onRenameVoice={renameVoice} onDeleteVoice={deleteVoice}
              speakerId={speakerId} numSpeakers={model.numSpeakers ?? 1} onUpdate={(patch) => write(dir, patch)} />
          </div>
        );
      })}
      {hasSupertonic && (
        <>
          {/* Supertone's Voice Builder, the only source of voice files, closed on 2026-08-31; files already
              downloaded still import above. */}
          <p className="local-voices__note">{t('voiceLibrary.voiceBuilderClosed', 'Supertone closed its Voice Builder service on August 31, 2026. Voice files you already downloaded can still be imported.')}</p>
          {importError && (
            <p className="local-voices__note local-voices__note--error" role="alert">
              {t('voiceLibrary.importError', 'Import failed: {error}').replace('{error}', importError)}
            </p>
          )}
          {changed && <p className="local-voices__note">{t('voiceLibrary.restartHint', 'Restart the session to apply imported voice changes.')}</p>}
        </>
      )}
    </div>
  );
}
