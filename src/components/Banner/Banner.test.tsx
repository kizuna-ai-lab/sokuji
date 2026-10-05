import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { Banner } from './Banner';

afterEach(cleanup);

describe('Banner', () => {
  it('draws the tone as a class, the text, one action and a dismiss', () => {
    const onClick = vi.fn(); const onDismiss = vi.fn();
    const { container } = render(
      <Banner id="x" tone="attention" icon={<i data-testid="icon" />} text="body" action={{ label: 'Repair', onClick }} onDismiss={onDismiss} dismissLabel="Dismiss" />,
    );
    const root = container.querySelector('.banner');
    expect(root?.className).toBe('banner banner--attention');
    expect(root?.querySelector('.banner__text')?.textContent).toBe('body');
    fireEvent.click(root!.querySelector('.banner__btn')!);
    expect(onClick).toHaveBeenCalledTimes(1);
    const dismiss = root!.querySelector('.banner__dismiss') as HTMLButtonElement;
    expect(dismiss.getAttribute('aria-label')).toBe('Dismiss');
    fireEvent.click(dismiss);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('a busy action is disabled; no onDismiss means no dismiss button; progress draws a bar', () => {
    const { container } = render(
      <Banner id="x" tone="brand" icon={null} text="downloading" action={{ label: 'Wait', onClick: vi.fn(), busy: true }} progress={42} dismissLabel="Dismiss" />,
    );
    expect((container.querySelector('.banner__btn') as HTMLButtonElement).disabled).toBe(true);
    expect(container.querySelector('.banner__dismiss')).toBeNull();
    expect((container.querySelector('.banner__progress-fill') as HTMLElement).style.width).toBe('42%');
  });

  // The stylesheet centres a line by trimming its own box (bannerTextCentre.test.ts),
  // which cannot reach bare text inside a flex container: every line needs an element.
  it('gives the action’s label its own element, beside the icon', () => {
    const { container } = render(
      <Banner id="x" tone="attention" icon={null} text="body" action={{ label: 'Repair', icon: <i data-testid="wrench" />, onClick: vi.fn() }} dismissLabel="Dismiss" />,
    );
    const button = container.querySelector('.banner__btn') as HTMLButtonElement;
    expect(button.querySelector('.banner__btn-label')?.textContent).toBe('Repair');
    expect(button.querySelector('[data-testid="wrench"]')).not.toBeNull();
    expect(button.textContent).toBe('Repair');
  });

  it('wraps words given as a plain string in an element', () => {
    const { container } = render(<Banner id="x" tone="brand" icon={null} text="New version available" dismissLabel="Dismiss" />);
    const text = container.querySelector('.banner__text') as HTMLElement;
    expect(text.children).toHaveLength(1);
    expect(text.firstElementChild?.tagName).toBe('SPAN');
    expect(text.firstElementChild?.textContent).toBe('New version available');
  });

  it('draws words given as elements as they are, with no extra wrapper', () => {
    const { container } = render(
      <Banner id="x" tone="attention" icon={null} text={<><span>Install it:</span><code className="banner__code">apt install x</code></>} dismissLabel="Dismiss" />,
    );
    const text = container.querySelector('.banner__text') as HTMLElement;
    expect([...text.children].map((el) => el.tagName)).toEqual(['SPAN', 'CODE']);
  });
});
