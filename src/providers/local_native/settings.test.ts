import { describe, expect, it } from 'vitest';
import { AUTO } from '../../lib/provider/languages';
import { LOCAL_NATIVE_DEFAULTS, localNativeLanguages, migrateLocalNativeSettings } from './settings';

describe('Local Native settings', () => {
  // The old slice's fields (`LocalNativeProviderConfig.ts`, `defaultLocalNativeSettings`),
  // less the ones the global pair, the turn mode and the app's turn detection own: each stored value is read under
  // the same `settings.localNative.<field>` key, as it is (#578 ruling 7).
  const OLD_SLICE_FIELDS = [
    'selections', 'ttsSpeed',
    'useTemplateMode', 'systemPrompt', 'asrDevice', 'translationDevice', 'ttsDevice', 'ttsVoice',
  ];

  it("reads the old slice's saved fields as they are, with one new field", () => {
    expect(Object.keys(LOCAL_NATIVE_DEFAULTS).sort()).toEqual([...OLD_SLICE_FIELDS, 'participantSystemPrompt'].sort());
  });

  it("keeps the old slice's defaults", () => {
    expect(LOCAL_NATIVE_DEFAULTS).toEqual({
      selections: {}, ttsSpeed: 1.0, ttsVoice: '',
      asrDevice: 'auto', translationDevice: 'auto', ttsDevice: 'auto',
      useTemplateMode: true, systemPrompt: '', participantSystemPrompt: '',
    });
  });

  it('never offers AUTO, offers a target for every source, and starts ja → en', () => {
    const sources = localNativeLanguages.sources(LOCAL_NATIVE_DEFAULTS).map((o) => o.value);
    expect(sources.length).toBeGreaterThan(0);
    expect(sources).not.toContain(AUTO);
    for (const source of sources) {
      const targets = localNativeLanguages.targets(source, LOCAL_NATIVE_DEFAULTS).map((o) => o.value);
      expect(targets.length, source).toBeGreaterThan(0);
      expect(targets, source).not.toContain(source);
    }
    expect(localNativeLanguages.initial?.(LOCAL_NATIVE_DEFAULTS)).toEqual({ source: 'ja', target: 'en' });
  });

  // A device stored by an earlier build may be a value this version no longer has ('cuda' before it was renamed,
  // anything else a test build wrote): read as what it meant, never handed on as is (the slot badge threw on it).
  it('reads a stored compute device it does not know as gpu (cuda) or auto, and leaves the known ones', () => {
    const stored = { ...LOCAL_NATIVE_DEFAULTS, asrDevice: 'cuda', translationDevice: 'vulkan', ttsDevice: undefined } as Record<string, unknown>;
    const out = migrateLocalNativeSettings(stored);
    expect(out.asrDevice).toBe('gpu');
    expect(out.translationDevice).toBe('auto');
    expect(out.ttsDevice).toBe('auto');
    expect(migrateLocalNativeSettings({ ...LOCAL_NATIVE_DEFAULTS, asrDevice: 'cpu', translationDevice: 'gpu' })).toEqual(
      { ...LOCAL_NATIVE_DEFAULTS, asrDevice: 'cpu', translationDevice: 'gpu' });
  });
});
