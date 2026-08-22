import { useMemo } from 'react';
import {
  useModelStore, useModelStatuses, useWebGPUAvailable, useDeviceFeatures, useStorageUsedMb,
} from '../../../stores/modelStore';
import { useLocalInferenceSettings, useUpdateLocalInference } from '../../../stores/settingsStore';
import { wasmCandidates } from '../../../lib/local-inference/selection/candidates.wasm';
import { directionKey, emptyDirection, type Stage } from '../../../lib/local-inference/selection/types';
import { getManifestEntry, getModelSizeMb } from '../../../lib/local-inference/modelManifest';
import { shortenModelName } from '../../../lib/local-inference/modelName';
import { languageNameFor } from './languageName';
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
      autoPick: (slot) => {
        const [src, tgt] = split(slot.dir);
        // Mask THIS slot's explicit pick so the resolver answers "what would
        // auto do" — with no explicit pick the mask is a no-op, so the auto
        // answer and the resolved answer agree by construction.
        const masked = {
          ...selections,
          [slot.dir]: { ...(selections[slot.dir] ?? emptyDirection()), [slot.stage]: { modelId: '' } },
        };
        return useModelStore.getState().resolve(src, tgt, masked)[slot.stage]?.modelId ?? null;
      },
      // Short names on the engine surface (2026-08-23): full names stay in
      // the Library/Storage cards.
      displayName: (id) => {
        const entry = getManifestEntry(id);
        return entry ? shortenModelName(entry.name, entry.shortName) : id;
      },
      languageName: languageNameFor,
      readyCandidates: (slot) => {
        const [src, tgt] = split(slot.dir);
        // Filtered on `autoEligible` too (not just ready && hardwareOk):
        // dropping it would put every downloaded AST-capable ASR entry into
        // the translation slot's quick picker. Picking one whose id != the
        // currently-resolved ASR is immediately masked by guardAstCrossStage
        // (resolves back to auto + a note) — a click that visibly does the
        // opposite of what it says. That trap is exactly what the AST guard
        // exists to contain. AST stays reachable through the Library (the
        // full card flow), not this quick picker.
        return source.pool(slot.stage, src, tgt)
          .filter((c) => c.ready && c.hardwareOk && c.autoEligible)
          .map((c) => {
            const entry = getManifestEntry(c.id);
            return {
              id: c.id,
              name: entry ? shortenModelName(entry.name, entry.shortName) : c.id,
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
