/**
 * Wire round-trip: messages CONSTRUCTED against the shared contract types
 * (src/types/subtitleWire.ts) are fed to the mirror's port handler, and the
 * resulting store state is asserted. Guards the seam the two sides used to
 * couple by convention only — especially the provider→settings-slice
 * resolution, which is now the registry's settingsSliceKey instead of a
 * hand-copied table that silently broke for unlisted providers.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SubtitleWireMessage } from '../types/subtitleWire';

vi.mock('../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: vi.fn(async (_key: string, def: unknown) => def),
      setSetting: vi.fn(async () => ({ success: true })),
    }),
  },
}));
// isElectron forces OPENAI_COMPATIBLE (Electron-gated) into the registry so
// its snake_case→camelCase slice mapping is exercised end-to-end.
vi.mock('../utils/environment', async (orig) => ({
  ...(await orig<object>()),
  isElectron: () => true,
  isExtension: () => false,
}));

import { installSessionPortMirror } from './sessionPortMirror';
import useSessionStore from './sessionStore';
import useSettingsStore from './settingsStore';

declare const globalThis: any;

function installAndCaptureHandler(): (msg: SubtitleWireMessage) => void {
  let handler: ((msg: SubtitleWireMessage) => void) | null = null;
  globalThis.chrome = {
    runtime: {
      connect: vi.fn(() => ({
        name: 'sokuji-subtitle',
        onMessage: { addListener: vi.fn((h: any) => { handler = h; }) },
        onDisconnect: { addListener: vi.fn() },
        postMessage: vi.fn(),
      })),
    },
  };
  installSessionPortMirror();
  expect(handler).toBeTruthy();
  return handler!;
}

describe('subtitle wire round-trip (shared contract)', () => {
  beforeEach(() => {
    useSessionStore.setState({
      items: [], participantItems: [], isSessionActive: false, sessionStartTime: null,
    } as any);
  });

  it('config resolves the settings slice through the registry (openai_compatible → openaiCompatible)', () => {
    const handle = installAndCaptureHandler();
    const msg: SubtitleWireMessage = {
      type: 'config',
      provider: 'openai_compatible',
      sourceLanguage: 'ja',
      targetLanguage: 'en',
      turnDetectionMode: 'Normal',
    };
    handle(msg);
    const s = useSettingsStore.getState() as any;
    expect(s.provider).toBe('openai_compatible');
    // The hand-copied table this replaced would have broken here for any
    // provider someone forgot to add; the registry cannot go stale.
    expect(s.openaiCompatible.sourceLanguage).toBe('ja');
    expect(s.openaiCompatible.targetLanguage).toBe('en');
    // No junk top-level snake_case key
    expect(s.openai_compatible).toBeUndefined();
  });

  it('an unregistered provider degrades to writing under the raw identifier (old behavior)', () => {
    const handle = installAndCaptureHandler();
    handle({
      type: 'config', provider: 'someday_provider', sourceLanguage: 'ko', targetLanguage: 'de',
    });
    const s = useSettingsStore.getState() as any;
    expect(s.someday_provider.sourceLanguage).toBe('ko');
  });

  it('state-init and items carry the session payload through', () => {
    const handle = installAndCaptureHandler();
    handle({
      type: 'state-init',
      payload: {
        items: [{ id: 'a' }], isSessionActive: true, sessionStartTime: 42,
        provider: 'gemini', sourceLanguage: 'ja', targetLanguage: 'en',
        playback: null,
      },
    });
    expect(useSessionStore.getState().items).toEqual([{ id: 'a' }]);
    expect(useSessionStore.getState().isSessionActive).toBe(true);
    expect((useSettingsStore.getState() as any).gemini.sourceLanguage).toBe('ja');

    handle({ type: 'items', items: [{ id: 'b' }] });
    expect(useSessionStore.getState().items).toEqual([{ id: 'b' }]);

    handle({ type: 'session', isSessionActive: false });
    expect(useSessionStore.getState().isSessionActive).toBe(false);
    expect(useSessionStore.getState().sessionStartTime).toBeNull();
  });
});
