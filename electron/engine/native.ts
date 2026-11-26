/**
 * The engine's one door to the native addon (port of sidecar/sokuji_sidecar/native.py). `loadNative` loads
 * `sokuji_native_node.node` from a directory and checks it against that directory's contract; `module()` initialises
 * it once with the SOKUJI_NATIVE_THREADS policy (0 = the library's own) and a log sink into the engine's log, and
 * answers device questions. No other module reaches the addon except through here.
 */
import path from 'node:path';
import { BackendLoadError } from './backends';

export type NativeModule = typeof import('../../native/node/index');
export type NativeDevice = ReturnType<NativeModule['devices']>[number];
export type NativeDeviceProfile = ReturnType<NativeModule['deviceProfiles']>[number];
export type NativeLog = (level: 'debug' | 'info' | 'warn' | 'error', message: string) => void;

export const ADDON_FILE = 'sokuji_native_node.node';
const LEVELS = ['debug', 'info', 'warn', 'error'] as const;

let loaded: { native: NativeModule; dir: string } | null = null;
let initialised = false;
let log: NativeLog = () => {};

/** Loads the addon from `dir` and checks it against `dir`'s contract; any failure throws with the loader's own message. */
export function loadNative(dir: string): NativeModule {
  const file = path.join(dir, ADDON_FILE);
  const holder = { exports: {} as NativeModule };
  process.dlopen(holder as unknown as NodeJS.Module, file);
  const native = holder.exports;
  const contract = native.contract(dir);
  if (contract.abi !== native.abi()) throw new Error(`${file}: ABI ${native.abi()} does not match contract.json's ${contract.abi}`);
  return native;
}

/** Makes `native` the addon `module()` answers with, not yet initialised. */
export function useNative(native: NativeModule, dir: string): void {
  loaded = { native, dir };
  initialised = false;
}

/** Where the addon's log lines go. */
export function setNativeLog(sink: NativeLog): void {
  log = sink;
}

/** The initialised addon; throws while none is loaded. */
export function module(): NativeModule {
  if (!loaded) throw new Error('the native addon is not loaded');
  if (!initialised) {
    const threads = Number.parseInt(process.env.SOKUJI_NATIVE_THREADS ?? '0', 10) || 0;
    loaded.native.init({ moduleDir: loaded.dir, threads, onLog: (level, message) => log(LEVELS[level] ?? 'info', message) });
    initialised = true;
  }
  return loaded.native;
}

export function devices(): NativeDevice[] {
  return [...module().devices()];
}

/** The first device of `kind`, or BackendLoadError: the resolver then falls back to the next plan. */
export function deviceFor(kind: string): NativeDevice {
  const device = devices().find((d) => d.kind === kind);
  if (!device) throw new BackendLoadError(`no ${kind} device in this process`);
  return device;
}

export function deviceProfiles(): NativeDeviceProfile[] {
  return [...module().deviceProfiles()];
}

export function deviceSupportsOps(index: number, stage: 'asr' | 'translate' | 'tts', family: string, weightDtypes: Iterable<string>) {
  return module().deviceSupportsOps(index, stage, family, [...weightDtypes]);
}

/** Replaces the addon for a test (null: none loaded). */
export function setNativeForTests(native: NativeModule | null): void {
  loaded = native ? { native, dir: '' } : null;
  initialised = false;
}
