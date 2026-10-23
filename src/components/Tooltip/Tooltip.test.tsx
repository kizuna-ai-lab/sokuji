import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { CircleHelp } from 'lucide-react';
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

describe('Tooltip trigger reaches the keyboard', () => {
  it('a help icon gets a tab stop and a name, and its tooltip opens on focus', async () => {
    render(
      <Tooltip content="Applies from the next session.">
        <CircleHelp className="tooltip-trigger" size={14} />
      </Tooltip>
    );
    const icon = screen.getByRole('img', { name: 'Help' });
    expect(icon).toHaveAttribute('tabindex', '0');
    expect(icon).not.toHaveAttribute('aria-hidden');
    fireEvent.focus(icon);
    await waitFor(() => expect(screen.getByText('Applies from the next session.')).toBeInTheDocument());
  });

  it("the tooltip's own icon does too", () => {
    render(<Tooltip content="own-icon-tip" />);
    const icon = screen.getByRole('img', { name: 'Help' });
    expect(icon).toHaveAttribute('tabindex', '0');
    expect(icon).not.toHaveAttribute('aria-hidden');
  });

  it('a trigger with text of its own gets a tab stop and keeps its text as its name', () => {
    render(<Tooltip content="chip-tip"><span className="chip">Multi</span></Tooltip>);
    const chip = screen.getByText('Multi');
    expect(chip).toHaveAttribute('tabindex', '0');
    expect(chip).not.toHaveAttribute('aria-label');
    expect(chip).not.toHaveAttribute('role');
  });

  it('a control, or a label around one, is left as it is: no second tab stop', () => {
    render(
      <>
        <Tooltip content="button-tip"><button>go</button></Tooltip>
        <Tooltip content="label-tip"><label>Language <select aria-label="Language"><option>en</option></select></label></Tooltip>
      </>
    );
    const button = screen.getByRole('button', { name: 'go' });
    expect(button).not.toHaveAttribute('tabindex');
    expect(button).not.toHaveAttribute('aria-label');
    const label = screen.getByText(/^Language/);
    expect(label.tagName).toBe('LABEL');
    expect(label).not.toHaveAttribute('tabindex');
  });

  it("the caller's own tab stop and name win", () => {
    render(<Tooltip content="own-tip"><CircleHelp tabIndex={-1} aria-label="About the pause" /></Tooltip>);
    const icon = screen.getByLabelText('About the pause');
    expect(icon).toHaveAttribute('tabindex', '-1');
  });
});
