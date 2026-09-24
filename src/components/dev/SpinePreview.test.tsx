import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('../../lib/auth/hooks', () => ({
  useAuth: () => ({ isSignedIn: false, getToken: async () => null }),
}));
vi.mock('../../lib/analytics', () => ({
  useAnalytics: () => ({ trackEvent: vi.fn() }),
}));
vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return { ...actual, useTranslation: () => ({ t: (key: string) => key }) };
});
vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (_key: string, def: unknown) => def,
      setSetting: async () => ({ success: true }),
    }),
  },
}));
vi.mock('../../lib/audio/appCapture', () => ({
  createAppCapture: () => ({
    openSource: async () => { throw new Error('no capture in tests'); },
    echo: { attach: () => () => {}, onNotice: () => {}, setDiagnostics: () => {} },
  }),
}));
vi.mock('../../lib/audio/appAudio', () => ({
  getAppAudio: async () => {
    const queue = { position: () => null, pending: 0, subscribe: () => () => {} };
    return {
      playback: {
        queues: { speaker: queue, participant: queue, replay: queue },
        audio: () => {}, held: () => {}, clear: () => {},
        replay: () => {}, stopReplay: () => {}, preview: async () => {}, stopPreview: () => {},
        passthrough: () => {}, ttsTap: { read: () => new Float32Array(0) }, dispose: async () => {},
      },
      testTone: async () => {},
    };
  },
}));

import { SpinePreview } from './SpinePreview';

describe('SpinePreview', () => {
  it('shows the providers this build offers, starting with the fake', async () => {
    render(<SpinePreview />);
    expect(await screen.findByLabelText('Script')).toBeInTheDocument();
  });

  it('offers the test tone once the playback has loaded', async () => {
    render(<SpinePreview />);
    expect(await screen.findByRole('button', { name: 'Test tone' })).toBeInTheDocument();
  });

  it("draws the conversation list's empty state before a session", async () => {
    const { container } = render(<SpinePreview />);
    await waitFor(() => expect(container.querySelector('.conversation-display .empty-state')).not.toBeNull());
  });

  it('draws the subtitle view on the page with &subtitle=1', async () => {
    const before = window.location.href;
    window.history.replaceState(null, '', '/?preview=spine&subtitle=1');
    // The electron surface's SubtitleBar renders ChildWindowPopover, which
    // calls window.open on mount; jsdom has no window.open, and without this
    // stub it prints "Error: Not implemented: window.open" (harmless, but
    // noise the component already handles a null return for).
    const windowOpen = vi.spyOn(window, 'open').mockReturnValue(null);
    try {
      const { container } = render(<SpinePreview />);
      await waitFor(() => expect(container.querySelector('.spine-subtitle .subtitle-app')).not.toBeNull());
    } finally {
      window.history.replaceState(null, '', before);
      windowOpen.mockRestore();
    }
  });
});
