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
  /** engineVersions(): pins plus "lane". */
  engineVersions?: Record<string, string>;
  /** Scripted ASR models (sidecar/tests/test_asr_backend.py's _FakeModel). */
  asr?: FakeAsrOptions;
}

export interface FakeAsrOptions {
  languages?: string[];
  supportsStreaming?: boolean;
  /** What run() answers. */
  text?: string;
  /** How long run() takes. */
  runDelayMs?: number;
  /** asrLoad rejects with this NativeError message. */
  loadError?: string;
}

const nativeError = (message: string, status = -6) => Object.assign(new Error(message), { name: 'NativeError', status });

/** One scripted AsrStream: committed text set by the test, finalize answers it plus " FINAL". */
export class FakeAsrStream {
  committed = '';
  closed = false;
  finalized = false;
  /** Feeds reject with this once set (a stream the library refused). */
  feedError: string | null = null;
  constructor(private readonly log: unknown[], readonly language: string | null) {}
  async feed(pcm: Float32Array) {
    this.log.push(['feed', pcm.length]);
    if (this.feedError !== null) throw nativeError(this.feedError, -1);
    return { committed: this.committed, tentative: '' };
  }
  async finalize() {
    this.log.push(['finalize']);
    this.finalized = true;
    this.closed = true;
    return `${this.committed} FINAL`;
  }
  close() {
    this.log.push(['close']);
    this.closed = true;
  }
}

/** One scripted AsrModel: records runs and streams. */
export class FakeAsrModel {
  readonly log: unknown[] = [];
  readonly runs: Array<{ n: number; language: string | null; pcm: Float32Array }> = [];
  readonly streams: FakeAsrStream[] = [];
  unloaded = false;
  readonly capabilities: { languages: string[]; supportsStreaming: boolean; supportsLanguageDetect: boolean; nativeSampleRate: number; arch: string };
  constructor(readonly path: string, readonly deviceIndex: number | null, private readonly opts: FakeAsrOptions) {
    this.capabilities = { languages: opts.languages ?? [], supportsStreaming: opts.supportsStreaming ?? false, supportsLanguageDetect: true, nativeSampleRate: 16000, arch: 'fake' };
  }
  async run(pcm: Float32Array, language: string | null) {
    this.runs.push({ n: pcm.length, language, pcm: new Float32Array(pcm) });
    if (this.opts.runDelayMs) await new Promise((r) => setTimeout(r, this.opts.runDelayMs));
    return this.opts.text ?? '  hello world  ';
  }
  openStream(language: string | null) {
    const st = new FakeAsrStream(this.log, language);
    this.streams.push(st);
    return st;
  }
  async unload() {
    this.unloaded = true;
  }
}

export type FakeNative = NativeModule & { calls: string[]; inits: Array<{ threads: number | undefined; onLog: boolean }>; asrModels: FakeAsrModel[] };

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
  const asrModels: FakeAsrModel[] = [];
  const version = opts.version ?? '1.2.0';
  const fake = {
    calls,
    inits,
    abi: () => { calls.push('abi'); return abi; },
    version: () => { calls.push('version'); return version; },
    engineVersions: () => ({ ...(opts.engineVersions ?? { ggml: '0.25.3', transcribe: '0.2.4', llama: '0.5.0', audiocpp: '0.8.2', lane: 'cpu-vulkan' }) }),
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
    asrModels,
    asrLoad: opts.asr
      ? async (path: string, deviceIndex: number | null) => {
        calls.push('asrLoad');
        if (opts.asr!.loadError) throw nativeError(opts.asr!.loadError);
        const m = new FakeAsrModel(path, deviceIndex, opts.asr!);
        asrModels.push(m);
        return m;
      }
      : notScripted('asrLoad'),
    translateLoad: notScripted('translateLoad'),
    ttsLoad: notScripted('ttsLoad'),
  };
  return fake as unknown as FakeNative;
}
