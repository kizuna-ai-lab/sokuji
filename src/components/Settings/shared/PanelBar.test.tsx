import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PanelBar from './PanelBar';
import type { Tab } from './TabBar';

const TABS: Tab[] = [
  { id: 'general', labelKey: 'x.general', fallback: 'General' },
  { id: 'audio', labelKey: 'x.audio', fallback: 'Audio' },
];

describe('PanelBar', () => {
  it('renders tabs when provided', () => {
    render(<PanelBar tabs={TABS} activeTab="general" onTabChange={() => {}} onClose={() => {}} />);
    expect(screen.getAllByRole('tab')).toHaveLength(2);
  });

  it('renders no tabs when tabs is omitted', () => {
    render(<PanelBar onClose={() => {}} />);
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
  });

  it('renders the actions slot', () => {
    render(<PanelBar actions={<button>my-action</button>} onClose={() => {}} />);
    expect(screen.getByRole('button', { name: 'my-action' })).toBeInTheDocument();
  });

  it('calls onClose when the collapse button is clicked', () => {
    const onClose = vi.fn();
    render(<PanelBar onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /close panel/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose on Escape', () => {
    const onClose = vi.fn();
    render(<PanelBar onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores Escape when a dialog is open', () => {
    const onClose = vi.fn();
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.appendChild(dialog);
    try {
      render(<PanelBar onClose={onClose} />);
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onClose).not.toHaveBeenCalled();
    } finally {
      document.body.removeChild(dialog);
    }
  });

  it('does NOT defer to a dialog hidden inside another panel (display:none ancestor)', () => {
    const onClose = vi.fn();
    // Simulate a persisted-open dialog inside a hidden <Activity> subtree.
    const hiddenHost = document.createElement('div');
    hiddenHost.style.display = 'none';
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    hiddenHost.appendChild(dialog);
    document.body.appendChild(hiddenHost);
    try {
      render(<PanelBar onClose={onClose} />);
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      document.body.removeChild(hiddenHost);
    }
  });

  it('does not call onClose after unmount', () => {
    const onClose = vi.fn();
    const { unmount } = render(<PanelBar onClose={onClose} />);
    unmount();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});
