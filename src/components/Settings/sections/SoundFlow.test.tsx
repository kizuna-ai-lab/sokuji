// The audio page's "where the sound goes" drawing (mock v18; the owner chose it for wide windows, 2026-11-15): who
// hears what, its lines lit while on and dashed while off, following the switches below it.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { SoundFlow, type SoundFlowProps } from './SoundFlow';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, d?: string, o?: Record<string, string>) => (d ?? _k).replace(/\{\{(\w+)\}\}/g, (_m, n: string) => o?.[n] ?? '') }),
}));

afterEach(() => cleanup());

const ALL_ON: SoundFlowProps = { mine: true, theirs: true, otherHears: true, meToo: true, passthrough: 30, iHear: true };
const leg = (container: HTMLElement, name: string) => container.querySelector(`[data-leg="${name}"]`)!;

describe('SoundFlow', () => {
  it('draws both sides, each line lit while its switch is on', () => {
    const { container } = render(<SoundFlow {...ALL_ON} />);
    for (const name of ['otherHears', 'meToo', 'passthrough', 'iHear']) expect(leg(container, name)).toHaveClass('is-on');
    expect(container.textContent).toContain('Passthrough 30%');
    expect(container.querySelector('svg')).toHaveAttribute('role', 'img');
  });

  it('dashes a line whose switch is off', () => {
    const { container } = render(<SoundFlow {...ALL_ON} meToo={false} passthrough={null} iHear={false} />);
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
