// src/components/SettingsPage/categories.ts
//
// The categories of the settings page, in the agreed order (providers and
// stages design, section 8.1), and where each of today's navigation targets
// lands on the page.
import { CAPS } from '../../lib/lineup/catalog';
import { accountAnchor, accountKeyOf, providerOfTarget } from './accountRows';

export type CategoryId = 'lineup' | 'words' | 'accounts' | 'models' | 'audio' | 'display' | 'history' | 'general';
export type CategoryGroup = 'session' | 'providers' | 'devices' | 'data' | 'app';

export interface Category {
  id: CategoryId;
  group: CategoryGroup;
  /** `settingsPage.categories.<id>` */
  titleKey: string;
  /** `settingsPage.words.<id>`: the search words in the interface language, space-separated. */
  wordsKey: string;
  /** English search words, used too when a locale has none. */
  words: readonly string[];
  /** Translation keys of names that find this category too, as the interface shows them (a provider's name). */
  nameKeys?: readonly string[];
  desktopOnly?: true;
  /** During a session: everything locked, part of it, or nothing. */
  lockedInSession: 'locked' | 'partly' | 'open';
  /** Whether the category is listed at all in this build. */
  shown(): boolean;
}

const category = (c: Omit<Category, 'titleKey' | 'wordsKey'>): Category => ({
  ...c, titleKey: `settingsPage.categories.${c.id}`, wordsKey: `settingsPage.words.${c.id}`,
});

export const CATEGORIES: readonly Category[] = [
  category({ id: 'lineup', group: 'session', words: ['language', 'languages', 'speech mode', 'push to talk', 'transcription', 'translation', 'speech', 'voice', 'provider', 'model', 'line-up'], lockedInSession: 'locked', shown: () => true }),
  // The app's one word list and the session background (spec §9); the extension has it too.
  category({ id: 'words', group: 'session', words: ['word list', 'terms', 'glossary', 'background'], lockedInSession: 'locked', shown: () => true }),
  // Every provider by the name the interface gives it: their keys and sign-ins are on this page.
  category({ id: 'accounts', group: 'providers', words: ['account', 'sign in', 'api key', 'keys', 'credential', 'balance', 'volcengine' /* Doubao's maker, whose console issues its keys */], nameKeys: CAPS.map((c) => `providers.${c.id}.name`), lockedInSession: 'partly', shown: () => true }),
  // Every download, delete and import there waits for the session to end (the owner, 2026-11-17).
  category({ id: 'models', group: 'providers', words: ['models', 'download', 'storage', 'delete', 'disk'], lockedInSession: 'locked', shown: () => true }),
  category({ id: 'audio', group: 'devices', words: ['microphone', 'noise suppression', 'echo', 'speaker', 'headphones', 'monitor', 'passthrough', 'virtual microphone', 'system audio'], lockedInSession: 'partly', shown: () => true }),
  category({ id: 'display', group: 'devices', words: ['font', 'size', 'colour', 'color', 'compact', 'subtitles', 'captions', 'preview'], lockedInSession: 'open', shown: () => true }),
  // Desktop only: the extension has no History.
  category({ id: 'history', group: 'data', words: ['history', 'notes', 'folder'], desktopOnly: true, lockedInSession: 'open', shown: () => true }),
  // The interface language and the setup wizard wait for the session to end; the rest stays open.
  category({ id: 'general', group: 'app', words: ['interface language', 'appearance', 'theme', 'updates', 'logs', 'setup', 'help', 'version'], lockedInSession: 'partly', shown: () => true }),
];

export const GROUPS: readonly CategoryGroup[] = ['session', 'providers', 'devices', 'data', 'app'];

/** Today's `navigateToSettings` targets: the category that holds each, and the element to highlight (`#<anchor>-section`). */
const TARGETS: Record<string, { category: CategoryId; anchor: string | null }> = {
  languages: { category: 'lineup', anchor: 'languages' },
  'turn-detection': { category: 'lineup', anchor: 'turn-detection' },
  'turn-detection-tuning': { category: 'lineup', anchor: 'turn-detection-tuning' },
  'system-instructions': { category: 'lineup', anchor: 'system-instructions' },
  'voice-settings': { category: 'lineup', anchor: 'voice-settings' },
  'model-management': { category: 'lineup', anchor: 'model-management' },
  'model-asr': { category: 'lineup', anchor: 'model-asr' },
  'model-translation': { category: 'lineup', anchor: 'model-translation' },
  'model-tts': { category: 'lineup', anchor: 'model-tts' },
  // Edge's voices, in the speech card when Edge speaks.
  'edge-voices': { category: 'lineup', anchor: 'edge-voices' },
  // Each stage's models in Models and storage, where an engine slot's "Browse library…" goes (B-20).
  'models-asr': { category: 'models', anchor: 'models-asr' },
  'models-translation': { category: 'models', anchor: 'models-translation' },
  'models-tts': { category: 'models', anchor: 'models-tts' },
  // The local engine's voices, in the speech card when this device speaks (B-20).
  'local-voices': { category: 'lineup', anchor: 'local-voices' },
  // The stage rows: where a provider is chosen (a notice with no provider).
  lineup: { category: 'lineup', anchor: 'lineup' },
  // What a provider needs besides a key (models, memory, voices, an engine slot): its own options, unfolded.
  'provider-options': { category: 'lineup', anchor: 'provider-options' },
  // Today's 'provider' target is the key or the sign-in: the accounts, without scrolling or highlighting.
  provider: { category: 'accounts', anchor: null },
  'user-account': { category: 'accounts', anchor: 'user-account' },
  microphone: { category: 'audio', anchor: 'microphone' },
  speech: { category: 'audio', anchor: 'speech' },
  participant: { category: 'audio', anchor: 'participant' },
  // Lands on the other side's audio, the section that holds the system audio choice.
  'system-audio': { category: 'audio', anchor: 'participant' },
  // The speech rows, one by one: where the audio page's drawing takes you (B-27).
  'speech-other-hears': { category: 'audio', anchor: 'speech-other-hears' },
  'speech-me-too': { category: 'audio', anchor: 'speech-me-too' },
  'speech-passthrough': { category: 'audio', anchor: 'speech-passthrough' },
  'speech-i-hear': { category: 'audio', anchor: 'speech-i-hear' },
};

/**
 * The category that holds each element the tour points at (its `data-tour`
 * value): Audio's three sections, the account rows, and the line-up's local
 * engine in the provider's options.
 */
const ANCHOR_CATEGORY: Readonly<Record<string, CategoryId>> = {
  'microphone-section': 'audio',
  'speech-section': 'audio',
  'participant-section': 'audio',
  'provider-section': 'accounts',
  'engine-chips': 'lineup',
};

/** The category whose body draws the tour anchor, or null when no category does. */
export function categoryHolding(anchor: string): CategoryId | null {
  return ANCHOR_CATEGORY[anchor] ?? null;
}

/** Where a target lands; a target the page does not know opens "General" without a highlight. */
export function targetToCategory(target: string): { category: CategoryId; anchor: string | null } {
  // One provider's key or sign-in (owner, 2026-11-17): its own row in the accounts.
  const provider = providerOfTarget(target);
  if (provider) return { category: 'accounts', anchor: accountAnchor(accountKeyOf(provider)) };
  return TARGETS[target] ?? { category: 'general', anchor: null };
}

/** The categories whose title or search words contain the query, in order; an empty query keeps them all. */
export function filterCategories(query: string, t: (key: string) => string, list: readonly Category[] = CATEGORIES): readonly Category[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  // A name matches with its spaces left out on both sides ("kizuna ai" finds "KizunaAI"); the other words as typed, so a
  // query does not run across their spaces ("sand" does not find "Accounts and keys").
  const squash = (text: string) => text.toLowerCase().replace(/\s+/g, '');
  return list.filter((c) => [t(c.titleKey), t(c.wordsKey), ...c.words].some((text) => text.toLowerCase().includes(q))
    || (c.nameKeys ?? []).some((k) => squash(t(k)).includes(squash(q))));
}
