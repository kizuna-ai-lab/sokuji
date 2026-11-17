// The question when the app is closed while notes are being written.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import '../../locales';
import { askQuitWhileNotes, useQuitQuestion } from '../../lib/notes/quitQuestion';
import NotesQuitDialog from './NotesQuitDialog';

const START = new Date(2026, 0, 15, 9, 0, 0).getTime();

afterEach(() => { cleanup(); useQuitQuestion.setState({ asking: null }); });

describe('quitting while notes are written', () => {
  it('shows nothing until asked', () => {
    render(<NotesQuitDialog />);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('names the record, says the notes will be cancelled, and answers Quit or Stay', async () => {
    render(<NotesQuitDialog />);
    let answer: Promise<string> = Promise.resolve('');
    act(() => { answer = askQuitWhileNotes([{ title: 'Supplier sync', startedAt: START }]); });
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Notes are being written for “Supplier sync”. Quit anyway? They will be marked cancelled.');
    fireEvent.click(screen.getByRole('button', { name: 'Stay' }));
    await expect(answer).resolves.toBe('stay');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    act(() => { answer = askQuitWhileNotes([]); });
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Notes are being written. Quit anyway? They will be marked cancelled.');
    fireEvent.click(screen.getByRole('button', { name: 'Quit' }));
    await expect(answer).resolves.toBe('quit');
  });

  // A record nobody renamed has no title of its own: the question names it as History does, by when it started.
  it('names a record with no title of its own by its date and time, as History shows it', () => {
    render(<NotesQuitDialog />);
    act(() => { void askQuitWhileNotes([{ title: null, startedAt: START }]); });
    const when = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(START);
    expect(screen.getByRole('alertdialog')).toHaveTextContent(`Notes are being written for “${when}”. Quit anyway? They will be marked cancelled.`);
  });

  it('is named by its question', () => {
    render(<NotesQuitDialog />);
    act(() => { void askQuitWhileNotes([]); });
    expect(screen.getByRole('alertdialog', { name: 'Notes are being written. Quit anyway? They will be marked cancelled.' })).toBeInTheDocument();
  });

  it('keeps Tab inside the question', () => {
    render(<NotesQuitDialog />);
    act(() => { void askQuitWhileNotes([]); });
    const quit = screen.getByRole('button', { name: 'Quit' });
    const stay = screen.getByRole('button', { name: 'Stay' });
    expect(stay).toHaveFocus();
    fireEvent.keyDown(stay, { key: 'Tab' });
    expect(quit).toHaveFocus();
    fireEvent.keyDown(quit, { key: 'Tab', shiftKey: true });
    expect(stay).toHaveFocus();
  });

  it('gives focus back to where it was after Stay', () => {
    render(<><button type="button">Before</button><NotesQuitDialog /></>);
    const before = screen.getByRole('button', { name: 'Before' });
    before.focus();
    act(() => { void askQuitWhileNotes([]); });
    expect(screen.getByRole('button', { name: 'Stay' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Stay' }));
    expect(before).toHaveFocus();
  });
});
