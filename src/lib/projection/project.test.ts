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
const exchanges = (entries: Entry[]) => entries.filter((e): e is Extract<Entry, { kind: 'exchange' }> => e.kind === 'exchange');

describe('createProjector', () => {
  it('groups by stated origin, keys the entry by it, and marks the pairing stated', () => {
    const src = seg('speaker', { side: 'source', origin: 'u1', openedAt: 10 });
    const tr = seg('speaker', { side: 'translation', origin: 'u1', openedAt: 40 });
    const [e] = exchanges(createProjector().project([legOf('speaker', [src, tr])], DEFAULT_PROJECTION));
    expect(e).toMatchObject({ id: 'speaker:o:u1', pairing: 'stated', t: 10, leg: 'speaker', languages: { source: 'ja', target: 'en' } });
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
});
