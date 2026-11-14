/**
 * The measurement seam: everything that wants region latencies calls
 * measureRegionFamily, and tests swap it with setRegionMeasure so no test
 * reaches the network.
 */
import { probeRegions, type RegionMedians } from './probe';
import { REGION_FAMILIES, type RegionFamily } from './regionalProviders';

type Measure = (family: RegionFamily, signal?: AbortSignal) => Promise<RegionMedians | null>;

/**
 * The real probe. Under the Vite dev server's cross-origin isolation headers
 * (COEP `require-corp`, vite.config.ts) Chromium blocks these no-cors probe
 * responses, so every region reads "unreachable" in `npm run dev` and the
 * Electron dev build. The packaged app (file://) and the extension are not
 * cross-origin isolated and measure normally.
 */
const realMeasure: Measure = (family, signal) => {
  const spec = REGION_FAMILIES[family];
  return probeRegions(
    spec.regions.map((r) => ({ region: r, url: spec.probeUrl(r) })),
    {
      fetch: (u, i) => fetch(u, i),
      now: () => performance.now(),
      sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
      signal,
    },
  );
};

let current: Measure = realMeasure;

/** Always a promise: a synchronous throw while setting up the probe (or from an injected fn) becomes a rejection. */
export async function measureRegionFamily(family: RegionFamily, signal?: AbortSignal): Promise<RegionMedians | null> {
  return current(family, signal);
}

/** Swap the measurement (tests); null restores the real probe. */
export function setRegionMeasure(fn: Measure | null): void {
  current = fn ?? realMeasure;
}
