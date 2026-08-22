import React, { useMemo } from 'react';
import { useNativeModelStore } from '../../../stores/nativeModelStore';
import { useLocalNativeSettings, useUpdateLocalNative } from '../../../stores/settingsStore';
import { nativeCandidates } from '../../../lib/local-inference/selection/candidates.native';
import { directionKey, emptyDirection, type Stage } from '../../../lib/local-inference/selection/types';
import { EngineSection } from '../sections/EngineSection';
import { NativeDeviceControl } from '../sections/NativeDeviceControl';
import type { EngineAdapter } from './EngineTypes';

const fmtBytes = (b?: number): string | undefined =>
  b && b > 0 ? `${Math.round(b / 1_048_576)} MB` : undefined;

/** stageExtras' per-slot compute-device control — a plain React element
 *  (NativeDeviceControl mounts as its own component instance), not a direct
 *  hook call, since this file is `.ts` (no JSX) and `stageExtras` is invoked
 *  synchronously inside EnginePage's render. */
const nativeDeviceControl = (stage: Stage, disabled: boolean) =>
  React.createElement(NativeDeviceControl, { stage, disabled });

/** LOCAL_NATIVE's EngineAdapter — sidecar catalog + statuses, EngineSection gate. */
export function useNativeEngineAdapter(isSessionActive = false): EngineAdapter {
  const { sourceLanguage, targetLanguage, selections } = useLocalNativeSettings();
  const updateLocalNative = useUpdateLocalNative();
  const catalog = useNativeModelStore((s) => s.catalog);
  const statuses = useNativeModelStore((s) => s.statuses);

  return useMemo<EngineAdapter>(() => {
    const speaker = directionKey(sourceLanguage, targetLanguage);
    const participant = directionKey(targetLanguage, sourceLanguage);
    const source = nativeCandidates({ catalog, statuses });
    const split = (dir: string): [string, string] => {
      const i = dir.indexOf('→');
      return [dir.slice(0, i), dir.slice(i + 1)];
    };
    const storageBytes = Object.entries(statuses)
      .filter(([, s]) => s === 'ready')
      .reduce((sum, [id]) => sum + (catalog[id]?.sizeBytes ?? 0), 0);
    return {
      directions: [
        { dir: speaker, src: sourceLanguage, tgt: targetLanguage },
        { dir: participant, src: targetLanguage, tgt: sourceLanguage },
      ],
      resolved: (slot) => {
        const [src, tgt] = split(slot.dir);
        return useNativeModelStore.getState().resolve(src, tgt, selections)[slot.stage];
      },
      displayName: (id) => catalog[id]?.name ?? id,
      readyCandidates: (slot) => {
        const [src, tgt] = split(slot.dir);
        return source.pool(slot.stage, src, tgt)
          .filter((c) => c.ready && c.hardwareOk)
          .map((c) => ({ id: c.id, name: catalog[c.id]?.name ?? c.id, sizeLabel: fmtBytes(catalog[c.id]?.sizeBytes) }));
      },
      select: async (slot, modelId) => {
        const current = selections[slot.dir] ?? emptyDirection();
        const prev = current[slot.stage];
        // Spec rule: a variant pin survives only while its model does.
        const variant = prev.modelId === modelId ? prev.variant : undefined;
        const nextDir = { ...current, [slot.stage]: { modelId, ...(variant ? { variant } : {}) } };
        const next = { ...selections, [slot.dir]: nextDir };
        if (!nextDir.asr.modelId && !nextDir.translation.modelId && !nextDir.tts.modelId) {
          delete next[slot.dir];
        }
        await updateLocalNative({ selections: next });
      },
      // The sidecar bundle gate renders at the top of the Engine page; while
      // the sidecar is starting/absent, the catalog is empty and every ready
      // list is naturally empty — EngineSection carries the messaging.
      // isSessionActive threaded through (deviates from the brief's one-arg
      // sketch): the standalone <EngineSection/> this replaced disabled the
      // install/remove buttons mid-session, and this gate must keep doing so.
      gate: React.createElement(EngineSection, { isSessionActive }),
      stageExtras: (slot) => nativeDeviceControl(slot.stage, isSessionActive),
      storageSummary: fmtBytes(storageBytes) ?? '0 MB',
      stagesFor: (_dir, isSpeaker): Stage[] => (isSpeaker ? ['asr', 'translation', 'tts'] : ['asr', 'translation']),
      disabled: isSessionActive,
    };
  }, [sourceLanguage, targetLanguage, selections, catalog, statuses, updateLocalNative, isSessionActive]);
}
