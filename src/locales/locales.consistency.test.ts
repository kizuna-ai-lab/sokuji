import { describe, it, expect, vi } from 'vitest';
// Force every provider gate on so ALL descriptors register regardless of build
// env — same trick as descriptorRegistry.test.ts.
vi.mock('../utils/environment', async (orig) => ({
  ...(await orig<any>()),
  isKizunaAIEnabled: () => true,
  // Explicit: each managed provider is gated on its own now, and this mock's
  // promise is that EVERY provider gate is forced on.
  isKizunaSonioxEnabled: () => true,
  isKizunaOpenAITranslateEnabled: () => true,
  isKizunaVolcengineAST2Enabled: () => true,
  isPalabraAIEnabled: () => true,
  isLocalNativeEnabled: () => true,
  isElectron: () => true,
  isExtension: () => false,
  getRelayWsUrl: () => 'wss://r.example/v1',
}));
import { ProviderConfigFactory } from '../services/providers/ProviderConfigFactory';
import en from './en/translation.json';

const catalogs = import.meta.glob('./*/translation.json', { eager: true }) as
  Record<string, { default: Record<string, unknown> }>;

const flatten = (o: unknown, prefix = ''): Record<string, string> => {
  const out: Record<string, string> = {};
  if (o && typeof o === 'object' && !Array.isArray(o)) {
    for (const [k, v] of Object.entries(o)) {
      Object.assign(out, flatten(v, prefix ? `${prefix}.${k}` : k));
    }
  } else {
    out[prefix] = o as string;
  }
  return out;
};

// Both conventions are live and are NOT interchangeable: {{x}} is i18next
// interpolation, {x} is a manual .replace() at the call site.
// Tolerates a non-string so a stray number/null surfaces as a readable diff on
// the offending key rather than a TypeError with no clue which key threw.
const placeholders = (s: unknown) =>
  (typeof s === 'string'
    ? s.match(/\{\{[^}]+\}\}|(?<!\{)\{[^{}]+\}(?!\})/g) ?? []
    : ['<not a string>']).sort();

const EN = flatten(en);
const locales = Object.entries(catalogs)
  .map(([path, mod]) => [path.split('/')[1], flatten(mod.default)] as const)
  .filter(([lang]) => lang !== 'en');

describe('locale catalogs stay in lockstep with en', () => {
  it.each(locales)('%s has exactly en\'s keys — no missing, no stale', (_lang, cat) => {
    expect(Object.keys(cat).sort()).toEqual(Object.keys(EN).sort());
  });

  it.each(locales)('%s preserves every en placeholder verbatim', (_lang, cat) => {
    const broken = Object.keys(EN)
      .filter(k => cat[k] !== undefined)
      .map(k => ({ k, want: placeholders(EN[k]), got: placeholders(cat[k]) }))
      .filter(({ want, got }) => JSON.stringify(want) !== JSON.stringify(got));
    expect(broken).toEqual([]);
  });

  it.each(locales)('%s has no empty strings', (_lang, cat) => {
    expect(Object.entries(cat).filter(([, v]) => typeof v !== 'string' || v === '')).toEqual([]);
  });
});

describe('dynamically-built i18n keys resolve in en', () => {
  // ProviderSpecificSettings renders one button per capabilities.turnDetection.mode
  // and derives the label key from the mode string. A mode whose key is absent
  // renders the raw key as the button text — Volcengine's 'Push-to-Talk' did
  // exactly that until it was folded into the settings.pushToTalk branch.
  it('every provider turn-detection mode maps to a key that exists', () => {
    const missing: string[] = [];
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      // Read through getConfig().capabilities — the exact path the component uses.
      const modes = ProviderConfigFactory.getConfig(id).capabilities.turnDetection.modes;
      for (const mode of modes) {
        const key = mode === 'Disabled' || mode === 'Push-to-Talk'
          ? 'settings.pushToTalk'
          : `settings.${mode.toLowerCase()}`;
        if (EN[key] === undefined) missing.push(`${id}: ${mode} -> ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe('the powered-by attribution keeps its brand slot', () => {
  // PoweredBy renders through <Trans components={{ brand: <span/> }}> so the
  // vendor gets its own element and can be typeset a step stronger than the
  // preposition it sits next to. A translation that drops the tag still shows
  // the vendor — it just silently loses the emphasis, which is exactly the kind
  // of regression that survives a review. Word order is free; the wrapper isn't.
  it('wraps {{name}} in <brand> in every locale', () => {
    const offenders: string[] = [];
    for (const [lang, cat] of [['en', EN] as const, ...locales]) {
      const s = cat['providers.poweredBy'];
      if (typeof s !== 'string') continue; // key parity is another test's job
      if (!/<brand>\s*\{\{name\}\}\s*<\/brand>/.test(s)) offenders.push(`${lang}: ${JSON.stringify(s)}`);
    }
    expect(offenders).toEqual([]);
  });
});

describe('notices that name a button use that locale\'s own label', () => {
  // Both Soniox end-of-session notices tell the user to tap the session-start
  // button. They spell the label out rather than interpolating it, so nothing
  // stops a translation from naming a word that appears nowhere in the UI —
  // which is exactly what happened: 18 of 30 catalogs said "Start" (or a local
  // equivalent) while their button read "Start Session" / "Sessione starten" /
  // "セッション開始". Pin the two together so the next translation pass, or a
  // rename of the button itself, fails here instead of shipping.
  const NOTICES = ['mainPanel.sonioxSegmentEnded', 'mainPanel.sonioxConnectionLost'];

  it.each(NOTICES)('%s names mainPanel.startSession in every locale', (key) => {
    const offenders: string[] = [];
    for (const [lang, cat] of [['en', EN] as const, ...locales]) {
      const label = cat['mainPanel.startSession'];
      const notice = cat[key];
      if (typeof label !== 'string' || typeof notice !== 'string') continue; // key-parity is another test's job
      if (!notice.includes(label)) offenders.push(`${lang}: ${JSON.stringify(notice)} omits ${JSON.stringify(label)}`);
    }
    expect(offenders).toEqual([]);
  });
});

describe('the three translation modes are named with one word each', () => {
  // The app names the same two conversation sides in six places: the mode
  // picker, the display-mode toggle, the per-bubble badge (which reads through
  // the display-mode keys), the logs panel, the conversation export and the
  // local-provider model group. Nothing but convention kept them in step, and
  // they drifted badly — en alone shipped "You"/"Others" in the picker,
  // "Speaker"/"Participant" on the badges and in the logs, "You"/"Other" in the
  // export, and "My"/"Other's" on the language labels: five vocabularies for
  // two concepts. Worse, "Speaker" meant BOTH the user's own channel and the
  // audio output device, so "Cannot enable Speaker" pointed at the wrong thing.
  //
  // The rule now: within a locale, every key naming a side says the *same
  // word*. Which word stays a per-locale choice (ja 自分/相手, de
  // Ich/Gegenüber, ru Я/Собеседник) — only the agreement is enforced.
  const SELF = [
    'modePicker.modeYou',
    'mainPanel.displayMode.speaker',
    'logsPanel.speakerClient',
    'mainPanel.export.speakerYou',
  ];
  const OTHER = [
    'modePicker.modeParticipants',
    'mainPanel.displayMode.participant',
    'logsPanel.participantClient',
    'mainPanel.export.speakerOther',
    'providers.local_inference.participant',
  ];
  // Both is named twice and drifted too: fil said "Pareho" in the picker and
  // "Parehas" on the display-mode toggle.
  const BOTH = [
    'modePicker.modeBoth',
    'mainPanel.displayMode.both',
  ];

  // Deliberately does NOT skip absent keys: a missing key must fail here rather
  // than shrink the set into a passing one. (Key parity is asserted above too,
  // but a test that reads as "these all agree" should not quietly pass when one
  // of them does not exist.)
  const agree = (cat: Record<string, string>, keys: string[]) => {
    const missing = keys.filter(k => typeof cat[k] !== 'string');
    expect(missing).toEqual([]);
    return new Set(keys.map(k => cat[k]));
  };

  it.each([['en', EN] as const, ...locales])(
    '%s uses one word each for "me", "the other side" and "both"',
    (_lang, cat) => {
      expect([...agree(cat, SELF)]).toHaveLength(1);
      expect([...agree(cat, OTHER)]).toHaveLength(1);
      expect([...agree(cat, BOTH)]).toHaveLength(1);
    },
  );

  it('the three words are always distinct', () => {
    const offenders: string[] = [];
    for (const [lang, cat] of [['en', EN] as const, ...locales]) {
      const [me, other, both] = [cat[SELF[0]], cat[OTHER[0]], cat[BOTH[0]]];
      if (new Set([me, other, both]).size !== 3) {
        offenders.push(`${lang}: ${JSON.stringify([me, other, both])}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  // The export header labels the two configured languages. It used to say
  // "Source"/"Target" while the settings screen that set them said
  // "My Language"/"Other's Language" — the reader had to map one to the other.
  // These are the same two fields, so they get the same two labels.
  it.each([
    ['mainPanel.export.headerSource', 'settings.sourceLanguage'],
    ['mainPanel.export.headerTarget', 'settings.targetLanguage'],
  ])('%s matches %s in every locale', (header, label) => {
    const offenders: string[] = [];
    for (const [lang, cat] of [['en', EN] as const, ...locales]) {
      // Require both to exist: two absent keys are `undefined === undefined`,
      // which would pass while saying nothing.
      if (typeof cat[header] !== 'string' || typeof cat[label] !== 'string') {
        offenders.push(`${lang}: missing ${typeof cat[header] !== 'string' ? header : label}`);
      } else if (cat[header] !== cat[label]) {
        offenders.push(`${lang}: ${JSON.stringify(cat[header])} != ${JSON.stringify(cat[label])}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
