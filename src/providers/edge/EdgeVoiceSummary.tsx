import type { VoiceSummaryProps } from '../../lib/provider/types';
import { voiceNameFromShortName } from '../../lib/edge-tts/voiceList';
import { directionKey } from '../../lib/local-inference/selection/types';
import type { EdgeSettings } from './settings';

const FALLBACK_PAIR = { source: 'ja', target: 'en' };

/** The voice a spoken leg reads in, by its own name; nothing while the leg's direction has none picked yet. */
export function EdgeVoiceSummary({ settings, pair = FALLBACK_PAIR, leg }: VoiceSummaryProps<EdgeSettings>) {
  const dir = leg === 'speaker' ? directionKey(pair.source, pair.target) : directionKey(pair.target, pair.source);
  const voice = settings.voices[dir];
  return voice ? <>{voiceNameFromShortName(voice)}</> : null;
}
