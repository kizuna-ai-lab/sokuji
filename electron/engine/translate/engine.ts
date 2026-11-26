/**
 * The translation engine (port of translate_engine.TranslateEngine): loads the resolved plan, measures tokens/s, and
 * translates with the session's languages. `generation` counts inits, so a teardown captured by an earlier init can
 * tell it has been superseded and leave the newer model alone.
 */
import { measureTps } from '../accel/bench';
import { ledgerRelease } from '../accel/ledger';
import { loadMeasured } from '../accel/loader';
import { probe } from '../accel/probe';
import { resolveTranslate } from '../accel/resolve';
import type { Plan } from '../planner';
import './backend';
import type { TranslateOptions } from './backend';
import { pyStrip } from './strategies';

export interface TranslateBackendLike {
  translate(text: string, systemPrompt: string, src: string, tgt: string, opts?: TranslateOptions): Promise<[string, number]>;
  cancel?(): void;
  unload?(): Promise<void> | void;
}

/** What init reads, patched by tests (Python's monkeypatching of accel). */
const DEFAULTS = {
  resolveTranslate: (modelId: string, override: string, reservedBytes: number, pin: string | null): Promise<Plan[]> => resolveTranslate(modelId, override, null, reservedBytes, pin),
  loadMeasured: (plans: readonly Plan[], stage: string) => loadMeasured(plans, stage) as Promise<[unknown, Plan, string | null, number | null]>,
  measureTps: (backend: unknown, plan: Plan, modelId: string) => measureTps(backend, plan, modelId, probe()),
  now: (): number => performance.now(),
};
export const engineSeams = { ...DEFAULTS };
export function restoreEngineSeams(): void {
  Object.assign(engineSeams, DEFAULTS);
}

export class TranslateEngine {
  backend: TranslateBackendLike | null = null;
  src = '';
  tgt = '';
  resolved: Record<string, unknown> | null = null;
  private gen = 0;

  get generation(): number {
    return this.gen;
  }

  async init(modelId: string | null = null, sourceLang = '', targetLang = '', device = 'auto', reservedBytes = 0, pin: string | null = null): Promise<number> {
    const t0 = engineSeams.now();
    this.gen += 1;                                        // before close(): a teardown of the previous init is now stale
    await this.close();                                   // free the prior model first
    this.src = sourceLang;
    this.tgt = targetLang;
    const id = modelId || 'qwen2.5-0.5b';
    const plans = await engineSeams.resolveTranslate(id, device || 'auto', reservedBytes, pin);
    const [backend, plan, notice, mem] = await engineSeams.loadMeasured(plans, 'translate');
    this.backend = backend as TranslateBackendLike;
    const tps = await engineSeams.measureTps(this.backend, plan, id);
    this.resolved = { backend: plan.backend, device: plan.device, computeType: plan.computeType };
    if (tps !== null) this.resolved.tokensPerSec = Math.round(tps * 10) / 10;
    if (mem !== null) this.resolved.memoryBytes = mem;
    if (notice) this.resolved.fallbackReason = notice;
    return Math.trunc(engineSeams.now() - t0);
  }

  /** Aborts the backend's most recent call (teardown runs this before close()). */
  cancelActive(): void {
    try {
      this.backend?.cancel?.();
    } catch {
      // best effort
    }
  }

  /** [translation, milliseconds]; blank text is answered at once. */
  async translate(text: string, systemPrompt = '', wrapTranscript = false, opts: Omit<TranslateOptions, 'wrap'> = {}): Promise<[string, number]> {
    const t0 = engineSeams.now();
    if (!pyStrip(text)) return ['', 0];
    if (this.backend === null) throw new Error('the translation model is not loaded (translate_init first)');
    const [out] = await this.backend.translate(text, systemPrompt, this.src, this.tgt, { wrap: wrapTranscript, ...opts });
    return [out, Math.trunc(engineSeams.now() - t0)];
  }

  async close(): Promise<void> {
    ledgerRelease('translate');
    const backend = this.backend;
    this.backend = null;
    if (backend !== null) {
      try {
        await backend.unload?.();
      } catch {
        // best effort
      }
    }
  }
}
