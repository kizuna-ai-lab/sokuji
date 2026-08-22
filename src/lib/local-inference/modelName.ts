/**
 * Short display names for models (2026-08-23 A+短名 decision): the engine
 * page's dropdowns, the chips, and the fallback summary show SHORT names;
 * full names stay in the Library and Storage cards, where there is room and
 * context for the qualifiers.
 *
 * Derivation: an explicit `shortName` (manifest) wins outright; otherwise
 * every parenthesized group is filtered against a NOISE vocabulary —
 * qualifiers that describe how a model runs, not which model it is — and
 * groups left empty are dropped. Identity-bearing parens survive untouched:
 * Opus-MT's direction ("ja → en" — two Opus-MT entries can share one
 * direction pool, e.g. de→en plus Germanic ↔ Germanic), TTS voice
 * language/gender ("Bulgarian", "Danish, female"), and "Online" (a cloud
 * model is a materially different thing). The one true collision the noise
 * list creates — Whisper Tiny WebGPU vs plain — carries an explicit
 * shortName in the manifest.
 */

const NOISE_TOKEN = /^(webgpu|quantized|int8|\d+\+?\s*languages)$/i;

export function shortenModelName(name: string, explicit?: string): string {
  if (explicit) return explicit;
  const shortened = name.replace(/\s*\(([^)]*)\)/g, (_m, group: string) => {
    const kept = group
      .split(',')
      .map((token) => token.trim())
      .filter((token) => token.length > 0 && !NOISE_TOKEN.test(token));
    return kept.length > 0 ? ` (${kept.join(', ')})` : '';
  });
  return shortened.replace(/\s{2,}/g, ' ').trim();
}
