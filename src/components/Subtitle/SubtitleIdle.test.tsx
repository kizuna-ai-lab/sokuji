import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import SubtitleIdle from './SubtitleIdle';

// i18n: return the default string passed to t(key, default).
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, d?: string, params?: Record<string, unknown>) =>
      typeof d === 'string' && params
        ? d.replace(/\{\{(\w+)\}\}/g, (_m, name) => String(params[name] ?? ''))
        : d ?? _k,
  }),
}));

const handlers = () => ({
  onStart: vi.fn(), onReturn: vi.fn(), allowSessionControl: true, canStart: true,
});

beforeEach(cleanup);

describe('SubtitleIdle ready state', () => {
  it('offers an enabled start action', () => {
    const h = handlers();
    render(<SubtitleIdle state={{ kind: 'ready' }} {...h} />);
    const btn = screen.getByRole('button', { name: /start translating/i });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    expect(h.onStart).toHaveBeenCalledTimes(1);
  });

  it('hints that the window can be positioned first', () => {
    render(<SubtitleIdle state={{ kind: 'ready' }} {...handlers()} />);
    expect(screen.getByText(/position/i)).toBeInTheDocument();
  });
});

describe('SubtitleIdle ended state', () => {
  it('says the session ended but still offers start', () => {
    const h = handlers();
    render(<SubtitleIdle state={{ kind: 'ended' }} {...h} />);
    expect(screen.getByText(/session has ended/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /start translating/i }));
    expect(h.onStart).toHaveBeenCalledTimes(1);
  });
});

describe('SubtitleIdle starting state', () => {
  it('shows progress and disables the action', () => {
    render(<SubtitleIdle state={{ kind: 'starting', completed: 3, total: 5 }} {...handlers()} />);
    expect(screen.getByText(/3\/5/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /loading/i })).toBeDisabled();
  });

  it('falls back to a generic connecting label without progress', () => {
    render(<SubtitleIdle state={{ kind: 'starting' }} {...handlers()} />);
    expect(screen.getByRole('button', { name: /connecting/i })).toBeDisabled();
  });
});

describe('SubtitleIdle failed state', () => {
  it('shows the error text on a single line and offers retry', () => {
    const h = handlers();
    render(<SubtitleIdle state={{ kind: 'failed', message: 'Network connection error' }} {...h} />);
    const error = screen.getByText(/Network connection error/);
    expect(error.className).toContain('subtitle-idle__error');
    const retry = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(retry);
    expect(h.onStart).toHaveBeenCalledTimes(1);
  });

  it('points at the main window for the full error', () => {
    const h = handlers();
    render(<SubtitleIdle state={{ kind: 'failed', message: 'boom' }} {...h} />);
    fireEvent.click(screen.getByRole('button', { name: /details/i }));
    expect(h.onReturn).toHaveBeenCalledTimes(1);
  });

  // Regression: a start failed, then the gate closed again (mic unplugged,
  // balance hit zero) before the user clicked Retry. Retry must not be able
  // to fire a start the gate currently forbids.
  it('disables retry when the gate is closed', () => {
    const h = handlers();
    render(
      <SubtitleIdle state={{ kind: 'failed', message: 'boom' }} {...h} canStart={false} />,
    );
    const retry = screen.getByRole('button', { name: /retry/i });
    expect(retry).toBeDisabled();
    fireEvent.click(retry);
    expect(h.onStart).not.toHaveBeenCalled();
  });
});

describe('SubtitleIdle unready state', () => {
  it("shows a provider that is not ready by its reason, punctuation trimmed, with an inert action", () => {
    const h = handlers();
    render(<SubtitleIdle state={{ kind: 'unready', message: 'Download a model first.' }} {...h} />);
    expect(screen.getByRole('button', { name: 'Download a model first' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /return to main window/i }));
    expect(h.onReturn).toHaveBeenCalledTimes(1);
  });

  // The fix action's destination comes from the readiness code, not from a
  // StartBlockReason (plan 1e-3b-1 ruling 13).
  it('opens Settings at the given target when the fix action is clicked', () => {
    const h = handlers();
    const onOpenSettings = vi.fn();
    render(
      <SubtitleIdle
        state={{ kind: 'unready', message: 'Configure devices for this mode to start.', target: 'microphone' }}
        {...h}
        onOpenSettings={onOpenSettings}
      />,
    );
    const btn = screen.getByRole('button', { name: 'Configure devices for this mode to start' });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    expect(onOpenSettings).toHaveBeenCalledWith('microphone');
  });
});

describe('SubtitleIdle return affordance', () => {
  it('is present in every non-starting state', () => {
    const h = handlers();
    render(<SubtitleIdle state={{ kind: 'ready' }} {...h} />);
    fireEvent.click(screen.getByRole('button', { name: /return to main window/i }));
    expect(h.onReturn).toHaveBeenCalledTimes(1);
  });
});

// The extension-overlay surface has no wiring for the new start-gate fields
// or session-start/stop request counters (they're never mirrored across the
// chrome.runtime port), so its buttons would be dead clicks. allowSessionControl
// gates the interactive controls off, restoring the old SubtitleSessionEnded
// presentation for that surface (issue #324 Task 6 finding).
describe('SubtitleIdle with allowSessionControl=false', () => {
  it('renders the ended message and a single return button, and calls onReturn on click', () => {
    const h = handlers();
    render(<SubtitleIdle state={{ kind: 'ended' }} {...h} allowSessionControl={false} />);
    expect(screen.getByText(/session ended/i)).toBeInTheDocument();
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /return to main window/i }));
    expect(h.onReturn).toHaveBeenCalledTimes(1);
  });

  it('offers no start or retry control, and never calls onStart', () => {
    const h = handlers();
    render(<SubtitleIdle state={{ kind: 'ended' }} {...h} allowSessionControl={false} />);
    expect(screen.queryByRole('button', { name: /start translating/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /configure/i })).toBeNull();
    expect(h.onStart).not.toHaveBeenCalled();
  });
});
