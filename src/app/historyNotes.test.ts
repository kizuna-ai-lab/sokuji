// A record's History warning goes to the panel only while that record's conversation is the one on screen.
import { describe, it, expect, beforeEach } from 'vitest';
import { usePanelNotesStore } from '../stores/panelNotesStore';
import { createVirtualClock } from '../lib/contract/clock';
import { Conversation } from '../lib/conversation/Conversation';
import { ConversationSet } from '../lib/session/conversationSet';
import { createStore } from 'zustand/vanilla';
import { historyNote, shownRecordOf } from './historyNotes';

let shown: string | undefined;
beforeEach(() => { usePanelNotesStore.setState({ notes: [], epoch: 0 }); shown = 'run-a'; });

describe("a record's History warning", () => {
  const tell = () => historyNote({ code: 'history_recording_stopped', message: 'The recording of this session stopped.' }, () => shown);

  it("is shown on the record's own conversation", () => {
    tell()('run-a');
    expect(usePanelNotesStore.getState().notes.map((n) => n.code)).toEqual(['history_recording_stopped']);
  });

  it('is not shown on a later session, nor after Clear', () => {
    shown = 'run-b';
    tell()('run-a');
    shown = undefined;
    tell()('run-a');
    expect(usePanelNotesStore.getState().notes).toEqual([]);
  });
});

// Review: Clear keeps the legs, and their snapshots still name the last run's record.
describe('the record whose conversation is on screen', () => {
  const clock = createVirtualClock(0);
  const legsOf = (session: string) => new Map([['speaker' as const, new Conversation({ leg: 'speaker', session, clock, languages: { source: 'zh', target: 'ja' } })]]);
  const run = () => createStore<{ phase: string }>(() => ({ phase: 'idle' }));

  it("is the run's record; after a Clear once the run has ended, none, until the next run", () => {
    const conversation = new ConversationSet();
    const state = run();
    const shown = shownRecordOf(conversation, state);
    state.setState({ phase: 'starting' });
    conversation.replace(legsOf('run-a'));
    state.setState({ phase: 'running' });
    expect(shown()).toBe('run-a');
    // Cleared while the run goes on: its conversation goes on on screen.
    conversation.clear();
    expect(shown()).toBe('run-a');
    state.setState({ phase: 'idle' });
    conversation.clear();
    expect(shown()).toBeUndefined();
    state.setState({ phase: 'starting' });
    conversation.replace(legsOf('run-b'));
    expect(shown()).toBe('run-b');
  });

  // Review: a start clears the panel's notes before it replaces the conversation; refused, the old record stayed "shown".
  it('is none once a start begins, refused or not, until that run replaces the conversation', () => {
    const conversation = new ConversationSet();
    const state = run();
    const shown = shownRecordOf(conversation, state);
    conversation.replace(legsOf('run-a'));
    expect(shown()).toBe('run-a');
    state.setState({ phase: 'starting' });
    expect(shown()).toBeUndefined();
    // A Clear while the start goes on does not bring the last record back.
    conversation.clear();
    expect(shown()).toBeUndefined();
    // Refused: the conversation was never replaced.
    state.setState({ phase: 'idle' });
    expect(shown()).toBeUndefined();
    state.setState({ phase: 'starting' });
    conversation.replace(legsOf('run-b'));
    expect(shown()).toBe('run-b');
  });
});
