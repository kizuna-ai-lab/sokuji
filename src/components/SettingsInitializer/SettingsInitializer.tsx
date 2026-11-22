import { useEffect } from 'react';
import { describeCause, reportWarning } from '../../lib/diagnostics/report';
import { filterVoicesByLanguage, getEdgeTtsVoices } from '../../lib/edge-tts/voiceList';
import { directionKey } from '../../lib/local-inference/selection/types';
import { usePlan } from '../../lib/plan/fromStores';
import { providersIn, transcriptionAccount, unitFor } from '../../lib/plan/read';
import { edgeProvider } from '../../providers/edge/provider';
import type { EdgeSettings } from '../../providers/edge/settings';
import { localInferenceProvider } from '../../providers/localInference/provider';
import { useModelStore } from '../../stores/modelStore';
import { useProviderStore } from '../../stores/providerStore';

/**
 * What the app keeps true about the settings of the providers in the plan (plan 1e-3b-2 ruling 10): the local
 * provider's downloaded models scanned once while a unit of it runs, and, while Edge speaks (the plan's speech unit
 * is Edge's), an Edge voice in Edge's own settings that speaks the target of each direction that will speak.
 * Readiness is the app session's (`attach()` checks a local provider itself); this writes only through the provider
 * store, the one writer of a provider's stored settings (ruling 11).
 */
export function SettingsInitializer() {
  const found = usePlan();
  const voices = useProviderStore((s) => (s.entries[edgeProvider.id]?.settings as EdgeSettings | undefined)?.voices);
  const legs = useProviderStore((s) => s.legs);
  const participantSpeech = useProviderStore((s) => s.speech.participantSpeech);
  const plan = found.state === 'ready' ? found.plan : null;
  // The local models are scanned whenever a unit of the local provider runs.
  const inPlan = plan !== null && providersIn(plan).some((p) => p.id === localInferenceProvider.id);
  const edgeSpeaks = plan !== null && unitFor(plan, 'speech').provider.id === edgeProvider.id;
  // The run's pair is its transcription provider's: Edge only reads what another provider translated.
  const pair = found.state === 'ready' ? transcriptionAccount(found).pair : undefined;
  const source = pair?.source;
  const target = pair?.target;
  // Edge sets no `participantSpeech` flag: the other side speaks when its leg runs and its switch is on.
  const participantSpeaks = legs.includes('participant') && participantSpeech;

  useEffect(() => {
    if (!inPlan || useModelStore.getState().initialized) return;
    useModelStore.getState().initialize().catch((error: unknown) =>
      reportWarning('SettingsInitializer', `Scanning the downloaded models failed: ${describeCause(error)}`, { cause: error }));
  }, [inPlan]);

  // Each direction that will speak keeps an Edge voice of its own target (#619): mine always; the other side's only
  // while its leg speaks. A direction with no voice for its target gets that language's first voice, the one Edge's
  // settings show first, so the two never disagree.
  useEffect(() => {
    if (!edgeSpeaks || !source || !target) return;
    const spoken = [{ src: source, tgt: target }, ...(participantSpeaks ? [{ src: target, tgt: source }] : [])];
    let cancelled = false;
    getEdgeTtsVoices()
      .then((list) => {
        if (cancelled) return;
        // The table as it is now: Edge's settings may have written another direction since this effect ran.
        const latest = useProviderStore.getState().entries[edgeProvider.id]?.settings as EdgeSettings | undefined;
        if (!latest) return;
        let table = latest.voices;
        for (const { src, tgt } of spoken) {
          const dir = directionKey(src, tgt);
          const candidates = filterVoicesByLanguage(list, tgt);
          if (candidates.length === 0 || candidates.some((v) => v.ShortName === table[dir])) continue;
          table = { ...table, [dir]: candidates[0].ShortName };
        }
        if (table !== latest.voices) useProviderStore.getState().updateSettings(edgeProvider, { voices: table });
      })
      .catch((error: unknown) =>
        reportWarning('SettingsInitializer', `Choosing an Edge TTS voice failed: ${describeCause(error)}`, { cause: error, dedupeKey: 'edge-voice' }));
    return () => { cancelled = true; };
  }, [edgeSpeaks, voices, source, target, participantSpeaks]);

  return null;
}
