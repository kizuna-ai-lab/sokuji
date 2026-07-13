// Single source of truth for meeting platforms supported by the Sokuji browser extension.
//
// This registry drives every platform-list surface:
//   - src/components/Subtitle/surfaces/ExtensionContentScriptSubtitleSurface.ts SUPPORTED_HOSTS (bundled import)
//   - extension/popup.js SITE_INFO / SITE_GROUPS / ENABLED_SITES (bundled import)
//   - extension/manifest.json content_scripts / web_accessible matches (guarded by manifest.consistency.test.ts, not generated)
//   - extension/background.js ENABLED_SITES + content.js guidance chain (via the build-emitted platforms.generated.js global)
//   - extension/content/site-plugins.js HOST_TO_PLUGIN_KEY (inline — runs in the page MAIN world, can't read the global; guarded by platforms.consistency.test.ts)
//
// Display names and short names were copied verbatim from popup.js's SITE_INFO.
// Platform icons live in platformIcons.ts (kept out of this module so
// non-popup consumers don't bundle ~11 KB of base64).
// guidanceKey / pluginKey correspond to the hostname-keyed lookups in
// content.js and site-plugins.js respectively; undefined means the platform
// has no dedicated guidance message (falls back to default) or no plugin.

export type ContentProfile = 'standard' | 'jitsi' | 'zoom';

export interface PlatformEntry {
  hostname: string;
  matchPattern: string;
  contentProfile: ContentProfile;
  displayName: string;
  shortName: string;
  group?: string;        // e.g. 'teams' — members render as one popup card
  groupLabel?: string;   // e.g. 'Free' | 'Work' | 'M365'
  guidanceKey?: string;  // i18n key prefix: `${guidanceKey}Title` / `${guidanceKey}Guidance`; undefined = default
  pluginKey?: string;    // site-plugins.js plugin key; undefined = no plugin
}

export const PLATFORMS: readonly PlatformEntry[] = [
  { hostname: 'meet.google.com', matchPattern: 'https://meet.google.com/*', contentProfile: 'standard', displayName: 'Google Meet', shortName: 'Meet' },
  { hostname: 'telemost.yandex.ru', matchPattern: 'https://telemost.yandex.ru/*', contentProfile: 'standard', displayName: 'Yandex Telemost', shortName: 'Telemost' },
  { hostname: 'telemost.yandex.com', matchPattern: 'https://telemost.yandex.com/*', contentProfile: 'standard', displayName: 'Yandex Telemost (International)', shortName: 'Telemost' },
  { hostname: 'teams.live.com', matchPattern: 'https://teams.live.com/*', contentProfile: 'standard', displayName: 'Microsoft Teams Free', shortName: 'Teams', group: 'teams', groupLabel: 'Free', guidanceKey: 'teams', pluginKey: 'teams' },
  { hostname: 'teams.microsoft.com', matchPattern: 'https://teams.microsoft.com/*', contentProfile: 'standard', displayName: 'Microsoft Teams (work or school)', shortName: 'Teams', group: 'teams', groupLabel: 'Work', guidanceKey: 'teams', pluginKey: 'teams' },
  { hostname: 'teams.cloud.microsoft', matchPattern: 'https://teams.cloud.microsoft/*', contentProfile: 'standard', displayName: 'Microsoft Teams M365', shortName: 'Teams', group: 'teams', groupLabel: 'M365', guidanceKey: 'teams', pluginKey: 'teams' },
  { hostname: 'app.zoom.us', matchPattern: 'https://app.zoom.us/*', contentProfile: 'zoom', displayName: 'Zoom', shortName: 'Zoom' },
  { hostname: 'app.slack.com', matchPattern: 'https://app.slack.com/*', contentProfile: 'standard', displayName: 'Slack', shortName: 'Slack', guidanceKey: 'slack', pluginKey: 'slack' },
  { hostname: 'app.gather.town', matchPattern: 'https://app.gather.town/*', contentProfile: 'standard', displayName: 'Gather Town', shortName: 'Gather', guidanceKey: 'gatherTown', pluginKey: 'gatherTown' },
  { hostname: 'app.v2.gather.town', matchPattern: 'https://app.v2.gather.town/*', contentProfile: 'standard', displayName: 'Gather Town v2', shortName: 'Gather v2', guidanceKey: 'gatherTown', pluginKey: 'gatherTown' },
  { hostname: 'whereby.com', matchPattern: 'https://whereby.com/*', contentProfile: 'standard', displayName: 'Whereby', shortName: 'Whereby', guidanceKey: 'whereby', pluginKey: 'whereby' },
  { hostname: 'discord.com', matchPattern: 'https://discord.com/*', contentProfile: 'standard', displayName: 'Discord', shortName: 'Discord', guidanceKey: 'discord', pluginKey: 'discord' },
  { hostname: 'meet.jit.si', matchPattern: 'https://meet.jit.si/*', contentProfile: 'jitsi', displayName: 'Jitsi Meet', shortName: 'Jitsi', guidanceKey: 'jitsi', pluginKey: 'jitsi' },
];

export const PLATFORM_HOSTNAMES: readonly string[] = PLATFORMS.map(p => p.hostname);

// --- vanilla-script codegen -------------------------------------------------
// Serializes the registry to a tiny JS file consumed by the vanilla extension
// scripts (background.js, content.js) at build time. A Vite plugin emits the
// output of this function as `platforms.generated.js`; the same function backs
// extension/platforms.generated.test.ts so the emitted shape stays pinned.
// Icons are intentionally dropped — the vanilla scripts only need hostname,
// contentProfile, and the guidance/plugin lookup keys.
export function serializePlatformsForVanilla(): string {
  const data = PLATFORMS.map(p => ({
    hostname: p.hostname,
    contentProfile: p.contentProfile,
    ...(p.guidanceKey ? { guidanceKey: p.guidanceKey } : {}),
    ...(p.pluginKey ? { pluginKey: p.pluginKey } : {}),
  }));
  return `// AUTO-GENERATED from extension/platforms.ts — do not edit.\n` +
    `globalThis.SOKUJI_PLATFORMS = ${JSON.stringify(data, null, 2)};\n`;
}

export function platformsByProfile(profile: ContentProfile): PlatformEntry[] {
  return PLATFORMS.filter(p => p.contentProfile === profile);
}

// --- manifest.json-shaped derivations ---------------------------------------
// These reproduce the hand-written extension/manifest.json content_scripts /
// web_accessible_resources match lists exactly (see
// extension/manifest.consistency.test.ts for the golden-equality guard).

export function deriveContentScripts(): Array<{ matches: string[]; js: string[]; run_at: string; all_frames?: boolean }> {
  const patterns = (profile: ContentProfile) => platformsByProfile(profile).map(p => p.matchPattern);
  const standard = patterns('standard');
  const zoom = patterns('zoom');
  const jitsi = patterns('jitsi');
  // 'platforms.generated.js' is a build-emitted content script that assigns
  // globalThis.SOKUJI_PLATFORMS; it must run before content.js (same isolated
  // world) so content.js can read the platform table for its guidance lookup.
  return [
    { matches: [...standard], js: ['platforms.generated.js', 'content.js', 'subtitle-overlay-content.js'], run_at: 'document_start' },
    { matches: [...jitsi], js: ['platforms.generated.js', 'content.js'], run_at: 'document_start', all_frames: true },
    { matches: [...jitsi], js: ['subtitle-overlay-content.js'], run_at: 'document_start' },
    { matches: [...zoom], js: ['zoom-content.js'], run_at: 'document_start', all_frames: true },
    { matches: [...zoom], js: ['subtitle-overlay-content.js'], run_at: 'document_idle' },
  ];
}

export function deriveSubtitleWebAccessibleMatches(): string[] {
  return PLATFORMS.map(p => p.matchPattern);
}

// --- popup.js-shaped derivations -------------------------------------------
// These reproduce the pre-registry hand-written popup.js literals exactly
// (see extension/platforms.derived.test.ts for the golden-equality pin).

export function deriveEnabledSites(): string[] {
  return PLATFORMS.map(p => p.hostname);
}

