/**
 * Agent text through the adapter (spec 2026-11-05 §4.2-§4.3): a session's
 * `agentText` sends on its core's one STT socket, only while that socket is
 * open and only if it was opened for agent text, and frames each send for the
 * Logs as `stt.agent_text`. Driven on `FakeSocket` and a virtual clock.
 */
import { describe, it, expect } from 'vitest';
import type { AdapterSession, SessionContext, StartRequest } from '../../lib/contract/adapter';
import { recordEvents } from '../../lib/contract/events';
import { FakeSocket, fakeSockets } from '../../lib/contract/testing/fakeSocket';
import { flush } from '../../lib/contract/testing/drive';
import type { LegName } from '../../lib/conversation/types';
import type { SharedSettings } from '../../lib/provider/types';
import { createSonioxAdapter } from './adapter';
import { buildSoniox, type SonioxConfig } from './config';
import { SONIOX_DEFAULTS, type SonioxCredentials, type SonioxSettings } from './settings';
import { ERROR_503, isStt, KEY, SHARED, trackedClock, type Json } from './testing';

type Mode = 'me' | 'other' | 'split' | 'shared' | 'faceToFace';

/** The app's rule (`shared.ts`): the participant's direction is the pair's reverse. */
const SPEAKS: SharedSettings = { ...SHARED, reversed: (direction) => direction.source === 'ja', speaks: true };

async function open(mode: Mode, over: Partial<SonioxSettings> = {}) {
  const sockets = fakeSockets();
  const { clock } = trackedClock();
  const signal = new AbortController().signal;
  const settings: SonioxSettings = { ...SONIOX_DEFAULTS, bothModeSharedSession: mode === 'shared' || mode === 'faceToFace', ...over };
  const shared: SharedSettings = { ...SPEAKS, ...(mode === 'faceToFace' ? { faceToFace: true } : {}) };
  // Both legs speak.
  const contexts: Record<LegName, SessionContext> = {
    speaker: { direction: { source: 'zh', target: 'ja' }, speech: true, turns: 'auto' },
    participant: { direction: { source: 'ja', target: 'zh' }, speech: true, turns: 'auto' },
  };
  const rec = { speaker: recordEvents(), participant: recordEvents() };
  const request = (leg: LegName): StartRequest<SonioxConfig, SonioxCredentials> =>
    ({ context: contexts[leg], config: buildSoniox(contexts[leg], settings, shared), credentials: KEY, clock, signal });
  const adapter = createSonioxAdapter({ openSocket: sockets.create });
  const openAll = () => { for (const x of sockets.all) if (x.readyState === FakeSocket.CONNECTING) x.open(); };
  const sttSockets = () => sockets.all.filter(isStt);
  let sessions: Partial<Record<LegName, AdapterSession>>;
  if (mode === 'me' || mode === 'other') {
    const leg: LegName = mode === 'me' ? 'speaker' : 'participant';
    const starting = adapter.start(request(leg), rec[leg].events);
    openAll();
    sessions = { [leg]: await starting };
  } else {
    const starting = adapter.startBoth({ speaker: request('speaker'), participant: request('participant') }, { speaker: rec.speaker.events, participant: rec.participant.events });
    openAll();
    sessions = await starting;
  }
  // The stop's end of stream is an empty text frame: not JSON.
  const agentFrames = (i: number) => sttSockets()[i].sent
    .filter((d): d is string => typeof d === 'string' && d !== '')
    .map((d) => JSON.parse(d) as Json)
    .filter((m) => m.type === 'agent_text');
  const logged = () => rec.speaker.log
    .filter((e) => e.kind === 'frame' && (e.payload as { type: string }).type === 'stt.agent_text')
    .map((e) => (e.payload as { payload?: unknown }).payload);
  return { sessions, sttSockets, openAll, agentFrames, logged };
}

describe('Soniox session agentText (spec 2026-11-05 §4.2-§4.3)', () => {
  it('face-to-face: either leg sends on the one socket, each send framed stt.agent_text', async () => {
    const h = await open('faceToFace');
    expect(h.sessions.speaker!.agentText!('こんにちは', false)).toBe(true);
    expect(h.sessions.participant!.agentText!('你好', false)).toBe(true);
    expect(h.agentFrames(0)).toEqual([{ type: 'agent_text', text: 'こんにちは', end_of_segment: false }, { type: 'agent_text', text: '你好', end_of_segment: false }]);
    expect(h.logged()).toEqual([{ text: 'こんにちは', end_of_segment: false }, { text: '你好', end_of_segment: false }]);
  });

  it('shared Both: either leg sends on the one socket', async () => {
    const h = await open('shared');
    expect(h.sessions.participant!.agentText!('Hello.', true)).toBe(true);
    expect(h.agentFrames(0)).toEqual([{ type: 'agent_text', text: 'Hello.', end_of_segment: true }]);
  });

  it('split Both takes no agent text (measured 2026-11-05): neither socket asks, neither session sends, nothing is logged', async () => {
    const h = await open('split');
    for (const s of h.sttSockets()) expect(s.sentJson<Json>()[0]).not.toHaveProperty('enable_agent_text_input');
    expect(h.sessions.speaker!.agentText!('Hello.', false)).toBe(false);
    expect(h.sessions.participant!.agentText!('Hello.', false)).toBe(false);
    expect(h.agentFrames(0)).toEqual([]);
    expect(h.agentFrames(1)).toEqual([]);
    expect(h.logged()).toEqual([]);
  });

  it('nothing while a reconnect replaces the socket; the new socket takes the next (Review Focus 5)', async () => {
    const h = await open('me');
    h.sttSockets()[0].receive(ERROR_503);
    h.sttSockets()[0].serverClose(1011);
    await flush();
    expect(h.sessions.speaker!.agentText!('lost', false)).toBe(false);
    h.openAll();
    await flush();
    expect(h.sessions.speaker!.agentText!('next', false)).toBe(true);
    expect(h.agentFrames(1)).toEqual([{ type: 'agent_text', text: 'next', end_of_segment: false }]);
    expect(h.agentFrames(0)).toEqual([]);
  });

  it('nothing once stopped', async () => {
    const h = await open('me');
    await h.sessions.speaker!.stop();
    expect(h.sessions.speaker!.agentText!('late', true)).toBe(false);
    expect(h.agentFrames(0)).toEqual([]);
    expect(h.logged()).toEqual([]);
  });

  it('Other mode: nothing, since its socket never asked', async () => {
    const h = await open('other');
    expect(h.sessions.participant!.agentText!('x', false)).toBe(false);
    expect(h.agentFrames(0)).toEqual([]);
    expect(h.logged()).toEqual([]);
  });

  for (const mode of ['me', 'shared', 'faceToFace'] as const) {
    it(`${mode}: with the Soniox setting off the socket does not ask, the session refuses silently, nothing is sent or logged (spec 2026-11-05 §4.3)`, async () => {
      const h = await open(mode, { agentText: false });
      for (const s of h.sttSockets()) expect(s.sentJson<Json>()[0]).not.toHaveProperty('enable_agent_text_input');
      expect(h.sessions.speaker!.agentText!('Hello.', false)).toBe(false);
      expect(h.sessions.speaker!.agentText!('', true)).toBe(false);
      expect(h.agentFrames(0)).toEqual([]);
      expect(h.logged()).toEqual([]);
    });
  }
});
