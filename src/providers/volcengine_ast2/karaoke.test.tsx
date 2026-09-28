/**
 * Doubao's karaoke, end to end, with the display cut by sentences
 * (Gemini/AST2 follow-up, ruling 1): the adapter ranges a spoken
 * sentence's clip over its whole translation once that text is final; L1
 * holds the range; the view lights the segment's characters `[0, upTo)`;
 * and each row the sentence cut draws lights its own slice of them — in
 * the panel's list and in the subtitle's bands alike. The cut by sentences
 * is also when L1's punctuation fill-in runs: a translation that closes
 * without a sentence end is filled in, before its clip arrives or after,
 * and the range still reaches its last character (choice 19).
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | { defaultValue?: string }) =>
      typeof fallback === 'string' ? fallback : fallback?.defaultValue ?? key,
  }),
}));

import { ConversationList } from '../../components/Conversation/ConversationList';
import { SubtitleBody } from '../../components/Subtitle/SubtitleBands';
import { clipKey } from '../../lib/audio/playback';
import { flush } from '../../lib/contract/testing/drive';
import { Conversation } from '../../lib/conversation/Conversation';
import { createProjector, DEFAULT_PROJECTION } from '../../lib/projection/project';
import { displayItems, type LegFilters } from '../../lib/view/filter';
import { litFor, nextLit } from '../../lib/view/karaoke';
import { AUTO_CTX, liveAst2, SERVER } from './testing';

const TIMES = { startTime: 20, endTime: 3_460 };
const TEXT = 'Welcome to real-time translation. I will help.';
const PIECES = ['Welcome', ' to', ' real', '-time', ' translation', '.', ' I', ' will', ' help', '.'];
const TRANSLATION_ONLY: LegFilters = { speaker: 'translation', participant: 'none' };
/** The clip's duration as the queue would schedule it, and the moment karaoke is sampled: 80 % in. */
const CLIP_MS = 2_000;
const AT_MS = 1_600;

async function spokenTranslation() {
  const h = await liveAst2();
  const conv = new Conversation({ leg: 'speaker', session: 'ast2', languages: AUTO_CTX.direction, clock: h.clock });
  let folded = 0;
  const fold = () => {
    for (const e of h.log.slice(folded)) if (e.kind !== 'frame') conv.apply(e);
    folded = h.log.length;
  };
  h.socket().receive(SERVER.subtitle('translation', 'start', '', TIMES));
  for (const piece of PIECES.slice(0, 5)) h.socket().receive(SERVER.subtitle('translation', 'response', piece));
  // The sentence starts, and its clip decodes, before the subtitle's End: its text may still change.
  h.socket().receive(SERVER.ttsStart(TIMES));
  h.socket().receive(SERVER.ttsChunk(48));
  h.socket().receive(SERVER.ttsEnd(TIMES));
  await flush();
  fold();
  const playing = { key: clipKey('speaker', 1, 0), t: AT_MS, ms: CLIP_MS };
  const before = litFor(playing, [conv.snapshot()]);
  for (const piece of PIECES.slice(5)) h.socket().receive(SERVER.subtitle('translation', 'response', piece));
  h.socket().receive(SERVER.subtitle('translation', 'end', TEXT, TIMES));
  fold();
  return { conv, before, lit: litFor(playing, [conv.snapshot()]) };
}

describe("Doubao's karaoke with the display cut by sentences (Gemini/AST2 follow-up, ruling 1)", () => {
  it('lights nothing while the subtitle is open, then the whole segment by the clip\'s progress once it is final', async () => {
    const { conv, before, lit } = await spokenTranslation();
    expect(before).toBeNull();
    const [segment] = conv.snapshot().segments;
    expect(segment.speech.map((s) => s.range)).toEqual([[0, TEXT.length]]);
    // 80 % of a clip spanning 46 characters: [0, 37).
    expect(lit).toEqual({ segmentId: segment.id, leg: 'speaker', upTo: 37 });
  });

  it("cuts the segment into one row per sentence, each lighting its own slice: the first passed, the second up to the boundary", async () => {
    const { conv, lit } = await spokenTranslation();
    const entries = createProjector().project([conv.snapshot()], { ...DEFAULT_PROJECTION, mode: 'sentences', sentencesPerRow: 1 });
    const items = displayItems(entries, TRANSLATION_ONLY);
    const rows = items.flatMap((item) => (item.kind === 'row' ? [item.row] : []));
    expect(rows.map((r) => [r.start, r.end, r.text])).toEqual([
      [0, 33, 'Welcome to real-time translation.'],
      [33, 46, ' I will help.'],
    ]);

    const litMap = new Map([[lit!.segmentId, lit!.upTo]]);
    const list = render(
      <ConversationList items={items} lit={litMap} replaying={null} replayLegs={new Set()} canReplay={() => false} onReplay={() => {}} compact={false} fontSize={14} empty={null} />,
    );
    const bodies = [...list.container.querySelectorAll('.row-body')];
    expect(bodies.map((b) => b.querySelector('.karaoke-played')?.textContent)).toEqual(['Welcome to real-time translation.', 'I w']);
    expect(bodies.map((b) => b.classList.contains('playing'))).toEqual([false, true]);
    list.unmount();

    const bands = render(<SubtitleBody entries={entries} lit={litMap} compact fontSize={14} filters={TRANSLATION_ONLY} newItemHighlightEnabled={false} />);
    expect([...bands.container.querySelectorAll('.karaoke-played')].map((e) => e.textContent)).toEqual(['Welcome to real-time translation.', ' I w']);
  });
});

describe("Doubao's karaoke with the punctuation fill-in, in the display cut by sentences (Gemini/AST2 follow-up, choice 19)", () => {
  /** ja → zh: a translation that closes without a sentence end, as three of the probe's eight did; the fill-in adds a comma and a full stop. */
  const CJK_TIMES = { startTime: 3_272, endTime: 6_312 };
  const SUBTITLE = '我来帮你翻译';
  const FILLED = '我来帮你，翻译。';
  const JA_ZH = { source: 'ja', target: 'zh' };

  /** The fill-in lands before the clip is emitted, or after it: the clip is ranged at its emission either way, its subtitle having closed first. */
  async function filledIn(order: 'before' | 'after') {
    const h = await liveAst2({ context: { ...AUTO_CTX, direction: JA_ZH } });
    let land = () => {};
    const punctuate = vi.fn((_lang: string, text: string) => new Promise<string | null>((resolve) => { land = () => resolve(text === SUBTITLE ? FILLED : null); }));
    const conv = new Conversation({ leg: 'speaker', session: 'ast2', languages: JA_ZH, clock: h.clock, punctuate });
    let folded = 0;
    const fold = () => {
      for (const e of h.log.slice(folded)) if (e.kind !== 'frame') conv.apply(e);
      folded = h.log.length;
    };
    h.socket().receive(SERVER.subtitle('translation', 'start', '', CJK_TIMES));
    for (const piece of ['我', '来', '帮', '你', '翻译']) h.socket().receive(SERVER.subtitle('translation', 'response', piece));
    h.socket().receive(SERVER.subtitle('translation', 'end', SUBTITLE, CJK_TIMES));
    fold();
    if (order === 'before') {
      land();
      await conv.settled();
    }
    h.socket().receive(SERVER.ttsStart(CJK_TIMES));
    h.socket().receive(SERVER.ttsChunk(48));
    h.socket().receive(SERVER.ttsEnd(CJK_TIMES));
    await flush();
    fold();
    // The adapter measures against the text it sent.
    expect(h.of('audio').map((e) => e.payload.range)).toEqual([[0, SUBTITLE.length]]);
    if (order === 'after') {
      land();
      await conv.settled();
    }
    return { conv, punctuate };
  }

  it.each(['before', 'after'] as const)('the fill-in landing %s the clip: the range spans the filled text, the row lights to its last character, and the hold lets go', async (order) => {
    const { conv, punctuate } = await filledIn(order);
    expect(punctuate).toHaveBeenCalledWith('zh', SUBTITLE);
    const legs = [conv.snapshot()];
    const [segment] = legs[0].segments;
    expect(segment.text).toBe(FILLED);
    expect(segment.speech.map((s) => s.range)).toEqual([[0, FILLED.length]]);

    const key = clipKey('speaker', segment.ref, 0);
    const lit = litFor({ key, t: AT_MS, ms: CLIP_MS }, legs);
    // 80 % of a clip spanning 8 characters: [0, 6).
    expect(lit).toEqual({ segmentId: segment.id, leg: 'speaker', upTo: 6 });
    const entries = createProjector().project(legs, { ...DEFAULT_PROJECTION, mode: 'sentences', sentencesPerRow: 1 });
    const items = displayItems(entries, TRANSLATION_ONLY);
    expect(items.flatMap((item) => (item.kind === 'row' ? [[item.row.start, item.row.end, item.row.text]] : []))).toEqual([[0, 8, FILLED]]);
    const litMap = new Map([[lit!.segmentId, lit!.upTo]]);
    const list = render(
      <ConversationList items={items} lit={litMap} replaying={null} replayLegs={new Set()} canReplay={() => false} onReplay={() => {}} compact={false} fontSize={14} empty={null} />,
    );
    expect([...list.container.querySelectorAll('.row-body')].map((b) => [b.querySelector('.karaoke-played')?.textContent, b.classList.contains('playing')])).toEqual([['我来帮你，翻', true]]);
    list.unmount();
    const bands = render(<SubtitleBody entries={entries} lit={litMap} compact fontSize={14} filters={TRANSLATION_ONLY} newItemHighlightEnabled={false} />);
    expect([...bands.container.querySelectorAll('.karaoke-played')].map((e) => e.textContent)).toEqual(['我来帮你，翻']);
    bands.unmount();

    // At the clip's end every character is lit; in the gap after it nothing is left to speak, so the hold lets go.
    const atEnd = litFor({ key, t: CLIP_MS, ms: CLIP_MS }, legs);
    expect(atEnd?.upTo).toBe(FILLED.length);
    expect(nextLit(atEnd, null, legs)).toBeNull();
  });
});
