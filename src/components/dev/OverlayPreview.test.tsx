import { describe, it, expect, vi } from 'vitest';
import { act, render } from '@testing-library/react';

vi.mock('../Subtitle/SubtitleView', () => ({
  SubtitleView: (p: { surface: string; model: { entries: unknown[]; session: unknown } }) =>
    require('react').createElement('div', { 'data-testid': 'view', 'data-surface': p.surface, 'data-entries': String(p.model.entries.length), 'data-session': p.model.session ? 'yes' : 'no' }),
}));

const { OverlayPreview } = await import('./OverlayPreview');

describe('OverlayPreview', () => {
  it('draws the overlay once its parent hands it a port, from what arrives on it', async () => {
    const { findByTestId, queryByTestId } = render(<OverlayPreview />);
    expect(queryByTestId('view')).toBeNull();
    const channel = new MessageChannel();
    await act(async () => {
      // A plain event carrying what a MessageEvent would: jsdom's MessageEvent rejects Node's MessagePort.
      window.dispatchEvent(Object.assign(new Event('message'), { data: { type: 'sokuji-subtitle:connect' }, ports: [channel.port2], origin: window.location.origin }));
    });
    channel.port1.postMessage({ type: 'subtitle:entries', entries: [{ kind: 'notice', id: 'n', leg: 'speaker', severity: 'warning', message: 'm', at: 0 }] });
    const view = await findByTestId('view');
    expect(view.dataset.surface).toBe('extension-overlay');
    await vi.waitFor(() => expect(view.dataset.entries).toBe('1'));
    channel.port1.close();
  });

  it('posts sokuji-subtitle:ready to its parent once mounted', () => {
    // jsdom: window.parent === window, so the ping lands on window itself.
    const postMessage = vi.spyOn(window, 'postMessage');
    render(<OverlayPreview />);
    expect(postMessage).toHaveBeenCalledWith({ type: 'sokuji-subtitle:ready' }, window.location.origin);
    postMessage.mockRestore();
  });
});
