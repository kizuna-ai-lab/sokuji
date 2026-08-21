import { describe, it, expect } from 'vitest';
import {
  MISSING_DEVICE_CHIP_HINT,
  MISSING_DEVICE_CHIP_LABEL,
  MISSING_DEVICE_NAMES,
  missingDeviceChipText,
} from './missingDeviceChip';
import type { DeviceScope } from './sessionStartGate';
import en from '../../locales/en/translation.json';

// Resolves to the inline English default and applies {{...}} interpolation,
// so what is asserted is the copy that actually ships rather than a key.
const translate = (_k: string, d: string, v?: Record<string, string>) =>
  Object.entries(v ?? {}).reduce((s, [name, value]) => s.replace(`{{${name}}}`, value), d);

const SCOPES: DeviceScope[] = ['speaker', 'participant', 'both'];

/**
 * The chip's copy lives in a pure module for the same reason splitDegraded's
 * does: it can be pinned without a React harness, and the component is left
 * with nothing but a render.
 */
describe('missingDeviceChipText', () => {
  it('names the microphone when the speaker channel has no device', () => {
    // The only scope reachable today — see MISSING_DEVICE_NAMES' note.
    expect(missingDeviceChipText('speaker', translate).label).toBe('Microphone not selected');
  });

  it('names participant audio when the participant channel has no device', () => {
    expect(missingDeviceChipText('participant', translate).label).toBe("Other's audio not selected");
  });

  it('names both devices when neither channel has one', () => {
    expect(missingDeviceChipText('both', translate).label).toBe("Microphone + Other's audio not selected");
  });

  it('follows the label with the remedy on hover', () => {
    // Same cause-then-remedy shape splitDegradedChipText uses, and the blank
    // line is what makes an unstyled native title read as two thoughts.
    const { label, title } = missingDeviceChipText('speaker', translate);
    expect(title).toBe(`${label}\n\n${MISSING_DEVICE_CHIP_HINT.defaultValue}`);
  });

  it('resolves a real sentence for every scope, never a raw key', () => {
    // Iterates the scope union rather than a hand-written list so a fourth
    // scope cannot ship without copy behind it.
    for (const scope of SCOPES) {
      const { label } = missingDeviceChipText(scope, translate);
      expect(label, `no label for ${scope}`).toBeTruthy();
      expect(label, `unsubstituted placeholder for ${scope}`).not.toMatch(/\{\{/);
      expect(label, `raw i18n key rendered for ${scope}`).not.toMatch(/^[a-zA-Z]+\.[a-zA-Z0-9]+$/);
    }
  });
});

describe('the strings this module names actually exist in the English catalog', () => {
  const flat = (o: unknown, prefix = ''): Record<string, string> => {
    const out: Record<string, string> = {};
    if (o && typeof o === 'object' && !Array.isArray(o)) {
      for (const [k, v] of Object.entries(o)) Object.assign(out, flat(v, prefix ? `${prefix}.${k}` : k));
    } else {
      out[prefix] = o as string;
    }
    return out;
  };
  const EN = flat(en);

  it('the chip template and its remedy line match their inline defaults', () => {
    // Not merely "exists": the inline defaultValue is what renders if i18n
    // has not loaded, so drift between the two is a real bug.
    expect(EN[MISSING_DEVICE_CHIP_LABEL.key]).toBe(MISSING_DEVICE_CHIP_LABEL.defaultValue);
    expect(EN[MISSING_DEVICE_CHIP_HINT.key]).toBe(MISSING_DEVICE_CHIP_HINT.defaultValue);
  });

  it('every device name it reuses already ships in the catalog', () => {
    // These are the popover's own row labels. Reusing them is what keeps this
    // chip to a single new key across all 32 catalogs.
    for (const names of Object.values(MISSING_DEVICE_NAMES)) {
      for (const name of names) {
        expect(EN[name.key], `missing en key: ${name.key}`).toBe(name.defaultValue);
      }
    }
  });

  it('keeps the label short enough to sit in a footer chip', () => {
    // Same constraint SPLIT_DEGRADED_LABEL is held to: the chip renders beside
    // the mode picker in a short footer, and a label that wraps would push the
    // footer taller in basic mode. Measured on the reachable scope.
    expect(missingDeviceChipText('speaker', translate).label.length).toBeLessThanOrEqual(28);
  });
});
