import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { compile } from 'sass';
import { resolve } from 'node:path';
import CaptionShareButton from './CaptionShareButton';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));
vi.mock('./CaptionSharePanel', () => ({
  __esModule: true,
  default: () => <div data-testid="caption-share-panel-marker" />,
}));

// size() clamps the floating wrapper's max-height to the room the window has;
// the panel must scroll inside that clamp, or on a short window its last
// controls (Stop sharing) fall off the bottom with no way to reach them.
// Asserted on the compiled CSS, as the display-settings popover's wrapper is.
// A leading newline so the first rule matches the same way as every other.
const css = '\n' + compile(resolve(__dirname, 'CaptionSharePanel.scss')).css;
const ruleBody = (selector: string): string | null => {
  const i = css.indexOf(`\n${selector} {`);
  if (i === -1) return null;
  const open = css.indexOf('{', i);
  return css.slice(open + 1, css.indexOf('}', open));
};

describe('caption share popover fits a short window', () => {
  it('wraps the panel in the clamped floating element', () => {
    render(<CaptionShareButton />);
    fireEvent.click(screen.getByRole('button'));
    const wrapper = screen.getByTestId('caption-share-panel-marker').parentElement;
    expect(wrapper?.classList.contains('caption-share-floating')).toBe(true);
  });

  it('lets the panel shrink to the clamp and scroll inside it', () => {
    const wrapper = ruleBody('.caption-share-floating');
    expect(wrapper).toMatch(/display:\s*flex/);
    expect(wrapper).toMatch(/min-height:\s*0/);
    const panel = ruleBody('.caption-share-floating .caption-share-panel');
    expect(panel).toMatch(/min-height:\s*0/);
    expect(panel).toMatch(/overflow-y:\s*auto/);
  });
});
