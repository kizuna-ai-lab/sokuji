/**
 * Mutation-verified wiring tests for the Soniox advanced settings (#342):
 * each control must actually write its field to the ACTIVE soniox slice
 * (BYOK `soniox`, or `kizunaSoniox` for the managed twin). Mounts the real
 * ProviderSpecificSettings against the real settingsStore — the #339 lesson:
 * per-provider switches/routing fail silently, only real write-path tests
 * catch a missing case.
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (_k: string, def?: string) => def ?? _k,
      i18n: { language: 'en' },
    }),
  };
});

vi.mock('../../../lib/analytics', () => ({
  useAnalytics: () => ({ trackEvent: vi.fn() }),
}));

// A plain vi.fn() (not a fixed arrow function) so individual tests can swap
// its return value to simulate signed-out / signed-in / a different account —
// needed for the managed-source identity tests below, which depend on
// `useAuth().userId`.
vi.mock('../../../lib/auth/hooks', () => ({
  useAuth: vi.fn(() => ({ getToken: async () => null, userId: undefined as string | undefined })),
}));

vi.mock('../../../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (_k: string, d: unknown) => d,
      setSetting: async () => undefined,
    }),
  },
}));

// Heavy local-provider sections; all render null for provider=SONIOX but pull
// large import graphs — stub them out.
vi.mock('./ModelManagementSection', () => ({ ModelManagementSection: () => null }));
vi.mock('./NativeModelManagementSection', () => ({ NativeModelManagementSection: () => null }));
vi.mock('./EngineSection', () => ({ EngineSection: () => null }));

// Identity map for the stub below: assigns a small stable id to each DISTINCT
// `source` object the section receives, so a test can tell "the parent handed
// in a genuinely NEW source object" apart from "still non-null" — nullness
// alone survives the exact regression this exists to catch. If
// ProviderSpecificSettings.tsx's `sonioxVoiceSource` useMemo ever drops
// `activeSonioxSettings.apiKey` from its dependency array (it reads like a
// redundant sub-field of an object already in the array), a BYOK user
// swapping Soniox project keys would keep the OLD SonioxVoicesClient: same
// source object, same id here, and project A's cloned voices / cached
// preview audio would silently persist under project B's key.
const sourceIds = new WeakMap<object, number>();
let nextSourceId = 1;
function sourceIdentity(source: unknown): string {
  if (source === null || typeof source !== 'object') return 'null';
  let id = sourceIds.get(source);
  if (id === undefined) {
    id = nextSourceId++;
    sourceIds.set(source, id);
  }
  return String(id);
}

// SonioxVoiceSection (Task 3) is exercised by its own test file; stub it here
// with markers that surface the `managed` prop and the `source` prop's
// IDENTITY (not just its presence, see sourceIdentity above) so wiring is
// testable without pulling in SonioxVoicesClient/recording machinery.
vi.mock('./SonioxVoiceSection', () => ({
  default: (p: any) => (
    <div
      data-testid="soniox-voice-section"
      data-managed={String(p.managed)}
      data-source-id={sourceIdentity(p.source)}
    />
  ),
}));

const { default: useSettingsStore } = await import('../../../stores/settingsStore');
const { Provider } = await import('../../../types/Provider');
const { ProviderConfigFactory } = await import('../../../services/providers/ProviderConfigFactory');
const { default: useSessionStore } = await import('../../../stores/sessionStore');
const { SonioxProviderConfig } = await import('../../../services/providers/SonioxProviderConfig');
const { default: ProviderSpecificSettings } = await import('./ProviderSpecificSettings');
const { useAuth } = await import('../../../lib/auth/hooks');
const { default: useAudioStore } = await import('../../../stores/audioStore');

const baseProps = {
  config: new SonioxProviderConfig().getConfig(),
  isSessionActive: false,
  isPreviewExpanded: false,
  setIsPreviewExpanded: () => {},
  getProcessedSystemInstructions: () => '',
  availableModels: [],
  loadingModels: false,
  fetchAvailableModels: async () => {},
};

function mount() {
  return render(<ProviderSpecificSettings {...baseProps} />);
}

// useAuth()'s real return type carries several fields (isLoaded, isSignedIn,
// sessionId, error) this file's tests never read; filling them with harmless
// stand-ins here (rather than casting each partial literal at every call
// site) keeps `vi.mocked(useAuth).mockReturnValue(...)` type-checking against
// the real hook shape.
function fakeAuth(over: { getToken: () => Promise<string | null>; userId: string | undefined }): ReturnType<typeof useAuth> {
  return {
    isLoaded: true,
    isSignedIn: !!over.userId,
    sessionId: over.userId ? `session-${over.userId}` : undefined,
    error: null,
    ...over,
  } as ReturnType<typeof useAuth>;
}

describe('ProviderSpecificSettings — Soniox advanced settings wiring (#342)', () => {
  beforeEach(() => {
    useSettingsStore.setState((s: any) => ({
      provider: Provider.SONIOX,
      soniox: {
        ...s.soniox,
        vocabularyTerms: '',
        vocabularyTranslations: '',
        contextText: '',
        endpointSensitivity: 0,
        endpointLatencyAdjustmentLevel: 0,
        ttsSpeed: 1.0,
      },
    }));
    // Reset to signed-out between tests: several tests below swap this via
    // vi.mocked(useAuth).mockReturnValue(...), and mock return values persist
    // across tests otherwise (no global mockReset/restoreMocks configured).
    vi.mocked(useAuth).mockReturnValue(fakeAuth({ getToken: async () => null, userId: undefined }));
  });

  it('writes the terms textarea to soniox.vocabularyTerms and caps it at 4000 chars', () => {
    const { container } = mount();
    const el = container.querySelector('#soniox-vocabulary-terms') as HTMLTextAreaElement;
    expect(el.getAttribute('maxlength')).toBe('4000');
    fireEvent.change(el, { target: { value: 'Sokuji\nKizuna AI' } });
    expect(useSettingsStore.getState().soniox.vocabularyTerms).toBe('Sokuji\nKizuna AI');
  });

  it('writes the translations textarea to soniox.vocabularyTranslations and caps it at 4000 chars', () => {
    const { container } = mount();
    const el = container.querySelector('#soniox-vocabulary-translations') as HTMLTextAreaElement;
    expect(el.getAttribute('maxlength')).toBe('4000');
    fireEvent.change(el, { target: { value: 'Kizuna AI=絆愛' } });
    expect(useSettingsStore.getState().soniox.vocabularyTranslations).toBe('Kizuna AI=絆愛');
  });

  it('writes the sensitivity slider to soniox.endpointSensitivity as a number', () => {
    const { container } = mount();
    const el = container.querySelector('#soniox-endpoint-sensitivity') as HTMLInputElement;
    fireEvent.change(el, { target: { value: '0.5' } });
    expect(useSettingsStore.getState().soniox.endpointSensitivity).toBe(0.5);
  });

  it('writes the latency-level select to soniox.endpointLatencyAdjustmentLevel as a number', () => {
    const { container } = mount();
    const el = container.querySelector('#soniox-endpoint-latency-level') as HTMLSelectElement;
    fireEvent.change(el, { target: { value: '2' } });
    expect(useSettingsStore.getState().soniox.endpointLatencyAdjustmentLevel).toBe(2);
  });

  it('writes the TTS speed slider (0.7–1.3 range) to soniox.ttsSpeed', () => {
    const { container } = mount();
    const el = container.querySelector('input[min="0.7"]') as HTMLInputElement;
    expect(el).not.toBeNull();
    expect(el.getAttribute('max')).toBe('1.3');
    expect(el.getAttribute('step')).toBe('0.05');
    fireEvent.change(el, { target: { value: '0.75' } });
    expect(useSettingsStore.getState().soniox.ttsSpeed).toBe(0.75);
  });

  it('writes the background textarea to soniox.contextText and caps it at 4000 chars', () => {
    const { container } = mount();
    const el = container.querySelector('#soniox-context-text') as HTMLTextAreaElement;
    expect(el.getAttribute('maxlength')).toBe('4000');
    fireEvent.change(el, { target: { value: 'Quarterly roadmap sync' } });
    expect(useSettingsStore.getState().soniox.contextText).toBe('Quarterly roadmap sync');
  });

  it('renders no model dropdown for Soniox (fixed stt-rt-v5 + tts-rt-v2 pipeline, nothing to choose)', () => {
    const { container } = mount();
    expect(container.querySelector('.model-selection-container')).toBeNull();
    useSettingsStore.setState({ provider: Provider.KIZUNA_AI_SONIOX });
    const managed = mount();
    expect(managed.container.querySelector('.model-selection-container')).toBeNull();
  });

  it('routes writes to the kizunaSoniox slice for the managed twin', () => {
    useSettingsStore.setState((s: any) => ({
      provider: Provider.KIZUNA_AI_SONIOX,
      kizunaSoniox: { ...s.kizunaSoniox, vocabularyTerms: '' },
      soniox: { ...s.soniox, vocabularyTerms: '' },
    }));
    const { container } = mount();
    const el = container.querySelector('#soniox-vocabulary-terms') as HTMLTextAreaElement;
    fireEvent.change(el, { target: { value: 'Managed term' } });
    expect(useSettingsStore.getState().kizunaSoniox.vocabularyTerms).toBe('Managed term');
    expect(useSettingsStore.getState().soniox.vocabularyTerms).toBe('');
  });

  it('renders SonioxVoiceSection (managed=false) and no generic voice dropdown for BYOK Soniox', () => {
    const { container, getByTestId } = mount();
    expect(getByTestId('soniox-voice-section').getAttribute('data-managed')).toBe('false');
    // The generic renderVoiceSettings section (id="voice-settings-section", gated on
    // config.capabilities.hasVoiceSettings) must not render — SonioxProviderConfig now
    // sets hasVoiceSettings: false so the cloning-aware section is the only voice UI.
    expect(container.querySelector('#voice-settings-section')).toBeNull();
  });

  it('passes managed=true for the Kizuna twin', () => {
    useSettingsStore.setState({ provider: Provider.KIZUNA_AI_SONIOX });
    const { getByTestId } = mount();
    expect(getByTestId('soniox-voice-section').getAttribute('data-managed')).toBe('true');
  });

  it('gives SonioxVoiceSection a fresh source identity when the BYOK API key changes, and the SAME identity when it does not (guards the sonioxVoiceSource useMemo dep array)', () => {
    useSettingsStore.setState((s: any) => ({
      provider: Provider.SONIOX,
      soniox: { ...s.soniox, apiKey: 'key-a' },
    }));
    const { getByTestId } = mount();
    const firstId = getByTestId('soniox-voice-section').getAttribute('data-source-id');
    expect(firstId).not.toBe('null'); // a real source was built for a present key

    // A DIFFERENT key must produce a DIFFERENT source object — the same
    // object across a key swap would mean the section still holds the OLD
    // SonioxVoicesClient, i.e. project A's clones/cached preview audio
    // leaking under project B's key.
    act(() => {
      useSettingsStore.setState((s: any) => ({ soniox: { ...s.soniox, apiKey: 'key-b' } }));
    });
    const secondId = getByTestId('soniox-voice-section').getAttribute('data-source-id');
    expect(secondId).not.toBe('null');
    expect(secondId).not.toBe(firstId);

    // Conversely, an update that leaves the key STRING unchanged (a new
    // `soniox` slice object, same `apiKey` value) must NOT mint a new
    // source — that's the whole point of depending on the apiKey primitive
    // rather than the settings object. Constructing fresh on every
    // unrelated re-render would refetch the voice list every time, the
    // class of bug CLAUDE.md warns about for audio devices (depend on
    // `deviceId`, not the device object).
    act(() => {
      useSettingsStore.setState((s: any) => ({ soniox: { ...s.soniox, apiKey: 'key-b' } }));
    });
    const thirdId = getByTestId('soniox-voice-section').getAttribute('data-source-id');
    expect(thirdId).toBe(secondId);
  });

  // Task 4 review finding: the managed branch of the sonioxVoiceSource memo
  // was unconditional on `provider` alone, so a signed-out KIZUNA_AI_SONIOX
  // account still got a real source — recording a clip would write it to
  // IndexedDB and then have the backend 401 it — and an account switch that
  // didn't also change `provider` left the OLD account's source (and its
  // already-fetched voice list) in place, since the section's load effect
  // refetches on source IDENTITY, not on any credential.
  it('gives KIZUNA_AI_SONIOX no source at all when no one is signed in', () => {
    useSettingsStore.setState({ provider: Provider.KIZUNA_AI_SONIOX });
    vi.mocked(useAuth).mockReturnValue(fakeAuth({ getToken: async () => null, userId: undefined }));
    const { getByTestId } = mount();
    expect(getByTestId('soniox-voice-section').getAttribute('data-source-id')).toBe('null');
  });

  it('gives KIZUNA_AI_SONIOX a real source once a user is signed in', () => {
    useSettingsStore.setState({ provider: Provider.KIZUNA_AI_SONIOX });
    vi.mocked(useAuth).mockReturnValue(fakeAuth({ getToken: async () => 'token-a', userId: 'user-a' }));
    const { getByTestId } = mount();
    expect(getByTestId('soniox-voice-section').getAttribute('data-source-id')).not.toBe('null');
  });

  it('mints a fresh managed source identity when the signed-in account changes (guards the sonioxVoiceSource useMemo dep array against an account switch)', () => {
    useSettingsStore.setState({ provider: Provider.KIZUNA_AI_SONIOX });
    vi.mocked(useAuth).mockReturnValue(fakeAuth({ getToken: async () => 'token-a', userId: 'user-a' }));
    const { getByTestId, rerender } = mount();
    const firstId = getByTestId('soniox-voice-section').getAttribute('data-source-id');
    expect(firstId).not.toBe('null');

    // A DIFFERENT signed-in user must produce a DIFFERENT source object — the
    // same object across an account switch would mean the section still
    // holds account A's ManagedVoicesClient identity, so its load effect
    // (keyed on source identity, not on any credential) never refires and
    // account A's "My voice" row stays listed and selectable under B.
    vi.mocked(useAuth).mockReturnValue(fakeAuth({ getToken: async () => 'token-b', userId: 'user-b' }));
    act(() => {
      rerender(<ProviderSpecificSettings {...baseProps} />);
    });
    const secondId = getByTestId('soniox-voice-section').getAttribute('data-source-id');
    expect(secondId).not.toBe('null');
    expect(secondId).not.toBe(firstId);
  });
});

/**
 * Managed Soniox used to have the shared/split toggle locked on, with an
 * inline note saying it could not be turned off. The backend now issues one
 * temporary key per stream, so split is a real choice for managed accounts
 * too — and it costs roughly 2× per wall-clock minute, which the UI has to say
 * out loud rather than let the user discover from a halved countdown.
 */
describe('ProviderSpecificSettings — managed Soniox shared/split toggle', () => {
  beforeEach(() => {
    // The toggle is only live in Both mode (`inBoth`); every other test in
    // this file runs in the default speaker mode.
    useAudioStore.setState({ mode: 'both' });
    useSettingsStore.setState((s: any) => ({
      provider: Provider.KIZUNA_AI_SONIOX,
      kizunaSoniox: { ...s.kizunaSoniox, bothModeSharedSession: true },
    }));
  });

  afterEach(() => {
    useAudioStore.setState({ mode: 'speaker' });
  });

  function pills(container: HTMLElement): HTMLButtonElement[] {
    const section = container.querySelector('#soniox-settings-section') as HTMLElement;
    expect(section).not.toBeNull();
    return Array.from(section.querySelectorAll('.option-button')) as HTMLButtonElement[];
  }

  it('leaves both pills enabled for a managed account in Both mode', () => {
    const { container } = mount();
    const [enabled, disabled] = pills(container);
    expect(enabled.disabled).toBe(false);
    expect(disabled.disabled).toBe(false);
  });

  it('writes bothModeSharedSession: false to the kizunaSoniox slice when split is picked', () => {
    const { container } = mount();
    const [, disabled] = pills(container);
    fireEvent.click(disabled);
    expect(useSettingsStore.getState().kizunaSoniox.bothModeSharedSession).toBe(false);
  });

  it('still locks both pills during an active session', () => {
    const { container } = render(<ProviderSpecificSettings {...baseProps} isSessionActive={true} />);
    const [enabled, disabled] = pills(container);
    expect(enabled.disabled).toBe(true);
    expect(disabled.disabled).toBe(true);
  });

  it('shows the explanatory tooltip for managed accounts too', () => {
    const { container } = mount();
    const section = container.querySelector('#soniox-settings-section') as HTMLElement;
    expect(section.querySelector('.tooltip-trigger')).not.toBeNull();
  });

  it('tells a managed account what split costs instead of saying it cannot be turned off', () => {
    const { container } = mount();
    const section = container.querySelector('#soniox-settings-section') as HTMLElement;
    // The i18n mock at the top of this file returns each t() call's English
    // default, so this asserts the shipped copy verbatim.
    expect(section.textContent).toContain('about twice the cost per minute');
    expect(section.textContent).not.toContain('cannot be turned off');
  });
});

describe('region selector', () => {
  // Its own setup: this block sits outside the main describe, so relying on
  // that one's beforeEach would make these tests depend on execution order.
  beforeEach(() => {
    useSettingsStore.setState((s: any) => ({
      provider: Provider.SONIOX,
      soniox: { ...s.soniox, region: 'us', voice: 'us-voice', voiceEu: 'eu-voice', voiceJp: 'jp-voice' },
    }));
  });

  it('lists every deployment and writes the choice to the active soniox slice', () => {
    const { container } = mount();
    const el = container.querySelector('#soniox-region-select') as HTMLSelectElement;
    expect(el).toBeTruthy();
    expect([...el.options].map((o) => o.value)).toEqual(['us', 'eu', 'jp']);
    // Every select in this panel carries `select-dropdown`; without it the
    // browser default renders a light, shrink-to-fit control inside a dark
    // panel. Shipped that way once -- caught by rendering it, not by reading it.
    expect(el.className).toContain('select-dropdown');
    // The <h2> already names the control. A second visible label rendered
    // "Region" twice; `aria-label` keeps it named without the duplicate.
    expect(el.getAttribute('aria-label')).toBeTruthy();
    expect(container.querySelectorAll('#soniox-region-section .setting-label')).toHaveLength(0);

    fireEvent.change(el, { target: { value: 'eu' } });
    expect(useSettingsStore.getState().soniox.region).toBe('eu');
  });

  // Codex review on PR #413: Start is not instantaneous. Managed voice prep,
  // the session-key round trip and both clients' construction all run while
  // `isSessionActive` is still false, and they read the region at different
  // moments -- so a change landing inside that window can claim a voice in one
  // region while the lease is bought in another.
  it('is disabled from the moment Start is pressed, not just once live', () => {
    act(() => { useSessionStore.setState({ isInitializing: true, isSessionActive: false } as any); });
    const { container } = mount();
    const el = container.querySelector('#soniox-region-select') as HTMLSelectElement;
    expect(el.disabled).toBe(true);
    act(() => { useSessionStore.setState({ isInitializing: false } as any); });
  });

  // Switching hosts under a live socket is not something the session can
  // survive, so the control is inert while one is running.
  it('is disabled during an active session', () => {
    const { container } = render(<ProviderSpecificSettings {...baseProps} isSessionActive={true} />);
    const el = container.querySelector('#soniox-region-select') as HTMLSelectElement;
    expect(el.disabled).toBe(true);
  });

  // The generic API key input edits the ACTIVE region's field. Writing every
  // region to `apiKey` would overwrite the US key each time a regional one was
  // pasted -- the exact silent data loss per-region storage exists to prevent.
  it('the voice section follows the region, not the us field', () => {
    act(() => {
      useSettingsStore.setState({
        soniox: {
          ...useSettingsStore.getState().soniox,
          region: 'jp',
          voice: 'us-voice',
          voiceJp: 'jp-voice',
        },
      });
    });
    mount();
    // buildSessionConfig is the one place the session's voice is decided, so
    // assert through it rather than through a rendered label.
    const session = ProviderConfigFactory
      .getDescriptor(Provider.SONIOX)
      .buildSessionConfig(useSettingsStore.getState().soniox, '');
    expect(session).toMatchObject({ voice: 'jp-voice' });
  });
});
