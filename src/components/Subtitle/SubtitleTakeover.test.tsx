import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';

// Kept from before the old audio service was deleted: ServiceFactory used to
// import ModernBrowserAudioService -> ModernAudioRecorder -> a worklet
// `?url` import that this sandboxed Vite test transform denied outright.
// ServiceFactory no longer reaches ModernAudioRecorder; this test's subject,
// session.ts, reaches it only via `appCapture`, which is mocked directly
// below. Not needed by the current graph for that reason.
vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (_key: string, def: unknown) => def,
      setSetting: async () => ({ success: true }),
    }),
  },
}));

vi.mock('../../lib/audio/appAudio', () => ({
  getAppAudio: vi.fn(async () => {
    const queue = { position: () => null, pending: 0, subscribe: () => () => {} };
    return {
      playback: {
        queues: { speaker: queue, participant: queue, replay: queue },
        audio: vi.fn(), held: vi.fn(), clear: vi.fn(), live: vi.fn(), passthrough: vi.fn(),
        ttsTap: { read: () => new Float32Array(0) },
        meter: vi.fn(() => null),
      },
      testTone: async () => {},
    };
  }),
}));

vi.mock('../../lib/audio/appCapture', () => ({
  createAppCapture: () => ({
    openSource: async () => { throw new Error('no capture in tests'); },
    echo: { attach: () => () => {}, onNotice: () => {}, setDiagnostics: () => {} },
    levels: {
      speaker: { push() {}, read: () => new Float32Array(32), reset() {} },
      participant: { push() {}, read: () => new Float32Array(32), reset() {} },
    },
  }),
}));

// As punctuation.test.ts mocks it: this file only needs the runtime's
// `enabled` (the stores decide it) and a `punctuate` that answers nothing.
vi.mock('../../lib/segmentation/PunctuationRuntime', () => {
  class FakePunctuationRuntime {
    dispose = vi.fn();
    punctuate = vi.fn(async () => null);
    constructor(public opts: { isEnabled(): boolean }) {}
    get enabled(): boolean {
      return this.opts.isEnabled();
    }
  }
  const PunctuationRuntime = vi.fn(function (opts: { isEnabled(): boolean }) {
    return new FakePunctuationRuntime(opts);
  });
  const MODEL_IDS = {
    'fireredpunc': 'punct-zh-fireredpunc',
    'edge-punct-en': 'punct-en-edge',
    'sat-3l-sm': 'punct-multi-sat',
  };
  return { PunctuationRuntime, MODEL_IDS };
});

// Partial: settingsStore's own import graph (through the Settings sections it
// pulls in) reaches `initReactI18next`, which a full mock would drop.
vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return { ...actual, useTranslation: () => ({ t: (key: string) => key }) };
});

// SubtitleView's own tests cover its rendering; this file only needs to see
// what SubtitleTakeover hands it.
const captured = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock('./SubtitleView', () => ({
  SubtitleView: (props: Record<string, unknown>) => { captured.push(props); return null; },
}));

const { exit, navigate, order } = vi.hoisted(() => {
  const order: string[] = [];
  const exit = vi.fn(async () => { order.push('exit'); });
  const navigate = vi.fn((target: string) => { order.push(`navigate:${target}`); });
  return { exit, navigate, order };
});
vi.mock('../../stores/settingsStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../stores/settingsStore')>();
  return { ...actual, useExitSubtitleMode: () => exit, useNavigateToSettings: () => navigate };
});

import { createVirtualClock } from '../../lib/contract/clock';
import { fakeProvider } from '../../providers/fake/provider';
import { createFakeSource } from '../../providers/fake/source';
import { useProviderStore } from '../../stores/providerStore';
import { configureAppSession, getAppSession } from '../../app/session';
import type { SubtitleControls } from './SubtitleView';
import { SubtitleTakeover } from './SubtitleTakeover';

const clock = createVirtualClock(0);
// Before any render builds the page's session: the fake source, no microphone needed.
configureAppSession({
  clock,
  newSessionId: () => 'r1',
  capture: () => async () => createFakeSource(clock),
  microphoneRequired: () => false,
});

beforeAll(async () => {
  await useProviderStore.getState().load(fakeProvider);
  useProviderStore.getState().select('fake');
});

beforeEach(() => {
  captured.length = 0;
  exit.mockClear();
  navigate.mockClear();
  order.length = 0;
});

function lastControls(): SubtitleControls {
  return captured[captured.length - 1].controls as SubtitleControls;
}

describe('SubtitleTakeover', () => {
  it("draws the electron surface with the root session's state and an exporter", () => {
    render(<SubtitleTakeover />);
    const last = captured[captured.length - 1];
    expect(last.surface).toBe('electron');
    expect(last.exporter).toBeTruthy();
    expect((last.model as { session: unknown }).session).toBe(getAppSession().subtitle.get());
  });

  it('drives the root runner past idle through controls.start()', async () => {
    render(<SubtitleTakeover />);
    act(() => { lastControls().start!(); });
    await waitFor(() => expect(getAppSession().runner.state.getState().phase).not.toBe('idle'));
    await act(() => getAppSession().runner.stop());
    await getAppSession().runner.settled();
  });

  // Ruling 11 (plan 1e-3b-1): a click before the selected provider's entry
  // has loaded must not reach the runner at all — the old `SubtitleApp.tsx`
  // had the same early return (`handleStart`, `if (!startGate.canStart) return;`).
  it("skips the start while the selected provider's entry has not loaded, then starts once it has (ruling 11)", async () => {
    render(<SubtitleTakeover />);
    useProviderStore.setState({ entries: {} });
    expect(getAppSession().subtitle.get().canStart).toBe(false);
    const before = getAppSession().runner.state.getState();
    act(() => { lastControls().start!(); });
    // Untouched, not just still `idle`: an earlier test may have already left
    // a `lastEnd` of its own on this module-singleton runner, so a bare
    // `{ phase: 'idle' }` is the wrong assertion — the same reference proves
    // this click never reached the runner at all.
    expect(getAppSession().runner.state.getState()).toBe(before);
    await act(async () => { await useProviderStore.getState().load(fakeProvider); });
    expect(getAppSession().subtitle.get().canStart).toBe(true);
    act(() => { lastControls().start!(); });
    await waitFor(() => expect(getAppSession().runner.state.getState().phase).not.toBe('idle'));
    await act(() => getAppSession().runner.stop());
    await getAppSession().runner.settled();
  });

  it("empties the runner's conversation through controls.clear()", async () => {
    render(<SubtitleTakeover />);
    await act(async () => { await getAppSession().runner.start(); });
    // The fake's first exchange finishes well before its second one starts at
    // 5000ms (`fakeScript('exchange')`): every segment is closed by here, so
    // `clear()` (which keeps a still-open segment, text emptied) drops it outright.
    act(() => { clock.advance(2500); });
    expect(getAppSession().runner.conversation.snapshot()[0].segments.length).toBeGreaterThan(0);
    act(() => { lastControls().clear(); });
    expect(getAppSession().runner.conversation.snapshot()[0].segments).toEqual([]);
    await act(() => getAppSession().runner.stop());
    await getAppSession().runner.settled();
  });

  it('leaves subtitle mode once through controls.exit()', () => {
    render(<SubtitleTakeover />);
    act(() => { lastControls().exit(); });
    expect(exit).toHaveBeenCalledTimes(1);
  });

  // The old `handleFix`'s rule, now `SubtitleTakeover.tsx`'s `openSettings`:
  // subtitle mode is left first so the main window is back before Settings
  // scrolls to the section.
  it('leaves subtitle mode before opening Settings, through controls.openSettings()', () => {
    render(<SubtitleTakeover />);
    act(() => { lastControls().openSettings!('provider'); });
    expect(order).toEqual(['exit', 'navigate:provider']);
  });
});
