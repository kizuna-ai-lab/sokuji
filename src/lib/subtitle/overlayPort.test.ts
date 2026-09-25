import { describe, expect, it, vi } from 'vitest';
import type { ChromePortLike } from './wire';
import { connectOverlay, SIDEPANEL_GONE, type OverlayParent } from './overlayPort';

const reportErrorSpy = vi.hoisted(() => vi.fn());
vi.mock('../diagnostics/report', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../diagnostics/report')>()),
  reportError: reportErrorSpy,
}));

/**
 * A `chrome.runtime.Port` as `onConnect` would hand it over, plus the two
 * test-only knobs: `deliver(m)` fires every subscribed `onMessage` listener,
 * `drop()` fires every subscribed `onDisconnect` listener.
 */
function chromePort(): ChromePortLike & { deliver(message: unknown): void; drop(): void } {
  const messages = new Set<(message: unknown) => void>();
  const gone = new Set<() => void>();
  return {
    postMessage: vi.fn(),
    onMessage: {
      addListener: vi.fn((listener: (message: unknown) => void) => { messages.add(listener); }),
      removeListener: vi.fn((listener: (message: unknown) => void) => { messages.delete(listener); }),
    },
    onDisconnect: {
      addListener: vi.fn((listener: () => void) => { gone.add(listener); }),
      removeListener: vi.fn((listener: () => void) => { gone.delete(listener); }),
    },
    disconnect: vi.fn(),
    deliver: (message: unknown) => { [...messages].forEach((listener) => listener(message)); },
    drop: () => { [...gone].forEach((listener) => listener()); },
  };
}

function stubParent() {
  return { postMessage: vi.fn() };
}

describe('connectOverlay', () => {
  it('opens one port named sokuji-subtitle and listens on it before returning', () => {
    const port = chromePort();
    const connect = vi.fn(() => port);
    const parent = stubParent();

    const receiver = connectOverlay(connect, parent)!;

    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith({ name: 'sokuji-subtitle' });
    expect(port.onMessage.addListener).toHaveBeenCalledTimes(1);

    port.deliver({ type: 'subtitle:language', language: 'ja' });
    expect(receiver.get().language).toBe('ja');
  });

  it("sends the overlay's controls down the port", () => {
    const port = chromePort();
    const connect = vi.fn(() => port);
    const parent = stubParent();

    const receiver = connectOverlay(connect, parent)!;
    receiver.send({ type: 'subtitle:turn-press' });

    expect(port.postMessage).toHaveBeenCalledWith({ type: 'subtitle:turn-press' });
  });

  it('when the side panel goes, disposes the receiver and asks the content script to unmount it', () => {
    const port = chromePort();
    const connect = vi.fn(() => port);
    const parent = stubParent();

    const receiver = connectOverlay(connect, parent)!;
    port.deliver({ type: 'subtitle:language', language: 'ja' });
    const listener = vi.fn();
    receiver.subscribe(listener);

    port.drop();

    expect(parent.postMessage).toHaveBeenCalledTimes(1);
    expect(parent.postMessage).toHaveBeenCalledWith(SIDEPANEL_GONE, '*');

    port.deliver({ type: 'subtitle:language', language: 'fr' });
    expect(listener).not.toHaveBeenCalled();
    expect(receiver.get().language).toBe('ja');
  });

  it('a parent that is gone does not throw out of the disconnect', () => {
    const port = chromePort();
    const connect = vi.fn(() => port);
    const parent: OverlayParent = { postMessage: vi.fn(() => { throw new Error('detached'); }) };

    connectOverlay(connect, parent);

    expect(() => port.drop()).not.toThrow();
  });

  it('a port that will not open is reported, and the overlay asks to be unmounted', () => {
    const connect = vi.fn((): ChromePortLike => { throw new Error('no side panel'); });
    const parent = stubParent();

    const receiver = connectOverlay(connect, parent);

    expect(receiver).toBeNull();
    expect(reportErrorSpy).toHaveBeenCalledTimes(1);
    expect(reportErrorSpy).toHaveBeenCalledWith('SubtitleOverlay', expect.any(String), expect.objectContaining({ cause: expect.any(Error) }));
    expect(parent.postMessage).toHaveBeenCalledWith(SIDEPANEL_GONE, '*');
  });
});
