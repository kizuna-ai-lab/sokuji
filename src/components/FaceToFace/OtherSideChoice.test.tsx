import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import OtherSideChoice from './OtherSideChoice';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, def?: string) => def ?? key }),
}));

const store = { otherSide: 'meeting' as 'meeting' | 'beside', setOtherSide: vi.fn() };
vi.mock('../../stores/audioStore', () => ({
  useOtherSide: () => store.otherSide,
  useSetOtherSide: () => store.setOtherSide,
}));

beforeEach(() => {
  store.otherSide = 'meeting';
  store.setOtherSide.mockReset();
});

describe('OtherSideChoice', () => {
  it('shows both tiles with their hints', () => {
    render(<OtherSideChoice locked={false} />);
    expect(screen.getByRole('radio', { name: /In a meeting/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Beside me/ })).toBeInTheDocument();
    expect(screen.getByText('Captures the system audio or an app')).toBeInTheDocument();
    expect(screen.getByText('Two people at one microphone')).toBeInTheDocument();
  });

  it('checks the tile the store holds', () => {
    store.otherSide = 'beside';
    render(<OtherSideChoice locked={false} />);
    expect(screen.getByRole('radio', { name: /Beside me/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /In a meeting/ })).not.toBeChecked();
  });

  it('writes the choice on a click', () => {
    render(<OtherSideChoice locked={false} />);
    fireEvent.click(screen.getByRole('radio', { name: /Beside me/ }));
    expect(store.setOtherSide).toHaveBeenCalledWith('beside');
  });

  it("locked: both radios are disabled with the mode picker's words, and a click writes nothing", () => {
    render(<OtherSideChoice locked={true} />);
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).toBeDisabled();
      expect(radio.closest('label')?.getAttribute('title')).toBe('Mode is locked during a session.');
    }
    fireEvent.click(screen.getByRole('radio', { name: /In a meeting/ }));
    expect(store.setOtherSide).not.toHaveBeenCalled();
  });

  it('labels the group by its visible heading', () => {
    render(<OtherSideChoice locked={false} />);
    const group = screen.getByRole('radiogroup', { name: 'Other side' });
    expect(group.hasAttribute('aria-label')).toBe(false);
    const heading = document.getElementById(group.getAttribute('aria-labelledby')!);
    expect(heading?.textContent).toBe('Other side');
    expect(heading?.closest('[role="radiogroup"]')).toBeNull();
  });

  it('gives each instance its own radio group', () => {
    store.otherSide = 'beside';
    render(<><OtherSideChoice locked={false} /><OtherSideChoice locked={false} /></>);
    const [first, second] = screen.getAllByRole('radiogroup').map((g) => Array.from(g.querySelectorAll('input')));
    expect(first[0].name).not.toBe(second[0].name);
    expect(first[0].name).toBe(first[1].name);
    // Each copy shows the store's choice though both are mounted at once.
    expect(first[1]).toBeChecked();
    expect(second[1]).toBeChecked();
    expect(first[0]).not.toBeChecked();
  });
});
