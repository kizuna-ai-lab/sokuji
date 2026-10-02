/** An OpenAI Live voice's audition (preset voice preview): its published sample, free to fetch. */
import { previewClip, type ClipDeps, type PreviewAudio } from '../../lib/tts/clip';
import { LIVE_VOICES } from './settings';

export async function previewLiveVoice(id: string, signal?: AbortSignal, deps?: ClipDeps): Promise<PreviewAudio | null> {
  const voice = LIVE_VOICES.find((v) => v.value === id);
  return voice ? previewClip({ url: voice.clip, name: voice.name, scope: 'LivePreview' }, signal, deps) : null;
}
