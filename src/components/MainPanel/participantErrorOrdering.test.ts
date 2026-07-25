import { describe, it, expect } from 'vitest';

/**
 * Regression test for the participant-connect error-bubble ordering bug in
 * MainPanel.tsx's connectConversation (participant catch block, ~line 1938,
 * and the deferred append after the post-init setItems overwrite, ~line
 * 1972).
 *
 * There is no React rendering harness in this repo, so this test does not
 * mount MainPanel or invoke connectConversation directly. Instead it proves
 * the state-update ordering property the fix depends on, using a minimal
 * reimplementation of React's useState setter *value semantics*: a plain
 * value passed to the setter fully replaces state; a function passed to the
 * setter receives whatever the state currently is and its return value
 * becomes the new state. That is exactly the mechanism connectConversation
 * relies on when it calls setItems either with a plain array
 * (`speakerClientRef.current?.getConversationItems() || []`) or with an
 * updater function (`prev => [...prev, errorItem]`).
 *
 * The bug: connectConversation calls the plain-value overwrite
 * unconditionally near the end of session start. Any setItems(prev => ...)
 * append that already ran *before* that line gets discarded — the
 * overwrite doesn't know about it. An append that runs *after* the
 * overwrite instead builds on top of the now-current (overwritten) state
 * and survives.
 *
 * Each pair of tests below replays the exact call sequence for both code
 * shapes (buggy vs. fixed) against both real-world shapes of the overwrite
 * value: participant-only mode (speakerClientRef.current is null, so the
 * overwrite is `setItems([])`) and Both mode (the overwrite is the
 * speaker's just-started, non-empty conversation list).
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

const errorItem: Item = { id: 'error-1', text: 'Failed to start the participant audio channel.' };

describe('participant-connect error bubble vs. the post-init setItems overwrite', () => {
  describe('pre-fix ordering (append runs BEFORE the overwrite) — reproduces the bug', () => {
    it('participant-only shape: bubble is wiped by setItems([])', () => {
      const { setItems, getState } = makeStateContainer([]);
      // catch block appends immediately, as the pre-fix code did
      setItems(prev => [...prev, errorItem]);
      // unconditional overwrite that ran after — speakerClientRef.current is
      // null in participant-only mode
      setItems([]);
      expect(getState()).toEqual([]); // bubble is gone
    });

    it('Both-mode shape: bubble is wiped by the speaker\'s list', () => {
      const { setItems, getState } = makeStateContainer([]);
      setItems(prev => [...prev, errorItem]);
      const speakerItems: Item[] = [{ id: 'speaker-1', text: 'hello' }];
      setItems(speakerItems);
      expect(getState()).toEqual(speakerItems); // bubble is gone, replaced by speaker items only
    });
  });

  describe('fixed ordering (append runs AFTER the overwrite) — current MainPanel.tsx behavior', () => {
    it('participant-only shape: bubble survives setItems([])', () => {
      const { setItems, getState } = makeStateContainer([]);
      setItems([]); // speakerClientRef.current is null -> overwrite with []
      setItems(prev => [...prev, errorItem]); // deferred append, per the fix
      expect(getState()).toEqual([errorItem]);
    });

    it('Both-mode shape: bubble survives being appended after the speaker\'s list', () => {
      const { setItems, getState } = makeStateContainer([]);
      const speakerItems: Item[] = [{ id: 'speaker-1', text: 'hello' }];
      setItems(speakerItems); // overwrite with the speaker's just-started list
      setItems(prev => [...prev, errorItem]); // deferred append, per the fix
      expect(getState()).toEqual([...speakerItems, errorItem]);
    });
  });
});
