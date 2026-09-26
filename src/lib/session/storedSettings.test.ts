import { describe, expect, it } from 'vitest';
import { Provider } from '../../types/Provider';
import {
  LEGACY_PROVIDER_IDS,
  LEGACY_SLICE_KEYS,
  legacyTurnModeKey,
  migrateTurnMode,
  providerIdFromStored,
  selectionFromStored,
  selectionToPersist,
  storedProviderValue,
  turnModeFromLegacy,
} from './storedSettings';

describe('providerIdFromStored', () => {
  it('maps a legacy id to the registry spelling', () => {
    expect(providerIdFromStored('local_inference')).toBe('localInference');
  });

  it('passes through a value that is already the registry spelling', () => {
    expect(providerIdFromStored('localInference')).toBe('localInference');
  });

  it('passes through a value with no legacy mapping', () => {
    expect(providerIdFromStored('soniox')).toBe('soniox');
  });

  it.each([['', null], ['  ', null], [undefined, null], [42, null]] as const)(
    '%s -> %s',
    (stored, expected) => {
      expect(providerIdFromStored(stored)).toBe(expected);
    },
  );
});

describe('storedProviderValue', () => {
  it('maps the registry spelling back to the legacy id', () => {
    expect(storedProviderValue('localInference')).toBe('local_inference');
  });

  it('passes through an id with no legacy mapping', () => {
    expect(storedProviderValue('fake')).toBe('fake');
  });

  it('round-trips every LEGACY_PROVIDER_IDS entry', () => {
    for (const legacy of Object.keys(LEGACY_PROVIDER_IDS)) {
      expect(storedProviderValue(providerIdFromStored(legacy)!)).toBe(legacy);
    }
  });
});

describe('selectionFromStored', () => {
  const offered = ['localInference', 'fake'];

  it('selects the stored provider when offered, in its legacy spelling', () => {
    expect(selectionFromStored('local_inference', offered)).toEqual({ id: 'localInference', fromStorage: true });
  });

  it('selects the stored provider when offered, already in registry spelling', () => {
    expect(selectionFromStored('fake', offered)).toEqual({ id: 'fake', fromStorage: true });
  });

  it('falls back to the first offered provider when the stored one is not offered', () => {
    expect(selectionFromStored('soniox', offered)).toEqual({ id: 'localInference', fromStorage: false });
  });

  it('falls back to the first offered provider when nothing is stored', () => {
    expect(selectionFromStored(undefined, offered)).toEqual({ id: 'localInference', fromStorage: false });
  });

  it('returns null when nothing is offered', () => {
    expect(selectionFromStored('local_inference', [])).toBeNull();
  });
});

describe('selectionToPersist', () => {
  it('writes nothing for a load, even when the id has a legacy spelling', () => {
    expect(selectionToPersist('localInference', 'load')).toBeNull();
  });

  it('writes nothing for a load, for an id with no legacy spelling', () => {
    expect(selectionToPersist('fake', 'load')).toBeNull();
  });

  it('writes the legacy spelling for an explicit pick', () => {
    expect(selectionToPersist('localInference', 'pick')).toBe('local_inference');
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

  it('finds the slice for the registry spelling of local inference', () => {
    expect(legacyTurnModeKey('localInference')).toBe('settings.localInference.turnDetectionMode');
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
