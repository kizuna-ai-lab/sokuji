/**
 * A fake of the native addon (native/node/index.d.ts) for the engine's tests, mirroring the fakes in
 * sidecar/tests/_fixtures.py and conftest.py: configurable devices, profiles and op coverage. Each stage's task adds
 * its scripted models (ASR, translation, TTS) as it ports them; until then loading one throws.
 */
import type { NativeModule } from '../native';

type Device = ReturnType<NativeModule['devices']>[number];
type DeviceProfile = ReturnType<NativeModule['deviceProfiles']>[number];
type OpCoverage = Awaited<ReturnType<NativeModule['deviceSupportsOps']>>;

export interface FakeNativeOptions {
  /** The devices, indexed in order; missing fields take a CPU-like default. */
  devices?: Array<Partial<Device> & { kind: Device['kind'] }>;
  profiles?: DeviceProfile[];
  opCoverage?: (index: number, stage: string, family: string, dtypes: string[]) => OpCoverage;
  abi?: number;
  version?: string;
}

export type FakeNative = NativeModule & { calls: string[]; inits: Array<{ threads: number | undefined; onLog: boolean }> };

const notScripted = (name: string) => () => { throw new Error(`fake native: ${name} is not scripted in this test`); };

export function makeFakeNative(opts: FakeNativeOptions = {}): FakeNative {
  const calls: string[] = [];
  const inits: FakeNative['inits'] = [];
  const devices: Device[] = (opts.devices ?? [{ kind: 'cpu', description: 'CPU' }]).map((d, index) => ({
    index,
    name: d.name ?? `${d.kind}${index}`,
    description: d.description ?? d.kind,
    memTotal: d.memTotal ?? 0,
    memFree: d.memFree ?? 0,
    ...d,
    kind: d.kind,
  }));
  const abi = opts.abi ?? 2;
  const version = opts.version ?? '1.2.0';
  const fake = {
    calls,
    inits,
    abi: () => { calls.push('abi'); return abi; },
    version: () => { calls.push('version'); return version; },
    engineVersions: () => ({}),
    contract: (_dir: string) => { calls.push('contract'); return { abi, version, lane: 'cpu' }; },
    init: (o: { threads?: number; onLog?: unknown }) => {
      calls.push('init');
      inits.push({ threads: o.threads, onLog: typeof o.onLog === 'function' });
      return { threads: o.threads ?? 0 };
    },
    devices: () => { calls.push('devices'); return devices.map((d) => ({ ...d })); },
    deviceFreeMem: (index: number) => devices.find((d) => d.index === index)?.memFree ?? 0,
    deviceProfiles: () => { calls.push('deviceProfiles'); return (opts.profiles ?? []).map((p) => ({ ...p })); },
    deviceSupportsOps: async (index: number, stage: 'asr' | 'translate' | 'tts', family: string, dtypes: string[]) => {
      calls.push('deviceSupportsOps');
      return opts.opCoverage ? opts.opCoverage(index, stage, family, dtypes) : { allSupported: true, unsupported: [], checked: [] };
    },
    audioFamilies: () => [],
    resample: notScripted('resample'),
    asrLoad: notScripted('asrLoad'),
    translateLoad: notScripted('translateLoad'),
    ttsLoad: notScripted('ttsLoad'),
  };
  return fake as unknown as FakeNative;
}
