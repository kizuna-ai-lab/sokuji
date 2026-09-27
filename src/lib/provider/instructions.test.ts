import { describe, it, expect } from 'vitest';
import { useSettingsStore } from '../../stores/settingsStore';
import {
  COMMON_INSTRUCTION_KEYS,
  INSTRUCTION_LEGACY_KEYS,
  INSTRUCTIONS_DEFAULTS,
  INSTRUCTIONS_TEMPLATE,
  migrateInstructions,
  resolveInstructions,
  type InstructionsSettings,
} from './instructions';

const stored = (patch: Partial<InstructionsSettings> = {}): Record<string, unknown> => ({ ...INSTRUCTIONS_DEFAULTS, ...patch });

describe('the instructions a provider owns (Stage 2 Gemini, ruling 4)', () => {
  it("start from the old app's defaults, word for word: Quick mode, its default prompt, no Other's prompt, its template", () => {
    // The old store is read here only, as the parity pin (choice 2): new code imports nothing from it.
    const old = useSettingsStore.getState();
    expect(INSTRUCTIONS_TEMPLATE).toBe(old.templateSystemInstructions);
    expect(INSTRUCTIONS_DEFAULTS).toEqual({
      useTemplateMode: old.useTemplateMode,
      systemInstructions: old.systemInstructions,
      participantSystemInstructions: old.participantSystemInstructions,
    });
    expect(INSTRUCTIONS_DEFAULTS.useTemplateMode).toBe(true);
    expect(INSTRUCTIONS_TEMPLATE).toContain('{{SOURCE_LANGUAGE}} → {{TARGET_LANGUAGE}}');
  });

  it('fills the template with the English names of the direction it resolves', () => {
    const text = resolveInstructions(INSTRUCTIONS_DEFAULTS, { participant: false, source: 'English (United States)', target: 'Japanese (Japan)' });
    expect(text).toContain('translate English (United States) → Japanese (Japan).');
    expect(text).toContain('Output ONLY the Japanese (Japan) translation.');
    expect(text).not.toMatch(/\{\{/);
    // The reverse direction is the same template with the names swapped (the old rule, `settingsStore.ts:1446-1452`).
    expect(resolveInstructions(INSTRUCTIONS_DEFAULTS, { participant: true, source: 'Japanese (Japan)', target: 'English (United States)' }))
      .toContain('translate Japanese (Japan) → English (United States).');
  });

  it("reads the user's prompt for the speaker's direction, Other's for the reverse, and the user's when Other's is blank", () => {
    const s: InstructionsSettings = { useTemplateMode: false, systemInstructions: 'mine', participantSystemInstructions: 'theirs' };
    expect(resolveInstructions(s, { participant: false, source: 'x', target: 'y' })).toBe('mine');
    expect(resolveInstructions(s, { participant: true, source: 'x', target: 'y' })).toBe('theirs');
    expect(resolveInstructions({ ...s, participantSystemInstructions: '   ' }, { participant: true, source: 'x', target: 'y' })).toBe('mine');
  });

  it('lists its own three fields, then the three global keys, as legacy keys', () => {
    expect(COMMON_INSTRUCTION_KEYS).toEqual({
      useTemplateMode: 'settings.common.useTemplateMode',
      systemInstructions: 'settings.common.systemInstructions',
      participantSystemInstructions: 'settings.common.participantSystemInstructions',
    });
    expect(INSTRUCTION_LEGACY_KEYS).toEqual([
      'useTemplateMode', 'systemInstructions', 'participantSystemInstructions',
      'settings.common.useTemplateMode', 'settings.common.systemInstructions', 'settings.common.participantSystemInstructions',
    ]);
  });

  describe('migrateInstructions (choice 1)', () => {
    it('turns the defaults, nothing stored anywhere, into the defaults', () => {
      expect(migrateInstructions(stored(), {})).toEqual(INSTRUCTIONS_DEFAULTS);
    });

    it("starts from the old app's global copy while the provider has written none, field by field", () => {
      const legacy = {
        'settings.common.useTemplateMode': false,
        'settings.common.systemInstructions': 'global mine',
        'settings.common.participantSystemInstructions': 'global theirs',
      };
      expect(migrateInstructions(stored(), legacy)).toEqual({ useTemplateMode: false, systemInstructions: 'global mine', participantSystemInstructions: 'global theirs' });
    });

    it("keeps the provider's own value once written — even one equal to the default — over the global one", () => {
      const legacy = {
        systemInstructions: INSTRUCTIONS_DEFAULTS.systemInstructions,
        'settings.common.systemInstructions': 'global mine',
        'settings.common.useTemplateMode': false,
      };
      // `systemInstructions` was written (legacy holds it): the stored value. `useTemplateMode` never was: the global.
      expect(migrateInstructions(stored(), legacy)).toEqual({ ...INSTRUCTIONS_DEFAULTS, useTemplateMode: false });
      // Written as the provider's own, the edited value wins.
      expect(migrateInstructions(stored({ systemInstructions: 'edited' }), { systemInstructions: 'edited', 'settings.common.systemInstructions': 'global mine' }))
        .toMatchObject({ systemInstructions: 'edited' });
    });

    it('reads back what localStorage parsed as the text it was, and anything else as the default', () => {
      const legacy = {
        'settings.common.systemInstructions': 123,
        'settings.common.participantSystemInstructions': { x: 1 },
        'settings.common.useTemplateMode': 'false',
      };
      expect(migrateInstructions(stored(), legacy)).toEqual({ useTemplateMode: false, systemInstructions: '123', participantSystemInstructions: '' });
    });
  });
});
