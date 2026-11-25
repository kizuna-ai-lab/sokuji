import React, { useMemo } from 'react';
import { useNativeModelStore } from '../../../stores/nativeModelStore';
import { nativeCandidates } from '../../../lib/local-inference/selection/candidates.native';
import { directionKey, emptyDirection, type Selections, type Stage } from '../../../lib/local-inference/selection/types';
import type { NativeDevice } from '../../../lib/local-inference/native/nativeCatalog';
import type { LanguagePair } from '../../../lib/run/types';
import { EngineSection } from '../sections/EngineSection';
import { SlotDeviceBadge } from './SlotDeviceBadge';
import { languageNameFor } from './languageName';
import { shortenModelName } from '../../../lib/local-inference/modelName';
import type { EngineAdapter } from './EngineTypes';

const fmtBytes = (b?: number): string | undefined =>
  b && b > 0 ? `${Math.round(b / 1_048_576)} MB` : undefined;

/** The slice of Local Native's settings the native model UI reads and writes. */
export interface NativeEngineSettings { selections: Selections; asrDevice: NativeDevice; translationDevice: NativeDevice; ttsDevice: NativeDevice; ttsVoice: string }

/** What the host hands the native model UI: its settings, how to write them, and the pair (#578). */
export interface NativeEngineOverride { settings: NativeEngineSettings; update(patch: Partial<NativeEngineSettings>): void; pair: LanguagePair }

/** LOCAL_NATIVE's EngineAdapter — sidecar catalog + statuses, EngineSection gate. Its host, Local Native's `Engine`, hands it the settings / update / pair (#578). */
export function useNativeEngineAdapter(isSessionActive: boolean, override: NativeEngineOverride): EngineAdapter {
  const sourceLanguage = override.pair.source;
  const targetLanguage = override.pair.target;
  const { selections, asrDevice, translationDevice, ttsDevice } = override.settings;
  const { update } = override;
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
    return {
      directions: [
        { dir: speaker, src: sourceLanguage, tgt: targetLanguage },
        { dir: participant, src: targetLanguage, tgt: sourceLanguage },
      ],
      resolved: (slot) => {
        const [src, tgt] = split(slot.dir);
        return useNativeModelStore.getState().resolve(src, tgt, selections)[slot.stage];
      },
      autoPick: (slot) => {
        const [src, tgt] = split(slot.dir);
        const masked = {
          ...selections,
          [slot.dir]: { ...(selections[slot.dir] ?? emptyDirection()), [slot.stage]: { modelId: '' } },
        };
        return useNativeModelStore.getState().resolve(src, tgt, masked)[slot.stage]?.modelId ?? null;
      },
      displayName: (id) => (catalog[id] ? shortenModelName(catalog[id].name) : id),
      languageName: languageNameFor,
      readyCandidates: (slot) => {
        const [src, tgt] = split(slot.dir);
        return source.pool(slot.stage, src, tgt)
          .filter((c) => c.ready && c.hardwareOk)
          .map((c) => ({ id: c.id, name: catalog[c.id] ? shortenModelName(catalog[c.id].name) : c.id, sizeLabel: fmtBytes(catalog[c.id]?.sizeBytes) }));
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
        update({ selections: next });
      },
      // The sidecar bundle gate renders at the top of the Engine page; while
      // the sidecar is starting/absent, the catalog is empty and every ready
      // list is naturally empty — EngineSection carries the messaging.
      // isSessionActive threaded through (deviates from the brief's one-arg
      // sketch): the standalone <EngineSection/> this replaced disabled the
      // install/remove buttons mid-session, and this gate must keep doing so.
      gate: React.createElement(EngineSection, { isSessionActive }),
      // A plain React element (SlotDeviceBadge mounts as its own component
      // instance), not a direct hook call, since this file is `.ts` (no JSX)
      // and `slotBadge` is invoked synchronously inside EnginePage's render.
      // `modelId` is this slot's effective pick (explicit or auto): the badge
      // shows the store's resolved device only when the report is about it.
      slotBadge: (slot, id) => {
        const [src, tgt] = split(slot.dir);
        const modelId = useNativeModelStore.getState().resolve(src, tgt, selections)[slot.stage]?.modelId ?? null;
        const setting = { asr: asrDevice, translation: translationDevice, tts: ttsDevice }[slot.stage];
        return React.createElement(SlotDeviceBadge, { stage: slot.stage, modelId, id, setting });
      },
      stagesFor: (_dir, isSpeaker): Stage[] => (isSpeaker ? ['asr', 'translation', 'tts'] : ['asr', 'translation']),
      disabled: isSessionActive,
    };
  }, [sourceLanguage, targetLanguage, selections, asrDevice, translationDevice, ttsDevice, catalog, statuses, update, isSessionActive]);
}
