/**
 * Which device to use, given the OS's list (spec 2026-10-04 "device follow",
 * section 1). One rule for the startup refresh, the refresh buttons and the
 * automatic sync, so the three agree — and the saved device comes first, which
 * is what switches back to the user's own device when it returns.
 */
import type { AudioDevice } from '../../stores/audioStore';
import { isLoopbackInput } from '../../utils/audioDevices';

export interface DeviceChoice {
  devices: readonly AudioDevice[];
  /** The user's own pick, as persisted; never a fallback. */
  savedId: string | null;
  /** What is selected now. */
  currentId: string | null;
  /** Inputs that failed to open this session (`audioStore.markInputUnusable`). */
  unusable?: ReadonlySet<string>;
}

/**
 * Pick a default microphone from an enumerated input list, excluding virtual
 * ones (e.g. Sokuji's own "Sokuji_Virtual_Mic" — the monitor of Sokuji's own
 * virtual speaker, meant for other apps to consume, not for Sokuji to listen
 * to itself). Returns null when only virtual/loopback devices are available
 * rather than falling back to one — auto-selecting a loopback device as the
 * mic would feed Sokuji's own TTS output back into ASR as "user speech",
 * creating a self-sustaining transcription loop (observed on machines with
 * no physical microphone, where a virtual device is the only input listed).
 *
 * OS loopback-style inputs ("Stereo Mix", PulseAudio sink monitors,
 * VoiceMeeter outputs) carry isVirtual: false — they are real OS devices and
 * must stay manually selectable (warned) — but they re-capture system output
 * just the same, so automatic selection skips them by label too.
 */
export function pickDefaultInputDevice(inputs: readonly AudioDevice[]): AudioDevice | null {
  return inputs.find((device) => !device.isVirtual && !isLoopbackInput(device)) ?? null;
}

/** The microphone to use: the saved one, else the current one, else the first real input; null when none is left. */
export function chooseInput({ devices, savedId, currentId, unusable = new Set() }: DeviceChoice): AudioDevice | null {
  const usable = devices.filter((device) => !unusable.has(device.deviceId));
  // A saved virtual device is refused: an old auto-select bug persisted Sokuji's own virtual mic.
  const saved = savedId ? usable.find((device) => device.deviceId === savedId && !device.isVirtual) : undefined;
  const current = currentId ? usable.find((device) => device.deviceId === currentId) : undefined;
  return saved ?? current ?? pickDefaultInputDevice(usable);
}

/** The monitor output to use: the saved one, else the current one, else the first non-virtual, else any. */
export function chooseOutput({ devices, savedId, currentId }: DeviceChoice): AudioDevice | null {
  const byId = (id: string | null) => (id ? devices.find((device) => device.deviceId === id) : undefined);
  return byId(savedId) ?? byId(currentId) ?? devices.find((device) => !device.isVirtual) ?? devices[0] ?? null;
}
