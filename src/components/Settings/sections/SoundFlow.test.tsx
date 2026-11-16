// The audio page's "where the sound goes" drawing (mock v18; the owner chose it for wide windows, 2026-11-15): who
// hears what, its lines lit while on and dashed while off, following the switches below it.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { SoundFlow, type SoundFlowProps } from './SoundFlow';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, d?: string, o?: Record<string, string>) => (d ?? _k).replace(/\{\{(\w+)\}\}/g, (_m, n: string) => o?.[n] ?? '') }),
}));

afterEach(() => cleanup());

const ALL_ON: SoundFlowProps = { mine: true, theirs: true, otherHears: true, meToo: true, passthroughOn: true, passthroughPercent: 30, iHear: true };
const leg = (container: HTMLElement, name: string) => container.querySelector(`[data-leg="${name}"]`)!;

describe('SoundFlow', () => {
  it('draws both sides, each line lit while its switch is on', () => {
    const { container } = render(<SoundFlow {...ALL_ON} />);
    for (const name of ['otherHears', 'meToo', 'passthrough', 'iHear']) expect(leg(container, name)).toHaveClass('is-on');
    expect(container.textContent).toContain('Passthrough 30%');
    expect(container.querySelector('svg')).toHaveAttribute('role', 'img');
  });

  it('dashes a line whose switch is off', () => {
    const { container } = render(<SoundFlow {...ALL_ON} meToo={false} passthroughOn={false} iHear={false} />);
    expect(leg(container, 'meToo')).toHaveClass('is-off');
    expect(leg(container, 'passthrough')).toHaveClass('is-off');
    expect(leg(container, 'iHear')).toHaveClass('is-off');
    expect(leg(container, 'otherHears')).toHaveClass('is-on');
  });

  // Owner, 2026-11-15: translating and turning the translation into speech are two steps; with a side's speech switch
  // off the translation is still made, only no speech, so the line from one to the other is dashed.
  it('draws translating and making speech as two steps on each side, the line between them following the speech switch', () => {
    const { container } = render(<SoundFlow {...ALL_ON} otherHears={false} />);
    for (const side of ['mine', 'theirs']) {
      const boxes = [...container.querySelectorAll(`[data-side="${side}"] .sound-flow__box`)].map((b) => b.textContent);
      expect(boxes, side).toEqual(expect.arrayContaining(['Translate', 'Speech']));
    }
    expect(leg(container, 'mineSpeech')).toHaveClass('is-off');
    expect(leg(container, 'theirSpeech')).toHaveClass('is-on');
    const { container: off } = render(<SoundFlow {...ALL_ON} iHear={false} />);
    expect(leg(off, 'mineSpeech')).toHaveClass('is-on');
    expect(leg(off, 'theirSpeech')).toHaveClass('is-off');
  });

  it("greys the side the mode does not use", () => {
    const { container } = render(<SoundFlow {...ALL_ON} theirs={false} />);
    expect(container.querySelector('[data-side="theirs"]')).toHaveClass('is-unused');
    expect(container.querySelector('[data-side="mine"]')).not.toHaveClass('is-unused');
  });

  it('says what the drawing shows under it', () => {
    const { container } = render(<SoundFlow {...ALL_ON} />);
    expect(container.querySelector('figcaption')?.textContent).toMatch(/Lit lines are on now/);
  });
});

// B-28: passthrough's volume is on the drawing whether it is on or off, as its row shows it.
describe('SoundFlow — passthrough volume (B-28)', () => {
  it('names passthrough with its volume while it is off too', () => {
    const { container } = render(<SoundFlow {...ALL_ON} passthroughOn={false} passthroughPercent={25} />);
    expect(leg(container, 'passthrough')).toHaveClass('is-off');
    expect(container.textContent).toContain('Passthrough 25%');
  });
});

// B-27: a part of the drawing that has a setting below takes you to it — by mouse or keyboard, whatever the setting's
// state — and changes nothing itself.
describe('SoundFlow — going to a setting (B-27)', () => {
  const GO = {
    microphone: 'Go to the “My microphone” setting',
    participant: 'Go to the “The other side\'s voice” setting',
    'speech-other-hears': 'Go to the “Translation the other side hears” setting',
    'speech-me-too': 'Go to the “I hear it too” setting',
    'speech-passthrough': 'Go to the “Passthrough” setting',
    'speech-i-hear': 'Go to the “Translation I hear” setting',
  } as const;

  it('offers each part that has a setting, named for where it goes', () => {
    render(<SoundFlow {...ALL_ON} onGo={() => {}} />);
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label')).sort()).toEqual(Object.values(GO).sort());
    for (const button of screen.getAllByRole('button')) {
      expect(button).toHaveAttribute('tabindex', '0');
      // The tip on hover says where it goes.
      expect(button.querySelector('title')?.textContent).toBe(button.getAttribute('aria-label'));
    }
  });

  it('goes there on a click, on Enter and on Space', () => {
    const onGo = vi.fn();
    render(<SoundFlow {...ALL_ON} onGo={onGo} />);
    for (const [target, name] of Object.entries(GO)) {
      fireEvent.click(screen.getByRole('button', { name }));
      expect(onGo).toHaveBeenLastCalledWith(target);
    }
    fireEvent.keyDown(screen.getByRole('button', { name: GO['speech-me-too'] }), { key: 'Enter' });
    expect(onGo).toHaveBeenLastCalledWith('speech-me-too');
    fireEvent.keyDown(screen.getByRole('button', { name: GO.participant }), { key: ' ' });
    expect(onGo).toHaveBeenLastCalledWith('participant');
    fireEvent.keyDown(screen.getByRole('button', { name: GO.microphone }), { key: 'a' });
    expect(onGo).toHaveBeenCalledTimes(Object.keys(GO).length + 2);
  });

  it('goes to a setting that is off, or on a side the mode does not use', () => {
    const onGo = vi.fn();
    render(<SoundFlow {...ALL_ON} theirs={false} iHear={false} passthroughOn={false} onGo={onGo} />);
    fireEvent.click(screen.getByRole('button', { name: GO['speech-i-hear'] }));
    expect(onGo).toHaveBeenLastCalledWith('speech-i-hear');
    fireEvent.click(screen.getByRole('button', { name: GO['speech-passthrough'] }));
    expect(onGo).toHaveBeenLastCalledWith('speech-passthrough');
  });

  it('offers no way to passthrough without a virtual microphone, where it has no row', () => {
    render(<SoundFlow {...ALL_ON} virtualBus={false} onGo={() => {}} />);
    expect(screen.queryByRole('button', { name: GO['speech-passthrough'] })).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(5);
  });

  it('is a picture only when nothing takes it anywhere', () => {
    const { container } = render(<SoundFlow {...ALL_ON} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(container.querySelector('svg')).toHaveAttribute('role', 'img');
  });

  it('keeps its description when it can take you somewhere', () => {
    const { container } = render(<SoundFlow {...ALL_ON} onGo={() => {}} />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('role', 'group');
    expect(svg.getAttribute('aria-label')).toMatch(/^Where the sound goes/);
  });
});
