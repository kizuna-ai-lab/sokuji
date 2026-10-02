/** An OpenAI Realtime voice's audition (preset voice preview): its published sample, free to fetch. */
import { previewClip, type ClipDeps, type PreviewAudio } from '../../lib/tts/clip';
import { REALTIME_VOICES } from './settings';

export async function previewRealtimeVoice(id: string, signal?: AbortSignal, deps?: ClipDeps): Promise<PreviewAudio | null> {
  const voice = REALTIME_VOICES.find((v) => v.value === id);
  return voice ? previewClip({ url: voice.clip, name: voice.name, scope: 'RealtimePreview' }, signal, deps) : null;
}
