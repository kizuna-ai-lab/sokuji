import { useEffect } from 'react';
import { describeCause, reportWarning } from '../../lib/diagnostics/report';
import { filterVoicesByLanguage, getEdgeTtsVoices } from '../../lib/edge-tts/voiceList';
import { directionKey } from '../../lib/local-inference/selection/types';
import { usePlan } from '../../lib/plan/fromStores';
import { providersIn, transcriptionAccount, transcriptionProvider, unitFor } from '../../lib/plan/read';
import { localInferenceProvider } from '../../providers/localInference/provider';
import type { LocalInferenceSettings } from '../../providers/localInference/settings';
import { directionVoice, withDirectionVoice } from '../../providers/localInference/voices';
import { useLineUpStore, useStoredLocalStages } from '../../stores/lineUpStore';
import { useModelStatuses, useModelStore } from '../../stores/modelStore';
import { useProviderStore } from '../../stores/providerStore';

/**
 * What the app keeps true about the local provider's settings while it is in
 * the plan (plan 1e-3b-2 ruling 10): its downloaded models scanned once, and,
 * while it is the one that speaks, an Edge TTS voice that matches the target
 * language of each speaking direction Edge will read. Readiness is the
 * app session's (`attach()` checks a local provider itself); this writes
 * only through the provider store, the one writer of the provider's stored
 * settings (ruling 11).
 */
export function SettingsInitializer() {
  const found = usePlan();
  const entry = useProviderStore((s) => s.entries[localInferenceProvider.id]);
  const legs = useProviderStore((s) => s.legs);
  const participantSpeech = useProviderStore((s) => s.speech.participantSpeech);
  const lineUpSpeech = useLineUpStore((s) => s.lineUp?.speech);
  // What the local provider serves of the stored line-up, as its builders read it; null until one is stored.
  const stages = useStoredLocalStages();
  const modelStatuses = useModelStatuses();
  const plan = found.state === 'ready' ? found.plan : null;
  // Its models are scanned whenever a unit of it runs; its voices are kept only while it is the one that speaks.
  const inPlan = plan !== null && providersIn(plan).some((p) => p.id === localInferenceProvider.id);
  const speaks = plan !== null && unitFor(plan, 'speech').provider.id === localInferenceProvider.id;
  // Another provider transcribes and translates: the local selections do not say who speaks, the line-up does.
  const voiceAlone = speaks && transcriptionProvider(plan).id !== localInferenceProvider.id;
  const settings = entry?.settings as LocalInferenceSettings | undefined;
  // The run's pair is its transcription provider's: the local provider's own while it runs every stage.
  const pair = found.state === 'ready' ? transcriptionAccount(found).pair : undefined;
  const source = pair?.source;
  const target = pair?.target;
  // Local inference sets no `participantSpeech` flag: the other side speaks when its leg runs and its switch is on.
  const participantSpeaks = legs.includes('participant') && participantSpeech;

  useEffect(() => {
    if (!inPlan || useModelStore.getState().initialized) return;
    useModelStore.getState().initialize().catch((error: unknown) =>
      reportWarning('SettingsInitializer', `Scanning the downloaded models failed: ${describeCause(error)}`, { cause: error }));
  }, [inPlan]);

  // Each direction that will speak keeps an Edge voice of its own target (#619): mine always, as
  // before; the other side's only while its leg speaks. The picker's own effect runs only while
  // Settings is open; both pick the target's first voice, so they never disagree.
  useEffect(() => {
    if (!speaks || !settings || !source || !target) return;
    const spoken = [{ src: source, tgt: target }, ...(participantSpeaks ? [{ src: target, tgt: source }] : [])];
    const { resolve } = useModelStore.getState();
    // Which of them Edge reads: all or none by the line-up while the voice is alone; else each as a session resolves
    // it, with the stored line-up's stages, so a direction Edge reads only because the line-up says so has its voice.
    let onEdge: typeof spoken;
    if (!voiceAlone) onEdge = spoken.filter((d) => resolve(d.src, d.tgt, settings.selections, stages).tts?.modelId === 'edge-tts');
    else if (lineUpSpeech === 'edge') onEdge = spoken;
    else onEdge = [];
    if (onEdge.length === 0) return;
    let cancelled = false;
    getEdgeTtsVoices()
      .then((voices) => {
        if (cancelled) return;
        // The table as it is now: the Library may have written another direction since this effect ran.
        const latest = useProviderStore.getState().entries[localInferenceProvider.id]?.settings as LocalInferenceSettings | undefined;
        if (!latest) return;
        let table = latest.voices;
        for (const { src, tgt } of onEdge) {
          const dir = directionKey(src, tgt);
          const candidates = filterVoicesByLanguage(voices, tgt);
          if (candidates.length === 0 || candidates.some((v) => v.ShortName === directionVoice(table, dir).edge)) continue;
          table = withDirectionVoice(table, dir, { edge: candidates[0].ShortName }).voices;
        }
        if (table !== latest.voices) useProviderStore.getState().updateSettings(localInferenceProvider, { voices: table });
      })
      .catch((error: unknown) =>
        reportWarning('SettingsInitializer', `Choosing an Edge TTS voice failed: ${describeCause(error)}`, { cause: error, dedupeKey: 'edge-voice' }));
    return () => { cancelled = true; };
  }, [speaks, voiceAlone, lineUpSpeech, stages, settings?.selections, settings?.voices, source, target, participantSpeaks, modelStatuses]);

  return null;
}
