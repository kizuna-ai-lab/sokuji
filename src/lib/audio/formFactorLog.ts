// The one reader of the form-factor answer: a diagnostic line per outlet.
import type { AudioDevice } from '../../stores/audioStore';
import type useAudioStore from '../../stores/audioStore';
import { outletContext } from './appAudio';
import { OUTLET_NAMES, resolveOutlet, type OutletName } from './outlets';
import { getOutputFormFactor } from './formFactor';

type AudioState = ReturnType<typeof useAudioStore.getState>;

const NO_DEVICE_LABEL = '(system default)';

export function createFormFactorLog(
  log: (line: string) => void,
  /** False while the system's answer is stale: every form reads unknown then, and that is not a change worth a line. */
  isCurrent: () => boolean,
  faceToFace: () => boolean = () => false,
): { baseline(audio: AudioState): void; update(audio: AudioState): void } {
  const logged = new Map<OutletName, string>();

  const triple = (name: OutletName, audio: AudioState) => {
    const device = resolveOutlet(name, audio.outlets[name], outletContext(audio, faceToFace())).device;
    const entry: AudioDevice | undefined = device === undefined ? undefined : audio.audioMonitorDevices.find((d) => d.deviceId === device);
    const { formFactor, transport } = getOutputFormFactor(device);
    return `"${entry?.label ?? NO_DEVICE_LABEL}" ${formFactor}/${transport}`;
  };

  const emit = (name: OutletName, text: string) => {
    logged.set(name, text);
    log(`Output form factor: ${name} → ${text}`);
  };

  return {
    baseline(audio) {
      for (const name of OUTLET_NAMES) emit(name, triple(name, audio));
    },
    update(audio) {
      if (!isCurrent()) return;
      for (const name of OUTLET_NAMES) {
        const text = triple(name, audio);
        if (logged.get(name) !== text) emit(name, text);
      }
    },
  };
}
