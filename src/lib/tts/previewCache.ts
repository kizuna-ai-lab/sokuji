/**
 * Cached preview audio, for the life of the app session.
 *
 * A synthesized sample is deterministic for a fixed (voice, language, speed),
 * so a repeat listen carries no new information — but it costs. For managed
 * Soniox it spends wallet balance AND takes the account's exclusivity lease
 * for 15-45s, during which a real session start gets a 409. That is why this
 * outlives the component: the old `useRef` inside SonioxVoiceSection was
 * thrown away by closing the panel, switching section or changing provider,
 * and the next listen paid again.
 *
 * DELIBERATELY NOT PERSISTED. Surviving a restart would mean handling "same
 * id, different content", and that failure — a user re-records a reference
 * clip, previews, and hears the OLD clone, concluding the re-record did not
 * take — is worse than paying twice. Within one app session the hazard cannot
 * arise: `NativeVoiceStore` exposes rename/delete/resolveApply and no
 * in-place replacement, so a re-record is always a new id, and a re-cloned
 * managed voice is a new Soniox UUID. Content is immutable per id. That is a
 * property of today's stores rather than a guarantee anyone wrote down, so a
 * store that gains in-place replacement must revisit this.
 */
const cache = new Map<string, { audio: Float32Array; sampleRate: number }>();

/** `source` namespaces the id. Once the cache outlives the section, `id`
 *  alone is ambiguous — `custom:1` is a different clip under a different TTS
 *  model (`voiceStoreFor(custom, modelId)`). */
export function previewCacheKey(source: string, id: string, language: string, speed: number): string {
  return `${source}|${id}|${language}|${speed}`;
}

export function getCachedPreview(key: string) { return cache.get(key); }
export function setCachedPreview(key: string, value: { audio: Float32Array; sampleRate: number }) { cache.set(key, value); }

/** With no argument, wipes the whole cache (what every existing test-isolation
 *  call site wants). With a `prefix` (a `source` value, as passed to
 *  `previewCacheKey`), clears only that namespace -- the cache is shared
 *  between managed Soniox (`soniox:<region>`/`managed:<region>`) and Local
 *  Native (`native:<modelId>`), so a caller leaving ONE namespace (e.g. a
 *  Soniox account swap) must not also drop the other's entries. Matched on
 *  `${prefix}|` so `soniox:us` cannot also match a would-be `soniox:us-2`. */
export function clearPreviewCache(prefix?: string): void {
  if (prefix === undefined) {
    cache.clear();
    return;
  }
  const needle = `${prefix}|`;
  for (const key of cache.keys()) {
    if (key.startsWith(needle)) cache.delete(key);
  }
}
