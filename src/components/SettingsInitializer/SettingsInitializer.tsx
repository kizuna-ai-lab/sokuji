import { useEffect } from 'react';
import { describeCause, reportWarning } from '../../lib/diagnostics/report';
import { filterVoicesByLanguage, getEdgeTtsVoices } from '../../lib/edge-tts/voiceList';
import { directionKey } from '../../lib/local-inference/selection/types';
import { localInferenceProvider } from '../../providers/localInference/provider';
import type { LocalInferenceSettings } from '../../providers/localInference/settings';
import { directionVoice, withDirectionVoice } from '../../providers/localInference/voices';
import { useModelStatuses, useModelStore } from '../../stores/modelStore';
import { useProviderStore } from '../../stores/providerStore';

/**
 * What the app keeps true about the selected provider's settings (plan
 * 1e-3b-2 ruling 10): LocalInference's downloaded models scanned once, and
 * an Edge TTS voice that matches each speaking direction's target language. Readiness is the
 * app session's (`attach()` checks a local provider itself); this writes
 * only through the provider store, the one writer of the provider's stored
 * settings (ruling 11).
 */
export function SettingsInitializer() {
  const selected = useProviderStore((s) => s.selected);
  const entry = useProviderStore((s) => s.entries[localInferenceProvider.id]);
  const legs = useProviderStore((s) => s.legs);
  const participantSpeech = useProviderStore((s) => s.speech.participantSpeech);
  const modelStatuses = useModelStatuses();
  const isLocal = selected === localInferenceProvider.id;
  const settings = entry?.settings as LocalInferenceSettings | undefined;
  const source = entry?.pair.source;
  const target = entry?.pair.target;
  // Local inference sets no `participantSpeech` flag: the other side speaks when its leg runs and its switch is on.
  const participantSpeaks = legs.includes('participant') && participantSpeech;

  useEffect(() => {
    if (!isLocal || useModelStore.getState().initialized) return;
    useModelStore.getState().initialize().catch((error: unknown) =>
      reportWarning('SettingsInitializer', `Scanning the downloaded models failed: ${describeCause(error)}`, { cause: error }));
  }, [isLocal]);

  // Each direction that will speak keeps an Edge voice of its own target (#619): mine always, as
  // before; the other side's only while its leg speaks. The picker's own effect runs only while
  // Settings is open; both pick the target's first voice, so they never disagree.
  useEffect(() => {
    if (!isLocal || !settings || !source || !target) return;
    const spoken = [{ src: source, tgt: target }, ...(participantSpeaks ? [{ src: target, tgt: source }] : [])];
    const { resolve } = useModelStore.getState();
    const onEdge = spoken.filter((d) => resolve(d.src, d.tgt, settings.selections).tts?.modelId === 'edge-tts');
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
  }, [isLocal, settings?.selections, settings?.voices, source, target, participantSpeaks, modelStatuses]);

  return null;
}
