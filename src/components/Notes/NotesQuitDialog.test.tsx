// The question when the app is closed while notes are being written.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import '../../locales';
import { askQuitWhileNotes, useQuitQuestion } from '../../lib/notes/quitQuestion';
import NotesQuitDialog from './NotesQuitDialog';

afterEach(() => { cleanup(); useQuitQuestion.setState({ asking: null }); });

describe('quitting while notes are written', () => {
  it('shows nothing until asked', () => {
    render(<NotesQuitDialog />);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('names the record, says the notes will be cancelled, and answers Quit or Stay', async () => {
    render(<NotesQuitDialog />);
    let answer: Promise<string> = Promise.resolve('');
    act(() => { answer = askQuitWhileNotes(['Supplier sync']); });
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Notes are being written for “Supplier sync”. Quit anyway? They will be marked cancelled.');
    fireEvent.click(screen.getByRole('button', { name: 'Stay' }));
    await expect(answer).resolves.toBe('stay');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    act(() => { answer = askQuitWhileNotes([]); });
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Notes are being written. Quit anyway? They will be marked cancelled.');
    fireEvent.click(screen.getByRole('button', { name: 'Quit' }));
    await expect(answer).resolves.toBe('quit');
  });
});
