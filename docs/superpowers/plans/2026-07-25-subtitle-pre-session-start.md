# Subtitle Pre-Session Start Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users enter subtitle mode on the Electron surface with no session running, and start/stop the session from inside the subtitle window.

**Architecture:** A pure `computeStartGate()` function becomes the single source of truth for "can the session start, and if not why" — consumed by both the main-window Start button tooltip and (mirrored through `sessionStore`) the subtitle window. Start/Stop travel the other way as monotonic version counters that a small `useSubtitleSessionBridge()` hook in MainPanel watches, exactly like the existing `requestClearConversation`. No session logic leaves MainPanel.

**Tech Stack:** React 18 + TypeScript, Zustand (`subscribeWithSelector`), Vitest + @testing-library/react (jsdom), i18next, SCSS.

**Spec:** `docs/superpowers/specs/2026-07-25-subtitle-pre-session-start-design.md`

## Global Constraints

- **Scope is the Electron surface only.** The extension overlay (`surface === 'extension-overlay'`) must remain session-gated. Every new control is rendered behind `surface === 'electron'` or `isElectron()`.
- **All code comments and docs in English.** (CLAUDE.md)
- **Conventional commit format** for every commit.
- **`tsc` is NOT clean in this repo (~113 pre-existing errors).** Do not gate on `tsc`. The correctness gate is Vitest.
- **Vitest runs in watch mode by default** (`npm run test` → `vitest`). Always use `npx vitest run <path>` for one-shot runs in this plan.
- **Reuse existing i18n strings for block reasons.** `mainPanel.apiKeyRequired`, `mainPanel.modelsRequired`, `mainPanel.modelsLoading`, `mainPanel.localModelsRequired`, `mainPanel.walletFrozen`, `mainPanel.insufficientBalance`, `modePicker.missingDevice` already exist in all 30 locale dirs. Only add new keys under `subtitle.*` (Task 10).
- **Mirror effects must depend on primitives only** — never object identities. CLAUDE.md documents this exact trap ("use `deviceId` in React dependencies, not device objects").
- Baseline before starting: `npx vitest run src/components/Subtitle` → 7 files, 60 tests, all passing.

---

### Task 1: Start-gate pure function

Extracts the "why can't the session start" logic out of MainPanel's JSX so the subtitle window can use it. Today it lives twice: a 5-level nested ternary in the basic-mode button `title` (`MainPanel.tsx:3255-3266`) and a 6-branch chain of `<span className="tooltip">` in advanced mode (`MainPanel.tsx:3408-3431`). This task creates the function and its tests only; wiring happens in Task 4.

**Files:**
- Create: `src/components/MainPanel/sessionStartGate.ts`
- Test: `src/components/MainPanel/sessionStartGate.test.ts`
- Modify: `docs/superpowers/specs/2026-07-25-subtitle-pre-session-start-design.md` (add the `no-models` row — see Step 6)

**Interfaces:**
- Consumes: `Provider`, `ProviderType`, `isKizunaManagedProvider` from `src/types/Provider.ts`
- Produces: `StartBlockReason`, `DeviceScope`, `StartGate`, `StartGateInput`, `computeStartGate()`, `reasonToSettingsTarget()`, `reasonToI18n()` — used by Tasks 3, 4, 5, 6, 7

- [ ] **Step 1: Write the failing test**

Create `src/components/MainPanel/sessionStartGate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Provider } from '../../types/Provider';
import {
  computeStartGate,
  reasonToSettingsTarget,
  reasonToI18n,
  type StartGateInput,
} from './sessionStartGate';

// A configuration where every gate condition passes. Individual tests break
// exactly one condition so precedence is unambiguous.
const ready: StartGateInput = {
  isApiKeyValid: true,
  availableModelCount: 3,
  loadingModels: false,
  isInitializing: false,
  provider: Provider.OPENAI,
  quota: null,
  missingDeviceForMode: null,
};

describe('computeStartGate', () => {
  it('allows start when every condition passes', () => {
    expect(computeStartGate(ready)).toEqual({ canStart: true, reason: null });
  });

  it('reports missing-device with the offending scope', () => {
    expect(computeStartGate({ ...ready, missingDeviceForMode: 'participant' })).toEqual({
      canStart: false,
      reason: 'missing-device',
      deviceScope: 'participant',
    });
  });

  it('treats an invalid key on LOCAL_INFERENCE as missing models, not a bad key', () => {
    const gate = computeStartGate({
      ...ready,
      isApiKeyValid: false,
      provider: Provider.LOCAL_INFERENCE,
    });
    expect(gate).toEqual({ canStart: false, reason: 'local-models-missing' });
  });

  it('reports api-key-invalid for a non-local provider', () => {
    expect(computeStartGate({ ...ready, isApiKeyValid: false })).toEqual({
      canStart: false,
      reason: 'api-key-invalid',
    });
  });

  it('reports no-models when the model list came back empty', () => {
    expect(computeStartGate({ ...ready, availableModelCount: 0 })).toEqual({
      canStart: false,
      reason: 'no-models',
    });
  });

  it('reports loading-models while the list is still loading', () => {
    expect(
      computeStartGate({ ...ready, availableModelCount: 0, loadingModels: true }),
    ).toEqual({ canStart: false, reason: 'loading-models' });
  });

  it('reports wallet-frozen for a Kizuna-managed provider', () => {
    expect(
      computeStartGate({
        ...ready,
        provider: Provider.KIZUNA_AI_OPENAI_TRANSLATE,
        quota: { balance: 100, frozen: true },
      }),
    ).toEqual({ canStart: false, reason: 'wallet-frozen' });
  });

  it('reports insufficient-balance with the balance attached', () => {
    expect(
      computeStartGate({
        ...ready,
        provider: Provider.KIZUNA_AI_OPENAI_TRANSLATE,
        quota: { balance: 0, frozen: false },
      }),
    ).toEqual({ canStart: false, reason: 'insufficient-balance', balance: 0 });
  });

  it('ignores balance for providers that are not Kizuna-managed', () => {
    expect(computeStartGate({ ...ready, quota: { balance: 0, frozen: true } })).toEqual({
      canStart: true,
      reason: null,
    });
  });

  it('blocks while initializing but reports no reason (it is a transient state)', () => {
    expect(computeStartGate({ ...ready, isInitializing: true })).toEqual({
      canStart: false,
      reason: null,
    });
  });

  // Precedence must match the main-window tooltip chain at MainPanel.tsx:3408.
  it('prefers missing-device over every other reason', () => {
    const gate = computeStartGate({
      ...ready,
      missingDeviceForMode: 'speaker',
      isApiKeyValid: false,
      availableModelCount: 0,
      provider: Provider.KIZUNA_AI_OPENAI_TRANSLATE,
      quota: { balance: 0, frozen: true },
    });
    expect(gate.reason).toBe('missing-device');
  });

  it('prefers an invalid key over an empty model list', () => {
    const gate = computeStartGate({ ...ready, isApiKeyValid: false, availableModelCount: 0 });
    expect(gate.reason).toBe('api-key-invalid');
  });

  it('prefers wallet-frozen over insufficient-balance', () => {
    const gate = computeStartGate({
      ...ready,
      provider: Provider.KIZUNA_AI_OPENAI_TRANSLATE,
      quota: { balance: 0, frozen: true },
    });
    expect(gate.reason).toBe('wallet-frozen');
  });
});

describe('reasonToSettingsTarget', () => {
  it('routes a missing speaker device to the microphone section', () => {
    expect(reasonToSettingsTarget('missing-device', 'speaker')).toBe('microphone');
  });

  it('routes a missing participant device to the participant section', () => {
    expect(reasonToSettingsTarget('missing-device', 'participant')).toBe('participant');
  });

  it('routes a both-scope device gap to the microphone section', () => {
    expect(reasonToSettingsTarget('missing-device', 'both')).toBe('microphone');
  });

  it('routes model and key problems to their sections', () => {
    expect(reasonToSettingsTarget('local-models-missing')).toBe('model-management');
    expect(reasonToSettingsTarget('api-key-invalid')).toBe('provider');
    expect(reasonToSettingsTarget('no-models')).toBe('provider');
  });

  it('routes wallet problems to the account section', () => {
    expect(reasonToSettingsTarget('wallet-frozen')).toBe('user-account');
    expect(reasonToSettingsTarget('insufficient-balance')).toBe('user-account');
  });

  it('offers no destination for the transient loading state', () => {
    expect(reasonToSettingsTarget('loading-models')).toBeNull();
  });
});

describe('reasonToI18n', () => {
  it('maps every reason to an existing translation key', () => {
    const reasons = [
      'missing-device', 'local-models-missing', 'api-key-invalid',
      'no-models', 'loading-models', 'wallet-frozen', 'insufficient-balance',
    ] as const;
    for (const reason of reasons) {
      const entry = reasonToI18n(reason);
      expect(entry.key).toMatch(/^(mainPanel|modePicker)\./);
      expect(entry.defaultValue.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/MainPanel/sessionStartGate.test.ts`
Expected: FAIL — `Failed to resolve import "./sessionStartGate"`.

- [ ] **Step 3: Write the implementation**

Create `src/components/MainPanel/sessionStartGate.ts`:

```ts
// src/components/MainPanel/sessionStartGate.ts
//
// Single source of truth for "can a session start, and if not, why".
//
// This used to live twice inside MainPanel's JSX — a nested ternary on the
// basic-mode button's title and a chain of tooltip spans in advanced mode.
// The subtitle window (a sibling React tree that cannot see MainPanel state)
// now needs the same answer, so the logic is a pure function both surfaces
// call. Keeping it in one place is what stops the two windows from giving
// the user contradictory explanations.
import { Provider, isKizunaManagedProvider, type ProviderType } from '../../types/Provider';

export type StartBlockReason =
  | 'missing-device'
  | 'local-models-missing'
  | 'api-key-invalid'
  | 'no-models'
  | 'loading-models'
  | 'wallet-frozen'
  | 'insufficient-balance';

export type DeviceScope = 'speaker' | 'participant' | 'both';

export interface StartGate {
  canStart: boolean;
  /**
   * Why the session cannot start. `null` with `canStart: false` means the
   * blocker is transient initialization, which callers render as a spinner
   * rather than as a problem the user has to fix.
   */
  reason: StartBlockReason | null;
  /** Present only for 'insufficient-balance'. */
  balance?: number;
  /** Present only for 'missing-device'. */
  deviceScope?: DeviceScope;
}

export interface StartGateInput {
  isApiKeyValid: boolean;
  availableModelCount: number;
  loadingModels: boolean;
  isInitializing: boolean;
  provider: ProviderType;
  quota: { balance?: number; frozen?: boolean } | null | undefined;
  missingDeviceForMode: DeviceScope | null;
}

export function computeStartGate(input: StartGateInput): StartGate {
  const {
    isApiKeyValid,
    availableModelCount,
    loadingModels,
    isInitializing,
    provider,
    quota,
    missingDeviceForMode,
  } = input;

  const kizunaManaged = isKizunaManagedProvider(provider);
  const hasValidBalance =
    !kizunaManaged ||
    Boolean(quota && quota.balance !== undefined && quota.balance > 0 && !quota.frozen);

  const canStart =
    isApiKeyValid &&
    availableModelCount > 0 &&
    !loadingModels &&
    !isInitializing &&
    hasValidBalance &&
    missingDeviceForMode === null;

  if (canStart) return { canStart: true, reason: null };

  // Initialization is not a problem to report — it is the "starting" state.
  if (isInitializing) return { canStart: false, reason: null };

  // Precedence below mirrors the tooltip chain the main window has always
  // used (MainPanel.tsx:3408). Do not reorder without changing both.
  if (missingDeviceForMode !== null) {
    return { canStart: false, reason: 'missing-device', deviceScope: missingDeviceForMode };
  }
  if (!isApiKeyValid) {
    // For LOCAL_INFERENCE, "API key valid" is really "required models are
    // downloaded" (settingsStore.validateApiKey delegates to
    // modelStore.isProviderReady), so the actionable message differs.
    return {
      canStart: false,
      reason: provider === Provider.LOCAL_INFERENCE ? 'local-models-missing' : 'api-key-invalid',
    };
  }
  if (loadingModels) return { canStart: false, reason: 'loading-models' };
  if (availableModelCount === 0) return { canStart: false, reason: 'no-models' };
  if (kizunaManaged && quota?.frozen) return { canStart: false, reason: 'wallet-frozen' };
  if (kizunaManaged && quota?.balance !== undefined && quota.balance <= 0) {
    return { canStart: false, reason: 'insufficient-balance', balance: quota.balance };
  }
  // Defensive: hasValidBalance failed for a Kizuna provider with no quota
  // loaded yet. Treat it as an account problem rather than reporting nothing.
  return { canStart: false, reason: 'insufficient-balance' };
}

/**
 * Settings section to navigate to when the user asks to fix the blocker.
 * Values are keys of NAVIGATION_TAB_MAP (Settings.tsx:25); passing one to
 * settingsStore.navigateToSettings() opens the panel and scrolls to it.
 * Returns null when there is nothing for the user to do.
 */
export function reasonToSettingsTarget(
  reason: StartBlockReason,
  deviceScope?: DeviceScope,
): string | null {
  switch (reason) {
    case 'missing-device':
      return deviceScope === 'participant' ? 'participant' : 'microphone';
    case 'local-models-missing':
      return 'model-management';
    case 'api-key-invalid':
    case 'no-models':
      return 'provider';
    case 'wallet-frozen':
    case 'insufficient-balance':
      return 'user-account';
    case 'loading-models':
      return null;
  }
}

/**
 * Existing translation keys, reused verbatim. These strings already ship in
 * all 30 locale directories, and reusing them guarantees the subtitle window
 * and the main window word the same blocker identically.
 */
export function reasonToI18n(reason: StartBlockReason): { key: string; defaultValue: string } {
  switch (reason) {
    case 'missing-device':
      return { key: 'modePicker.missingDevice', defaultValue: 'Configure devices for this mode to start.' };
    case 'local-models-missing':
      return { key: 'mainPanel.localModelsRequired', defaultValue: 'Please download the required models in Settings to start.' };
    case 'api-key-invalid':
      return { key: 'mainPanel.apiKeyRequired', defaultValue: 'Please add a valid OpenAI API Key in settings first' };
    case 'no-models':
      return { key: 'mainPanel.modelsRequired', defaultValue: 'Models are required. Please validate your API key first to load available models.' };
    case 'loading-models':
      return { key: 'mainPanel.modelsLoading', defaultValue: 'Loading available models, please wait...' };
    case 'wallet-frozen':
      return { key: 'mainPanel.walletFrozen', defaultValue: 'Wallet is frozen. Please contact support.' };
    case 'insufficient-balance':
      return { key: 'mainPanel.insufficientBalance', defaultValue: 'Insufficient token balance: {{balance}} tokens' };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/MainPanel/sessionStartGate.test.ts`
Expected: PASS — 20 tests.

- [ ] **Step 5: Verify nothing else broke**

Run: `npx vitest run src/components src/stores`
Expected: PASS, same counts as before this task plus the 20 new tests.

- [ ] **Step 6: Sync the spec's reason table**

The spec listed six reasons; the implementation has seven. In
`docs/superpowers/specs/2026-07-25-subtitle-pre-session-start-design.md`,
replace the `api-key-invalid` row and add a `no-models` row so the table reads:

```markdown
| `missing-device` | `missingDeviceForMode !== null` | `microphone` / `participant` |
| `local-models-missing` | `!isApiKeyValid` and `provider === LOCAL_INFERENCE` | `model-management` |
| `api-key-invalid` | `!isApiKeyValid` otherwise | `provider` |
| `no-models` | model list empty and not loading | `provider` |
| `loading-models` | `loadingModels` | none (transient) |
| `wallet-frozen` | Kizuna-managed provider and `quota.frozen` | `user-account` |
| `insufficient-balance` | Kizuna-managed provider and `balance <= 0` | `user-account` |
```

Also replace the sentence "Reason precedence is lifted verbatim from the existing tooltip" with "Reason precedence is lifted verbatim from the advanced-mode tooltip chain (`MainPanel.tsx:3408`), which is the more complete of the two existing chains."

- [ ] **Step 7: Commit**

```bash
git add src/components/MainPanel/sessionStartGate.ts \
        src/components/MainPanel/sessionStartGate.test.ts \
        docs/superpowers/specs/2026-07-25-subtitle-pre-session-start-design.md
git commit -m "feat(session): extract the start gate into a tested pure function"
```

---

### Task 2: sessionStore mirror fields and start/stop requests

Adds the store surface the subtitle window reads from and writes to. Pure state plumbing — nothing consumes it until Task 3.

**Files:**
- Modify: `src/stores/sessionStore.ts`
- Test: `src/stores/sessionStore.startRequests.test.ts` (create)

**Interfaces:**
- Consumes: `StartBlockReason`, `DeviceScope` from Task 1
- Produces: state `startGate`, `isInitializing`, `initProgress`, `startSessionVersion`, `stopSessionVersion`; actions `setStartGate`, `setIsInitializing`, `setInitProgress`, `requestSessionStart`, `requestSessionStop`; hooks `useStartGate`, `useSessionIsInitializing`, `useInitProgress`, `useRequestSessionStart`, `useRequestSessionStop`

- [ ] **Step 1: Write the failing test**

Create `src/stores/sessionStore.startRequests.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import useSessionStore from './sessionStore';

describe('sessionStore start/stop requests', () => {
  beforeEach(() => {
    useSessionStore.setState({
      startSessionVersion: 0,
      stopSessionVersion: 0,
      startGate: { canStart: false, reason: null },
      isInitializing: false,
      initProgress: null,
    });
  });

  it('starts with both request counters at zero', () => {
    const state = useSessionStore.getState();
    expect(state.startSessionVersion).toBe(0);
    expect(state.stopSessionVersion).toBe(0);
  });

  it('bumps only the start counter on requestSessionStart', () => {
    useSessionStore.getState().requestSessionStart();
    expect(useSessionStore.getState().startSessionVersion).toBe(1);
    expect(useSessionStore.getState().stopSessionVersion).toBe(0);
  });

  it('bumps monotonically so repeated requests are distinguishable', () => {
    useSessionStore.getState().requestSessionStart();
    useSessionStore.getState().requestSessionStart();
    expect(useSessionStore.getState().startSessionVersion).toBe(2);
  });

  it('bumps only the stop counter on requestSessionStop', () => {
    useSessionStore.getState().requestSessionStop();
    expect(useSessionStore.getState().stopSessionVersion).toBe(1);
    expect(useSessionStore.getState().startSessionVersion).toBe(0);
  });

  it('stores the mirrored start gate verbatim', () => {
    useSessionStore.getState().setStartGate({
      canStart: false,
      reason: 'missing-device',
      deviceScope: 'speaker',
    });
    expect(useSessionStore.getState().startGate).toEqual({
      canStart: false,
      reason: 'missing-device',
      deviceScope: 'speaker',
    });
  });

  it('stores initialization progress and clears it back to null', () => {
    useSessionStore.getState().setInitProgress({ completed: 3, total: 5 });
    expect(useSessionStore.getState().initProgress).toEqual({ completed: 3, total: 5 });
    useSessionStore.getState().setInitProgress(null);
    expect(useSessionStore.getState().initProgress).toBeNull();
  });

  // endSession is the "session is over" transition. The mirrored gate belongs
  // to MainPanel's live configuration, not to the session, so it must survive
  // — otherwise the subtitle window would show a blocked Start after every
  // normal stop until MainPanel's next mirror effect happens to run.
  it('keeps the mirrored gate across endSession', () => {
    useSessionStore.getState().setStartGate({ canStart: true, reason: null });
    useSessionStore.getState().endSession();
    expect(useSessionStore.getState().startGate).toEqual({ canStart: true, reason: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/stores/sessionStore.startRequests.test.ts`
Expected: FAIL — `state.requestSessionStart is not a function`.

- [ ] **Step 3: Write the implementation**

In `src/stores/sessionStore.ts`, add the import at the top (after the existing `ConversationItem` import):

```ts
import type { StartBlockReason, DeviceScope } from '../components/MainPanel/sessionStartGate';
```

A store importing from a component directory is unusual, but this is a
**type-only** import — it is erased at build time and creates no runtime
dependency from the store on the component layer. The alternative (a third
module holding just the two type aliases) would separate the reasons from the
function that produces them.

Add to the `SessionStore` interface, right after `clearConversationVersion`:

```ts
  // Mirror of MainPanel's start gate. MainPanel owns the computation; the
  // subtitle window is a sibling React tree that cannot read MainPanel state,
  // so the answer is published here. Same pattern as lockedMode above.
  startGate: { canStart: boolean; reason: StartBlockReason | null; balance?: number; deviceScope?: DeviceScope };
  isInitializing: boolean;
  initProgress: { completed: number; total: number } | null;
  // Monotonic counters — every requestSessionStart/Stop bumps one. MainPanel
  // watches them and runs connectConversation/disconnectConversation, so any
  // surface can drive the session without a reference to MainPanel. Same
  // pattern as clearConversationVersion above.
  startSessionVersion: number;
  stopSessionVersion: number;
```

Add to the actions block of the interface, after `requestClearConversation`:

```ts
  setStartGate: (gate: SessionStore['startGate']) => void;
  setIsInitializing: (initializing: boolean) => void;
  setInitProgress: (progress: { completed: number; total: number } | null) => void;
  requestSessionStart: () => void;
  requestSessionStop: () => void;
```

Add to the initial state, after `clearConversationVersion: 0,`:

```ts
    startGate: { canStart: false, reason: null },
    isInitializing: false,
    initProgress: null,
    startSessionVersion: 0,
    stopSessionVersion: 0,
```

Add the actions after `requestClearConversation`:

```ts
    setStartGate: (startGate) => set({ startGate }),
    setIsInitializing: (isInitializing) => set({ isInitializing }),
    setInitProgress: (initProgress) => set({ initProgress }),
    requestSessionStart: () => set((state) => ({
      startSessionVersion: state.startSessionVersion + 1,
    })),
    requestSessionStop: () => set((state) => ({
      stopSessionVersion: state.stopSessionVersion + 1,
    })),
```

Do **not** touch `endSession` or `resetSession` — the mirrored gate describes
MainPanel's live configuration, not the session.

Add the selectors next to the existing ones (after `useRequestClearConversation`):

```ts
export const useStartGate = () => useSessionStore((state) => state.startGate);
// Named useSessionIsInitializing to avoid colliding with MainPanel's local
// isInitializing state when both are in scope.
export const useSessionIsInitializing = () => useSessionStore((state) => state.isInitializing);
export const useInitProgress = () => useSessionStore((state) => state.initProgress);
export const useRequestSessionStart = () => useSessionStore((state) => state.requestSessionStart);
export const useRequestSessionStop = () => useSessionStore((state) => state.requestSessionStop);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/stores/sessionStore.startRequests.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Verify the store's other consumers still pass**

Run: `npx vitest run src/stores`
Expected: PASS, no regressions.

- [ ] **Step 6: Commit**

```bash
git add src/stores/sessionStore.ts src/stores/sessionStore.startRequests.test.ts
git commit -m "feat(session): mirror the start gate and add session start/stop requests"
```

---

### Task 3: MainPanel bridge hook

The two effects that connect MainPanel to the store, extracted into a hook so they can be tested. MainPanel itself is 3000+ lines and does not render in a unit test.

**Files:**
- Create: `src/components/MainPanel/useSubtitleSessionBridge.ts`
- Test: `src/components/MainPanel/useSubtitleSessionBridge.test.tsx`

**Interfaces:**
- Consumes: `StartGate` (Task 1); `sessionStore` actions (Task 2)
- Produces: `useSubtitleSessionBridge({ startGate, isInitializing, initProgress, onStart, onStop }): void` — called by MainPanel in Task 4

- [ ] **Step 1: Write the failing test**

Create `src/components/MainPanel/useSubtitleSessionBridge.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useSessionStore from '../../stores/sessionStore';
import { useSubtitleSessionBridge } from './useSubtitleSessionBridge';
import type { StartGate } from './sessionStartGate';

const readyGate: StartGate = { canStart: true, reason: null };

beforeEach(() => {
  useSessionStore.setState({
    startSessionVersion: 0,
    stopSessionVersion: 0,
    startGate: { canStart: false, reason: null },
    isInitializing: false,
    initProgress: null,
  });
});

describe('useSubtitleSessionBridge mirroring', () => {
  it('publishes the gate to the store on mount', () => {
    renderHook(() =>
      useSubtitleSessionBridge({
        startGate: { canStart: false, reason: 'missing-device', deviceScope: 'speaker' },
        isInitializing: false,
        initProgress: null,
        onStart: vi.fn(),
        onStop: vi.fn(),
      }),
    );
    expect(useSessionStore.getState().startGate).toEqual({
      canStart: false,
      reason: 'missing-device',
      deviceScope: 'speaker',
    });
  });

  it('republishes when the reason changes', () => {
    const { rerender } = renderHook(
      (props: { startGate: StartGate }) =>
        useSubtitleSessionBridge({
          startGate: props.startGate,
          isInitializing: false,
          initProgress: null,
          onStart: vi.fn(),
          onStop: vi.fn(),
        }),
      { initialProps: { startGate: { canStart: false, reason: 'api-key-invalid' } as StartGate } },
    );
    rerender({ startGate: readyGate });
    expect(useSessionStore.getState().startGate).toEqual({ canStart: true, reason: null });
  });

  it('mirrors initialization state and progress', () => {
    renderHook(() =>
      useSubtitleSessionBridge({
        startGate: readyGate,
        isInitializing: true,
        initProgress: { completed: 2, total: 5 },
        onStart: vi.fn(),
        onStop: vi.fn(),
      }),
    );
    expect(useSessionStore.getState().isInitializing).toBe(true);
    expect(useSessionStore.getState().initProgress).toEqual({ completed: 2, total: 5 });
  });
});

describe('useSubtitleSessionBridge request watching', () => {
  it('does not fire on mount even when the counters are non-zero', () => {
    useSessionStore.setState({ startSessionVersion: 7, stopSessionVersion: 4 });
    const onStart = vi.fn();
    const onStop = vi.fn();
    renderHook(() =>
      useSubtitleSessionBridge({
        startGate: readyGate, isInitializing: false, initProgress: null, onStart, onStop,
      }),
    );
    expect(onStart).not.toHaveBeenCalled();
    expect(onStop).not.toHaveBeenCalled();
  });

  it('calls onStart when the start counter bumps', () => {
    const onStart = vi.fn();
    renderHook(() =>
      useSubtitleSessionBridge({
        startGate: readyGate, isInitializing: false, initProgress: null,
        onStart, onStop: vi.fn(),
      }),
    );
    act(() => { useSessionStore.getState().requestSessionStart(); });
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('calls onStop when the stop counter bumps, and not onStart', () => {
    const onStart = vi.fn();
    const onStop = vi.fn();
    renderHook(() =>
      useSubtitleSessionBridge({
        startGate: readyGate, isInitializing: false, initProgress: null, onStart, onStop,
      }),
    );
    act(() => { useSessionStore.getState().requestSessionStop(); });
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onStart).not.toHaveBeenCalled();
  });

  it('fires once per bump', () => {
    const onStart = vi.fn();
    renderHook(() =>
      useSubtitleSessionBridge({
        startGate: readyGate, isInitializing: false, initProgress: null,
        onStart, onStop: vi.fn(),
      }),
    );
    act(() => { useSessionStore.getState().requestSessionStart(); });
    act(() => { useSessionStore.getState().requestSessionStart(); });
    expect(onStart).toHaveBeenCalledTimes(2);
  });

  // The callbacks close over MainPanel state that changes every render;
  // re-arming the effect on every new closure would replay stale requests.
  it('invokes the latest callback without refiring on callback identity change', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(
      (props: { onStart: () => void }) =>
        useSubtitleSessionBridge({
          startGate: readyGate, isInitializing: false, initProgress: null,
          onStart: props.onStart, onStop: vi.fn(),
        }),
      { initialProps: { onStart: first } },
    );
    rerender({ onStart: second });
    expect(first).not.toHaveBeenCalled();
    act(() => { useSessionStore.getState().requestSessionStart(); });
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/MainPanel/useSubtitleSessionBridge.test.tsx`
Expected: FAIL — `Failed to resolve import "./useSubtitleSessionBridge"`.

- [ ] **Step 3: Write the implementation**

Create `src/components/MainPanel/useSubtitleSessionBridge.ts`:

```ts
// src/components/MainPanel/useSubtitleSessionBridge.ts
//
// Two-way bridge between MainPanel and any surface that is outside its React
// tree (today: the Electron subtitle window). Outbound, it publishes the start
// gate and initialization state into sessionStore. Inbound, it watches the
// start/stop request counters and calls back into MainPanel's own
// connect/disconnect functions.
//
// This lives in a hook rather than inline in MainPanel purely so it can be
// tested — MainPanel does not render in a unit test.
import { useEffect, useRef } from 'react';
import useSessionStore from '../../stores/sessionStore';
import type { StartGate } from './sessionStartGate';

interface Args {
  startGate: StartGate;
  isInitializing: boolean;
  initProgress: { completed: number; total: number } | null;
  onStart: () => void;
  onStop: () => void;
}

export function useSubtitleSessionBridge({
  startGate,
  isInitializing,
  initProgress,
  onStart,
  onStop,
}: Args): void {
  const setStartGate = useSessionStore((s) => s.setStartGate);
  const setIsInitializing = useSessionStore((s) => s.setIsInitializing);
  const setInitProgress = useSessionStore((s) => s.setInitProgress);
  const startSessionVersion = useSessionStore((s) => s.startSessionVersion);
  const stopSessionVersion = useSessionStore((s) => s.stopSessionVersion);

  // Outbound mirrors. Dependencies are primitives only: depending on the
  // `startGate` object identity would re-run on every MainPanel render and
  // write a fresh object into the store each time, waking every subscriber.
  const { canStart, reason, balance, deviceScope } = startGate;
  useEffect(() => {
    setStartGate({ canStart, reason, balance, deviceScope });
  }, [canStart, reason, balance, deviceScope, setStartGate]);

  useEffect(() => {
    setIsInitializing(isInitializing);
  }, [isInitializing, setIsInitializing]);

  const completed = initProgress?.completed;
  const total = initProgress?.total;
  useEffect(() => {
    setInitProgress(
      completed === undefined || total === undefined ? null : { completed, total },
    );
  }, [completed, total, setInitProgress]);

  // Inbound requests. The callbacks close over MainPanel state and get a new
  // identity every render, so they are held in refs — an effect that depended
  // on them would re-run constantly and replay the last request.
  const onStartRef = useRef(onStart);
  onStartRef.current = onStart;
  const onStopRef = useRef(onStop);
  onStopRef.current = onStop;

  // Seeded with the mount-time value so mounting never looks like a request.
  // Same convention as MainPanel's lastClearVersionRef.
  const lastStartVersion = useRef(startSessionVersion);
  const lastStopVersion = useRef(stopSessionVersion);

  useEffect(() => {
    if (startSessionVersion === lastStartVersion.current) return;
    lastStartVersion.current = startSessionVersion;
    onStartRef.current();
  }, [startSessionVersion]);

  useEffect(() => {
    if (stopSessionVersion === lastStopVersion.current) return;
    lastStopVersion.current = stopSessionVersion;
    onStopRef.current();
  }, [stopSessionVersion]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/MainPanel/useSubtitleSessionBridge.test.tsx`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/MainPanel/useSubtitleSessionBridge.ts \
        src/components/MainPanel/useSubtitleSessionBridge.test.tsx
git commit -m "feat(session): add the MainPanel↔subtitle session bridge hook"
```

---

### Task 4: Wire MainPanel to the gate and the bridge

Replaces the two duplicated tooltip chains with the pure function and installs the bridge. No behavior change to the main window other than tooltip precedence becoming uniform across basic and advanced mode.

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx` (imports; `canStartSession` at 413-418; basic-mode button title at 3252-3267; advanced-mode tooltip chain at 3405-3431)

**Interfaces:**
- Consumes: `computeStartGate`, `reasonToI18n` (Task 1); `useSubtitleSessionBridge` (Task 3)
- Produces: nothing new — MainPanel remains the only caller of `connectConversation` / `disconnectConversation`

- [ ] **Step 1: Add the imports**

After the existing `import { Provider, ... } from '../../types/Provider';` line (currently line 54), add:

```ts
import { computeStartGate, reasonToI18n } from './sessionStartGate';
import { useSubtitleSessionBridge } from './useSubtitleSessionBridge';
```

- [ ] **Step 2: Replace the canStartSession computation**

Find (around line 413-418):

```tsx
  // canStartSession requires the *intended* mode to have all its devices
  // ready (missingDeviceForMode === null). Mode is always one of the three
  // values: 'speaker', 'participant', or 'both'.
  const canStartSession = isApiKeyValid && availableModels.length > 0 &&
    !loadingModels && !isInitializing && hasValidBalance &&
    missingDeviceForMode === null;
```

Replace with:

```tsx
  // canStartSession requires the *intended* mode to have all its devices
  // ready (missingDeviceForMode === null). Mode is always one of the three
  // values: 'speaker', 'participant', or 'both'.
  //
  // The gate also carries WHY it is closed, so the tooltip below and the
  // subtitle window (via useSubtitleSessionBridge) explain the blocker with
  // one shared implementation. See sessionStartGate.ts.
  const startGate = useMemo(
    () => computeStartGate({
      isApiKeyValid,
      availableModelCount: availableModels.length,
      loadingModels,
      isInitializing,
      provider,
      quota,
      missingDeviceForMode,
    }),
    [isApiKeyValid, availableModels.length, loadingModels, isInitializing, provider, quota, missingDeviceForMode],
  );
  const canStartSession = startGate.canStart;
```

Note: `hasValidBalance` (declared around line 349) is now only used inside
`computeStartGate`. Leave the declaration in place only if other code still
references it — check with `grep -n "hasValidBalance" src/components/MainPanel/MainPanel.tsx`.
If `canStartSession` was its only consumer, delete the declaration.

- [ ] **Step 3: Install the bridge**

The hook call must sit **after** both `connectConversation` and
`disconnectConversation` are declared — they are `const` bindings in the
temporal dead zone before that point. Search for
`const disconnectConversation = useCallback` and insert the call after that
`useCallback` block closes:

```tsx
  // Bridge to surfaces outside this React tree (the Electron subtitle window):
  // publishes the start gate + init state, and turns their start/stop requests
  // into calls on this component's own session functions.
  useSubtitleSessionBridge({
    startGate,
    isInitializing,
    initProgress,
    onStart: connectConversation,
    onStop: disconnectConversation,
  });
```

- [ ] **Step 4: Replace the basic-mode button tooltip**

Find the `title={...}` prop on the `main-action-btn` button (around line 3255-3267) — the nested ternary starting `!canStartSession && !isSessionActive`. Replace the whole `title={...}` prop with:

```tsx
                title={
                  !isSessionActive && startGate.reason
                    ? t(
                        reasonToI18n(startGate.reason).key,
                        reasonToI18n(startGate.reason).defaultValue,
                        { balance: startGate.balance },
                      )
                    : undefined
                }
```

- [ ] **Step 5: Replace the advanced-mode tooltip chain**

Find the six `<span className="tooltip">` siblings (around line 3408-3431) inside the `session-button` and replace all of them with:

```tsx
                    {startGate.reason && (
                      <span className="tooltip">
                        {t(
                          reasonToI18n(startGate.reason).key,
                          reasonToI18n(startGate.reason).defaultValue,
                          { balance: startGate.balance },
                        )}
                      </span>
                    )}
```

- [ ] **Step 6: Run the full test suite**

Run: `npx vitest run`
Expected: PASS. Note the pre-existing pass counts; nothing should regress.

- [ ] **Step 7: Manual smoke test**

Run: `npm run electron:dev`

Verify:
1. With a valid configuration, the Start button is enabled and has no tooltip.
2. Deselect the microphone in settings (or pick a mode whose device is missing) — Start disables and hovering shows "Configure devices for this mode to start."
3. Start a session, confirm it connects, stop it.

- [ ] **Step 8: Commit**

```bash
git add src/components/MainPanel/MainPanel.tsx
git commit -m "refactor(main-panel): drive Start gating and tooltips from the shared gate"
```

---

### Task 5: Idle-state derivation

The pure function that decides which of the five idle presentations the subtitle window shows. Separated from the component so the precedence rules are testable without rendering.

**Files:**
- Create: `src/components/Subtitle/subtitleIdleState.ts`
- Test: `src/components/Subtitle/subtitleIdleState.test.ts`

**Interfaces:**
- Consumes: `StartBlockReason`, `DeviceScope` (Task 1); `ConversationItem` from `src/services/interfaces/IClient`
- Produces: `SubtitleIdleState` union and `deriveSubtitleIdleState(input)` — used by Tasks 6 and 7

- [ ] **Step 1: Write the failing test**

Create `src/components/Subtitle/subtitleIdleState.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { deriveSubtitleIdleState, type IdleStateInput } from './subtitleIdleState';
import type { ConversationItem } from '../../services/interfaces/IClient';

const item = (over: Partial<ConversationItem> = {}): ConversationItem => ({
  id: 'i1',
  role: 'assistant',
  type: 'message',
  status: 'completed',
  createdAt: 1000,
  formatted: { text: 'hello' },
  ...over,
} as ConversationItem);

const errorItem = (createdAt: number, text = 'Network connection error') =>
  item({ id: `e-${createdAt}`, role: 'system', type: 'error', createdAt, formatted: { text } });

const base: IdleStateInput = {
  isInitializing: false,
  initProgress: null,
  startGate: { canStart: true, reason: null },
  items: [],
  hasRunSession: false,
  startRequestedAt: null,
};

describe('deriveSubtitleIdleState', () => {
  it('is ready with a clean gate and no history', () => {
    expect(deriveSubtitleIdleState(base)).toEqual({ kind: 'ready' });
  });

  it('is ended after a session has run in this visit', () => {
    expect(deriveSubtitleIdleState({ ...base, hasRunSession: true })).toEqual({ kind: 'ended' });
  });

  it('is starting while initializing, carrying progress when known', () => {
    expect(
      deriveSubtitleIdleState({
        ...base, isInitializing: true, initProgress: { completed: 3, total: 5 },
      }),
    ).toEqual({ kind: 'starting', completed: 3, total: 5 });
  });

  it('is starting without progress numbers when none are reported', () => {
    expect(deriveSubtitleIdleState({ ...base, isInitializing: true })).toEqual({ kind: 'starting' });
  });

  it('is blocked with the reason from the gate', () => {
    expect(
      deriveSubtitleIdleState({
        ...base,
        startGate: { canStart: false, reason: 'missing-device', deviceScope: 'speaker' },
      }),
    ).toEqual({ kind: 'blocked', reason: 'missing-device', deviceScope: 'speaker' });
  });

  it('carries the balance on an insufficient-balance block', () => {
    expect(
      deriveSubtitleIdleState({
        ...base,
        startGate: { canStart: false, reason: 'insufficient-balance', balance: 0 },
      }),
    ).toEqual({ kind: 'blocked', reason: 'insufficient-balance', balance: 0 });
  });

  it('is failed when an error item arrived after the user asked to start', () => {
    expect(
      deriveSubtitleIdleState({
        ...base,
        startRequestedAt: 500,
        items: [item(), errorItem(900, '401 Incorrect API key provided')],
      }),
    ).toEqual({ kind: 'failed', message: '401 Incorrect API key provided' });
  });

  // Mid-session error items from an earlier, successful session must not be
  // mistaken for a start failure.
  it('ignores an error item that predates the start request', () => {
    expect(
      deriveSubtitleIdleState({
        ...base,
        hasRunSession: true,
        startRequestedAt: 2000,
        items: [errorItem(900)],
      }),
    ).toEqual({ kind: 'ended' });
  });

  it('ignores an error item when no start was requested from this window', () => {
    expect(
      deriveSubtitleIdleState({ ...base, hasRunSession: true, items: [errorItem(900)] }),
    ).toEqual({ kind: 'ended' });
  });

  it('only considers the trailing item, not an error buried in history', () => {
    expect(
      deriveSubtitleIdleState({
        ...base, startRequestedAt: 500, items: [errorItem(600), item({ createdAt: 700 })],
      }),
    ).toEqual({ kind: 'ready' });
  });

  it('falls back to a generic message when the error item carries no text', () => {
    const bare = { ...errorItem(900), formatted: {} } as ConversationItem;
    expect(
      deriveSubtitleIdleState({ ...base, startRequestedAt: 500, items: [bare] }),
    ).toEqual({ kind: 'failed', message: '' });
  });

  it('prefers starting over a stale failure', () => {
    expect(
      deriveSubtitleIdleState({
        ...base, isInitializing: true, startRequestedAt: 500, items: [errorItem(900)],
      }),
    ).toEqual({ kind: 'starting' });
  });

  it('prefers a failure over a blocked gate', () => {
    expect(
      deriveSubtitleIdleState({
        ...base,
        startRequestedAt: 500,
        items: [errorItem(900, 'boom')],
        startGate: { canStart: false, reason: 'api-key-invalid' },
      }),
    ).toEqual({ kind: 'failed', message: 'boom' });
  });

  it('prefers a blocked gate over the ended headline', () => {
    expect(
      deriveSubtitleIdleState({
        ...base, hasRunSession: true, startGate: { canStart: false, reason: 'no-models' },
      }),
    ).toEqual({ kind: 'blocked', reason: 'no-models' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/Subtitle/subtitleIdleState.test.ts`
Expected: FAIL — `Failed to resolve import "./subtitleIdleState"`.

- [ ] **Step 3: Write the implementation**

Create `src/components/Subtitle/subtitleIdleState.ts`:

```ts
// src/components/Subtitle/subtitleIdleState.ts
//
// Chooses what the subtitle window shows while no session is running. The
// rules are a small precedence chain, kept out of the component so they can
// be tested without rendering.
import type { StartBlockReason, DeviceScope } from '../MainPanel/sessionStartGate';
import type { ConversationItem } from '../../services/interfaces/IClient';

export type SubtitleIdleState =
  | { kind: 'ready' }
  | { kind: 'ended' }
  | { kind: 'starting'; completed?: number; total?: number }
  | { kind: 'blocked'; reason: StartBlockReason; balance?: number; deviceScope?: DeviceScope }
  | { kind: 'failed'; message: string };

export interface IdleStateInput {
  isInitializing: boolean;
  initProgress: { completed: number; total: number } | null;
  startGate: {
    canStart: boolean;
    reason: StartBlockReason | null;
    balance?: number;
    deviceScope?: DeviceScope;
  };
  items: ConversationItem[];
  /** True once a session has been active during this visit to subtitle mode. */
  hasRunSession: boolean;
  /**
   * Timestamp of the last start requested from the subtitle window, or null.
   * Used to tell "this session failed to start" apart from "an old session
   * happened to end on an error item" — MainPanel appends init failures to
   * items (MainPanel.tsx:1849), which is also where mid-session errors land.
   */
  startRequestedAt: number | null;
}

export function deriveSubtitleIdleState(input: IdleStateInput): SubtitleIdleState {
  const { isInitializing, initProgress, startGate, items, hasRunSession, startRequestedAt } = input;

  if (isInitializing) {
    return initProgress
      ? { kind: 'starting', completed: initProgress.completed, total: initProgress.total }
      : { kind: 'starting' };
  }

  const last = items[items.length - 1];
  const isFreshStartFailure =
    startRequestedAt !== null &&
    last?.type === 'error' &&
    (last.createdAt ?? 0) >= startRequestedAt;
  if (isFreshStartFailure) {
    return { kind: 'failed', message: last.formatted?.text ?? '' };
  }

  if (!startGate.canStart && startGate.reason) {
    return {
      kind: 'blocked',
      reason: startGate.reason,
      balance: startGate.balance,
      deviceScope: startGate.deviceScope,
    };
  }

  return hasRunSession ? { kind: 'ended' } : { kind: 'ready' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/Subtitle/subtitleIdleState.test.ts`
Expected: PASS — 14 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/Subtitle/subtitleIdleState.ts \
        src/components/Subtitle/subtitleIdleState.test.ts
git commit -m "feat(subtitle): derive the idle-state presentation from session state"
```

---

### Task 6: SubtitleIdle component

Replaces `SubtitleSessionEnded` with a presentational component covering all five states. Pure props in, callbacks out — no store access, so it tests trivially.

**Files:**
- Create: `src/components/Subtitle/SubtitleIdle.tsx`
- Create: `src/components/Subtitle/SubtitleIdle.test.tsx`
- Delete: `src/components/Subtitle/SubtitleSessionEnded.tsx`, `src/components/Subtitle/SubtitleSessionEnded.test.tsx`
- Modify: `src/components/Subtitle/SubtitleApp.scss`

**Interfaces:**
- Consumes: `SubtitleIdleState` (Task 5); `reasonToI18n` (Task 1)
- Produces: `SubtitleIdle` default export with props `{ state, onStart, onFix, onReturn }` — mounted by Task 7

- [ ] **Step 1: Write the failing test**

Create `src/components/Subtitle/SubtitleIdle.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import SubtitleIdle from './SubtitleIdle';

// i18n: return the default string passed to t(key, default).
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, d?: string, params?: Record<string, unknown>) =>
      typeof d === 'string' && params
        ? d.replace(/\{\{(\w+)\}\}/g, (_m, name) => String(params[name] ?? ''))
        : d ?? _k,
  }),
}));

const handlers = () => ({ onStart: vi.fn(), onFix: vi.fn(), onReturn: vi.fn() });

beforeEach(cleanup);

describe('SubtitleIdle ready state', () => {
  it('offers an enabled start action', () => {
    const h = handlers();
    render(<SubtitleIdle state={{ kind: 'ready' }} {...h} />);
    const btn = screen.getByRole('button', { name: /start translating/i });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    expect(h.onStart).toHaveBeenCalledTimes(1);
  });

  it('hints that the window can be positioned first', () => {
    render(<SubtitleIdle state={{ kind: 'ready' }} {...handlers()} />);
    expect(screen.getByText(/position/i)).toBeInTheDocument();
  });
});

describe('SubtitleIdle ended state', () => {
  it('says the session ended but still offers start', () => {
    const h = handlers();
    render(<SubtitleIdle state={{ kind: 'ended' }} {...h} />);
    expect(screen.getByText(/session has ended/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /start translating/i }));
    expect(h.onStart).toHaveBeenCalledTimes(1);
  });
});

describe('SubtitleIdle starting state', () => {
  it('shows progress and disables the action', () => {
    render(<SubtitleIdle state={{ kind: 'starting', completed: 3, total: 5 }} {...handlers()} />);
    expect(screen.getByText(/3\/5/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /loading/i })).toBeDisabled();
  });

  it('falls back to a generic connecting label without progress', () => {
    render(<SubtitleIdle state={{ kind: 'starting' }} {...handlers()} />);
    expect(screen.getByRole('button', { name: /connecting/i })).toBeDisabled();
  });
});

describe('SubtitleIdle blocked state', () => {
  // The primary action becomes the fix action: in a 200px-tall window a
  // greyed-out Start plus a tiny reason line puts the only useful action in
  // the smallest element on screen.
  it('turns the primary action into the fix action and routes it', () => {
    const h = handlers();
    render(
      <SubtitleIdle
        state={{ kind: 'blocked', reason: 'missing-device', deviceScope: 'speaker' }}
        {...h}
      />,
    );
    const btn = screen.getByRole('button', { name: /configure devices/i });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    expect(h.onFix).toHaveBeenCalledWith('missing-device', 'speaker');
    expect(h.onStart).not.toHaveBeenCalled();
  });

  it('interpolates the balance into the insufficient-balance message', () => {
    render(
      <SubtitleIdle state={{ kind: 'blocked', reason: 'insufficient-balance', balance: 0 }} {...handlers()} />,
    );
    expect(screen.getByRole('button', { name: /0 tokens/i })).toBeInTheDocument();
  });

  // loading-models has no settings destination, so there is nothing to click.
  it('disables the action for a transient block with no destination', () => {
    const h = handlers();
    render(<SubtitleIdle state={{ kind: 'blocked', reason: 'loading-models' }} {...h} />);
    const btn = screen.getByRole('button', { name: /loading available models/i });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(h.onFix).not.toHaveBeenCalled();
  });
});

describe('SubtitleIdle failed state', () => {
  it('shows the error text on a single line and offers retry', () => {
    const h = handlers();
    render(<SubtitleIdle state={{ kind: 'failed', message: 'Network connection error' }} {...h} />);
    const error = screen.getByText(/Network connection error/);
    expect(error.className).toContain('subtitle-idle__error');
    const retry = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(retry);
    expect(h.onStart).toHaveBeenCalledTimes(1);
  });

  it('points at the main window for the full error', () => {
    const h = handlers();
    render(<SubtitleIdle state={{ kind: 'failed', message: 'boom' }} {...h} />);
    fireEvent.click(screen.getByRole('button', { name: /details/i }));
    expect(h.onReturn).toHaveBeenCalledTimes(1);
  });
});

describe('SubtitleIdle return affordance', () => {
  it('is present in every non-starting state', () => {
    const h = handlers();
    render(<SubtitleIdle state={{ kind: 'ready' }} {...h} />);
    fireEvent.click(screen.getByRole('button', { name: /return to main window/i }));
    expect(h.onReturn).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/Subtitle/SubtitleIdle.test.tsx`
Expected: FAIL — `Failed to resolve import "./SubtitleIdle"`.

- [ ] **Step 3: Write the component**

Create `src/components/Subtitle/SubtitleIdle.tsx`:

```tsx
// src/components/Subtitle/SubtitleIdle.tsx
//
// What the subtitle window shows while no session is running. Replaces the
// old SubtitleSessionEnded, which only handled the post-session case — the
// window can now be opened before a session exists (issue #324).
//
// Purely presentational: state in, callbacks out. All store access lives in
// SubtitleApp.
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Play, RotateCcw, Loader, AlertTriangle } from 'lucide-react';
import { reasonToI18n, reasonToSettingsTarget, type StartBlockReason, type DeviceScope } from '../MainPanel/sessionStartGate';
import type { SubtitleIdleState } from './subtitleIdleState';

interface Props {
  state: SubtitleIdleState;
  onStart: () => void;
  onFix: (reason: StartBlockReason, deviceScope?: DeviceScope) => void;
  onReturn: () => void;
}

const SubtitleIdle: React.FC<Props> = ({ state, onStart, onFix, onReturn }) => {
  const { t } = useTranslation();

  if (state.kind === 'starting') {
    const label = state.total !== undefined && state.completed !== undefined
      ? t('mainPanel.initProgress', 'Loading ({{completed}}/{{total}})...', {
          completed: state.completed, total: state.total,
        })
      : t('simplePanel.connecting', 'Connecting...');
    return (
      <div className="subtitle-idle">
        <button type="button" className="subtitle-idle__action" disabled>
          <Loader size={16} className="spinning" />
          <span>{label}</span>
        </button>
      </div>
    );
  }

  if (state.kind === 'blocked') {
    const { key, defaultValue } = reasonToI18n(state.reason);
    const message = t(key, defaultValue, { balance: state.balance });
    // No destination means there is nothing for the user to fix (the model
    // list is still loading), so the action is inert rather than misleading.
    const target = reasonToSettingsTarget(state.reason, state.deviceScope);
    return (
      <div className="subtitle-idle">
        <button
          type="button"
          className="subtitle-idle__action subtitle-idle__action--fix"
          disabled={target === null}
          onClick={() => onFix(state.reason, state.deviceScope)}
        >
          <AlertTriangle size={15} />
          <span>{message}</span>
        </button>
        {target !== null && (
          <p className="subtitle-idle__hint">
            {t('subtitle.idle.fixHint', 'You can start once this is configured')}
          </p>
        )}
        <button type="button" className="subtitle-idle__link" onClick={onReturn}>
          {t('subtitle.backToMain', 'Return to main window')}
        </button>
      </div>
    );
  }

  if (state.kind === 'failed') {
    return (
      <div className="subtitle-idle">
        {/* Single truncated line: the window is user-resizable to arbitrary
            heights, so the body keeps a fixed row structure. The full text is
            one click away in the main window's conversation — the same item. */}
        <p className="subtitle-idle__error" title={state.message}>
          {t('subtitle.idle.failed', 'Failed to start: {{message}}', { message: state.message })}
        </p>
        <div className="subtitle-idle__row">
          <button type="button" className="subtitle-idle__action" onClick={onStart}>
            <RotateCcw size={15} />
            <span>{t('subtitle.idle.retry', 'Retry')}</span>
          </button>
          <button type="button" className="subtitle-idle__link" onClick={onReturn}>
            {t('subtitle.idle.backForDetails', 'Return to main window for details')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="subtitle-idle">
      <button type="button" className="subtitle-idle__action" onClick={onStart}>
        <Play size={15} />
        <span>{t('subtitle.idle.start', 'Start translating')}</span>
      </button>
      <p className="subtitle-idle__hint">
        {state.kind === 'ended'
          ? t('subtitle.idle.ended', 'This session has ended')
          : t('subtitle.idle.hint', 'Position and size the window before you start')}
      </p>
      <button type="button" className="subtitle-idle__link" onClick={onReturn}>
        {t('subtitle.backToMain', 'Return to main window')}
      </button>
    </div>
  );
};

export default SubtitleIdle;
```

- [ ] **Step 4: Add the styles**

In `src/components/Subtitle/SubtitleApp.scss`, replace both `.subtitle-session-ended` blocks (the shared layout block starting at line 38 and the button block at line 56) so the file reads:

```scss
.subtitle-ptt-hint,
.subtitle-idle {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px 24px;
  gap: 10px;
  flex-direction: column;
  min-height: 0;

  p {
    margin: 0;
    font-size: 16px;
    color: rgba(255, 255, 255, 0.7);
    letter-spacing: 0.3px;
  }
}

.subtitle-idle {
  &__row {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  &__action {
    appearance: none;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    background: #10a37f;
    color: #fff;
    border: none;
    border-radius: 8px;
    padding: 9px 20px;
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    max-width: 100%;
    transition: background 120ms ease, opacity 120ms ease;
    -webkit-app-region: no-drag;

    span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    &:hover:not(:disabled) { background: #0d8c6d; }

    &:disabled {
      background: rgba(255, 255, 255, 0.09);
      color: rgba(255, 255, 255, 0.45);
      cursor: default;
    }

    // Blocked state: the action routes to settings instead of starting.
    &--fix:not(:disabled) {
      background: rgba(231, 76, 60, 0.16);
      color: #f0a49b;
      border: 1px solid rgba(231, 76, 60, 0.45);

      &:hover { background: rgba(231, 76, 60, 0.24); }
    }
  }

  &__hint {
    font-size: 12px !important;
    color: rgba(255, 255, 255, 0.45) !important;
  }

  // One line, always. The window can be resized to any height, so the error
  // must never push the buttons out of view.
  &__error {
    font-size: 12.5px !important;
    color: #f0a49b !important;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__link {
    appearance: none;
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    font-size: 11.5px;
    color: rgba(255, 255, 255, 0.5);
    text-decoration: underline;
    cursor: pointer;
    -webkit-app-region: no-drag;

    &:hover { color: rgba(255, 255, 255, 0.75); }
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/components/Subtitle/SubtitleIdle.test.tsx`
Expected: PASS — 11 tests.

- [ ] **Step 6: Delete the superseded component**

```bash
git rm src/components/Subtitle/SubtitleSessionEnded.tsx \
       src/components/Subtitle/SubtitleSessionEnded.test.tsx
```

Run: `npx vitest run src/components/Subtitle`
Expected: FAIL — `SubtitleApp.tsx` still imports `SubtitleSessionEnded`. That is Task 7's job; do not fix it here.

- [ ] **Step 7: Commit**

```bash
git add src/components/Subtitle/SubtitleIdle.tsx \
        src/components/Subtitle/SubtitleIdle.test.tsx \
        src/components/Subtitle/SubtitleApp.scss
git commit -m "feat(subtitle): add the five-state idle body

SubtitleApp still imports the removed SubtitleSessionEnded; wired in the
next commit."
```

---

### Task 7: Wire SubtitleApp

Mounts `SubtitleIdle` in place of `SubtitleSessionEnded`, derives its state, and tracks the two pieces of local history the derivation needs.

**Files:**
- Modify: `src/components/Subtitle/SubtitleApp.tsx`

**Interfaces:**
- Consumes: `deriveSubtitleIdleState` (Task 5); `SubtitleIdle` (Task 6); store hooks `useStartGate`, `useSessionIsInitializing`, `useInitProgress`, `useRequestSessionStart`, `useRequestSessionStop` (Task 2); `useNavigateToSettings`, `useExitSubtitleMode` from settingsStore
- Produces: `sessionControl` props consumed by `SubtitleBar` in Task 8

- [ ] **Step 1: Update the imports**

In `src/components/Subtitle/SubtitleApp.tsx`:

Replace `import SubtitleSessionEnded from './SubtitleSessionEnded';` with:

```tsx
import SubtitleIdle from './SubtitleIdle';
import { deriveSubtitleIdleState } from './subtitleIdleState';
import type { StartBlockReason, DeviceScope } from '../MainPanel/sessionStartGate';
import { reasonToSettingsTarget } from '../MainPanel/sessionStartGate';
```

Add `useNavigateToSettings` to the existing `settingsStore` import list.

Add to the existing `sessionStore` import list: `useStartGate`, `useSessionIsInitializing`, `useInitProgress`, `useRequestSessionStart`, `useRequestSessionStop`.

- [ ] **Step 2: Add the state derivation**

Immediately after the existing `const requestClearConversation = useRequestClearConversation();` line, add:

```tsx
  const startGate = useStartGate();
  const sessionInitializing = useSessionIsInitializing();
  const initProgress = useInitProgress();
  const requestSessionStart = useRequestSessionStart();
  const requestSessionStop = useRequestSessionStop();
  const navigateToSettings = useNavigateToSettings();

  // "A session has run during this visit to subtitle mode" — drives the
  // ended-vs-never-started headline. translationCount cannot be used: it
  // survives endSession, and a session can legitimately end with zero
  // translations.
  const hasRunSessionRef = useRef(false);
  if (isSessionActive && !hasRunSessionRef.current) hasRunSessionRef.current = true;

  // Timestamp of the last start requested from this window. Lets the idle
  // state tell a genuine start failure apart from an old error item that
  // happens to sit at the end of the conversation.
  const startRequestedAtRef = useRef<number | null>(null);
  const handleStart = useCallback(() => {
    startRequestedAtRef.current = Date.now();
    requestSessionStart();
  }, [requestSessionStart]);

  const handleFix = useCallback((reason: StartBlockReason, deviceScope?: DeviceScope) => {
    const target = reasonToSettingsTarget(reason, deviceScope);
    if (!target) return;
    // Leave subtitle mode first so the main window is restored before the
    // settings panel opens and scrolls to the section.
    void exitSubtitleMode();
    navigateToSettings(target);
  }, [exitSubtitleMode, navigateToSettings]);

  const idleState = deriveSubtitleIdleState({
    isInitializing: sessionInitializing,
    initProgress,
    startGate,
    items,
    hasRunSession: hasRunSessionRef.current,
    startRequestedAt: startRequestedAtRef.current,
  });
```

- [ ] **Step 3: Pass the session controls to the bar**

Change the `<SubtitleBar ... />` element to add one prop, after `surface={surface}`:

```tsx
        sessionControl={{
          isSessionActive,
          isInitializing: sessionInitializing,
          canStart: startGate.canStart,
          onStart: handleStart,
          onStop: requestSessionStop,
        }}
```

- [ ] **Step 4: Swap the idle branch**

Replace:

```tsx
      ) : (
        <SubtitleSessionEnded onReturn={requestExit} />
      )}
```

with:

```tsx
      ) : (
        <SubtitleIdle
          state={idleState}
          onStart={handleStart}
          onFix={handleFix}
          onReturn={requestExit}
        />
      )}
```

- [ ] **Step 5: Run the subtitle suite**

Run: `npx vitest run src/components/Subtitle`
Expected: PASS. (Task 8 adds the `sessionControl` prop to SubtitleBar; until then TypeScript flags an unknown prop but Vitest/esbuild does not type-check, so tests still run. If SubtitleBar's tests fail because the extra prop reaches the DOM, that is a real bug — SubtitleBar must not spread unknown props onto elements.)

- [ ] **Step 6: Commit**

```bash
git add src/components/Subtitle/SubtitleApp.tsx
git commit -m "feat(subtitle): render the idle body and route start/stop requests"
```

---

### Task 8: Start/Stop pill in the subtitle bar

A persistent control in the toolbar so Stop is reachable during a session (when the body is full of subtitles) and Start keeps a fixed home across states.

**Files:**
- Modify: `src/components/Subtitle/SubtitleBar.tsx`
- Modify: `src/components/Subtitle/SubtitleBar.scss`
- Modify: `src/components/Subtitle/SubtitleBar.test.tsx`

**Interfaces:**
- Consumes: `sessionControl` prop from Task 7
- Produces: nothing downstream

- [ ] **Step 1: Write the failing test**

Append to `src/components/Subtitle/SubtitleBar.test.tsx`:

```tsx
describe('SubtitleBar session pill', () => {
  // Shaped by hand rather than derived from the component's props type — this
  // test file does not import React.
  interface SessionControl {
    isSessionActive: boolean;
    isInitializing: boolean;
    canStart: boolean;
    onStart: ReturnType<typeof vi.fn>;
    onStop: ReturnType<typeof vi.fn>;
  }
  const control = (over: Partial<SessionControl> = {}): SessionControl => ({
    isSessionActive: false,
    isInitializing: false,
    canStart: true,
    onStart: vi.fn(),
    onStop: vi.fn(),
    ...over,
  });

  it('renders a start pill when idle and ready', () => {
    const c = control();
    render(<SubtitleBar {...baseProps} surface="electron" sessionControl={c} />);
    const btn = screen.getByLabelText('Start session');
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    expect(c.onStart).toHaveBeenCalledTimes(1);
  });

  it('disables the start pill when the session cannot start', () => {
    const c = control({ canStart: false });
    render(<SubtitleBar {...baseProps} surface="electron" sessionControl={c} />);
    expect(screen.getByLabelText('Start session')).toBeDisabled();
  });

  it('renders a stop pill during a session', () => {
    const c = control({ isSessionActive: true });
    render(<SubtitleBar {...baseProps} surface="electron" sessionControl={c} />);
    const btn = screen.getByLabelText('Stop session');
    fireEvent.click(btn);
    expect(c.onStop).toHaveBeenCalledTimes(1);
  });

  it('disables the pill while initializing', () => {
    const c = control({ isInitializing: true });
    render(<SubtitleBar {...baseProps} surface="electron" sessionControl={c} />);
    expect(screen.getByLabelText('Start session')).toBeDisabled();
  });

  // Start/stop from the overlay is out of scope: the side panel is always
  // visible there and owns session control.
  it('does NOT render the pill on the extension-overlay surface', () => {
    render(<SubtitleBar {...baseProps} surface="extension-overlay" sessionControl={control()} />);
    expect(screen.queryByLabelText('Start session')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Stop session')).not.toBeInTheDocument();
  });

  it('renders nothing when no session control is supplied', () => {
    render(<SubtitleBar {...baseProps} surface="electron" />);
    expect(screen.queryByLabelText('Start session')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/Subtitle/SubtitleBar.test.tsx`
Expected: FAIL — `Unable to find a label with the text of: Start session`.

- [ ] **Step 3: Implement the pill**

In `src/components/Subtitle/SubtitleBar.tsx`, add to the `Props` interface:

```tsx
  /**
   * Session start/stop, Electron surface only. Absent on the extension
   * overlay, where the side panel owns session control.
   */
  sessionControl?: {
    isSessionActive: boolean;
    isInitializing: boolean;
    canStart: boolean;
    onStart: () => void;
    onStop: () => void;
  };
```

Add `sessionControl` to the destructured props.

Add `Play`, `Square` and `Loader` to the existing `lucide-react` import.

Inside `<div className="subtitle-bar__left">`, before the `subtitle-bar__logo` span, insert:

```tsx
        {surface === 'electron' && sessionControl && (
          <button
            type="button"
            className={`subtitle-bar__session ${sessionControl.isSessionActive ? 'is-stop' : 'is-start'}`}
            onClick={sessionControl.isSessionActive ? sessionControl.onStop : sessionControl.onStart}
            disabled={
              sessionControl.isInitializing ||
              (!sessionControl.isSessionActive && !sessionControl.canStart)
            }
            title={sessionControl.isSessionActive
              ? t('subtitle.bar.stop', 'Stop session')
              : t('subtitle.bar.start', 'Start session')}
            aria-label={sessionControl.isSessionActive
              ? t('subtitle.bar.stop', 'Stop session')
              : t('subtitle.bar.start', 'Start session')}
          >
            {sessionControl.isInitializing
              ? <Loader size={11} className="spinning" />
              : sessionControl.isSessionActive
                ? <Square size={11} />
                : <Play size={11} />}
          </button>
        )}
```

- [ ] **Step 4: Add the pill styles**

Append to `src/components/Subtitle/SubtitleBar.scss`:

```scss
.subtitle-bar__session {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 18px;
  border: none;
  border-radius: 999px;
  color: #fff;
  cursor: pointer;
  padding: 0;
  -webkit-app-region: no-drag;
  transition: background 120ms ease, opacity 120ms ease;

  &.is-start { background: #10a37f; }
  &.is-stop  { background: #e74c3c; }

  &:disabled {
    background: rgba(255, 255, 255, 0.12);
    color: rgba(255, 255, 255, 0.4);
    cursor: default;
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/components/Subtitle/SubtitleBar.test.tsx`
Expected: PASS — the 6 new tests plus the existing ones.

- [ ] **Step 6: Commit**

```bash
git add src/components/Subtitle/SubtitleBar.tsx \
        src/components/Subtitle/SubtitleBar.scss \
        src/components/Subtitle/SubtitleBar.test.tsx
git commit -m "feat(subtitle): add a persistent start/stop control to the bar"
```

---

### Task 9: Ungate the subtitle entry button

Removes the session requirement on Electron while keeping it on the extension.

**Files:**
- Modify: `src/components/Subtitle/SubtitleEnterButton.tsx`
- Create: `src/components/Subtitle/SubtitleEnterButton.test.tsx`

**Interfaces:**
- Consumes: `isElectron`, `isExtension` from `src/utils/environment`
- Produces: nothing downstream

- [ ] **Step 1: Write the failing test**

Create `src/components/Subtitle/SubtitleEnterButton.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import SubtitleEnterButton from './SubtitleEnterButton';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, d?: string) => d ?? _k }),
}));

let sessionActive = false;
vi.mock('../../stores/sessionStore', () => ({
  useIsSessionActive: () => sessionActive,
}));

const enterSubtitleMode = vi.fn(async () => {});
let subtitleActive = false;
vi.mock('../../stores/settingsStore', () => ({
  useEnterSubtitleMode: () => enterSubtitleMode,
  useExitSubtitleMode: () => vi.fn(async () => {}),
  useSubtitleModeActive: () => subtitleActive,
}));

vi.mock('../Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));

let electron = true;
vi.mock('../../utils/environment', () => ({
  isElectron: () => electron,
  isExtension: () => !electron,
}));

beforeEach(() => {
  cleanup();
  enterSubtitleMode.mockClear();
  sessionActive = false;
  subtitleActive = false;
  electron = true;
});

describe('SubtitleEnterButton on Electron', () => {
  // Issue #324: the window is the place users size and position ahead of the
  // meeting, so it must open before a session exists.
  it('is enabled with no active session', () => {
    render(<SubtitleEnterButton />);
    const btn = screen.getByRole('button');
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    expect(enterSubtitleMode).toHaveBeenCalledTimes(1);
  });

  it('is enabled during a session', () => {
    sessionActive = true;
    render(<SubtitleEnterButton />);
    expect(screen.getByRole('button')).toBeEnabled();
  });
});

describe('SubtitleEnterButton on the extension', () => {
  // Out of scope for #324: the side panel is always visible there and can
  // start the session itself, so the overlay stays session-gated.
  it('stays disabled without a session', () => {
    electron = false;
    render(<SubtitleEnterButton />);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('is enabled once a session is running', () => {
    electron = false;
    sessionActive = true;
    render(<SubtitleEnterButton />);
    expect(screen.getByRole('button')).toBeEnabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/Subtitle/SubtitleEnterButton.test.tsx`
Expected: FAIL — the first test finds a disabled button.

- [ ] **Step 3: Implement**

In `src/components/Subtitle/SubtitleEnterButton.tsx`, replace the tooltip and `disabled` computation:

```tsx
  // The Electron subtitle window carries its own Start control, so it can be
  // opened at any time — users position and size it before the meeting
  // (issue #324). The extension overlay has no such control (the side panel
  // owns session control there), so it stays session-gated.
  const canEnter = isElectron() || isSessionActive;
  const enterTooltip = canEnter
    ? t('subtitle.enterButton.title', 'Enter subtitle mode')
    : t('subtitle.enterButton.disabled', 'Start a session first');
```

and:

```tsx
  // Exit is always available while active; Enter is gated only on the
  // extension surface.
  const disabled = subtitleActive ? false : !canEnter;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/Subtitle/SubtitleEnterButton.test.tsx`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/Subtitle/SubtitleEnterButton.tsx \
        src/components/Subtitle/SubtitleEnterButton.test.tsx
git commit -m "feat(subtitle): allow entering subtitle mode before a session (Electron)"
```

---

### Task 10: Translations and end-to-end verification

**Files:**
- Modify: `src/locales/en/translation.json`

**Interfaces:**
- Consumes: the `subtitle.idle.*` and `subtitle.bar.*` keys referenced in Tasks 6 and 8
- Produces: nothing downstream

- [ ] **Step 1: Add the English strings**

In `src/locales/en/translation.json`, inside the `"subtitle"` object, add an
`"idle"` block next to the existing `"sessionEnded"` / `"backToMain"` keys:

```json
    "idle": {
      "start": "Start translating",
      "hint": "Position and size the window before you start",
      "ended": "This session has ended",
      "fixHint": "You can start once this is configured",
      "failed": "Failed to start: {{message}}",
      "retry": "Retry",
      "backForDetails": "Return to main window for details"
    },
```

and add to the existing `"subtitle.bar"` object:

```json
      "start": "Start session",
      "stop": "Stop session",
```

Leave `subtitle.sessionEnded` in place — other locales still carry it and
removing a key from 30 files is out of scope.

- [ ] **Step 2: Verify the JSON parses**

Run: `node -e "JSON.parse(require('fs').readFileSync('src/locales/en/translation.json','utf8')); console.log('ok')"`
Expected: `ok`

- [ ] **Step 3: Run the whole suite**

Run: `npx vitest run`
Expected: PASS — no regressions; the subtitle directory should now report
substantially more than the 60 baseline tests.

- [ ] **Step 4: Manual QA in Electron**

Run: `npm run electron:dev`

Walk the full matrix:

1. **Pre-session entry** — with no session, click Subtitle in the title bar. The window shrinks to the bar and shows "Start translating".
2. **Position persistence** — drag and resize the bar, click Start, confirm the window stays exactly where it was put.
3. **Start from the window** — the session starts, subtitles stream, the bar's pill turns red.
4. **Stop from the window** — click the red pill; the window returns to the idle body with "This session has ended" and an enabled Start.
5. **Restart** — click Start again from the same idle body; a second session runs.
6. **Blocked** — exit subtitle mode, clear the API key in settings, re-enter subtitle mode. The body shows the API-key message as the primary action; clicking it restores the main window with the provider settings open and highlighted.
7. **Missing device** — same flow with the microphone deselected; verify it lands on the microphone section.
8. **Loading** — with a local-inference provider that must load models, confirm the body shows `Loading (n/m)...` and both controls are disabled.
9. **Failure** — set an invalid API key so start fails; confirm the body shows a one-line error with Retry, that Retry re-attempts, and that the line does not wrap or push the buttons out of view when the window is dragged to its minimum height.
10. **Fullscreen and ESC** — enter fullscreen from the idle state, press ESC once (back to windowed), press ESC again (exits subtitle mode).

- [ ] **Step 5: Manual QA in the extension (regression only)**

Load the extension build and confirm the Subtitle button in the side panel is
still disabled until a session is running, and that entering subtitle mode
mid-session still works. Nothing about the overlay should have changed.

- [ ] **Step 6: Commit**

```bash
git add src/locales/en/translation.json
git commit -m "i18n(subtitle): add idle-state and session-control strings"
```

- [ ] **Step 7: Open the PR (ask first)**

Do not push or open a PR without explicit approval. When approved:

```bash
git push -u origin feat/subtitle-pre-session-start
gh pr create --title "feat(subtitle): open the subtitle window before a session starts" --body "$(cat <<'EOF'
Closes #324.

The subtitle window can now be opened with no session running, so users can
position it, size it, and preview display settings before the meeting starts.
It carries its own Start/Stop control: a persistent pill in the toolbar and a
primary action in the idle body.

- `computeStartGate()` is a new pure function that answers "can the session
  start, and if not why". It replaces the two duplicated tooltip chains in
  MainPanel and is mirrored into `sessionStore` for the subtitle window, so the
  two surfaces can never word a blocker differently.
- Start/stop travel back as monotonic version counters watched by
  `useSubtitleSessionBridge()`, the same pattern as `requestClearConversation`.
  Session logic stays entirely in MainPanel.
- When the session cannot start, the idle body's primary action becomes the fix
  action and routes to the responsible settings section.
- Start failures reuse the error item MainPanel already appends to `items` —
  no new state.

The extension overlay deliberately stays session-gated: the side panel is always
visible there and owns session control.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Follow-ups (not in this plan)

- Translate the new `subtitle.idle.*` / `subtitle.bar.start|stop` keys into the
  other 29 locales.
- The toast stack (`position: fixed; bottom: 24px`, portaled to `document.body`)
  overlays the subtitle body in subtitle mode. No current subtitle-mode path
  raises a toast, so it is documented in the spec as a known limitation rather
  than fixed here.
- Extension overlay start/stop, if it is ever wanted, needs
  `subtitleWire` messages plus a mirrored gate over the port.
