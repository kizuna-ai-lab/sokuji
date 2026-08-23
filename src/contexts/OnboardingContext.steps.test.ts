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

const { createBasicOnboardingSteps, createAdvancedOnboardingSteps } = await import('./OnboardingContext');

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

describe('basic step numbering', () => {
  // Feed every numbered title the SAME wrong number. If the list renumbers,
  // the output is 1..7 regardless; if it just passes catalogue text through,
  // the output stays 9,9,9... So this fails unless renumbering exists, and it
  // cannot be satisfied by the catalogue happening to be correct today.
  const scrambled = (key: string, fallback?: string) => {
    const text = fallback ?? key;
    return /Step \d+:/.test(text) ? text.replace(/Step \d+:/, 'Step 9:') : text;
  };

  const numbersFrom = (tt: (k: string, d?: string) => string) =>
    createBasicOnboardingSteps(tt as any)
      .map((s) => String(s.title))
      .filter((x) => /Step \d+:/.test(x))
      .map((x) => Number(x.match(/Step (\d+):/)![1]));

  it('numbers the steps by their real position, not by the catalogue text', () => {
    expect(numbersFrom(scrambled)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('leaves an already-correct catalogue alone', () => {
    // Idempotence: the shipped en text must survive renumbering unchanged.
    expect(numbersFrom(t)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

describe('advanced step numbering', () => {
  // The advanced list had its own inline copy of the renumberer and no test.
  // Sharing one implementation between the two lists is only safe if the
  // advanced behaviour is pinned, so pin it: same scrambled input, same
  // expectation that position wins over catalogue text.
  const scrambled = (key: string, fallback?: string) => {
    const text = fallback ?? key;
    return /Step \d+:/.test(text) ? text.replace(/Step \d+:/, 'Step 9:') : text;
  };

  const numbers = (tt: (k: string, d?: string) => string) =>
    createAdvancedOnboardingSteps(tt as any)
      .map((s) => String(s.title))
      .filter((x) => /Step \d+:/.test(x))
      .map((x) => Number(x.match(/Step (\d+):/)![1]));

  it('numbers by position, and stays consecutive from one', () => {
    const got = numbers(scrambled);
    expect(got.length).toBeGreaterThan(0);
    expect(got).toEqual(got.map((_, i) => i + 1));
  });
});
