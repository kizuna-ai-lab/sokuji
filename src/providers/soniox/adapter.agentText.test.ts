/**
 * Agent text input through the adapter (experiment, `exp/agent-text-probe`):
 * `config.stt.enableAgentTextInput` reaches the STT config frame, and a
 * session's `agentText` sends on the core's one STT socket — the socket both
 * legs share face-to-face — only while it is open and only when the config
 * asked for it. Driven on `FakeSocket` and a virtual clock.
 */
import { describe, it, expect } from 'vitest';
import type { SessionContext, StartRequest } from '../../lib/contract/adapter';
import { recordEvents } from '../../lib/contract/events';
import { FakeSocket, fakeSockets } from '../../lib/contract/testing/fakeSocket';
import type { LegName } from '../../lib/conversation/types';
import type { SharedSettings } from '../../lib/provider/types';
import { createSonioxAdapter } from './adapter';
import { buildSoniox, type SonioxConfig } from './config';
import { SONIOX_DEFAULTS, type SonioxCredentials } from './settings';
import { isStt, KEY, SHARED, trackedClock, type Json } from './testing';

const FACE_TO_FACE: SharedSettings = { ...SHARED, reversed: (direction) => direction.source === 'ja', faceToFace: true };

async function faceToFace(enableAgentTextInput: boolean | undefined) {
  const sockets = fakeSockets();
  const { clock } = trackedClock();
  const signal = new AbortController().signal;
  const contexts: Record<LegName, SessionContext> = {
    speaker: { direction: { source: 'zh', target: 'ja' }, speech: true, turns: 'auto' },
    participant: { direction: { source: 'ja', target: 'zh' }, speech: true, turns: 'auto' },
  };
  const rec = { speaker: recordEvents(), participant: recordEvents() };
  const request = (leg: LegName): StartRequest<SonioxConfig, SonioxCredentials> => {
    const config = buildSoniox(contexts[leg], SONIOX_DEFAULTS, FACE_TO_FACE);
    return {
      context: contexts[leg],
      config: { ...config, stt: { ...config.stt, ...(enableAgentTextInput === undefined ? {} : { enableAgentTextInput }) } },
      credentials: KEY,
      clock,
      signal,
    };
  };
  const starting = createSonioxAdapter({ openSocket: sockets.create }).startBoth(
    { speaker: request('speaker'), participant: request('participant') },
    { speaker: rec.speaker.events, participant: rec.participant.events },
  );
  for (const x of sockets.all) if (x.readyState === FakeSocket.CONNECTING) x.open();
  const sessions = await starting;
  const stt = sockets.all.filter(isStt);
  // The stop's end of stream is an empty text frame: not JSON.
  const agentFrames = () => stt[0].sent.filter((d): d is string => typeof d === 'string' && d !== '').map((d) => JSON.parse(d) as Json).filter((m) => m.type === 'agent_text');
  const logged = () => rec.speaker.log.filter((e) => e.kind === 'frame' && (e.payload as { type: string }).type === 'stt.agent_text').map((e) => (e.payload as { payload?: unknown }).payload);
  return { sessions, stt, agentFrames, logged };
}

describe('Soniox agent text input (experiment)', () => {
  it('asks for agent text on the one face-to-face socket when the config says so', async () => {
    const h = await faceToFace(true);
    expect(h.stt).toHaveLength(1);
    expect(h.stt[0].sentJson<Json>()[0]).toMatchObject({ model: 'stt-rt-v6', enable_agent_text_input: true, translation: { type: 'two_way' } });
  });

  it('leaves the config frame unchanged when the config does not ask (the app never does)', async () => {
    for (const flag of [undefined, false]) {
      const h = await faceToFace(flag);
      expect(h.stt[0].sentJson<Json>()[0]).not.toHaveProperty('enable_agent_text_input');
    }
  });

  it("sends either leg's agent text on the shared socket, and frames it for the Logs", async () => {
    const h = await faceToFace(true);
    expect(h.sessions.speaker.agentText('こんにちは', false)).toBe(true);
    expect(h.sessions.participant.agentText('你好', false)).toBe(true);
    expect(h.sessions.speaker.agentText('', true)).toBe(true);
    expect(h.agentFrames()).toEqual([
      { type: 'agent_text', text: 'こんにちは', end_of_segment: false },
      { type: 'agent_text', text: '你好', end_of_segment: false },
      { type: 'agent_text', text: '', end_of_segment: true },
    ]);
    expect(h.logged()).toEqual([
      { text: 'こんにちは', end_of_segment: false },
      { text: '你好', end_of_segment: false },
      { text: '', end_of_segment: true },
    ]);
  });

  it('sends nothing when the config did not ask for agent text: Soniox would end the stream', async () => {
    const h = await faceToFace(undefined);
    expect(h.sessions.speaker.agentText('こんにちは', false)).toBe(false);
    expect(h.agentFrames()).toEqual([]);
    expect(h.logged()).toEqual([]);
  });

  it('sends nothing once the session has stopped', async () => {
    const h = await faceToFace(true);
    await h.sessions.speaker.stop();
    expect(h.sessions.participant.agentText('late', true)).toBe(false);
    expect(h.agentFrames()).toEqual([]);
  });
});
