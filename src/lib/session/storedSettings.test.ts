import { describe, expect, it } from 'vitest';
import { Provider } from '../../types/Provider';
import {
  LEGACY_SLICE_KEYS,
  legacyTurnModeKey,
  migrateTurnMode,
  providerIdFromStored,
  selectionFromStored,
  selectionToPersist,
  turnModeFromLegacy,
} from './storedSettings';

describe('providerIdFromStored', () => {
  it('passes a stored id through as it is: every registered id is the old enum spelling', () => {
    expect(providerIdFromStored('local_inference')).toBe('local_inference');
    expect(providerIdFromStored('soniox')).toBe('soniox');
  });

  it('passes through a value this build may not offer, for Stage 2 to find', () => {
    expect(providerIdFromStored('openai_compatible')).toBe('openai_compatible');
  });

  it.each([['', null], ['  ', null], [undefined, null], [42, null]] as const)(
    '%s -> %s',
    (stored, expected) => {
      expect(providerIdFromStored(stored)).toBe(expected);
    },
  );
});

describe('selectionFromStored', () => {
  const offered = ['local_inference', 'fake'];

  it('selects the stored provider when offered', () => {
    expect(selectionFromStored('local_inference', offered)).toEqual({ id: 'local_inference', fromStorage: true });
  });

  it('selects the stored development provider when offered', () => {
    expect(selectionFromStored('fake', offered)).toEqual({ id: 'fake', fromStorage: true });
  });

  it('falls back to the first offered provider when the stored one is not offered', () => {
    expect(selectionFromStored('soniox', offered)).toEqual({ id: 'local_inference', fromStorage: false });
  });

  it('falls back to the first offered provider when nothing is stored', () => {
    expect(selectionFromStored(undefined, offered)).toEqual({ id: 'local_inference', fromStorage: false });
  });

  it('returns null when nothing is offered', () => {
    expect(selectionFromStored('local_inference', [])).toBeNull();
  });

  it('sends a stored managed id this build does not port to the default managed provider', () => {
    // The managed default is NOT the first offered id, so a plain fallback to
    // offered[0] would land on 'local_inference' — only the legacy-managed
    // branch reaches 'kizunaai_soniox' here.
    const managedOffered = ['local_inference', 'kizunaai_soniox'];
    expect(selectionFromStored('kizunaai', managedOffered, 'kizunaai_soniox')).toEqual({ id: 'kizunaai_soniox', fromStorage: false });
    expect(selectionFromStored('kizunaai_openai_translate', managedOffered, 'kizunaai_soniox')).toEqual({ id: 'kizunaai_soniox', fromStorage: false });
    expect(selectionFromStored('kizunaai_volcengine_ast2', managedOffered, 'kizunaai_soniox')).toEqual({ id: 'kizunaai_soniox', fromStorage: false });
  });

  it('falls back to the first offered when no managed provider is offered', () => {
    expect(selectionFromStored('kizunaai', ['local_inference'], null)).toEqual({ id: 'local_inference', fromStorage: false });
  });

  it('keeps a stored managed provider that is offered', () => {
    expect(selectionFromStored('kizunaai_soniox', ['kizunaai_soniox', 'local_inference'], 'kizunaai_soniox')).toEqual({ id: 'kizunaai_soniox', fromStorage: true });
  });

  it('an unrelated stored id still falls back to the first offered', () => {
    // Same offered/managedDefault as the legacy-managed case above: an id
    // outside MANAGED_LEGACY_IDS must not also ride the managed-default branch.
    expect(selectionFromStored('openai', ['local_inference', 'kizunaai_soniox'], 'kizunaai_soniox')).toEqual({ id: 'local_inference', fromStorage: false });
  });
});

describe('selectionToPersist', () => {
  it('writes nothing for a load', () => {
    expect(selectionToPersist('local_inference', 'load')).toBeNull();
    expect(selectionToPersist('fake', 'load')).toBeNull();
  });

  it('writes the id for an explicit pick', () => {
    expect(selectionToPersist('local_inference', 'pick')).toBe('local_inference');
  });

  it('writes the id itself for an explicit pick when it has no legacy spelling', () => {
    expect(selectionToPersist('fake', 'pick')).toBe('fake');
  });
});

describe('LEGACY_SLICE_KEYS', () => {
  it('has a key for every value of the Provider enum', () => {
    for (const value of Object.values(Provider)) {
      expect(LEGACY_SLICE_KEYS[value], `LEGACY_SLICE_KEYS['${value}']`).toBeDefined();
    }
  });
});

describe('legacyTurnModeKey', () => {
  it('finds the slice for a plain provider', () => {
    expect(legacyTurnModeKey('openai')).toBe('settings.openai.turnDetectionMode');
  });

  it('finds the slice for a provider whose slice key differs in casing/shape', () => {
    expect(legacyTurnModeKey('volcengine_ast2')).toBe('settings.volcengineAST2.turnDetectionMode');
  });

  it('finds the slice for the legacy spelling of local inference', () => {
    expect(legacyTurnModeKey('local_inference')).toBe('settings.localInference.turnDetectionMode');
  });

  it('returns null for a provider with no old turn-mode slice', () => {
    expect(legacyTurnModeKey('kizunaai')).toBeNull();
  });

  it('returns null when nothing is stored', () => {
    expect(legacyTurnModeKey(undefined)).toBeNull();
  });
});

describe('turnModeFromLegacy', () => {
  it('maps Push-to-Talk to push-to-talk', () => {
    expect(turnModeFromLegacy('Push-to-Talk')).toBe('push-to-talk');
  });

  it('maps Push-to-Translate to push-to-translate', () => {
    expect(turnModeFromLegacy('Push-to-Translate')).toBe('push-to-translate');
  });

  it.each(['Normal', 'Semantic', 'Disabled', 'Auto', undefined, 'push-to-talk'])(
    '%s -> auto',
    (mode) => {
      expect(turnModeFromLegacy(mode)).toBe('auto');
    },
  );
});

describe('migrateTurnMode', () => {
  it('migrates from the legacy slice when the global mode was never written', () => {
    expect(migrateTurnMode('', 'Push-to-Talk')).toEqual({ turnMode: 'push-to-talk', write: true });
  });

  it('migrates to auto when neither the global mode nor a legacy value exists', () => {
    expect(migrateTurnMode(undefined, undefined)).toEqual({ turnMode: 'auto', write: true });
  });

  it('keeps the already-written global mode and does not write', () => {
    expect(migrateTurnMode('push-to-translate', 'Push-to-Talk')).toEqual({ turnMode: 'push-to-translate', write: false });
  });

  it('falls back to auto for a written but unrecognized global mode, and does not write', () => {
    expect(migrateTurnMode('bogus', 'Push-to-Talk')).toEqual({ turnMode: 'auto', write: false });
  });
});
