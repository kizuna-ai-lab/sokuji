/**
 * The environment facts accel reads, each a replaceable function (the Python module calls its own as module globals
 * for the same reason: so a test can stand one in). `seams.x()` is the only way accel reaches them; a test sets
 * `seams.x = ...` and `restoreSeams()` puts the defaults back.
 *
 * The model-cache facts (`cachedFilePath`, `snapshotPath`, `modelSize`) are the HF cache's; Task 7's models/ modules
 * supply the real ones. Until then they answer "not cached" and the catalog's own size.
 */
import os from 'node:os';
import { asrModel, translateModel, ttsModel } from '../catalog';
import { makeBackend } from '../backends';
import * as native from '../native';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const SYSTEM_NAMES: Readonly<Record<string, string>> = { Linux: 'Linux', Darwin: 'Darwin', Windows_NT: 'Windows' };

/** platform.system()'s spelling: Linux, Darwin, Windows. */
export function systemName(): string {
  return SYSTEM_NAMES[os.type()] ?? os.type();
}

const defaults = {
  /** platform.system(). */
  system: (): string => systemName(),
  /** platform.machine(): x86_64, aarch64, arm64, ... */
  machine: (): string => os.machine(),
  cpuCount: (): number => os.cpus().length || 1,
  appleSilicon: (): boolean => systemName() === 'Darwin' && ['arm64', 'aarch64'].includes(os.machine()),
  /** The backends this process can run: every native one when the addon is loaded. */
  installed: (): ReadonlySet<string> => {
    try {
      native.module();
      return new Set(['native_asr', 'native_asr_stream', 'native_translate', 'native_tts']);
    } catch {
      return new Set();
    }
  },
  nativeDevices: () => native.devices(),
  nativeProfiles: () => native.deviceProfiles(),
  nativeIdentity: (): [version: string, pins: Record<string, string>] => {
    const mod = native.module();
    return [mod.version(), { ...mod.engineVersions() }];
  },
  deviceFreeMem: (index: number): number => native.module().deviceFreeMem(index),
  deviceSupportsOps: (index: number, stage: 'asr' | 'translate' | 'tts', family: string, dtypes: readonly string[]) => native.deviceSupportsOps(index, stage, family, dtypes),
  rssBytes: (): number | null => process.memoryUsage().rss,
  ramFreeBytes: (): number | null => os.freemem(),
  makeBackend: (name: string): unknown => makeBackend(name),
  /** The local path of `file` in `repo`'s cached snapshot, or null. */
  cachedFilePath: (_repo: string, _file: string): string | null => null,
  /** The local snapshot directory of a whole repo, or null. */
  snapshotPath: (_repo: string): string | null => null,
  /** A card's (or an artifact's) download size: the catalog row's, else unknown. */
  modelSize: (id: string): number | null => {
    const card = asrModel(id) ?? translateModel(id) ?? ttsModel(id);
    return card && card.sizeBytes ? card.sizeBytes : null;
  },
  now: (): number => performance.now(),
  log: (_level: LogLevel, _message: string): void => {},
};

export type Seams = typeof defaults;
export const seams: Seams = { ...defaults };

/** Puts every default back (tests). */
export function restoreSeams(): void {
  Object.assign(seams, defaults);
}
