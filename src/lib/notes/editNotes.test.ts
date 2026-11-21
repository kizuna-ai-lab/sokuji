// One field of a notes version edited by hand, and taken back (design P1 §1).
import { describe, it, expect } from 'vitest';
import type { HistoryNotesBody } from '../history/types';
import { applyNotesEdit, undoNotesEdit, type NotesEdit } from './editNotes';

const body = (): HistoryNotesBody => ({
  title: '周会',
  overview: { text: '讨论了上线。', format: 'plain' },
  topics: [{ title: '上线', summary: '下周三上线。', first: 1 }, { title: '招聘', summary: '还缺一人。', first: 4 }],
  points: [
    { topic: 0, text: '下周三上线', sentences: [2], kinds: ['decision'] },
    { topic: 0, text: '准备发布说明', sentences: [3], kinds: ['todo'], owner: 'My side', due: 'Friday' },
    { topic: 1, text: '面试两人', sentences: [5], kinds: ['todo'], owner: null, due: null, anchorMoved: true },
  ],
  names: [{ written: '搜库机', likely: 'Sokuji', sentences: [2] }],
});
const edit = (b: HistoryNotesBody, e: NotesEdit) => applyNotesEdit(b, e);

describe('editing one field', () => {
  it('changes only that field and keeps everything else as stored', () => {
    const cases: Array<[NotesEdit, (b: HistoryNotesBody) => void]> = [
      [{ field: { part: 'title' }, text: ' 周会（改） ' }, (b) => { b.title = '周会（改）'; }],
      [{ field: { part: 'overview' }, text: '讨论了上线和招聘。' }, (b) => { b.overview.text = '讨论了上线和招聘。'; }],
      [{ field: { part: 'topicTitle', topic: 1 }, text: '招人' }, (b) => { b.topics[1].title = '招人'; }],
      [{ field: { part: 'topicSummary', topic: 0 }, text: '周三上线。' }, (b) => { b.topics[0].summary = '周三上线。'; }],
      [{ field: { part: 'point', point: 0 }, text: '周三上线' }, (b) => { b.points[0].text = '周三上线'; }],
    ];
    for (const [e, expected] of cases) {
      const want = body();
      expected(want);
      expect(edit(body(), e)!.body).toEqual(want);
    }
  });

  it('never changes the body it was given', () => {
    const b = body();
    edit(b, { field: { part: 'point', point: 1 }, text: '' });
    expect(b).toEqual(body());
  });

  it('refuses an emptied title or topic title; an emptied overview or summary is left empty', () => {
    expect(edit(body(), { field: { part: 'title' }, text: '  ' })).toBeNull();
    expect(edit(body(), { field: { part: 'topicTitle', topic: 0 }, text: '' })).toBeNull();
    expect(edit(body(), { field: { part: 'overview' }, text: '' })!.body.overview.text).toBe('');
    expect(edit(body(), { field: { part: 'topicSummary', topic: 1 }, text: ' ' })!.body.topics[1].summary).toBe('');
  });

  it('an emptied point is removed, and its undo puts it back in place with its owner and date', () => {
    const r = edit(body(), { field: { part: 'point', point: 1 }, text: '' })!;
    expect(r.body.points.map((p) => p.text)).toEqual(['下周三上线', '面试两人']);
    expect(r.undo).toMatchObject({ kind: 'removed', at: 1 });
    expect(undoNotesEdit(r.body, r.undo)).toEqual(body());
  });

  it('owner and date are a to-do’s only; an emptied date is none', () => {
    const decision = edit(body(), { field: { part: 'point', point: 0 }, text: '下周三上线', owner: 'Ana', due: 'Monday' });
    expect(decision).toBeNull();
    const todo = edit(body(), { field: { part: 'point', point: 1 }, text: '准备发布说明', owner: 'Ana', due: '' })!;
    expect(todo.body.points[1]).toMatchObject({ owner: 'Ana', due: null, sentences: [3], kinds: ['todo'] });
    expect(undoNotesEdit(todo.body, todo.undo)!.points[1]).toMatchObject({ owner: 'My side', due: 'Friday' });
  });

  it('refuses a place that does not exist, and an edit that changes nothing', () => {
    expect(edit(body(), { field: { part: 'point', point: 9 }, text: 'x' })).toBeNull();
    expect(edit(body(), { field: { part: 'topicSummary', topic: 5 }, text: 'x' })).toBeNull();
    expect(edit(body(), { field: { part: 'title' }, text: '周会' })).toBeNull();
  });
});

describe('taking an edit back', () => {
  it('restores the field after a name was dismissed in between', () => {
    const r = edit(body(), { field: { part: 'overview' }, text: '新的概述' })!;
    const later = structuredClone(r.body);
    later.names[0].dismissed = true;
    const back = undoNotesEdit(later, r.undo)!;
    expect(back.overview.text).toBe('讨论了上线。');
    expect(back.names[0]).toMatchObject({ dismissed: true });
  });

  it('leaves a field changed again since', () => {
    const r = edit(body(), { field: { part: 'topicTitle', topic: 0 }, text: '发布' })!;
    const later = edit(r.body, { field: { part: 'topicTitle', topic: 0 }, text: '发布计划' })!.body;
    expect(undoNotesEdit(later, r.undo)).toBeNull();
  });

  it('leaves a removed point out when its place is gone', () => {
    const r = edit(body(), { field: { part: 'point', point: 2 }, text: '' })!;
    const later = edit(r.body, { field: { part: 'point', point: 1 }, text: '' })!.body;
    expect(undoNotesEdit(later, r.undo)).toBeNull();
  });
});
