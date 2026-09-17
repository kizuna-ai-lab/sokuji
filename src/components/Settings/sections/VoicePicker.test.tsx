import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, within, fireEvent } from '@testing-library/react';
import VoicePicker from './VoicePicker';

// This suite drives interactions with `fireEvent`, not `@testing-library/user-event`:
// the latter is not a dependency of this project (not in package.json, not in
// node_modules, and nothing else in the codebase imports it — every other
// Settings/MainPanel test, e.g. ExportButton.test.tsx, uses `fireEvent`). Adding
// it would mean editing root package.json/package-lock.json, outside this
// task's file list. Every assertion below is the same one the design called
// for; only the interaction-simulation mechanism changed.

const base = {
  selectedId: 'builtin:Grace',
  onSelect: vi.fn(),
  onAskDelete: vi.fn(),
  playingId: null,
  loadingId: null,
  capability: { importModes: [] as ('upload' | 'record')[] },
};

const GRACE = {
  id: 'builtin:Grace', label: 'Grace', group: 'builtin' as const, removable: false, previewable: true,
  meta: { facets: { gender: 'female', style: ['calm', 'soft'], description: 'Unhurried American guide voice.' } },
};
const ALEX = { id: 'builtin:Alex', label: 'Alex', group: 'builtin' as const, removable: false };
const MINE = { id: 'custom:1', label: 'Mine', group: 'custom' as const, removable: true };

beforeEach(() => { vi.clearAllMocks(); cleanup(); });

describe('VoicePicker', () => {
  it('shows the selected voice on the trigger and no rows until it is opened', () => {
    render(<VoicePicker {...base} voices={[GRACE, ALEX]} />);
    expect(screen.getByRole('button', { expanded: false })).toHaveTextContent('Grace');
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
  });

  it('opens on click and renders name plus facets for a preset (R2) and a marker for a clone', () => {
    render(<VoicePicker {...base} voices={[GRACE, MINE]} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    // The floating wrapper must carry role="dialog", not just the inner
    // role="grid": Settings' PanelBar keeps a document-level Escape listener
    // that collapses the whole settings panel unless isVisibleDialogOpen()
    // finds a role="dialog" ancestor. useDismiss's Escape handler stops
    // propagation but never calls preventDefault, so without this role a
    // single Escape would close this popover AND collapse the panel behind
    // it. Queried via `within` rather than two independent getByRole calls,
    // so this pins the actual invariant — the grid NESTED inside the dialog —
    // rather than merely that one of each role exists somewhere on the page.
    const grid = within(screen.getByRole('dialog')).getByRole('grid');
    expect(within(grid).getByText(/female · calm · soft/)).toBeInTheDocument();
    expect(within(grid).getByText('Grace')).toBeInTheDocument();
    expect(within(grid).getByText('Mine')).toBeInTheDocument();
  });

  it('renders a play control only where onPreview and previewable and not disabled all hold', () => {
    render(
      <VoicePicker
        {...base}
        voices={[GRACE, ALEX, MINE, { ...MINE, id: 'custom:2', label: 'Busy', disabled: true }]}
        onPreview={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    // Grace (opted in) and Mine (clone default) — not Alex, not the disabled clone.
    expect(screen.getAllByRole('button', { name: /play/i })).toHaveLength(2);
  });

  it('selects and closes on the name, and does neither on play', () => {
    const onSelect = vi.fn();
    const onPreview = vi.fn().mockResolvedValue(null);
    render(<VoicePicker {...base} voices={[GRACE, ALEX]} onSelect={onSelect} onPreview={onPreview} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));

    fireEvent.click(screen.getAllByRole('button', { name: /play/i })[0]);
    expect(onPreview).toHaveBeenCalledWith('builtin:Grace', expect.anything());
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole('grid')).toBeInTheDocument();

    // The name cell is still a real gridcell (Task 4 depends on this): the
    // wrapping div's accessible name is computed from its button child's
    // aria-label, proving the row/cell structure the grid markup requires.
    expect(screen.getByRole('gridcell', { name: 'Alex' })).toBeInTheDocument();
    // But the CLICK targets the button itself, not the div wrapping it: a
    // click dispatched at the wrapper does not bubble DOWN into a child's
    // handler (only up, per normal DOM event flow), so it would never reach
    // the button's onClick.
    fireEvent.click(screen.getByRole('button', { name: 'Alex' }));
    expect(onSelect).toHaveBeenCalledWith('builtin:Alex');
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
  });

  it('aborts the previous preview when a new one starts', () => {
    const onPreview = vi.fn().mockResolvedValue(null);
    render(<VoicePicker {...base} voices={[GRACE, MINE]} onPreview={onPreview} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));

    fireEvent.click(screen.getAllByRole('button', { name: /play/i })[0]);
    const firstSignal = onPreview.mock.calls[0][1] as AbortSignal;
    expect(firstSignal.aborted).toBe(false);

    // A second preview — from either row, it doesn't matter which — must
    // reach back and abort the first request's signal. A signal that is only
    // ever constructed and handed off, never aborted by anything, would pass
    // `expect.anything()` in the test above while being unable to do the one
    // thing its type exists for.
    fireEvent.click(screen.getAllByRole('button', { name: /play/i })[1]);
    expect(firstSignal.aborted).toBe(true);
  });

  it('shows a spinner on the row being synthesized and a stop control once it is playing', () => {
    const { rerender } = render(<VoicePicker {...base} voices={[GRACE]} onPreview={vi.fn()} loadingId="builtin:Grace" />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByRole('button', { name: /synthesiz/i })).toBeDisabled();
    rerender(<VoicePicker {...base} voices={[GRACE]} onPreview={vi.fn()} playingId="builtin:Grace" />);
    expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument();
  });

  it('disables every play control with the given reason', () => {
    render(<VoicePicker {...base} voices={[GRACE, MINE]} onPreview={vi.fn()} previewUnavailableReason="Stop the session to preview this voice." />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    const buttons = screen.getAllByRole('button', { name: 'Stop the session to preview this voice.' });
    expect(buttons).toHaveLength(2);
    buttons.forEach((b) => expect(b).toBeDisabled());
  });

  it('renames a clone in place and never offers rename or delete on a preset', () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    const onAskDelete = vi.fn();
    render(<VoicePicker {...base} voices={[GRACE, MINE]} onRename={onRename} onAskDelete={onAskDelete} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getAllByRole('button', { name: /rename/i })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /delete/i })).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: /rename/i }));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Renamed' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    expect(onRename).toHaveBeenCalledWith('custom:1', 'Renamed');
  });

  it('asks the parent to delete rather than deleting or confirming itself', () => {
    const onAskDelete = vi.fn();
    render(<VoicePicker {...base} voices={[MINE]} onAskDelete={onAskDelete} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    fireEvent.click(screen.getByRole('button', { name: /delete/i }));
    expect(onAskDelete).toHaveBeenCalledWith('custom:1', 'Mine');
  });

  it('offers the add row only when a parent handed it a handler', () => {
    const onAddVoice = vi.fn();
    const { rerender } = render(<VoicePicker {...base} voices={[GRACE]} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.queryByRole('button', { name: /add a voice/i })).not.toBeInTheDocument();

    rerender(<VoicePicker {...base} voices={[GRACE]} onAddVoice={onAddVoice} />);
    fireEvent.click(screen.getByRole('button', { name: /add a voice/i }));
    expect(onAddVoice).toHaveBeenCalledTimes(1);
  });

  it('narrows presets by facet without touching clones, and counts what it shows', () => {
    // selectedId is overridden to Alex (not base's Grace) so this case stays
    // about facet narrowing alone: the very next test pins the "selected
    // preset survives its own filter" rule, and with base's selectedId
    // (Grace) the two rules would contradict on identical inputs — Grace
    // would need to be both hidden (this test, filtered out) and shown (next
    // test, same filter, same voice, kept only for being selected).
    render(
      <VoicePicker
        {...base}
        selectedId="builtin:Alex"
        voices={[GRACE, { ...ALEX, meta: { facets: { gender: 'male' } } }, MINE]}
        capability={{ importModes: [], facetFilter: true }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    fireEvent.change(screen.getByLabelText(/gender/i), { target: { value: 'male' } });
    const grid = screen.getByRole('grid');
    expect(within(grid).queryByText('Grace')).not.toBeInTheDocument();
    expect(within(grid).getByText('Alex')).toBeInTheDocument();
    expect(within(grid).getByText('Mine')).toBeInTheDocument();     // clones never filtered
    expect(within(grid).getByText('1 of 2')).toBeInTheDocument();
  });

  it('keeps the selected preset listed even when the filter excludes it', () => {
    render(
      <VoicePicker
        {...base}
        voices={[GRACE, { ...ALEX, meta: { facets: { gender: 'male' } } }]}
        capability={{ importModes: [], facetFilter: true }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    fireEvent.change(screen.getByLabelText(/gender/i), { target: { value: 'male' } });
    expect(within(screen.getByRole('grid')).getByText('Grace')).toBeInTheDocument();
  });

  it('disables selection while a session is active but still allows auditioning', () => {
    const onSelect = vi.fn();
    render(<VoicePicker {...base} voices={[GRACE]} onSelect={onSelect} onPreview={vi.fn()} isSessionActive />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    // The name cell is a <div role="gridcell"> wrapping a real <button> (see
    // VoicePicker.tsx) — jest-dom's toBeDisabled() only recognizes actual
    // form controls, so this targets the button inside the cell, not the
    // cell itself. Its accessible name is exactly "Grace" (from aria-label),
    // unlike the trigger button above, whose name also carries the facet
    // subtitle.
    expect(screen.getByRole('button', { name: 'Grace' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /play/i })).toBeEnabled();
  });
});

describe('VoicePicker keyboard', () => {
  const THREE = [
    { id: 'builtin:Grace', label: 'Grace', group: 'builtin' as const, removable: false, previewable: true },
    { id: 'builtin:Isla', label: 'Isla', group: 'builtin' as const, removable: false, previewable: true },
    { id: 'builtin:Victoria', label: 'Victoria', group: 'builtin' as const, removable: false, previewable: true },
  ];

  it('moves between rows with the arrow keys and lands on the name cell', async () => {
    render(<VoicePicker {...base} voices={THREE} onPreview={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    const grid = screen.getByRole('grid');
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    await vi.waitFor(() => expect(screen.getByRole('gridcell', { name: 'Grace' })).toHaveFocus());
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    await vi.waitFor(() => expect(screen.getByRole('gridcell', { name: 'Isla' })).toHaveFocus());
    fireEvent.keyDown(grid, { key: 'ArrowUp' });
    await vi.waitFor(() => expect(screen.getByRole('gridcell', { name: 'Grace' })).toHaveFocus());
  });

  it('moves within a row with left and right', async () => {
    render(<VoicePicker {...base} voices={THREE} onPreview={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    const grid = screen.getByRole('grid');
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    fireEvent.keyDown(grid, { key: 'ArrowRight' });
    await vi.waitFor(() => expect(screen.getAllByRole('button', { name: /play/i })[0]).toHaveFocus());
    fireEvent.keyDown(grid, { key: 'ArrowLeft' });
    await vi.waitFor(() => expect(screen.getByRole('gridcell', { name: 'Grace' })).toHaveFocus());
  });

  it('jumps to the first and last row with Home and End', async () => {
    render(<VoicePicker {...base} voices={THREE} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    const grid = screen.getByRole('grid');
    fireEvent.keyDown(grid, { key: 'End' });
    await vi.waitFor(() => expect(screen.getByRole('gridcell', { name: 'Victoria' })).toHaveFocus());
    fireEvent.keyDown(grid, { key: 'Home' });
    await vi.waitFor(() => expect(screen.getByRole('gridcell', { name: 'Grace' })).toHaveFocus());
  });

  it('jumps to a row by typing its first letters — the search box we did not build', async () => {
    render(<VoicePicker {...base} voices={THREE} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    const grid = screen.getByRole('grid');
    // One keyDown per character: the buffer is what turns 'v' + 'i' into a
    // two-character match, so a single synthetic event would not exercise it.
    fireEvent.keyDown(grid, { key: 'v' });
    fireEvent.keyDown(grid, { key: 'i' });
    await vi.waitFor(() => expect(screen.getByRole('gridcell', { name: 'Victoria' })).toHaveFocus());
  });

  it('selects with Enter and closes', async () => {
    const onSelect = vi.fn();
    render(<VoicePicker {...base} voices={THREE} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    const grid = screen.getByRole('grid');
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    // Enter is dispatched on the ACTUAL focused gridcell, not on the grid
    // container: `onGridKeyDown`'s `Enter` case only acts when `e.target`
    // itself carries `role="gridcell"` (fix round 2 — real focus, not
    // remembered coordinates), which is what a genuine keydown's target
    // would be once arrow navigation has moved DOM focus there. Waiting for
    // focus to actually land (see `focusActive`'s comment on why this is
    // async) is what makes that target real rather than assumed.
    const isla = await vi.waitFor(() => {
      const cell = screen.getByRole('gridcell', { name: 'Isla' });
      expect(cell).toHaveFocus();
      return cell;
    });
    fireEvent.keyDown(isla, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('builtin:Isla');
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
  });

  it('closes on Escape and gives focus back to the trigger', async () => {
    render(<VoicePicker {...base} voices={THREE} />);
    const trigger = screen.getByRole('button', { expanded: false });
    fireEvent.click(trigger);
    // `document`, not the grid: this Escape is handled by floating-ui's
    // `useDismiss`, which binds its listener to the document.
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    await vi.waitFor(() => expect(trigger).toHaveFocus());
  });

  // These three drive the REAL mouse path that exposed the double-fire bug:
  // click a control directly (no prior arrow-key navigation, so
  // activeRow/activeCell sit at their post-open default), then fire keydown
  // on the element that ACTUALLY has focus — never on the grid container.
  // Firing keydown on the grid, as the six tests above all do, cannot see
  // this class of bug: the grid's Enter handler used to trust
  // activeCell === 0 alone, which stays true even when the real focus (and
  // the real event target) is a rename <input> or an action <button>.

  it('a mouse-driven rename does not also select or close the picker', async () => {
    const onSelect = vi.fn();
    const onRename = vi.fn().mockResolvedValue(undefined);
    render(<VoicePicker {...base} voices={[MINE, ...THREE]} onSelect={onSelect} onRename={onRename} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    // No arrow key pressed — activeRow/activeCell are still (0, 0).
    fireEvent.click(screen.getByRole('button', { name: /rename/i }));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Renamed' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    expect(onRename).toHaveBeenCalledWith('custom:1', 'Renamed');
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole('grid')).toBeInTheDocument();
  });

  it('a mouse-driven ▶ does not also trigger a spurious select', async () => {
    const onSelect = vi.fn();
    const onPreview = vi.fn().mockResolvedValue(null);
    render(<VoicePicker {...base} voices={THREE} onSelect={onSelect} onPreview={onPreview} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    // No arrow key pressed — activeRow/activeCell are still (0, 0), so
    // rowOrder[activeRow] resolves to Grace: exactly the spurious selection
    // this guard must prevent.
    const play = screen.getAllByRole('button', { name: /play/i })[0];
    fireEvent.click(play);
    fireEvent.keyDown(play, { key: 'Enter' });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('arrow and letter keys stay in the rename input instead of leaking into the grid', async () => {
    render(<VoicePicker {...base} voices={[MINE, ...THREE]} onRename={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    fireEvent.click(screen.getByRole('button', { name: /rename/i }));
    const input = screen.getByRole('textbox');
    fireEvent.keyDown(input, { key: 'ArrowRight' });
    fireEvent.keyDown(input, { key: 'v' });
    expect(input).toHaveFocus();
    // 'v' would jump type-ahead to Victoria if it leaked into the grid; it
    // must not have.
    expect(screen.getByRole('gridcell', { name: 'Victoria' })).not.toHaveFocus();
  });
});
