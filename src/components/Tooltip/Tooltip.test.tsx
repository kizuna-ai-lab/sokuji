import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { createPortal } from 'react-dom';
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

describe('Tooltip whose trigger lives in another document', () => {
  // The subtitle bar hosts its popovers in child BrowserWindows and portals
  // React into them, so one React tree can span two documents. A tooltip that
  // portalled to THIS document's body would be painted in the wrong window
  // entirely — and positioned with the wrong window's coordinates. An iframe
  // document stands in for the child window here: same "separate document,
  // same React tree" shape, and it works in jsdom.
  it('portals into the trigger\'s own document, not the host one', async () => {
    const frame = document.createElement('iframe');
    document.body.appendChild(frame);
    const otherDoc = frame.contentDocument!;

    render(
      createPortal(
        <Tooltip content="other-doc-tip" trigger="hover" openDelay={0}>
          <button>other-doc-trigger</button>
        </Tooltip>,
        otherDoc.body,
      ),
    );

    const button = otherDoc.body.querySelector('button')!;
    expect(button).not.toBeNull();
    fireEvent.mouseEnter(button);

    await waitFor(() => {
      expect(otherDoc.body.textContent).toContain('other-doc-tip');
    });
    // Nothing leaked into the hosting document — an iframe's content is not
    // part of its parent's text, so a stray portal here would show up.
    expect(document.body.textContent).not.toContain('other-doc-tip');
    // The frame is deliberately left in place: tearing down the document a
    // live portal points into makes React's unmount throw.
  });
});
