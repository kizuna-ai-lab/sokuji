import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

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
// The page's runner is the real one; this only watches its `start()` — the
// post-start signal `&punctuation=1`'s test needs.
const runnerStart = vi.hoisted(() => vi.fn());
vi.mock('../../lib/session/runner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/session/runner')>();
  return {
    ...actual,
    createRunner: (deps: Parameters<typeof actual.createRunner>[0]) => {
      const runner = actual.createRunner(deps);
      return { ...runner, start: (method?: Parameters<typeof runner.start>[0]) => { runnerStart(); return runner.start(method); } };
    },
  };
});
vi.mock('../../lib/audio/appAudio', () => ({
  getAppAudio: async () => {
    const queue = { position: () => null, pending: 0, subscribe: () => () => {} };
    return {
      playback: {
        queues: { speaker: queue, participant: queue, replay: queue },
        audio: () => {}, held: () => {}, clear: () => {}, live: () => {},
        replay: () => {}, stopReplay: () => {}, preview: async () => {}, stopPreview: () => {},
        passthrough: () => {}, ttsTap: { read: () => new Float32Array(0) }, dispose: async () => {},
      },
      testTone: async () => {},
    };
  },
}));

import { SpinePreview } from './SpinePreview';
import { getAppSession } from '../../app/session';
import { useProviderStore } from '../../stores/providerStore';
import { useSegmentationStore } from '../../stores/segmentationStore';

describe('SpinePreview', () => {
  it('shows the providers this build offers, starting with the fake', async () => {
    render(<SpinePreview />);
    expect(await screen.findByLabelText('Script')).toBeInTheDocument();
  });

  it('shows no seals until the runner hands the preview a seal frame', async () => {
    const { container } = render(<SpinePreview />);
    await waitFor(() => expect(container.querySelector('[data-probe="seals"]')).not.toBeNull());
    expect(container.querySelector('[data-probe="seals"]')?.textContent).toBe('-');
  });

  // Plan 1e-2 ruling 10: LocalInference is first in the registry now, so
  // ProviderPanel's own mount effect (a child of this page, so it runs
  // first) would otherwise leave `localInference` selected — this page's
  // probes must still land on the fake.
  it('opens on the fake even when localInference was left selected', async () => {
    useProviderStore.setState({ selected: 'localInference' });
    render(<SpinePreview />);
    expect(await screen.findByLabelText('Script')).toBeInTheDocument();
  });

  // Task 9: `&provider=<id>` picks a provider on load instead of the fake —
  // the exception the mount effect carves out of ruling 10's default.
  it('selects the provider named by &provider= instead of the fake', async () => {
    const before = window.location.href;
    window.history.replaceState(null, '', '/?preview=spine&provider=localInference');
    try {
      render(<SpinePreview />);
      // This page's i18n mock returns the raw key (no fallback), unlike
      // LocalInferenceSettings.test.tsx's own mock — `TtsSpeedControl`'s
      // `aria-label` is `t('settings.ttsSpeed', 'Speech Speed')`.
      expect(await screen.findByLabelText('settings.ttsSpeed')).toBeInTheDocument();
      expect(screen.queryByLabelText('Script')).not.toBeInTheDocument();
    } finally {
      window.history.replaceState(null, '', before);
    }
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

  // Task 9, plan 1e-3a: the fake source is the page's default, and it does
  // not need a chosen microphone (1e-3 ruling 5 exempts it).
  it('runs the fake source without asking for a microphone', async () => {
    render(<SpinePreview />);
    await screen.findByLabelText('Script');
    const session = getAppSession().subtitle.get();
    expect(session.canStart).toBe(true);
    expect(session.idle.kind === 'unready' ? session.idle.code : undefined).not.toBe('no_microphone');
  });

  // Task 9: the page is a thin shell over the app's own session — its Start
  // button drives `getAppSession().runner`, not a runner of the page's own.
  it("is the app's session: the page's Start drives the root's runner", async () => {
    render(<SpinePreview />);
    await screen.findByLabelText('Script');
    expect(getAppSession().runner.state.getState()).toEqual({ phase: 'idle' });
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    // A run started, or a refusal recorded its `lastEnd` — either way the
    // state is no longer the bare idle it started at.
    await waitFor(() => expect(getAppSession().runner.state.getState()).not.toEqual({ phase: 'idle' }));
    await act(() => getAppSession().runner.stop());
    await getAppSession().runner.settled();
  });

  // Task 5, plan 1e-2b ruling 12: `&punctuation=1` downloads the punctuation
  // pack before autostart so a `sentences` cut gets a real punctuator instead
  // of racing a background load. Last in the file: the previous test also
  // started the app's (module-singleton) runner, but stopped it and awaited
  // `settled()` first, so it is idle again here; nothing after this depends
  // on it staying idle.
  it('with &punctuation=1, downloads the punctuation pack before autostart when it is not ready', async () => {
    const before = window.location.href;
    window.history.replaceState(null, '', '/?preview=spine&autostart=1&punctuation=1');
    const download = vi.fn(async () => {
      useSegmentationStore.setState({ phase: 'ready' });
    });
    useSegmentationStore.setState({ phase: 'missing', download });
    // What the pack's phase was when the run started: `ready` only once the download has finished.
    const phaseAtStart: string[] = [];
    runnerStart.mockReset();
    runnerStart.mockImplementation(() => { phaseAtStart.push(useSegmentationStore.getState().phase); });
    try {
      render(<SpinePreview />);
      await waitFor(() => expect(runnerStart).toHaveBeenCalledTimes(1));
      expect(download).toHaveBeenCalledTimes(1);
      expect(phaseAtStart).toEqual(['ready']);
    } finally {
      window.history.replaceState(null, '', before);
    }
  });
});
