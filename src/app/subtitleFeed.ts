/**
 * What the extension overlay's publisher reads, for code that must not
 * import the session's module graph — the side panel's surface class
 * (`ExtensionContentScriptSubtitleSurface`). `settingsStore` imports that
 * class and the root imports the stores, so a static import of the root
 * from there would close a cycle and pull the runner into every page that
 * imports the store — the meeting page's overlay among them (plan 1e-4
 * ruling 1). `attach()` registers the page's session for as long as it is
 * attached; before that, and after its detach, there is none.
 */
import type { PanelSources } from '../lib/subtitle/wire';

export interface SubtitleFeed {
  /** The conversation's entries, the subtitle session and karaoke. */
  sources: Pick<PanelSources, 'entries' | 'session' | 'karaoke'>;
  /** The runner's: what the overlay's Clear and hold button reach. */
  clear(): void;
  press(): void;
  release(): void;
}

let feed: SubtitleFeed | null = null;

/** Registers the page's feed. The returned call unregisters it — unless a later registration replaced it. */
export function registerSubtitleFeed(next: SubtitleFeed): () => void {
  feed = next;
  return () => {
    if (feed === next) feed = null;
  };
}

export function currentSubtitleFeed(): SubtitleFeed | null {
  return feed;
}
