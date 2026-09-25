import { act, render, screen } from '@testing-library/react';
import { useTranslation } from 'react-i18next';
import { describe, expect, it } from 'vitest';
import i18n from './index';

function Greeting() {
  const { t } = useTranslation();
  return <span data-testid="greeting">{t('bundleRerenderProbe.greeting', 'Hello')}</span>;
}

/**
 * A language's bundle arrives after the first render: `index.ts` loads the
 * detected language in the background. Whatever `useTranslation` already
 * mounted must redraw in it then — the extension overlay, idle after a stop,
 * has nothing else that would ever redraw it (plan 1e-4 Task 9).
 */
describe('a bundle added after the first render', () => {
  it('redraws what useTranslation mounted, with no other re-render', () => {
    render(<Greeting />);
    expect(screen.getByTestId('greeting').textContent).toBe('Hello');

    act(() => {
      i18n.addResourceBundle(i18n.language, 'translation', { bundleRerenderProbe: { greeting: 'Bonjour' } }, true, true);
    });

    expect(screen.getByTestId('greeting').textContent).toBe('Bonjour');
  });
});
