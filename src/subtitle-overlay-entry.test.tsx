import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { render, order, hydrate, reportErrorSpy } = vi.hoisted(() => {
  const order: string[] = [];
  return {
    render: vi.fn(),
    order,
    hydrate: vi.fn(async () => { order.push('hydrate'); }),
    reportErrorSpy: vi.fn(),
  };
});

vi.mock('react-dom/client', () => ({ createRoot: () => ({ render }) }));
vi.mock('./stores/subtitleStore', () => ({ useSubtitleStore: { getState: () => ({ hydrate }) } }));
vi.mock('./components/AppProviders', () => ({ AppProviders: ({ children }: { children: unknown }) => children }));
vi.mock('./components/Subtitle/ConnectedOverlay', () => ({ ConnectedOverlay: () => null }));
vi.mock('./lib/diagnostics/report', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/diagnostics/report')>()),
  reportError: reportErrorSpy,
}));

function chromePortFake() {
  return {
    postMessage: vi.fn(),
    onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    onDisconnect: { addListener: vi.fn(), removeListener: vi.fn() },
    disconnect: vi.fn(),
  };
}

let connect: ReturnType<typeof vi.fn>;

describe('subtitle-overlay-entry', () => {
  beforeEach(() => {
    vi.resetModules();
    order.length = 0;
    render.mockClear();
    hydrate.mockClear();
    reportErrorSpy.mockClear();
    document.body.innerHTML = '<div id="root"></div>';
    connect = vi.fn((info: { name: string }) => {
      order.push('connect:' + info.name);
      return chromePortFake();
    });
    vi.stubGlobal('chrome', { runtime: { connect } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("hydrates the overlay's own settings, then opens one port, then draws ConnectedOverlay over its receiver", async () => {
    await import('./subtitle-overlay-entry');

    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1));
    expect(order).toEqual(['hydrate', 'connect:sokuji-subtitle']);

    const { ConnectedOverlay } = await import('./components/Subtitle/ConnectedOverlay');
    const element = render.mock.calls[0][0];
    expect(element.props.children.type).toBe(ConnectedOverlay);
    expect(typeof element.props.children.props.receiver.send).toBe('function');
  });

  it('draws nothing, and reports, with no #root', async () => {
    document.body.innerHTML = '';

    await import('./subtitle-overlay-entry');

    await vi.waitFor(() => expect(reportErrorSpy).toHaveBeenCalledTimes(1));
    expect(reportErrorSpy.mock.calls[0][0]).toBe('SubtitleOverlay');
    expect(connect).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
  });

  it('draws nothing when the port will not open', async () => {
    connect = vi.fn(() => { throw new Error('no side panel'); });
    vi.stubGlobal('chrome', { runtime: { connect } });

    await import('./subtitle-overlay-entry');

    await vi.waitFor(() => expect(reportErrorSpy).toHaveBeenCalledTimes(1));
    expect(render).not.toHaveBeenCalled();
  });
});
