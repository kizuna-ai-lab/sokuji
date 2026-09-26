import { describe, it, expect } from 'vitest';
import type { Leg, Segment, Notice } from '../conversation/types';
import { createProjector, DEFAULT_PROJECTION } from './project';
import type { Entry } from './types';

let n = 0;
const seg = (leg: 'speaker' | 'participant', over: Partial<Segment>): Segment => ({
  id: `s:${leg}:${++n}`, ref: n, side: 'source', text: 'x.', final: true, openedAt: 0, marks: [], speech: [], ...over,
});
const legOf = (leg: 'speaker' | 'participant', segments: Segment[], notices: Notice[] = []): Leg => ({
  leg, session: 's', languages: { source: 'ja', target: 'en' }, segments, notices,
});
const exchanges = (entries: readonly Entry[]) => entries.filter((e): e is Extract<Entry, { kind: 'exchange' }> => e.kind === 'exchange');

describe('createProjector', () => {
  it('groups by stated origin, keys the entry by it, and marks the pairing stated', () => {
    const src = seg('speaker', { side: 'source', origin: 'u1', openedAt: 10 });
    const tr = seg('speaker', { side: 'translation', origin: 'u1', openedAt: 40 });
    const [e] = exchanges(createProjector().project([legOf('speaker', [src, tr])], DEFAULT_PROJECTION));
    expect(e).toMatchObject({ id: 's:speaker:o:u1', pairing: 'stated', t: 10, leg: 'speaker', languages: { source: 'ja', target: 'en' } });
    expect(e.source.map((r) => r.segmentId)).toEqual([src.id]);
    expect(e.translation.map((r) => r.segmentId)).toEqual([tr.id]);
  });

  it('groups an inferred pair under the source, and leaves the unpaired alone', () => {
    const src = seg('speaker', { side: 'source', openedAt: 0 });
    const tr = seg('speaker', { side: 'translation', openedAt: 500 });
    const lone = seg('speaker', { side: 'source', openedAt: 9000 });
    const es = exchanges(createProjector().project([legOf('speaker', [src, tr, lone])], DEFAULT_PROJECTION));
    expect(es.map((e) => [e.id, e.pairing, e.source.length, e.translation.length])).toEqual([
      [`speaker:s:${src.id}`, 'inferred', 1, 1],
      [`speaker:s:${lone.id}`, 'none', 1, 0],
    ]);
  });

  it('interleaves both legs by time and includes notices', () => {
    const a = seg('speaker', { openedAt: 100 });
    const b = seg('participant', { openedAt: 50 });
    const notice: Notice = { id: 's:speaker:n1', at: 75, severity: 'warning', message: 'w' };
    const entries = createProjector().project([legOf('speaker', [a], [notice]), legOf('participant', [b])], DEFAULT_PROJECTION);
    expect(entries.map((e) => (e.kind === 'notice' ? `notice@${e.at}` : `${e.leg}@${e.t}`))).toEqual(['participant@50', 'notice@75', 'speaker@100']);
    expect(entries[1]).toMatchObject({ kind: 'notice', id: 'speaker:n:s:speaker:n1', severity: 'warning' });
  });

  // A final holding several chunks opens several segments in one synchronous
  // burst, all at one `openedAt`: their origins' ids must not decide, or `u10`
  // sorts before `u9`.
  it("keeps one leg's own order for exchanges opened at the same instant, past u9 → u10", () => {
    const segs = ['u8', 'u9', 'u10', 'u11'].map((origin) => seg('speaker', { origin, openedAt: 100 }));
    const es = exchanges(createProjector().project([legOf('speaker', segs)], DEFAULT_PROJECTION));
    expect(es.map((e) => e.id)).toEqual(['s:speaker:o:u8', 's:speaker:o:u9', 's:speaker:o:u10', 's:speaker:o:u11']);
  });

  it("between legs, a tie still goes by leg — participant first — and each leg's entries keep their own order", () => {
    const u1 = seg('speaker', { origin: 'u1', openedAt: 100 });
    const u2 = seg('speaker', { origin: 'u2', openedAt: 100 });
    const notice: Notice = { id: 's:speaker:n1', at: 100, severity: 'warning', message: 'w' };
    const other = seg('participant', { origin: 'u1', openedAt: 100 });
    const entries = createProjector().project([legOf('speaker', [u1, u2], [notice]), legOf('participant', [other])], DEFAULT_PROJECTION);
    expect(entries.map((e) => e.id)).toEqual(['s:participant:o:u1', 's:speaker:o:u1', 's:speaker:o:u2', 'speaker:n:s:speaker:n1']);
  });

  it("carries a notice's params onto its entry", () => {
    const notice: Notice = { id: 's:speaker:n1', at: 5, severity: 'error', message: 'lease ended', code: 'lease_ended', params: { minutes: 3 } };
    const [entry] = createProjector().project([legOf('speaker', [], [notice])], DEFAULT_PROJECTION);
    expect(entry).toMatchObject({ kind: 'notice', code: 'lease_ended', params: { minutes: 3 } });
  });

  it('cuts rows with the settings', () => {
    const src = seg('speaker', { text: 'One. Two.' });
    const [e] = exchanges(createProjector().project([legOf('speaker', [src])], { ...DEFAULT_PROJECTION, mode: 'sentences', sentencesPerRow: 1 }));
    expect(e.source.map((r) => [r.start, r.end])).toEqual([[0, 4], [4, 9]]);
  });

  it('keeps identity for entries whose inputs did not change, and returns the same array for the same inputs', () => {
    const projector = createProjector();
    const a = seg('speaker', { openedAt: 0 });
    const b = seg('speaker', { openedAt: 100 });
    const first = projector.project([legOf('speaker', [a, b])], DEFAULT_PROJECTION);
    expect(projector.project([legOf('speaker', [a, b])], DEFAULT_PROJECTION)).toBe(first);
    const b2 = { ...b, text: 'changed.' };
    const second = projector.project([legOf('speaker', [a, b2])], DEFAULT_PROJECTION);
    expect(second).not.toBe(first);
    expect(second[0]).toBe(first[0]);
    expect(second[1]).not.toBe(first[1]);
  });

  it('keeps an entry when only its segment\'s audio changed', () => {
    const projector = createProjector();
    const a = seg('speaker', { openedAt: 0 });
    const first = projector.project([legOf('speaker', [a])], DEFAULT_PROJECTION);
    const withAudio = { ...a, speech: [{ pcm: new Int16Array(10) }] };
    const second = projector.project([legOf('speaker', [withAudio])], DEFAULT_PROJECTION);
    expect(second[0]).toBe(first[0]);
  });

  it('moves a translation into its source\'s group once they pair, leaving no standalone entry', () => {
    const projector = createProjector();
    const tr = seg('speaker', { side: 'translation', openedAt: 500 });
    const first = projector.project([legOf('speaker', [tr])], DEFAULT_PROJECTION);
    expect(first.map((e) => e.id)).toEqual([`speaker:s:${tr.id}`]);
    const src = seg('speaker', { side: 'source', openedAt: 0 });
    const second = projector.project([legOf('speaker', [src, tr])], DEFAULT_PROJECTION);
    expect(second.map((e) => e.id)).toEqual([`speaker:s:${src.id}`]);
    expect(exchanges(second)[0]).toMatchObject({ pairing: 'inferred' });
  });

  it('leaves out an exchange with no text on either side', () => {
    const empty = seg('speaker', { text: '', final: false });
    expect(createProjector().project([legOf('speaker', [empty])], DEFAULT_PROJECTION)).toEqual([]);
  });

  it('makes a new entry when a segment only turned final, and its rows say so', () => {
    const projector = createProjector();
    const open = seg('speaker', { final: false });
    const first = projector.project([legOf('speaker', [open])], DEFAULT_PROJECTION);
    const second = projector.project([legOf('speaker', [{ ...open, final: true }])], DEFAULT_PROJECTION);
    expect(second[0]).not.toBe(first[0]);
    expect(exchanges(second)[0].source[0]).toMatchObject({ text: 'x.', final: true });
  });
});
