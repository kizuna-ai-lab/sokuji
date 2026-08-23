import { describe, it, expect, vi } from 'vitest';

// OnboardingContext statically imports settingsStore, which drags in its real
// static import graph — including
// audioStore -> ServiceFactory -> ModernBrowserAudioService -> ModernAudioRecorder
// -> the @sapphi-red/web-noise-suppressor worklet's `?url` import, which this
// sandboxed Vite test transform denies outright. Mock ServiceFactory (same fix
// ensureSelectionReady.test.ts / useWasmEngineAdapter.test.ts already use) so
// that chain never loads. Nothing here stubs the step list or the build gates
// it reads, so the assertions below still see the real thing.
vi.mock('../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: vi.fn(() => ({
      setSetting: vi.fn().mockResolvedValue(undefined),
      getSetting: vi.fn(),
    })),
  },
}));

// analytics.ts re-exports from shared/index.tsx, whose module scope calls
// ReactDOM.createRoot(document.getElementById('root')) — no such element in
// jsdom. Same mock the Settings section tests use. It touches nothing the
// assertions below read.
vi.mock('../lib/analytics', () => ({
  useAnalytics: () => ({ trackEvent: vi.fn() }),
}));

const { createBasicOnboardingSteps } = await import('./OnboardingContext');

const t = (_k: string, d?: string) => d ?? _k;

describe('basic onboarding steps', () => {
  it('no longer targets the deleted account section', () => {
    const targets = createBasicOnboardingSteps(t as any).map((s) => s.target);
    expect(targets).not.toContain('#user-account-section');
  });

  it('spotlights each element at most once', () => {
    const targets = createBasicOnboardingSteps(t as any).map((s) => s.target);
    const elementTargets = targets.filter((x) => x !== 'body');
    expect(new Set(elementTargets).size).toBe(elementTargets.length);
  });

  it('has ten steps', () => {
    // Eleven before this task. Counted, not assumed: the list is
    // body, mode-picker, settings-button, [account], languages, provider,
    // microphone, speaker, participant, main-action-btn, body.
    expect(createBasicOnboardingSteps(t as any)).toHaveLength(10);
  });
});
