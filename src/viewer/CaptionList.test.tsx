// src/viewer/CaptionList.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { ViewerEntry } from '../lib/share/types';
import type { Choice } from './text';

vi.mock('./text', async (orig) => {
  const actual = await orig<typeof import('./text')>();
  return { ...actual, piecesOf: vi.fn(actual.piecesOf) };
});
import { piecesOf } from './text';
import CaptionList from './CaptionList';

afterEach(cleanup);

const entry = (id: string, tr: string, final = true): ViewerEntry => ({
  id, leg: 'speaker', t: Number(id.slice(1)), languages: { source: 'ja', target: 'zh-CN' },
  source: [{ key: `${id}:1:0`, text: `src ${id}`, final: true }],
  translation: [{ key: `${id}:2:0`, text: tr, final }],
});
const list = (entries: ViewerEntry[], choice: Choice = { code: 'zh-CN', both: false }, completeOnly = false) => (
  <CaptionList
    t={(key) => key} entries={entries} choice={choice} completeOnly={completeOnly} layout="phone" twoLegs={false}
    notice={null} emptyText="nothing yet" following onFollowingChange={() => {}}
  />
);

describe('CaptionList', () => {
  // Upserts arrive many times a second while anyone speaks; a long talk holds
  // ~1,500 entries. An update must not re-render the lines it did not change.
  it('re-renders only the entry an update changed', () => {
    const a = entry('e1', '一'), b = entry('e2', '二'), c = entry('e3', '三');
    const { rerender } = render(list([a, b, c]));
    vi.mocked(piecesOf).mockClear();
    const b2 = entry('e2', '二二');
    rerender(list([a, b2, c]));
    expect(screen.getByText('二二')).toBeTruthy();
    expect(vi.mocked(piecesOf).mock.calls.map(([rows]) => rows)).toEqual([b2.translation]);
  });

  it('shows the empty line when no entry has anything to show', () => {
    render(list([entry('e1', '半', false)], { code: 'zh-CN', both: false }, true));
    expect(screen.getByText('nothing yet')).toBeTruthy();
    cleanup();
    render(list([entry('e1', '全', true)], { code: 'zh-CN', both: false }, true));
    expect(screen.queryByText('nothing yet')).toBeNull();
    expect(screen.getByText('全')).toBeTruthy();
  });
});
