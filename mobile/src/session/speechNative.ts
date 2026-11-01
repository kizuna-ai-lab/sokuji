import * as AudioCapture from '../../modules/audio-capture/src/AudioCaptureModule';
import { createModuleSpeechPlayer } from './captureAdapter';
import type { SpeechPlayer } from './speech';

// Android's SpeechPlayer (spec §5). Kept apart from captureAdapter.ts, which
// the node tests import: this module is native.
export function createNativeSpeechPlayer(sampleRate: number, onFailed: (message: string) => void = () => {}): SpeechPlayer & { close(): Promise<void> } {
  return createModuleSpeechPlayer(AudioCapture, sampleRate, onFailed);
}
