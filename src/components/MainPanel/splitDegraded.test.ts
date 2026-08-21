import { describe, it, expect } from 'vitest';
import {
  resolveSplitDegraded,
  splitDegradedChipText,
  SPLIT_DEGRADED_DETAIL,
  SPLIT_DEGRADED_LABEL,
  SPLIT_DEGRADED_REASONS,
  SPLIT_DEGRADED_TOOLTIP,
  type SplitDegradedReason,
} from './splitDegraded';
import en from '../../locales/en/translation.json';

/**
 * The DECISION is a pure function in its own module so it can be tested
 * without a React harness — the same rule resolveVoicePrepOutcome follows
 * (see voicePrepWiring.test.ts). Only the side effects stay inline in
 * connectConversation.
 */
describe('resolveSplitDegraded', () => {
  const base = { splitRequested: true, participantChannelStarted: false, failure: null as SplitDegradedReason | null };

  it('is null when split was never requested', () => {
    // Shared Both, You-only, BYOK, every non-Soniox provider: unchanged.
    expect(resolveSplitDegraded({ ...base, splitRequested: false, failure: 'loopback-denied' })).toBeNull();
  });

  it('is null when the participant leg actually came up', () => {
    expect(resolveSplitDegraded({ ...base, participantChannelStarted: true })).toBeNull();
  });

  it('reports the recorded reason for each of the three failure paths', () => {
    expect(resolveSplitDegraded({ ...base, failure: 'loopback-denied' })).toBe('loopback-denied');
    expect(resolveSplitDegraded({ ...base, failure: 'no-participant-config' })).toBe('no-participant-config');
    expect(resolveSplitDegraded({ ...base, failure: 'participant-connect-failed' })).toBe('participant-connect-failed');
  });

  it('reports a degraded split even when NO reason was recorded', () => {
    // The load-bearing clause. Two of the three existing failure paths were
    // console-only, and the acquire-throw sibling produced no user-visible
    // signal at all. A split session whose participant leg never reached the
    // active flag is degraded whether or not anyone remembered to say why.
    expect(resolveSplitDegraded({ ...base, failure: null })).toBe('participant-connect-failed');
  });

  it('a recorded failure does not survive a leg that started anyway', () => {
    // requestLoopbackAudioStream can be denied for the whole-system path and
    // the session still come up on a per-application source.
    expect(resolveSplitDegraded({
      splitRequested: true, participantChannelStarted: true, failure: 'loopback-denied',
    })).toBeNull();
  });

  describe('a leg that started and then lost its stream', () => {
    const started = { splitRequested: true, participantChannelStarted: true, failure: null as SplitDegradedReason | null };

    it('is degraded once its own stream has ended', () => {
      // The finding: `participantChannelStarted` only means connect() resolved
      // and the recorder was wired. Soniox validates `api_key` AFTER the socket
      // opens, so a refused participant key produces a live-looking leg that is
      // already dead. The stream's end is that fact arriving.
      expect(resolveSplitDegraded({ ...started, participantStreamEnded: true }))
        .toBe('participant-stream-ended');
    });

    it('is NOT degraded while the stream is merely quiet', () => {
      // The failure mode this must never hit: the far side has not spoken yet.
      // Silence is indistinguishable from health, so it claims nothing.
      expect(resolveSplitDegraded({ ...started, participantStreamEnded: false })).toBeNull();
      expect(resolveSplitDegraded({ ...started })).toBeNull();
    });

    it('does not resurrect a leg that never started at all', () => {
      // A leg that never got a socket has no stream to end; the earlier,
      // more specific reason is the one that explains it.
      expect(resolveSplitDegraded({
        ...started, participantChannelStarted: false, failure: 'loopback-denied', participantStreamEnded: false,
      })).toBe('loopback-denied');
    });

    it('is inert outside split', () => {
      expect(resolveSplitDegraded({ ...started, splitRequested: false, participantStreamEnded: true })).toBeNull();
    });
  });

  it('every reason maps to a detail string that exists', () => {
    for (const r of SPLIT_DEGRADED_REASONS) {
      expect(SPLIT_DEGRADED_DETAIL[r].key).toMatch(/^[a-zA-Z]+\.[a-zA-Z0-9]+$/);
      expect(SPLIT_DEGRADED_DETAIL[r].defaultValue.length).toBeGreaterThan(0);
    }
  });
});

/**
 * The per-cause detail lines deliberately REUSE keys that already ship in all
 * 30 catalogs rather than minting three new ones. That saving is only safe if
 * the keys are real and their English text still says what this module claims
 * it says — a rename or a reword elsewhere would otherwise silently turn the
 * hover explanation into a raw key string on screen, in every language at
 * once. The shape assertion above cannot catch that; this does.
 */
describe('the strings this module names actually exist in the English catalog', () => {
  const flat = (o: unknown, prefix = ''): Record<string, string> => {
    const out: Record<string, string> = {};
    if (o && typeof o === 'object' && !Array.isArray(o)) {
      for (const [k, v] of Object.entries(o)) Object.assign(out, flat(v, prefix ? `${prefix}.${k}` : k));
    } else {
      out[prefix] = o as string;
    }
    return out;
  };
  const EN = flat(en);

  it('every reused per-cause detail key resolves, and its default matches the catalog', () => {
    for (const detail of Object.values(SPLIT_DEGRADED_DETAIL)) {
      expect(EN[detail.key], `missing en key: ${detail.key}`).toBeDefined();
      // Not merely "exists": the inline defaultValue is what renders if
      // i18n has not loaded, so a drift between the two is a real bug.
      expect(EN[detail.key]).toBe(detail.defaultValue);
    }
  });

  it('the two new chip strings exist in en and match their inline defaults', () => {
    expect(EN[SPLIT_DEGRADED_LABEL.key]).toBe(SPLIT_DEGRADED_LABEL.defaultValue);
    expect(EN[SPLIT_DEGRADED_TOOLTIP.key]).toBe(SPLIT_DEGRADED_TOOLTIP.defaultValue);
  });

  it('the label is short enough to sit in a footer chip', () => {
    // The chip renders beside the mode picker in a 36px-min footer. A label
    // that wraps would push the footer taller in basic mode.
    expect(SPLIT_DEGRADED_LABEL.defaultValue.length).toBeLessThanOrEqual(20);
  });
});

/**
 * The hover text is a COMPOSITION of two strings — the cause and the
 * consequence-plus-remedy — and that composition is a decision, not markup.
 * It lives here rather than inline in the chip's JSX so it is pinned by a
 * test; MainPanel and the chip then only render an already-decided value.
 */
describe('splitDegradedChipText', () => {
  // Resolves to the inline English default — asserts the copy that ships.
  const translate = (_key: string, defaultValue: string) => defaultValue;

  it('labels the chip with the shared label regardless of reason', () => {
    for (const r of SPLIT_DEGRADED_REASONS) {
      expect(splitDegradedChipText(r, translate).label).toBe('One-way only');
    }
  });

  it('puts the cause first and the consequence second, separated by a blank line', () => {
    const { title } = splitDegradedChipText('loopback-denied', translate);
    expect(title).toBe(
      SPLIT_DEGRADED_DETAIL['loopback-denied'].defaultValue +
      '\n\n' +
      SPLIT_DEGRADED_TOOLTIP.defaultValue
    );
  });

  it('varies the cause line by reason', () => {
    const denied = splitDegradedChipText('loopback-denied', translate).title;
    const failed = splitDegradedChipText('participant-connect-failed', translate).title;
    expect(denied).not.toBe(failed);
    expect(denied).toContain('Screen Recording permission');
    expect(failed).toContain("Other's audio channel");
  });

  it('goes through the translator for every string it emits', () => {
    // Proves nothing is hardcoded past the i18n seam: a translator that
    // returns the key gives a title made entirely of keys.
    const keysOnly = (key: string) => key;
    const { label, title } = splitDegradedChipText('no-participant-config', keysOnly);
    expect(label).toBe(SPLIT_DEGRADED_LABEL.key);
    expect(title).toBe(
      SPLIT_DEGRADED_DETAIL['no-participant-config'].key + '\n\n' + SPLIT_DEGRADED_TOOLTIP.key
    );
  });
});

/**
 * The spec forbids "a bubble that scrolls away". This replays the exact
 * mechanism participantErrorOrdering.test.ts models — React useState setter
 * value semantics — to show WHY: the indicator must live outside `items`,
 * because connectConversation's unconditional
 * setItems(speakerClient.getConversationItems()) replaces that array
 * wholesale.
 */
type Item = { id: string; text: string };
type Updater = Item[] | ((prev: Item[]) => Item[]);

function makeStateContainer(initial: Item[]) {
  let state = initial;
  const setItems = (updater: Updater) => {
    state = typeof updater === 'function' ? (updater as (prev: Item[]) => Item[])(state) : updater;
  };
  return { setItems, getState: () => state };
}

describe('the split-degraded indicator is not a conversation item', () => {
  it('a bubble appended in the participant catch is wiped; the indicator is not', () => {
    const { setItems, getState } = makeStateContainer([]);
    let degraded: SplitDegradedReason | null = null;
    const setDegraded = (v: SplitDegradedReason | null) => { degraded = v; };

    // participant catch: the old shape appended a bubble here
    setItems(prev => [...prev, { id: 'bubble', text: "Failed to start Other's audio channel." }]);
    // ...and the indicator is set from the same place, into its own state
    setDegraded(resolveSplitDegraded({
      splitRequested: true, participantChannelStarted: false, failure: 'participant-connect-failed',
    }));

    // connectConversation's unconditional overwrite with the speaker's list
    setItems([{ id: 'speaker-1', text: 'hello' }]);

    expect(getState().find(i => i.id === 'bubble')).toBeUndefined(); // bubble gone
    expect(degraded).toBe('participant-connect-failed');             // indicator stands
  });
});
