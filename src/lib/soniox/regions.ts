/**
 * Soniox regional deployments.
 *
 * Soniox runs one project per region, each with its OWN API key, reachable only
 * on its own hosts. The region is therefore part of the CREDENTIAL, not a
 * routing preference layered on top of one — which is why it travels on
 * SonioxCredentialBundle rather than living in a module-level "current region".
 * A split Both session runs two clients at once; a global would be one mutable
 * cell shared by both legs and by any settings change made mid-session.
 *
 * Host shape verified against soniox.com/docs/data-residency and DNS-resolved
 * on 2026-08-15: `<service>.<region>.soniox.com`, US carrying NO infix. The
 * region-first shape everyone reaches for first (`eu.api.soniox.com`) is
 * NXDOMAIN, and regions.test.ts pins the negative.
 *
 * This is the ONLY place in the client where that shape exists.
 */

export type SonioxRegion = 'us' | 'eu' | 'jp';

export const SONIOX_REGIONS: readonly SonioxRegion[] = ['us', 'eu', 'jp'] as const;

export const DEFAULT_SONIOX_REGION: SonioxRegion = 'us';

/**
 * Dropdown labels. Deliberately NOT locale keys: these follow the rule the
 * language dropdown already uses — a place is named in its own language — so
 * adding a region does not mean editing 30 catalogs before it can be offered.
 */
export const SONIOX_REGION_LABELS: Record<SonioxRegion, string> = {
  us: 'United States',
  eu: 'European Union',
  jp: '日本 (Japan)',
};

export interface SonioxHosts {
  /** REST API: key validation, voice cloning. */
  api: string;
  /** Real-time STT+translation WebSocket. */
  sttRt: string;
  /** Real-time TTS — WebSocket for sessions, HTTPS for one-shot previews. */
  ttsRt: string;
}

export function sonioxHosts(region: SonioxRegion): SonioxHosts {
  const infix = region === 'us' ? '' : `.${region}`;
  return {
    api: `api${infix}.soniox.com`,
    sttRt: `stt-rt${infix}.soniox.com`,
    ttsRt: `tts-rt${infix}.soniox.com`,
  };
}

/**
 * Narrow an untrusted value to a region, defaulting to US.
 *
 * Two untrusted sources feed this: a persisted settings value written by an
 * older or newer build, and the backend's session-key response (which an older
 * backend omits entirely). Both must degrade to a working session — a malformed
 * hostname would fail every connect with a DNS error nobody can act on.
 *
 * This is the OPPOSITE choice from the backend's `parseSonioxRegion`, which
 * returns null so a REQUEST can be refused with a 400. That asymmetry is
 * deliberate: refusing is right when a user asked for a region we cannot serve,
 * and defaulting is right when we are reading back our own storage. The two
 * must not be unified.
 */
export function asSonioxRegion(value: unknown): SonioxRegion {
  return typeof value === 'string' && (SONIOX_REGIONS as readonly string[]).includes(value)
    ? (value as SonioxRegion)
    : DEFAULT_SONIOX_REGION;
}
