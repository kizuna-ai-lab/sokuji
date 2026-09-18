import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, within, fireEvent, waitFor } from '@testing-library/react';
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

  // Spec §7: "the selected row carries `aria-selected="true"`". Final-review
  // finding 5 found it on the name GRIDCELL instead — valid ARIA either way,
  // which is exactly why only an explicit assertion keeps it where the spec
  // put it. Both halves are pinned so it cannot quietly migrate back down
  // into the cell.
  it('marks the selected row, not its name cell, as selected', () => {
    render(<VoicePicker {...base} voices={[GRACE, ALEX]} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    const grid = screen.getByRole('grid');

    // `base.selectedId` is Grace. Reached via its name cell, whose COMPUTED
    // name concatenates the label with the row subtitle — hence a regex
    // rather than an exact string.
    const graceCell = within(grid).getByRole('gridcell', { name: /Grace/ });
    const graceRow = graceCell.closest('[role="row"]') as HTMLElement;
    expect(graceRow).toHaveAttribute('aria-selected', 'true');
    expect(graceCell).not.toHaveAttribute('aria-selected');

    // The accessibility tree's own view of it, which is what §7 is really
    // asking for: a row query filtered on selected state resolves to this row.
    expect(within(grid).getByRole('row', { selected: true })).toBe(graceRow);

    const alexRow = within(grid).getByRole('gridcell', { name: /Alex/ }).closest('[role="row"]') as HTMLElement;
    expect(alexRow).toHaveAttribute('aria-selected', 'false');
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

  // `async` and awaiting the close is not decoration: the row now closes only
  // after `onRename` resolves, so a synchronous end-of-test would leave that
  // state update to land outside `act`.
  it('renames a clone in place and never offers rename or delete on a preset', async () => {
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
    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument());
  });

  // Where a failed rename is reported was settled by rendering the four
  // candidates and picking one: under the input, inside the row. The
  // alternatives were the popover's top (which shoves the whole list down a
  // line), its bottom (up to a full popover away from the input), and a red
  // border on the input alone — that last ruled out by measurement, since it
  // moved 4 pixels: the input's focus ring already paints over
  // `border-color`.
  //
  // Before this, a rejected rename was INVISIBLE. `commitRename` closed the
  // row before awaiting, so by the time the rejection arrived the input was
  // unmounted, and `VoiceLibrarySection.handleRename` swallowed it into a
  // `console.warn` — under a comment claiming reporting was its job.
  it('reports a failed rename under the input, inside the row, and keeps the row open', async () => {
    const onRename = vi.fn().mockRejectedValue(new Error('That name is already taken.'));
    render(<VoicePicker {...base} voices={[GRACE, MINE]} onRename={onRename} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    fireEvent.click(screen.getByRole('button', { name: /rename/i }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Taken' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', code: 'Enter' });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('That name is already taken.');
    // One alert, not two: the picker owns this failure, so nothing else may
    // also render it.
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    // The product's own error class, not a bespoke one invented here.
    expect(alert).toHaveClass('voice-capture-error');

    // Still editable, so the name can be corrected without starting over —
    // and the message sits in the SAME row as the input, which is the whole
    // point of the chosen position.
    const input = screen.getByRole('textbox');
    expect(input).toHaveValue('Taken');
    expect(within(input.closest('[role="row"]') as HTMLElement).getByRole('alert')).toBe(alert);
  });

  it('closes the row and leaves no error behind when the rename succeeds', async () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    render(<VoicePicker {...base} voices={[GRACE, MINE]} onRename={onRename} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    fireEvent.click(screen.getByRole('button', { name: /rename/i }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Renamed' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', code: 'Enter' });

    // RTL's `waitFor`, not `vi.waitFor`: only the former wraps its polling in
    // `act`, and the close lands in a microtask after `onRename` resolves.
    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  // Keeping the row open after a failure re-arms `onBlur`, which also
  // commits. Without a guard, every click elsewhere on the page fires the
  // same doomed request again — so the retry has to be gated on the name
  // actually changing.
  it('does not re-fire the same failed name on blur, and a new name clears the error', async () => {
    const onRename = vi.fn().mockRejectedValue(new Error('That name is already taken.'));
    render(<VoicePicker {...base} voices={[GRACE, MINE]} onRename={onRename} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    fireEvent.click(screen.getByRole('button', { name: /rename/i }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Taken' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', code: 'Enter' });
    await screen.findByRole('alert');
    expect(onRename).toHaveBeenCalledTimes(1);

    fireEvent.blur(screen.getByRole('textbox'));
    expect(onRename).toHaveBeenCalledTimes(1);

    // Typing again retracts the stale message straight away — leaving it up
    // while the user edits would keep accusing a name they already changed.
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Free' } });
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', code: 'Enter' });
    expect(onRename).toHaveBeenLastCalledWith('custom:1', 'Free');
    expect(onRename).toHaveBeenCalledTimes(2);
    // The second attempt fails too — await its message so that state update
    // lands inside `act` rather than after the test has finished.
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
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

  // Spec §8: "`emptyHint` survives: the popover shows it under `MY VOICES`
  // when a provider CAN create but has no clones yet." Final-review finding
  // 4: the condition was inverted, so the hint appeared only where the
  // provider could NOT create — telling users to add a voice exactly where
  // there is no way to, and staying silent in the case the copy exists for
  // (Soniox BYOK with a key and no clones yet). The plan carried the inverted
  // form as well, so this follows the spec over the plan.
  //
  // All three branches, because either single case passes on its own under a
  // condition that ignores one of the two inputs.
  it('hints at an empty My Voices group only when the provider can create one', () => {
    const hint = () => screen.queryByText('No imported voices yet.');

    // Can create, no clones yet — the case the copy was written for.
    const { rerender } = render(<VoicePicker {...base} voices={[GRACE]} onAddVoice={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(hint()).toBeInTheDocument();

    // Cannot create: a hint telling someone to add a voice is useless
    // precisely where no add affordance exists.
    rerender(<VoicePicker {...base} voices={[GRACE]} />);
    expect(hint()).not.toBeInTheDocument();

    // Can create, but a clone already exists — nothing empty to hint about.
    rerender(<VoicePicker {...base} voices={[GRACE, MINE]} onAddVoice={vi.fn()} />);
    expect(hint()).not.toBeInTheDocument();
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

  // Fix round 1 (2026-09-17): `facetRow()` read/wrote every dimension through
  // one `string | undefined` cast, which silently dropped `useCase` and
  // `style` (typed `string[]` in `VoiceFacetCriteria`, unlike the other
  // three's `string | null`) and used the field's own label ("Gender") as
  // the neutral option instead of its `any*` wording ("Any gender"). These
  // two cases are what stop both from recurring.
  it('offers all five facet dimensions, each with its own "Any …" neutral option', () => {
    const FULL = {
      id: 'builtin:Full', label: 'Full', group: 'builtin' as const, removable: false,
      meta: { facets: { gender: 'female', age: 'young', accent: 'american', useCase: ['narration'], style: ['calm'] } },
    };
    render(<VoicePicker {...base} voices={[FULL]} capability={{ importModes: [], facetFilter: true }} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    for (const [label, anyLabel] of [
      ['Gender', 'Any gender'],
      ['Age', 'Any age'],
      ['Accent', 'Any accent'],
      ['Use case', 'Any use case'],
      ['Style', 'Any style'],
    ]) {
      const select = screen.getByLabelText(label) as HTMLSelectElement;
      expect(select.querySelector('option[value=""]')).toHaveTextContent(anyLabel);
    }
  });

  // A facet VALUE's real translated text (as opposed to the humanized
  // fallback) needs a `t` that can distinguish a keyed lookup from its
  // default — this file's react-i18next is the real package with no catalog
  // loaded, so `t(key, def)` always returns `def` here regardless of `key`,
  // same as `humanizeFacetValue` would. That proof lives in
  // VoicePicker.facetTranslation.test.tsx instead, which mocks a small
  // catalog precisely so the two are distinguishable.

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

  // Final-review finding 1. The trigger used to carry
  // `disabled={isSessionActive && !onPreview}`, which locked the ENTIRE
  // surface for any provider that passes no `onPreview` — Supertonic
  // (`LocalInferenceVoiceSection` passes `importModes: ['upload']`,
  // `onRename` and `onDelete`, never `onPreview`) and Soniox with no API
  // key. Starting a session left import, rename and delete unreachable,
  // contradicting VoiceLibrarySection's own `isSessionActive` contract
  // ("leaves import / rename / delete available so users can stage voices
  // for their next session").
  //
  // The case above cannot catch it: it supplies `onPreview`, which is
  // precisely the term that made the expression false there. This one
  // supplies none — the Supertonic prop shape — and asserts the popover
  // still opens and all three manage affordances are reachable, while
  // SELECTION stays blocked (the one thing a live session must not change).
  it('keeps the popover and its manage controls reachable mid-session for a provider with no onPreview', () => {
    render(
      <VoicePicker
        {...base}
        voices={[MINE, GRACE]}
        onRename={vi.fn()}
        onAddVoice={vi.fn()}
        isSessionActive
      />,
    );
    const trigger = screen.getByRole('button', { expanded: false });
    expect(trigger).toBeEnabled();

    fireEvent.click(trigger);
    // Presence before absence: the popover must genuinely have opened before
    // "the controls are reachable" means anything.
    const grid = within(screen.getByRole('dialog')).getByRole('grid');
    expect(within(grid).getByRole('button', { name: /rename/i })).toBeEnabled();
    expect(within(grid).getByRole('button', { name: /delete/i })).toBeEnabled();
    expect(within(grid).getByRole('button', { name: /add a voice/i })).toBeEnabled();
    // No ▶ anywhere — this provider passes no onPreview at all, which is the
    // condition that used to disable the trigger.
    expect(within(grid).queryByRole('button', { name: /play/i })).not.toBeInTheDocument();
    // Selection is still refused, per row rather than per surface.
    expect(within(grid).getByRole('button', { name: 'Grace' })).toBeDisabled();
    expect(within(grid).getByRole('button', { name: 'Mine' })).toBeDisabled();
  });
});

describe('VoicePicker keyboard', () => {
  const THREE = [
    { id: 'builtin:Grace', label: 'Grace', group: 'builtin' as const, removable: false, previewable: true },
    { id: 'builtin:Isla', label: 'Isla', group: 'builtin' as const, removable: false, previewable: true },
    { id: 'builtin:Victoria', label: 'Victoria', group: 'builtin' as const, removable: false, previewable: true },
  ];

  // `go()` never moves focus inline — it only SCHEDULES a `focusActive` call,
  // deferred by one or two animation frames (see VoicePicker.tsx's
  // `pastInitialFocusRaceRef` comment). A synchronous assertion right after a
  // keydown proves nothing about whether a focus change was scheduled: it
  // passes identically whether one was scheduled and just hasn't run yet, or
  // none was scheduled at all. Flushing two real frames (the worst case) is
  // what makes "focus did not move" an assertion about the ABSENCE of a
  // scheduled change, not merely about timing.
  const flushTwoFrames = () => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });

  it('moves between rows with the arrow keys, preserving the active column', async () => {
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
    // The row closes after the resolve, so wait for it here too.
    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument());
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
    // Let `FloatingFocusManager`'s own deferred initial-focus action (see
    // VoicePicker.tsx's `pastInitialFocusRaceRef` comment) land on the grid
    // BEFORE clicking Rename. A real user's click always arrives long after
    // that microtask+rAF has resolved; without this wait, that still-pending
    // action can fire during `flushTwoFrames()` below and steal focus back
    // from the rename input's `autoFocus` — a jsdom timing artifact from
    // compressing the two clicks into one synchronous tick, not a
    // production bug (nothing in this scenario touches `go()`, which is the
    // only thing this component itself schedules a focus change from).
    await vi.waitFor(() => expect(screen.getByRole('grid')).toHaveFocus());
    fireEvent.click(screen.getByRole('button', { name: /rename/i }));
    const input = screen.getByRole('textbox');
    fireEvent.keyDown(input, { key: 'ArrowRight' });
    fireEvent.keyDown(input, { key: 'v' });
    // Without `await flushTwoFrames()` here this assertion is vacuous: `go()`
    // never moves focus inline, only schedules it, so a synchronous check
    // would pass whether or not a focus change had been scheduled. See
    // `flushTwoFrames`'s comment above.
    await flushTwoFrames();
    expect(input).toHaveFocus();
    // 'v' would jump type-ahead to Victoria if it leaked into the grid; it
    // must not have.
    expect(screen.getByRole('gridcell', { name: 'Victoria' })).not.toHaveFocus();
  });

  it('skips a disabled ▶ during horizontal movement, keeping exactly one tab stop', async () => {
    const CLONE = { id: 'custom:1', label: 'Mine', group: 'custom' as const, removable: true, previewable: true };
    render(
      <VoicePicker
        {...base}
        voices={[CLONE]}
        onPreview={vi.fn()}
        onRename={vi.fn()}
        // Disables only THIS row's ▶ (loadingId is per-voice), leaving name,
        // rename and delete enabled — the shape a mid-synthesis row is in.
        loadingId="custom:1"
      />,
    );
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    const grid = screen.getByRole('grid');
    fireEvent.keyDown(grid, { key: 'ArrowDown' }); // enters at the name cell
    fireEvent.keyDown(grid, { key: 'ArrowRight' }); // ▶ is disabled: skip to rename
    await vi.waitFor(() => expect(screen.getByRole('button', { name: /rename/i })).toHaveFocus());
    // The clone's gridcell computed name is now just "Mine" — the name
    // button's aria-label and nothing else. Clones no longer carry a
    // subtitle (it used to repeat the group label, which drowned the group
    // header once the popover started rendering one), so the cell's "name
    // from content" computation has only the one string to gather. The regex
    // below matched before this change too, when the name was
    // "Mine My Voices"; it is written loosely on purpose, because what this
    // case is pinning is the single tabbable element per row, not the name.
    const row = screen.getByRole('gridcell', { name: /Mine/ }).closest('[role="row"]') as HTMLElement;
    expect(row.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
  });
});

// Reported 2026-09-18: Local Native's supertonic-3 showed a "Custom voices"
// group with nothing under it. supertonic-3 cannot clone (the sidecar catalog
// has clones=False), so `voiceStoreFor` hands back no store, `importModes` is
// empty, and VoiceLibrarySection therefore passes no `onAddVoice` — leaving a
// header promising a section that has no rows, no add affordance, and not even
// the "No imported voices yet." hint (which is itself gated on `onAddVoice`).
//
// Both headers rendered unconditionally, so the same defect existed in mirror
// image: moss has no presets at all, and showed a bare "Presets" header.
describe('group headers with nothing under them', () => {
  it('omits the custom group when the provider can neither clone nor import', () => {
    render(<VoicePicker {...base} voices={[GRACE, ALEX]} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.queryByRole('columnheader', { name: /custom voices/i })).toBeNull();
    expect(screen.getByRole('columnheader', { name: /presets/i })).toBeInTheDocument();
  });

  it('keeps the custom group when a voice can be added, even with no clones yet', () => {
    render(<VoicePicker {...base} voices={[GRACE]} onAddVoice={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByRole('columnheader', { name: /custom voices/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add a voice/i })).toBeInTheDocument();
  });

  it('omits the presets group for a model that has none', () => {
    render(<VoicePicker {...base} voices={[MINE]} onAddVoice={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.queryByRole('columnheader', { name: /presets/i })).toBeNull();
    expect(screen.getByRole('columnheader', { name: /custom voices/i })).toBeInTheDocument();
  });

  // Guard, not symptom: a facet filter that matches nothing leaves the shown
  // list empty while the roster still HAS presets, and the header is what
  // carries "No voices match these filters." Hiding it then would delete the
  // only feedback that the filter is what emptied the list.
  it('keeps the presets group when a filter hides every preset', () => {
    render(
      <VoicePicker
        {...base}
        voices={[GRACE, ALEX]}
        capability={{ importModes: [], facetFilter: true }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    const genderSelect = screen.getAllByRole('combobox')[0];
    fireEvent.change(genderSelect, { target: { value: 'male' } });
    expect(screen.getByRole('columnheader', { name: /presets/i })).toBeInTheDocument();
  });

  // Guard: the Refresh control lives INSIDE the presets header, so a provider
  // that offers it must keep the header even with an empty preset roster.
  it('keeps the presets group when it carries the refresh control', () => {
    render(<VoicePicker {...base} voices={[MINE]} onAddVoice={vi.fn()} onRefresh={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByRole('columnheader', { name: /presets/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument();
  });
});
