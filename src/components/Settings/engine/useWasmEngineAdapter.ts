import { useMemo } from 'react';
import {
  useModelStore, useModelStatuses, useWebGPUAvailable, useDeviceFeatures, useStorageUsedMb,
} from '../../../stores/modelStore';
import { useLocalInferenceSettings, useUpdateLocalInference } from '../../../stores/settingsStore';
import { wasmCandidates } from '../../../lib/local-inference/selection/candidates.wasm';
import { directionKey, emptyDirection, type Stage } from '../../../lib/local-inference/selection/types';
import { getManifestEntry, getModelSizeMb } from '../../../lib/local-inference/modelManifest';
import type { EngineAdapter } from './EngineTypes';

/** LOCAL_INFERENCE's EngineAdapter — resolve() for display, selections for writes. */
export function useWasmEngineAdapter(isSessionActive = false): EngineAdapter {
  const { sourceLanguage, targetLanguage, selections } = useLocalInferenceSettings();
  const updateLocalInference = useUpdateLocalInference();
  const modelStatuses = useModelStatuses();
  const webgpuAvailable = useWebGPUAvailable();
  const deviceFeatures = useDeviceFeatures();
  const storageUsedMb = useStorageUsedMb();

  return useMemo<EngineAdapter>(() => {
    const speaker = directionKey(sourceLanguage, targetLanguage);
    const participant = directionKey(targetLanguage, sourceLanguage);
    const source = wasmCandidates({ modelStatuses, webgpuAvailable, deviceFeatures });
    const split = (dir: string): [string, string] => {
      const i = dir.indexOf('→');
      return [dir.slice(0, i), dir.slice(i + 1)];
    };
    return {
      directions: [
        { dir: speaker, src: sourceLanguage, tgt: targetLanguage },
        { dir: participant, src: targetLanguage, tgt: sourceLanguage },
      ],
      resolved: (slot) => {
        const [src, tgt] = split(slot.dir);
        return useModelStore.getState().resolve(src, tgt, selections)[slot.stage];
      },
      displayName: (id) => getManifestEntry(id)?.name ?? id,
      readyCandidates: (slot) => {
        const [src, tgt] = split(slot.dir);
        // NOT filtered on `autoEligible` — that flag only governs whether the
        // AUTO resolver may land on a candidate; the AST-capable ASR entries
        // it excludes are, per candidates.wasm.ts's own comment, "reachable
        // by explicit choice only". This picker IS that explicit choice, so
        // excluding them here would make them unreachable everywhere.
        return source.pool(slot.stage, src, tgt)
          .filter((c) => c.ready && c.hardwareOk)
          .map((c) => {
            const entry = getManifestEntry(c.id);
            return {
              id: c.id,
              name: entry?.name ?? c.id,
              sizeLabel: entry && !entry.isCloudModel ? `${getModelSizeMb(entry, deviceFeatures)} MB` : undefined,
            };
          });
      },
      select: async (slot, modelId) => {
        const current = selections[slot.dir] ?? emptyDirection();
        const nextDir = { ...current, [slot.stage]: { modelId } };
        const next = { ...selections, [slot.dir]: nextDir };
        if (!nextDir.asr.modelId && !nextDir.translation.modelId && !nextDir.tts.modelId) {
          delete next[slot.dir]; // all-auto directions carry no information
        }
        await updateLocalInference({ selections: next });
      },
      storageSummary: `${storageUsedMb} MB`,
      stagesFor: (_dir, isSpeaker): Stage[] => (isSpeaker ? ['asr', 'translation', 'tts'] : ['asr', 'translation']),
      disabled: isSessionActive,
    };
  }, [sourceLanguage, targetLanguage, selections, modelStatuses, webgpuAvailable, deviceFeatures, storageUsedMb, updateLocalInference, isSessionActive]);
}
