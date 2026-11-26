/**
 * What the planner knows of this machine (port of the dataclasses at the top of sidecar/sokuji_sidecar/accel.py).
 * The probe assembles a Machine once and caches it; the planner reads it and nothing else.
 */

/** One sk_device_profile (spec A §3.1) as the planner reads it. `known: false` means every consumer passes through. */
export interface DeviceProfile {
  readonly index: number;
  readonly kind: string;
  readonly name: string;
  readonly description: string;
  readonly memTotal: number;
  readonly known: boolean;
  readonly features: ReadonlySet<string>;
  readonly driverName: string;
  readonly driverVersion: string;
  readonly deviceUuid: string;
  readonly cpuFeatures: string;
}

export interface OpCoverage {
  readonly allSupported: boolean;
  readonly unsupported: readonly string[];
}

export interface Machine {
  readonly os: string;
  readonly arch: string;
  readonly cpuCores: number;
  readonly appleSilicon: boolean;
  /** The backends this process can run. */
  readonly installed: ReadonlySet<string>;
  readonly fingerprint: string;
  /** Accelerator kinds the native library reports ("vulkan", "metal", "cpu"): the ground truth for the GPU tiers. */
  readonly tcKinds: readonly string[];
  /**
   * STABLE GPU identity from the same probe: [kind, description, memTotal] per accelerator. Volatile free memory is
   * intentionally not here (the Machine is cached and fingerprinted); planners read it fresh at plan time.
   */
  readonly gpus: ReadonlyArray<readonly [kind: string, description: string, memTotal: number]>;
  /** Structured per-device profiles; empty when the addon predates them. */
  readonly devices: readonly DeviceProfile[];
  /** The cache generation every bench key is prefixed with; "" only when the identity detector failed. */
  readonly generation: string;
}

/** A Machine with the dataclass's defaults for what is not given. */
export function machine(m: Omit<Machine, 'tcKinds' | 'gpus' | 'devices' | 'generation'> & Partial<Pick<Machine, 'tcKinds' | 'gpus' | 'devices' | 'generation'>>): Machine {
  return { tcKinds: [], gpus: [], devices: [], generation: '', ...m };
}
