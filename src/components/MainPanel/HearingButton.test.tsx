import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';

const state = vi.hoisted(() => ({
  value: {} as Record<string, unknown>,
  toggleThem: vi.fn(), toggleMe: vi.fn(),
}));
vi.mock('./useHearingRows', () => ({ useHearingRows: () => ({ ...state.value, toggleThem: state.toggleThem, toggleMe: state.toggleMe }) }));
vi.mock('../Settings/shared/OutletSelect', () => ({ OutletSelect: ({ label }: { label: string }) => <select aria-label={label} /> }));
vi.mock('../../app/useRun', () => ({ useSessionLocked: () => false }));

import { HearingButton } from './HearingButton';

const base = {
  mode: 'both', faceToFace: false, myLegRuns: true, theirLegRuns: true, otherOn: true, speech: 'optional', participantOffered: true,
  themOn: true, themLocked: false, recaptured: false, meChecked: false, meDisabled: false,
};

beforeEach(() => { state.value = { ...base }; state.toggleThem.mockClear(); state.toggleMe.mockClear(); });
afterEach(() => cleanup());

describe('the headphones entry', () => {
  it('opens a popover with the rows that apply, and is not itself a switch', () => {
    render(<HearingButton />);
    fireEvent.click(screen.getByRole('button', { name: 'What I hear' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getAllByRole('switch')).toHaveLength(2);
    expect(state.toggleThem).not.toHaveBeenCalled();
    expect(state.toggleMe).not.toHaveBeenCalled();
  });

  it('switches the spoken translation off and on during a session', () => {
    render(<HearingButton />);
    fireEvent.click(screen.getByRole('button', { name: 'What I hear' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Translation I hear' }));
    expect(state.toggleThem).toHaveBeenCalledTimes(1);
  });

  it('cannot turn on what was off at the start', () => {
    state.value = { ...base, themOn: false, themLocked: true };
    render(<HearingButton />);
    fireEvent.click(screen.getByRole('button', { name: 'What I hear' }));
    const sw = screen.getByRole('switch', { name: 'Translation I hear' });
    expect(sw).toBeDisabled();
    expect(sw).toHaveAttribute('title', 'Fixed for this session; stop it to change.');
  });

  it('shows crossed-out headphones when every row is off, and hides face to face', () => {
    state.value = { ...base, themOn: false, meChecked: false };
    const { container } = render(<HearingButton />);
    expect(container.querySelector('[data-hearing="off"]')).not.toBeNull();
    cleanup();
    state.value = { ...base, faceToFace: true };
    render(<HearingButton />);
    expect(screen.queryByRole('button', { name: 'What I hear' })).toBeNull();
  });
});

// PR review: a keyboard user reaches the popover's controls and comes back to the button.
describe('the headphones entry — keyboard', () => {
  it('moves focus into the popover on opening and back to the button on Esc', async () => {
    render(<HearingButton />);
    const button = screen.getByRole('button', { name: 'What I hear' });
    button.focus();
    fireEvent.click(button);
    const dialog = screen.getByRole('dialog');
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(button);
  });

  // Tab and Shift+Tab land on the focus guards Floating UI puts around the portalled popover (what a browser's
  // Tab does next); the guards pass the focus on as the tab order would run if the popover sat after the button.
  it('keeps the tab order: in from the button, through its controls, out to what follows the button', async () => {
    render(<div><button type="button">Before</button><HearingButton /><button type="button">Next</button></div>);
    const button = screen.getByRole('button', { name: 'What I hear' });
    // Enter and Space click a native button: the keyboard opens it as the pointer does.
    expect(button.tagName).toBe('BUTTON');
    button.focus();
    fireEvent.click(button);
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    const guards = () => [...document.querySelectorAll<HTMLElement>('[data-floating-ui-focus-guard]')];
    const inside = () => guards().filter((g) => dialog.parentElement?.contains(g) && !g.contains(dialog));
    const controls = [...dialog.querySelectorAll<HTMLElement>('button, select')];
    expect(controls.map((c) => c.getAttribute('aria-label') ?? c.textContent)).toEqual(['Translation I hear', 'Translation I hear', 'I hear it too', 'I hear it too', 'Audio settings']);
    // Shift+Tab from the first control: back to the button.
    act(() => { inside()[0].focus(); });
    await waitFor(() => expect(document.activeElement).toBe(button));
    // Tab from the button: into the popover's first control.
    act(() => { guards().find((g) => g.getAttribute('data-type') === 'outside')!.focus(); });
    await waitFor(() => expect(document.activeElement).toBe(controls[0]));
    // Tab from the last control: out to what follows the button.
    act(() => { const all = inside(); all[all.length - 1].focus(); });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Next' })));
  });
});
