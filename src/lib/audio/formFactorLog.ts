// The one reader of the form-factor answer: a diagnostic line per outlet.
import { describeCause, reportWarning } from '../diagnostics/report';
import type { AudioDevice } from '../../stores/audioStore';
import type useAudioStore from '../../stores/audioStore';
import { outletContext } from './appAudio';
import { OUTLET_NAMES, resolveOutlet, type OutletName } from './outlets';
import { cleanOutputLabel, getOutputFormFactor, unmatchedOutputLabels, type OutputDeviceInfo } from './formFactor';
import { currentNativeOutputs } from './nativeOutputs';

type AudioState = ReturnType<typeof useAudioStore.getState>;

const NO_DEVICE_LABEL = '(system default)';

export function createFormFactorLog(
  log: (line: string) => void,
  /** False while the system's answer is stale: every form reads unknown then, and that is not a change worth a line. */
  isCurrent: () => boolean,
  faceToFace: () => boolean = () => false,
  /** The system's output list, for the outputs it has no device for. */
  nativeOutputs: () => readonly OutputDeviceInfo[] | null = currentNativeOutputs,
): { baseline(audio: AudioState): void; update(audio: AudioState): void } {
  const logged = new Map<OutletName, string>();
  /** Browser labels already named this session as matching no system device. */
  const unmatchedNamed = new Set<string>();

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

  // An output no system device matches reads unknown wherever it is used, and if Chromium starts naming outputs
  // differently (a new suffix, a rewrite), every output does: the one line that shows it, each label once a session.
  const checkMatches = (audio: AudioState) => {
    if (!isCurrent()) return;
    const labels = audio.audioMonitorDevices.map((d) => d.label);
    const unmatched = unmatchedOutputLabels(labels, nativeOutputs(), audio.outputLabelsKnown);
    const fresh = unmatched.filter((l) => !unmatchedNamed.has(l));
    if (fresh.length === 0) return;
    for (const l of fresh) unmatchedNamed.add(l);
    const total = new Set(labels.map(cleanOutputLabel).filter((l) => l !== '')).size;
    log(`Output form factor: no system device matches ${fresh.map((l) => `"${l}"`).join(', ')} (${unmatched.length} of ${total} output labels)`);
  };

  // A diagnostic must never throw into a store subscriber or a session start.
  const safely = (work: () => void) => {
    try {
      work();
    } catch (error) {
      reportWarning('OutputForm', `The output form factor log failed (${describeCause(error)})`, { cause: error, dedupeKey: 'output-form:log' });
    }
  };

  return {
    baseline: (audio) => safely(() => {
      for (const name of OUTLET_NAMES) emit(name, triple(name, audio));
      unmatchedNamed.clear();
      checkMatches(audio);
    }),
    update: (audio) => safely(() => {
      if (!isCurrent()) return;
      for (const name of OUTLET_NAMES) {
        const text = triple(name, audio);
        if (logged.get(name) !== text) emit(name, text);
      }
      checkMatches(audio);
    }),
  };
}
