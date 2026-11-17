/**
 * The measurement seam: everything that wants region latencies calls
 * measureRegionFamily, and tests swap it with setRegionMeasure so no test
 * reaches the network.
 */
import { probeRegions, type RegionMedians } from './probe';
import { REGION_FAMILIES, type RegionFamily } from './regionalProviders';

type Measure = (family: RegionFamily, signal?: AbortSignal) => Promise<RegionMedians | null>;

/**
 * The probe hosts answer 404 at their root, and Chromium writes every failed or
 * cancelled load into the console itself ("HEAD … 404 (Not Found)",
 * "net::ERR_ABORTED"), out of reach of any try/catch. So the measurement
 * brackets those lines with two of its own, telling whoever reads the console
 * that they come from the latency test.
 */
function startLine(vendor: string, urls: readonly string[]): string {
  return `[Sokuji] [RegionLatency] ===== ${vendor} latency test: start. The "HEAD … 404 (Not Found)" and "net::ERR_ABORTED" errors that follow, for ${urls.join(', ')}, come from this test and are expected: these servers answer 404 at their root, and only the time to answer is used. =====`;
}

function endLine(vendor: string, medians: RegionMedians | null, cancelled: boolean): string {
  const outcome = medians
    ? Object.entries(medians).map(([region, ms]) => (ms === null ? `${region} no answer` : `${region} ${ms} ms`)).join(', ')
    : cancelled ? 'cancelled' : 'stopped by an error';
  return `[Sokuji] [RegionLatency] ===== ${vendor} latency test: end (${outcome}). The 404 and net::ERR_ABORTED errors above came from this test. =====`;
}

/**
 * The real probe. The requests are no-cors and carry no credentials, so they
 * also pass a page that is cross-origin isolated with COEP `credentialless`
 * (the Vite dev server, vite.config.ts). Under COEP `require-corp` Chromium
 * would block these responses and every region would read "unreachable". The
 * packaged app (file://) and the extension are not cross-origin isolated.
 */
const realMeasure: Measure = async (family, signal) => {
  const spec = REGION_FAMILIES[family];
  const targets = spec.regions.map((r) => ({ region: r, url: spec.probeUrl(r) }));
  console.info(startLine(spec.vendor, targets.map((t) => t.url)));
  let medians: RegionMedians | null = null;
  try {
    medians = await probeRegions(targets, {
      fetch: (u, i) => fetch(u, i),
      now: () => performance.now(),
      sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
      signal,
    });
    return medians;
  } finally {
    console.info(endLine(spec.vendor, medians, signal?.aborted === true));
  }
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
