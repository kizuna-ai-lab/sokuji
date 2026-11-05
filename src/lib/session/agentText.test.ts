import { describe, it, expect } from 'vitest';
import type { OutletName } from '../audio/outlets';
import { routesFor, type RoutingSettings } from '../audio/routes';
import type { LegName } from '../conversation/types';
import { AgentTextFeed, agentTextTarget } from './agentText';

const BASE: RoutingSettings = { meeting: true, faceToFace: false, speak: { other: true, me: false, them: true }, passthrough: { on: false, ratio: 0 }, sinks: { other: {}, me: {}, them: {} } };
const outletsOf = (patch: Partial<RoutingSettings>, voice: LegName) =>
  routesFor({ ...BASE, ...patch }, false).filter((e) => e.from === voice && e.to !== 'virtual').map((e) => e.to as OutletName);
const BOTH: LegName[] = ['speaker', 'participant'];

describe('agentTextTarget — spec §4.1, row by row', () => {
  it.each([
    ['face-to-face: my voice on other', BOTH, { faceToFace: true }, 'speaker', 'speaker'],
    ['face-to-face: their voice on them', BOTH, { faceToFace: true }, 'participant', 'speaker'],
    ['Both: my voice, I hear it too on', BOTH, { speak: { other: true, me: true, them: true } }, 'speaker', 'speaker'],
    ['Both: my voice, I hear it too off', BOTH, {}, 'speaker', null],
    ['Both: their voice on them (split crosses to the speaker core)', BOTH, {}, 'participant', 'speaker'],
    ['Me: I hear it too on', ['speaker'], { speak: { other: true, me: true, them: false } }, 'speaker', 'speaker'],
    ['Me: the meeting only', ['speaker'], { speak: { other: true, me: false, them: false } }, 'speaker', null],
    ['Other: no microphone', ['participant'], { speak: { other: false, me: false, them: true } }, 'participant', null],
  ] as const)('%s', (_name, legs, patch, voice, target) => expect(agentTextTarget(legs, outletsOf(patch, voice))).toBe(target));
});

function setup() {
  const sent: Array<[LegName, string, boolean]> = [];
  const gate = { mic: true, up: true };
  const feed = new AgentTextFeed({
    legs: BOTH, micOpen: () => gate.mic,
    session: (leg) => ({ agentText: (text: string, end: boolean) => { if (gate.up) sent.push([leg, text, end]); return gate.up; } }),
  });
  feed.rowText('speaker', 1, 'Hello there. How are you?');
  return { feed, sent, gate, texts: () => sent.map(([, t, e]) => [t, e]) };
}
const ME: OutletName[] = ['me'];

describe('AgentTextFeed', () => {
  it("sends each local chunk's stretch of its row as it is queued", () => {
    const { feed, sent } = setup();
    feed.audio('speaker', { ref: 1, range: [0, 6] }, ME);
    feed.audio('speaker', { ref: 1, range: [6, 13] }, ME);
    expect(sent).toEqual([['speaker', 'Hello ', false], ['speaker', 'there. ', false]]);
  });

  it('sends nothing for a chunk on none of my outlets', () => {
    const { feed, sent } = setup();
    feed.audio('speaker', { ref: 1, range: [0, 6] }, []);
    expect(sent).toEqual([]);
  });

  it('a chunk with no range sends nothing; the next range carries its text', () => {
    const { feed, texts } = setup();
    feed.audio('speaker', { ref: 1 }, ME);
    expect(texts()).toEqual([]);
    feed.audio('speaker', { ref: 1, range: [0, 13] }, ME);
    expect(texts()).toEqual([['Hello there. ', false]]);
  });

  it('never sends a stretch twice', () => {
    const { feed, texts } = setup();
    feed.audio('speaker', { ref: 1, range: [0, 6] }, ME);
    feed.audio('speaker', { ref: 1, range: [3, 13] }, ME);
    expect(texts()).toEqual([['Hello ', false], ['there. ', false]]);
  });

  it("closes a voice's segment once when its queue goes idle, and only a segment something opened", () => {
    const { feed, texts } = setup();
    feed.voiceIdle('speaker');
    expect(texts()).toEqual([]);
    feed.audio('speaker', { ref: 1, range: [0, 6] }, ME);
    feed.voiceIdle('speaker');
    feed.voiceIdle('speaker');
    expect(texts()).toEqual([['Hello ', false], ['', true]]);
  });

  it('a send the socket refused opens no segment', () => {
    const { feed, sent, gate } = setup();
    gate.up = false;
    feed.audio('speaker', { ref: 1, range: [0, 6] }, ME);
    gate.up = true;
    feed.voiceIdle('speaker');
    expect(sent).toEqual([]);
  });

  it('a refusal is silent: a socket that did not ask answers false, and nothing is reported (spec 2026-11-05 §4.3)', () => {
    const reported: unknown[] = [];
    const feed = new AgentTextFeed({ legs: BOTH, micOpen: () => true, session: () => ({ agentText: () => false }), report: (error) => reported.push(error) });
    feed.rowText('speaker', 1, 'Hello there. How are you?');
    feed.audio('speaker', { ref: 1, range: [0, 6] }, ME);
    feed.voiceIdle('speaker');
    expect(reported).toEqual([]);
  });

  it('numbers every audio event of a row that has a ref, on my outlets or not, as the adapter does (rule 1)', () => {
    const { feed, texts } = setup();
    feed.audio('speaker', { range: [0, 6] }, ME);
    feed.audio('speaker', { ref: 1, range: [0, 6] }, []);
    feed.audio('speaker', { ref: 1 }, ME);
    feed.ranges('speaker', { ref: 1, ranges: [{ index: 0, range: [0, 6] }, { index: 1, range: [6, 13] }] });
    expect(texts()).toEqual([['there. ', false]]);
  });

  it('the words the provisional ranges had not reached go with the fill-in, while the chunk is queued (Review Focus 1)', () => {
    const { feed, texts } = setup();
    feed.audio('speaker', { ref: 1, range: [0, 6] }, ME);
    feed.audio('speaker', { ref: 1, range: [6, 9] }, ME);
    feed.ranges('speaker', { ref: 1, ranges: [{ index: 0, range: [0, 7] }, { index: 1, range: [7, 13] }] });
    expect(texts()).toEqual([['Hello ', false], ['the', false], ['re. ', false]]);
  });

  it('a fill-in after the voice went idle sends nothing: that speech has played (Review Focus 1)', () => {
    const { feed, texts } = setup();
    feed.audio('speaker', { ref: 1, range: [0, 6] }, ME);
    feed.voiceIdle('speaker');
    feed.ranges('speaker', { ref: 1, ranges: [{ index: 0, range: [0, 13] }] });
    expect(texts()).toEqual([['Hello ', false], ['', true]]);
  });

  it('two voices on one socket open and close their own segments, a row read in the other voice keyed by that voice (Review Focus 2)', () => {
    const { feed, sent } = setup();
    feed.rowText('participant', 1, 'こんにちは。');
    feed.audio('speaker', { ref: 1, range: [0, 6] }, ['other']);
    feed.audio('participant', { ref: 1, range: [0, 6] }, ['them']);
    feed.audio('speaker', { ref: 1, range: [6, 13], voice: 'participant' }, ['them']);
    feed.voiceIdle('speaker');
    expect(sent).toEqual([['speaker', 'Hello ', false], ['speaker', 'こんにちは。', false], ['speaker', 'there. ', false], ['speaker', '', true]]);
    feed.voiceIdle('participant');
    expect(sent).toHaveLength(5);
  });

  it('a clear mid-segment ends it, and nothing of the dropped text goes after (Review Focus 3)', () => {
    const { feed, texts } = setup();
    feed.audio('speaker', { ref: 1, range: [0, 6] }, ME);
    feed.audio('speaker', { ref: 1, range: [6, 13] }, ME);
    feed.voiceIdle('speaker');
    feed.ranges('speaker', { ref: 1, ranges: [{ index: 1, range: [6, 25] }] });
    feed.audio('speaker', { ref: 1, range: [6, 19] }, ME);
    expect(texts()).toEqual([['Hello ', false], ['there. ', false], ['', true], ['How ar', false]]);
  });

  it('the microphone gate, read at each chunk: closed places text unsent, the idle still closes; open again sends from the next chunk only (Review Focus 4)', () => {
    const { feed, gate, texts } = setup();
    feed.audio('speaker', { ref: 1, range: [0, 6] }, ME);
    gate.mic = false;
    feed.audio('speaker', { ref: 1, range: [6, 13] }, ME);
    feed.voiceIdle('speaker');
    gate.mic = true;
    feed.audio('speaker', { ref: 1, range: [6, 19] }, ME);
    expect(texts()).toEqual([['Hello ', false], ['', true], ['How ar', false]]);
  });

  it("a manual turn's key up: nothing sent, and not later when the key goes down (Review Focus 4)", () => {
    const { feed, gate, texts } = setup();
    gate.mic = false;
    feed.audio('speaker', { ref: 1, range: [0, 6] }, ME);
    gate.mic = true;
    feed.audio('speaker', { ref: 1, range: [0, 13] }, ME);
    expect(texts()).toEqual([['there. ', false]]);
  });

  it('a reconnect mid-segment: no end frame for the next socket, nothing replayed; the next chunk opens a new segment (Review Focus 5)', () => {
    const { feed, texts } = setup();
    feed.audio('speaker', { ref: 1, range: [0, 6] }, ME);
    feed.reconnecting('speaker');
    feed.ranges('speaker', { ref: 1, ranges: [{ index: 0, range: [0, 13] }] });
    feed.voiceIdle('speaker');
    feed.audio('speaker', { ref: 1, range: [6, 13] }, ME);
    expect(texts()).toEqual([['Hello ', false], ['there. ', false]]);
    feed.voiceIdle('speaker');
    expect(texts()).toEqual([['Hello ', false], ['there. ', false], ['', true]]);
  });

  it('a chunk queued with the key up gets nothing from its fill-in once the key is down: text continues from the next chunk (Review Focus 4)', () => {
    const { feed, gate, texts } = setup();
    gate.mic = false;
    feed.audio('speaker', { ref: 1, range: [0, 6] }, ME);
    gate.mic = true;
    feed.ranges('speaker', { ref: 1, ranges: [{ index: 0, range: [0, 13] }] });
    expect(texts()).toEqual([]);
  });

  it('a chunk the socket refused gets nothing from its fill-in once the resumed socket accepts (Review Focus 5)', () => {
    const { feed, gate, texts } = setup();
    feed.reconnecting('speaker');
    gate.up = false;
    feed.audio('speaker', { ref: 1, range: [0, 6] }, ME);
    gate.up = true;
    feed.ranges('speaker', { ref: 1, ranges: [{ index: 0, range: [0, 13] }] });
    expect(texts()).toEqual([]);
  });

  it('a fill-in gated by the microphone ends the chunk: a later fill-in with the gate open again sends nothing more of it (Review Focus 4)', () => {
    const { feed, gate, texts } = setup();
    feed.audio('speaker', { ref: 1, range: [0, 6] }, ME);
    gate.mic = false;
    feed.ranges('speaker', { ref: 1, ranges: [{ index: 0, range: [0, 9] }] });
    gate.mic = true;
    feed.ranges('speaker', { ref: 1, ranges: [{ index: 0, range: [0, 13] }] });
    expect(texts()).toEqual([['Hello ', false]]);
  });

  it('a session whose agentText throws: the feed never throws, reports once, and treats the chunk as refused', () => {
    const fault = { on: true };
    const sent: Array<[string, boolean]> = [];
    const reported: unknown[] = [];
    const feed = new AgentTextFeed({
      legs: BOTH, micOpen: () => true,
      session: () => ({ agentText: (text: string, end: boolean) => { if (fault.on) throw new Error('socket gone'); sent.push([text, end]); return true; } }),
      report: (error) => reported.push(error),
    });
    feed.rowText('speaker', 1, 'Hello there. How are you?');
    expect(() => feed.audio('speaker', { ref: 1, range: [0, 6] }, ME)).not.toThrow();
    expect(() => feed.audio('speaker', { ref: 1, range: [6, 13] }, ME)).not.toThrow();
    fault.on = false;
    // Refused, so not live: its fill-in sends nothing of the row's rest.
    feed.ranges('speaker', { ref: 1, ranges: [{ index: 1, range: [6, 25] }] });
    expect(sent).toEqual([]);
    expect(reported).toHaveLength(1);
    expect(reported[0]).toBeInstanceOf(Error);
  });

  it('an end frame that throws: voiceIdle never throws, the holder is still forgotten, and the report stays at one', () => {
    const fault = { on: false };
    const sent: Array<[string, boolean]> = [];
    const reported: unknown[] = [];
    const feed = new AgentTextFeed({
      legs: BOTH, micOpen: () => true,
      session: () => ({ agentText: (text: string, end: boolean) => { if (fault.on) throw new Error('socket gone'); sent.push([text, end]); return true; } }),
      report: (error) => reported.push(error),
    });
    feed.rowText('speaker', 1, 'Hello there. How are you?');
    feed.audio('speaker', { ref: 1, range: [0, 6] }, ME);
    fault.on = true;
    expect(() => feed.voiceIdle('speaker')).not.toThrow();
    expect(() => feed.audio('speaker', { ref: 1, range: [6, 13] }, ME)).not.toThrow();
    fault.on = false;
    feed.voiceIdle('speaker');
    expect(sent).toEqual([['Hello ', false]]);
    expect(reported).toHaveLength(1);
  });

  it("a reconnect on a socket that holds no segment (split Both's participant core) closes nothing", () => {
    const { feed, texts } = setup();
    feed.audio('speaker', { ref: 1, range: [0, 6] }, ME);
    feed.reconnecting('participant');
    feed.voiceIdle('speaker');
    expect(texts()).toEqual([['Hello ', false], ['', true]]);
  });
});
