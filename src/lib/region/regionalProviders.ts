/**
 * The table of providers that run in more than one region: which regions a
 * family has, how to name them, and which URL to time. Adding a Soniox region
 * to SONIOX_REGIONS makes it join here without another edit.
 */
import { SONIOX_REGIONS, SONIOX_REGION_LABELS, sonioxHosts, asSonioxRegion, type SonioxRegion } from '../soniox/regions';
import { QWEN_REGIONS, QWEN_REGION_LABELS, asQwenRegion, type QwenRegion } from '../../providers/qwen_livetranslate/regions';
import { ENDPOINTS } from '../../providers/qwen_livetranslate/endpoints';

export type RegionFamily = 'soniox' | 'qwen';

export interface RegionFamilySpec {
  vendor: 'Soniox' | 'Qwen';
  regions: readonly string[];
  label(r: string): string;
  probeUrl(r: string): string;
  narrow(v: unknown): string;
}

function qwenProbeUrl(region: string): string {
  const entry = Object.values(ENDPOINTS).find((e) => e.region === region);
  if (!entry) throw new Error(`No Qwen endpoint for region "${region}"`);
  return `${new URL(entry.tokens).origin}/`;
}

export const REGION_FAMILIES: Readonly<Record<RegionFamily, RegionFamilySpec>> = {
  soniox: {
    vendor: 'Soniox',
    regions: SONIOX_REGIONS,
    label: (r) => SONIOX_REGION_LABELS[r as SonioxRegion] ?? r,
    probeUrl: (r) => `https://${sonioxHosts(r as SonioxRegion).ttsRt}/`,
    narrow: (v) => asSonioxRegion(v),
  },
  qwen: {
    vendor: 'Qwen',
    regions: QWEN_REGIONS,
    label: (r) => QWEN_REGION_LABELS[r as QwenRegion] ?? r,
    probeUrl: qwenProbeUrl,
    narrow: (v) => asQwenRegion(v),
  },
};

export type RegionalProviderId = 'kizunaai_soniox' | 'soniox' | 'kizunaai_qwen';

export const REGION_FAMILY_OF: Readonly<Record<RegionalProviderId, RegionFamily>> = {
  kizunaai_soniox: 'soniox',
  soniox: 'soniox',
  kizunaai_qwen: 'qwen',
};

/** Only the managed providers are ever recommended a region; own-key never. */
export type RecommendedProviderId = 'kizunaai_soniox' | 'kizunaai_qwen';

export const RECOMMENDED_PROVIDER_IDS: readonly RecommendedProviderId[] = ['kizunaai_soniox', 'kizunaai_qwen'];

export function isRecommendedProvider(id: string | null | undefined): id is RecommendedProviderId {
  return (RECOMMENDED_PROVIDER_IDS as readonly (string | null | undefined)[]).includes(id);
}

/** The provider's configured region, narrowed to a valid one (family default otherwise). */
export function currentRegion(providerId: RegionalProviderId, settings: unknown): string {
  const region = (settings as { region?: unknown } | null | undefined)?.region;
  return REGION_FAMILIES[REGION_FAMILY_OF[providerId]].narrow(region);
}
