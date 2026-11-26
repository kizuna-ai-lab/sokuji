import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { GradeHelp, SpeedHelp } from './AsrFactsHelp';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string, opts?: Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback.replace(/\{\{(\w+)\}\}/g, (_m, n) => String(opts?.[n] ?? '')) : _k,
    i18n: { language: 'en' },
  }),
}));

const rows = (help: HTMLElement) => within(help).getAllByRole('row').map((r) => r.textContent?.trim());
const marked = (help: HTMLElement) => help.querySelector('.asr-scale__row--this')?.textContent?.trim();

// Each tooltip says what every letter and every step of the scale means, and where this model sits (owner, 2026-11-27).
describe('AsrFactsHelp — what a grade and a speed mean', () => {
  it('gives the measured error rate, every letter with its error rate, and the sub-grades of this letter', () => {
    render(<GradeHelp language="English" grade="B+" error={5.83} />);
    const help = screen.getByTestId('grade-help');
    expect(help).toHaveTextContent('Accuracy in English: B+');
    expect(help).toHaveTextContent('Measured error rate: 5.8%');
    expect(rows(help)).toEqual(['Aunder 5%', 'B5–10%', 'C10–20%', 'D20–30%', 'F30% or more']);
    expect(marked(help)).toBe('B5–10%');
    expect(help).toHaveTextContent('B+ is 5–6.3%, B 6.3–7.9%, B- 7.9–10%');
  });

  it('shows the scale with nothing marked where the language was not measured, and no sub-grades for D or F', () => {
    const { unmount } = render(<GradeHelp language="Japanese" grade={undefined} error={undefined} />);
    let help = screen.getByTestId('grade-help');
    expect(help).toHaveTextContent('Accuracy in Japanese was not measured');
    expect(help).not.toHaveTextContent('Measured');
    expect(rows(help)).toHaveLength(5);
    expect(marked(help)).toBeUndefined();
    unmount();
    render(<GradeHelp language="German" grade="D" error={24} />);
    help = screen.getByTestId('grade-help');
    expect(marked(help)).toBe('D20–30%');
    expect(help).not.toHaveTextContent('split in three');
  });

  it('gives the measured time and every step with its time limit, fastest first, marking this model', () => {
    render(<SpeedHelp level={2} waitSeconds={7.42} />);
    const help = screen.getByTestId('speed-help');
    expect(help).toHaveTextContent('Speed: 2 of 5');
    expect(help).toHaveTextContent('Measured: 7.4 s to process the 30-second recording');
    expect(rows(help)).toEqual(['within 1.5 s', 'within 3 s', 'within 5 s', 'within 10 s', 'within 20 s', 'over 20 s']);
    expect(marked(help)).toBe('within 10 s');
    // Each row is named by its step count for assistive tech; the meter beside it is drawn with that many lit.
    const row = within(help).getAllByRole('row')[3];
    expect(within(row).getByRole('rowheader')).toHaveAttribute('aria-label', 'Speed: 2 of 5');
    expect(row.querySelectorAll('i.on')).toHaveLength(2);
  });

  it('marks no step when the speed was not measured', () => {
    render(<SpeedHelp level={undefined} waitSeconds={undefined} />);
    const help = screen.getByTestId('speed-help');
    expect(help).toHaveTextContent('Speed was not measured');
    expect(marked(help)).toBeUndefined();
  });
});
