import { Platform } from 'react-native';
import { requireNativeModule } from 'expo';
import type { CaptureChain } from '../../../src/session/capture';
import type { Pan } from '../../../src/session/speech';
import { bytesToInt16, int16ToBytes } from './int16';

export interface CaptureOptions {
  echoCancellation: boolean;
  sampleRate: 16000;
  /** The stored microphone; a device that is gone falls back to the phone's own. */
  inputDeviceId?: string | null;
}

export interface CaptureInfo {
  /** The chain actually running, which may be `none` although echo cancellation was asked for. */
  chain: CaptureChain;
  sampleRate: number;
  android?: { implementor: string | null; noiseSuppressionOff: boolean | null; seededDelayMs: number | null };
}

export type CaptureStopped = { reason: 'interrupted' | 'error'; message?: string };

export type InputDevice = { id: string; name: string; category: string };

type Subscription = { remove(): void };

type NativeModule = {
  startCapture(options: CaptureOptions): Promise<CaptureInfo>;
  stopCapture(): Promise<void>;
  listInputs(): InputDevice[] | Promise<InputDevice[]>;
  speechOpen(sampleRate: number): Promise<void>;
  speechWrite(bytes: Uint8Array, pan: Pan): void;
  speechStop(): void;
  speechQueuedSeconds(): number;
  speechHeld(): number;
  speechClose(): Promise<void>;
  addListener(event: 'audio', listener: (e: { bytes: Uint8Array }) => void): Subscription;
  addListener(event: 'stopped', listener: (e: CaptureStopped) => void): Subscription;
};

// Looked up at the first call, never at import: the module is only needed by a running session.
const native = () => requireNativeModule<NativeModule>('AudioCapture');

export function startCapture(options: CaptureOptions): Promise<CaptureInfo> {
  return native().startCapture(options);
}

export function stopCapture(): Promise<void> {
  return native().stopCapture();
}

/** 100 ms frames of 16 kHz mono 16-bit PCM. */
export function addAudioListener(cb: (pcm: Int16Array) => void): Subscription {
  return native().addListener('audio', (e) => cb(bytesToInt16(e.bytes)));
}

export function addStoppedListener(cb: (e: CaptureStopped) => void): Subscription {
  return native().addListener('stopped', cb);
}

/** Android: the inputs, USB included. Elsewhere none: the audio library lists them. */
export async function listInputs(): Promise<InputDevice[]> {
  if (Platform.OS !== 'android') return [];
  return native().listInputs();
}

// Android: speech plays through the module, whose canceller needs every sample
// as its reference (spec §5). iOS plays through the audio library, so nothing
// below is ever called there and the native side does not define it.
export function speechOpen(sampleRate: number): Promise<void> {
  return native().speechOpen(sampleRate);
}

export function speechWrite(pcm: Int16Array, pan: Pan): void {
  native().speechWrite(int16ToBytes(pcm), pan);
}

export function speechStop(): void {
  native().speechStop();
}

export function speechQueuedSeconds(): number {
  return native().speechQueuedSeconds();
}

export function speechHeld(): number {
  return native().speechHeld();
}

export function speechClose(): Promise<void> {
  return native().speechClose();
}
