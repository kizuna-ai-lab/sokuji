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

  it('opens what it has to open when its icon or words are pressed, with the keyboard too, and not when its buttons are', () => {
    const onOpen = vi.fn(); const onClick = vi.fn(); const onDismiss = vi.fn();
    const { container } = render(
      <Banner id="update" tone="brand" icon={<i data-testid="icon" />} text="New version" action={{ label: 'Download Now', onClick }} onDismiss={onDismiss} dismissLabel="Dismiss" onOpen={onOpen} />,
    );
    const content = container.querySelector('.banner__content') as HTMLElement;
    expect(content.getAttribute('role')).toBe('button');
    expect(content.tabIndex).toBe(0);
    fireEvent.click(container.querySelector('.banner__text')!);
    fireEvent.keyDown(content, { key: 'Enter' });
    fireEvent.keyDown(content, { key: ' ' });
    fireEvent.keyDown(content, { key: 'a' });
    expect(onOpen).toHaveBeenCalledTimes(3);
    fireEvent.click(container.querySelector('.banner__btn')!);
    fireEvent.click(container.querySelector('.banner__dismiss')!);
    expect(onOpen).toHaveBeenCalledTimes(3);
  });

  it('is not pressed anywhere but its buttons when it has nothing to open', () => {
    const { container } = render(<Banner id="x" tone="attention" icon={<i />} text="body" dismissLabel="Dismiss" />);
    const content = container.querySelector('.banner__content') as HTMLElement;
    expect(content.className).toBe('banner__content');
    expect(content.getAttribute('role')).toBeNull();
    expect(content.getAttribute('tabindex')).toBeNull();
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
