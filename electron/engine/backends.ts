/**
 * The backend registry and the shared ASR result (port of sidecar/sokuji_sidecar/backends.py). One class per inference
 * stage, registered by its NAME; the ASR, translation and TTS backends register themselves when their modules load.
 */

/** What a recogniser answers. */
export class AsrResult {
  constructor(readonly text: string, readonly language: string | null = null) {}
}

/** A backend could not honour (device, compute type): the resolver falls back to the next plan. */
export class BackendLoadError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.name = 'BackendLoadError';
    this.reason = reason;
  }
}

export interface BackendClass<B = unknown> {
  readonly NAME: string;
  new (): B;
}

const BACKENDS = new Map<string, BackendClass>();

/** Registers a backend class under its NAME for makeBackend(). */
export function registerBackend<C extends BackendClass>(cls: C): C {
  BACKENDS.set(cls.NAME, cls);
  return cls;
}

/** A new instance of the backend registered under `name`. */
export function makeBackend(name: string): unknown {
  const cls = BACKENDS.get(name);
  if (!cls) throw new BackendLoadError(`unknown backend: ${name}`);
  return new cls();
}

export const TARGET_RATE = 16000;
