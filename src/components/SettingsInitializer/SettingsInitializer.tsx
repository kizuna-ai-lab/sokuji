import { useEffect } from 'react';
import { describeCause, reportWarning } from '../../lib/diagnostics/report';
import { filterVoicesByLanguage, getEdgeTtsVoices } from '../../lib/edge-tts/voiceList';
import { localInferenceProvider } from '../../providers/localInference/provider';
import type { LocalInferenceSettings } from '../../providers/localInference/settings';
import { useModelStatuses, useModelStore } from '../../stores/modelStore';
import { useProviderStore } from '../../stores/providerStore';

/**
 * What the app keeps true about the selected provider's settings (plan
 * 1e-3b-2 ruling 10): LocalInference's downloaded models scanned once, and
 * an Edge TTS voice that matches the target language. Readiness is the
 * app session's (`attach()` checks a local provider itself); this writes
 * only through the provider store, the one writer of the provider's stored
 * settings (ruling 11).
 */
export function SettingsInitializer() {
  const selected = useProviderStore((s) => s.selected);
  const entry = useProviderStore((s) => s.entries[localInferenceProvider.id]);
  const modelStatuses = useModelStatuses();
  const isLocal = selected === localInferenceProvider.id;
  const settings = entry?.settings as LocalInferenceSettings | undefined;
  const source = entry?.pair.source;
  const target = entry?.pair.target;

  useEffect(() => {
    if (!isLocal || useModelStore.getState().initialized) return;
    useModelStore.getState().initialize().catch((error: unknown) =>
      reportWarning('SettingsInitializer', `Scanning the downloaded models failed: ${describeCause(error)}`, { cause: error }));
  }, [isLocal]);

  // Today's rule (SettingsInitializer.tsx:165-199): the picker's own effect runs only while Settings is open.
  useEffect(() => {
    if (!isLocal || !settings || !source || !target) return;
    if (useModelStore.getState().resolve(source, target, settings.selections).tts?.modelId !== 'edge-tts') return;
    let cancelled = false;
    getEdgeTtsVoices()
      .then((voices) => {
        if (cancelled) return;
        const candidates = filterVoicesByLanguage(voices, target);
        if (candidates.length === 0 || candidates.some((v) => v.ShortName === settings.edgeTtsVoice)) return;
        useProviderStore.getState().updateSettings(localInferenceProvider, { edgeTtsVoice: candidates[0].ShortName });
      })
      .catch((error: unknown) =>
        reportWarning('SettingsInitializer', `Choosing an Edge TTS voice failed: ${describeCause(error)}`, { cause: error, dedupeKey: 'edge-voice' }));
    return () => { cancelled = true; };
  }, [isLocal, settings?.selections, settings?.edgeTtsVoice, source, target, modelStatuses]);

  return null;
}
