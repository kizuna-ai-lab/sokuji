import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { HoldToTalk } from './HoldToTalk';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_k: string, d?: string) => d ?? _k }) }));

describe('HoldToTalk', () => {
  it('presses on pointer down and releases on up, leave and cancel — once each', () => {
    const onPress = vi.fn();
    const onRelease = vi.fn();
    render(<HoldToTalk onPress={onPress} onRelease={onRelease} />);
    const button = screen.getByRole('button');
    for (const end of ['pointerUp', 'pointerLeave', 'pointerCancel'] as const) {
      fireEvent.pointerDown(button);
      expect(button.textContent).toBe('Release');
      fireEvent[end](button);
      expect(button.textContent).toBe('Hold');
    }
    fireEvent.pointerUp(button);
    expect(onPress).toHaveBeenCalledTimes(3);
    expect(onRelease).toHaveBeenCalledTimes(3);
  });

  it('releases a held button when it goes away', () => {
    const onRelease = vi.fn();
    const { unmount } = render(<HoldToTalk onPress={() => {}} onRelease={onRelease} />);
    fireEvent.pointerDown(screen.getByRole('button'));
    unmount();
    expect(onRelease).toHaveBeenCalledTimes(1);
  });
});
