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
