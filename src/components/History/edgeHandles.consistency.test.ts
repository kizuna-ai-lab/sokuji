// The panels' edge handles are one design (owner, 2026-11-17): the speakers' side panel and the notes column of a
// record, and the live notes beside the conversation. Mirrored by the side a panel sits on; the same size, the same
// place from the top. And a panel hidden from one leaves a line and the handle, not a tinted bar.
import { describe, it, expect } from 'vitest';
import { compile } from 'sass';
import { resolve } from 'node:path';

const css = (rel: string) => compile(resolve(__dirname, '..', rel)).css;
const rule = (sheet: string, selector: string) => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return sheet.match(new RegExp(`(?:^|\\n|\\})\\s*${esc}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
};
const prop = (body: string, name: string) => body.match(new RegExp(`(?:^|;|\\s)${name}:\\s*([^;]+);`))?.[1]?.trim();

describe('the edge handles', () => {
  const history = css('History/History.scss');
  const live = css('LiveNotes/LiveNotesPanel.scss');
  const handles = {
    speakers: rule(history, '.record-side__handle'),
    notes: rule(history, '.record-page__notes-handle'),
    live: rule(live, '.live-notes__handle'),
  };

  it('are the same size and as far from the top', () => {
    for (const [name, body] of Object.entries(handles)) {
      expect(prop(body, 'width'), name).toBe('24px');
      expect(prop(body, 'height'), name).toBe('32px');
      expect(prop(body, 'top'), name).toBe('8px');
    }
  });

  it('leave a hidden live notes panel as a line and its handle, without the panel\'s tint', () => {
    const layout = css('MainLayout/MainLayout.scss');
    const hidden = rule(layout, '.main-layout .main-panel-row > .live-notes.is-hidden');
    expect(prop(hidden, 'flex')).toBe('0 0 24px');
    expect(prop(hidden, 'background')).toBe('transparent');
  });

  // Owner, 2026-11-17: the notes and the transcript are long lists with scrollbars at their right edges, where the
  // handles sit. Their scrolling boxes end 24px early, so each handle has a lane of its own beside the scrollbar.
  it('keep clear of the scrollbars of the notes and the transcript', () => {
    const notes = rule(history, '.record-page__columns.is-wide .record-page__notes');
    expect(prop(notes, 'margin-right')).toBe('24px');
    expect(prop(notes, 'padding-right')).toBeUndefined();
    const transcript = rule(history, '.record-page__body:has(> .record-side) .record-page__transcript');
    expect(prop(transcript, 'margin-right')).toBe('24px');
    expect(history).not.toMatch(/\.record-page__transcript\s*\{\s*padding-right/);
  });
});
