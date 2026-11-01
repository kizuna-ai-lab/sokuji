import * as AudioCapture from '../../modules/audio-capture/src/AudioCaptureModule';
import { createCaptureAdapter, type Capture, type CaptureCallbacks } from './captureAdapter';

// Kept apart from captureAdapter.ts, which the node tests import: this module is native.
export function createCapture(o: CaptureCallbacks): Capture {
  return createCaptureAdapter(AudioCapture, o);
}
