import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import Tooltip from './Tooltip';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, d?: string) => d ?? _k }),
}));

describe('Tooltip trigger ref handling (React 19 ref-as-prop)', () => {
  it('opens on hover when the trigger child carries its own ref, and still forwards it', async () => {
    const callerRef = createRef<HTMLButtonElement>();
    render(
      <Tooltip content="tip-text" trigger="hover" openDelay={0}>
        <button ref={callerRef}>trigger</button>
      </Tooltip>
    );

    const button = screen.getByRole('button', { name: 'trigger' });

    // The caller's own ref must survive the cloneElement merge…
    expect(callerRef.current).toBe(button);

    // …and the floating-ui anchor ref must too: without it the hover
    // interaction never attaches and the tooltip cannot open.
    fireEvent.mouseEnter(button);
    await waitFor(() => {
      expect(screen.getByText('tip-text')).toBeInTheDocument();
    });
  });

  it('closes when its panel hides inside an <Activity> (no frozen tooltip on reveal)', async () => {
    const { Activity } = await import('react');
    const ui = (mode: 'visible' | 'hidden') => (
      <Activity mode={mode}>
        <Tooltip content="hidden-tip" trigger="hover" openDelay={0}>
          <button>host</button>
        </Tooltip>
      </Activity>
    );
    const { rerender } = render(ui('visible'));
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'host' }));
    await waitFor(() => expect(screen.getByText('hidden-tip')).toBeInTheDocument());

    rerender(ui('hidden'));
    rerender(ui('visible'));
    expect(screen.queryByText('hidden-tip')).toBeNull();
  });

  it('opens on hover for a plain ref-less child', async () => {
    render(
      <Tooltip content="plain-tip" trigger="hover" openDelay={0}>
        <button>plain</button>
      </Tooltip>
    );
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'plain' }));
    await waitFor(() => {
      expect(screen.getByText('plain-tip')).toBeInTheDocument();
    });
  });
});
