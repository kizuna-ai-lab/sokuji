import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../../../locales/en/translation.json';
import { ScreenContextChip, type ScreenContextChipProps } from './ScreenContextChip';

// The real English catalog, so every assertion below is the copy a user reads, looked up by its key.
beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: 'en',
    resources: { en: { translation: en } },
    interpolation: { escapeValue: false },
    showSupportNotice: false,
  });
});

afterEach(() => {
  cleanup();
});

const props = (over: Partial<ScreenContextChipProps> = {}): ScreenContextChipProps => ({
  name: 'Slides',
  kind: 'window',
  status: 'live',
  sentCount: 12,
  lastSentAt: 7_000,
  now: 10_000,
  thumbnail: 'blob:thumb-1',
  iconOnly: false,
  onChooseAgain: vi.fn(),
  ...over,
});

const chip = (status = 'Live') => screen.getByRole('button', { name: `Screen context: Slides, ${status}` });
const dot = (el: HTMLElement) => el.querySelector('.screen-context-chip__dot') as HTMLElement;

describe('ScreenContextChip', () => {
  it('names the source with a green dot while live, amber when unchanged, red and Not available when lost', () => {
    const { rerender } = render(<ScreenContextChip {...props()} />);
    expect(chip().textContent).toContain('Slides');
    expect(dot(chip()).classList.contains('live')).toBe(true);

    rerender(<ScreenContextChip {...props({ status: 'stale' })} />);
    expect(dot(chip('Unchanged')).classList.contains('stale')).toBe(true);
    expect(chip('Unchanged').textContent).toContain('Unchanged');

    rerender(<ScreenContextChip {...props({ status: 'lost' })} />);
    expect(dot(chip('Not available')).classList.contains('lost')).toBe(true);
    expect(chip('Not available').textContent).toContain('Not available');
  });

  it('icon-only hides the name but keeps the accessible label', () => {
    render(<ScreenContextChip {...props({ iconOnly: true })} />);
    expect(chip().textContent).not.toContain('Slides');
    expect(chip().getAttribute('aria-label')).toBe('Screen context: Slides, Live');
    expect(dot(chip()).classList.contains('live')).toBe(true);
  });

  it('the card shows the thumbnail, the frames sent and a Choose again that calls back', () => {
    const p = props();
    render(<ScreenContextChip {...p} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(chip());
    const card = screen.getByRole('dialog');
    expect(within(card).getByRole('img', { name: 'Slides' })).toHaveAttribute('src', 'blob:thumb-1');
    expect(card.textContent).toContain('Slides');
    expect(card.textContent).toContain('Frames sent: 12');
    expect(card.textContent).toContain('Last frame 3 s ago');
    fireEvent.click(within(card).getByRole('button', { name: 'Choose again' }));
    expect(p.onChooseAgain).toHaveBeenCalledTimes(1);
  });

  it('the card opens on hover too', async () => {
    render(<ScreenContextChip {...props()} />);
    fireEvent.mouseEnter(chip());
    expect(await screen.findByRole('dialog')).toBeTruthy();
  });

  it('restarts the dot on every frame sent, so it pulses once per frame', () => {
    const { rerender } = render(<ScreenContextChip {...props()} />);
    const before = dot(chip());
    rerender(<ScreenContextChip {...props()} />);
    expect(dot(chip())).toBe(before);
    rerender(<ScreenContextChip {...props({ sentCount: 13 })} />);
    expect(dot(chip())).not.toBe(before);
  });

  it('when lost the card says the last picture is kept until Choose again, which it offers; without a frame or a sending time it shows neither', () => {
    render(<ScreenContextChip {...props({ status: 'lost', thumbnail: null, lastSentAt: null })} />);
    fireEvent.click(chip('Not available'));
    const card = screen.getByRole('dialog');
    expect(card.textContent).toContain('The source is gone; the last picture is kept until you choose again.');
    expect(within(card).getByRole('button', { name: 'Choose again' })).toBeTruthy();
    expect(card.textContent).not.toContain("The meeting tab's picture");
    expect(within(card).queryByRole('img')).toBeNull();
    expect(card.textContent).not.toContain('Last frame');
  });

  it('offers no Choose again where nothing can be chosen again', () => {
    render(<ScreenContextChip {...props({ onChooseAgain: undefined })} />);
    fireEvent.click(chip());
    expect(within(screen.getByRole('dialog')).queryByRole('button', { name: 'Choose again' })).toBeNull();
  });

  it('lost where nothing can be chosen again (the extension), the card says translation goes on on audio, and never to choose again', () => {
    render(<ScreenContextChip {...props({ status: 'lost', kind: 'tab', onChooseAgain: undefined })} />);
    fireEvent.click(chip('Not available'));
    const card = screen.getByRole('dialog');
    expect(card.textContent).toContain("The meeting tab's picture is no longer available; translation continues on audio alone.");
    expect(card.textContent).not.toContain('choose again');
    expect(within(card).queryByRole('button')).toBeNull();
  });
});
