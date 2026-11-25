/**
 * Hardware detection (port of the probe half of sidecar/sokuji_sidecar/accel.py): what the native library sees on
 * this machine, assembled once into a Machine and cached. Every detector that throws degrades to "absent", so the CPU
 * floor is always reachable. The fingerprint names the hardware and the generation names the software; both are the
 * first 12 hex digits of a sha256 over their facts (the bench cache keyed by them is a new file, accel-bench.v2.json).
 */
import { createHash } from 'node:crypto';
import { machine as makeMachine, type DeviceProfile, type Machine } from './machine';
import { seams } from './seams';

const PLATFORM_MAP: Readonly<Record<string, string>> = { Linux: 'linux', Windows: 'windows', Darwin: 'macos' };

/** This host's platform tag for the catalog's per-deployment filter (D9): linux | windows | macos. */
export function currentPlatform(): string {
  const sys = seams.system();
  return PLATFORM_MAP[sys] ?? sys.toLowerCase();
}

const hash12 = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 12);

/** The accelerator kinds the native library can use here, sorted for a stable fingerprint. */
export function nativeKinds(): string[] {
  return [...new Set(seams.nativeDevices().map((d) => d.kind as string))].sort();
}

/** The non-CPU devices' stable identity: [kind, DESCRIPTION, memTotal] — the planner reads the description (R36). */
export function nativeGpus(): Array<[string, string, number]> {
  return seams.nativeDevices().filter((d) => d.kind !== 'cpu').map((d) => [d.kind, d.description || '', Math.trunc(d.memTotal || 0)]);
}

export function nativeProfiles(): DeviceProfile[] {
  return seams.nativeProfiles().map((p) => ({
    index: p.index, kind: p.kind, name: p.name, description: p.description, memTotal: Math.trunc(p.memTotal), known: Boolean(p.known),
    features: new Set(p.features), driverName: p.driverName, driverVersion: p.driverVersion, deviceUuid: p.deviceUuid, cpuFeatures: p.cpuFeatures,
  }));
}

/**
 * The cache generation (spec A §3.3): a hash over the library version, the engine pins, each device's driver
 * identity and the GGML_* environment. No devices hash as an empty list, so an addon without profiles still gets a
 * version-keyed generation; no identity is "".
 */
export function computeGeneration(identity: [string, Record<string, string>] | null, devices: readonly DeviceProfile[]): string {
  if (identity === null) return '';
  const [version, pins] = identity;
  const devPart = [...devices].sort((a, b) => a.index - b.index).map((d) => [d.kind, d.deviceUuid, d.driverName, d.driverVersion]);
  const envPart = Object.entries(process.env).filter(([k]) => k.startsWith('GGML_')).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const pinPart = Object.entries(pins).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return hash12(`${version}|${JSON.stringify(pinPart)}|${JSON.stringify(devPart)}|${JSON.stringify(envPart)}`);
}

/**
 * FRESH free memory of the primary accelerator, or null without one. Volatile by design: read at plan or load time,
 * never cached in the Machine. Callers take null as "skip memory gating and measurement".
 */
export function deviceFreeBytes(): number | null {
  try {
    for (const d of seams.nativeDevices()) {
      if (d.kind !== 'cpu') {
        const free = Math.trunc(seams.deviceFreeMem(d.index) || 0);
        if (free > 0) return free;
      }
    }
  } catch {
    // no addon: no reading
  }
  return null;
}

/** FRESH available system memory. */
export function ramFreeBytes(): number | null {
  return seams.ramFreeBytes();
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

let MACHINE: Machine | null = null;

/** Detects the hardware once and caches it; `force` probes again. */
export function probe(force = false): Machine {
  if (MACHINE !== null && !force) return MACHINE;
  const apple = safe(() => seams.appleSilicon(), false);
  const installed = safe(() => seams.installed(), new Set<string>());
  const tcKinds = safe(nativeKinds, []);
  const tcGpus = safe(nativeGpus, []);
  const devices = safe(nativeProfiles, []);
  const identity = safe(() => seams.nativeIdentity(), null);
  const fpSrc = `${seams.system()}|${seams.machine()}|${apple ? 1 : 0}|${[...installed].sort().join(',')}|${tcKinds.join(',')}|${tcGpus.map(([k, n, t]) => `${k}:${n}:${t}`).join(',')}`;
  MACHINE = makeMachine({
    os: seams.system(), arch: seams.machine(), cpuCores: seams.cpuCount() || 1, appleSilicon: apple, installed,
    fingerprint: hash12(fpSrc), tcKinds, gpus: tcGpus, devices, generation: computeGeneration(identity, devices),
  });
  return MACHINE;
}

/** Forgets the cached Machine (tests). */
export function resetProbeForTests(): void {
  MACHINE = null;
}

/** Makes `probe()` answer `m` until the next forced probe (tests; Python's monkeypatch of accel.probe). */
export function setMachineForTests(m: Machine | null): void {
  MACHINE = m;
}
