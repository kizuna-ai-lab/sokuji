import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { VoiceSummaryProps } from '../../lib/provider/types';
import { voiceNameFromShortName } from '../../lib/edge-tts/voiceList';
import { getManifestEntry } from '../../lib/local-inference/modelManifest';
import { shortenModelName } from '../../lib/local-inference/modelName';
import { dbKeyFromImportedSid } from '../../lib/local-inference/sidMapping';
import { directionKey } from '../../lib/local-inference/selection/types';
import { useModelStore } from '../../stores/modelStore';
import { FALLBACK_PAIR } from './engineLegs';
import type { LocalInferenceSettings } from './settings';
import { directionVoice, speakerIdFor } from './voices';

/**
 * The voice a spoken leg reads in (#619), from its direction's resolved TTS
 * model and `voices` entry: an Edge voice by its own name; a Supertonic
 * preset by name, an imported one as a custom voice (its name lives in
 * IndexedDB); another multi-speaker model by its short name and speaker
 * number, as the Library edits it; a single-voice model by its short name.
 * Nothing when no TTS model resolves: the start warns about that leg instead.
 */
export function LocalInferenceVoiceSummary({ settings, pair = FALLBACK_PAIR, leg }: VoiceSummaryProps<LocalInferenceSettings>) {
  const { t } = useTranslation();
  const modelStatuses = useModelStore((s) => s.modelStatuses);
  const [src, tgt] = leg === 'speaker' ? [pair.source, pair.target] : [pair.target, pair.source];
  const ttsId = useMemo(
    () => useModelStore.getState().resolve(src, tgt, settings.selections).tts?.modelId,
    [src, tgt, settings.selections, modelStatuses],
  );
  if (!ttsId) return null;
  const entry = getManifestEntry(ttsId);
  const modelName = entry ? shortenModelName(entry.name, entry.shortName) : ttsId;
  const voice = directionVoice(settings.voices, directionKey(src, tgt));
  if (entry?.engine === 'edge-tts') return <>{voice.edge ? voiceNameFromShortName(voice.edge) : modelName}</>;
  const sid = speakerIdFor(voice, ttsId);
  if (entry?.engine === 'supertonic') {
    if (dbKeyFromImportedSid(sid) !== null) return <>{t('settings.voiceCustom', 'Custom voice')}</>;
    return <>{entry.ttsConfig?.presetVoices?.find((p) => p.sid === sid)?.name ?? modelName}</>;
  }
  return <>{(entry?.numSpeakers ?? 1) > 1 ? `${modelName} #${sid}` : modelName}</>;
}
