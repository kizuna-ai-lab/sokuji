// The panels are shown and hidden from switches in fixed toolbars, not from handles on their edges (owner and design
// review, 2026-11-17; B-40 redone): a handle on an edge fought the scrollbar for that edge. So no handle is styled, the
// notes' and the transcript's scrolling boxes reach their edges (their scrollbars where they belong), and a switch
// shows when its panel is shown.
import { describe, it, expect } from 'vitest';
import { compile } from 'sass';
import { resolve } from 'node:path';

const css = (rel: string) => compile(resolve(__dirname, '..', rel)).css;

describe('the panels\' switches', () => {
  const history = css('History/History.scss');
  const live = css('LiveNotes/LiveNotesPanel.scss');
  const layout = css('MainLayout/MainLayout.scss');

  it('leave no handle on any panel\'s edge', () => {
    for (const sheet of [history, live, layout]) {
      expect(sheet).not.toMatch(/\.record-side__handle|\.record-page__notes-handle|\.live-notes__handle/);
    }
  });

  it('leave the notes\' and the transcript\'s scrollbars at their edges', () => {
    expect(history).not.toMatch(/\.record-page__notes\s*\{[^}]*margin-right/);
    expect(history).not.toMatch(/\.record-page__transcript\s*\{[^}]*(margin|padding)-right/);
  });

  it('mark the switch of a panel that is shown', () => {
    expect(history).toMatch(/\.record-page__panel-switch\[aria-pressed=["']?true["']?\]\s*\{[^}]*background/);
  });

  // Owner, 2026-11-17: the notes, side panel, Export and More buttons stand evenly apart, as one row.
  it('stand as far apart as the other actions, the pair with no extra space of its own', () => {
    const panels = history.match(/\.record-page__panels\s*\{([^}]*)\}/)?.[1] ?? '';
    const actions = history.match(/\.record-page__actions\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(actions).toMatch(/gap:\s*8px/);
    expect(panels).toMatch(/gap:\s*8px/);
    expect(panels).not.toMatch(/margin/);
  });
});
