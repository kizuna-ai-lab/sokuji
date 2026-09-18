/**
 * Proves `VoicePicker`'s facet options go through the locale catalog, not
 * just `humanizeFacetValue`'s fallback.
 *
 * Fix round 1 (2026-09-17), loss #3: `facetRow()` rendered every option as
 * `humanizeFacetValue(val)` alone, so all 30 catalogs' ~45 facet-value
 * strings per language went unused and every option showed English
 * everywhere. Neither `VoicePicker.test.tsx` nor
 * `VoiceLibrarySection.facets.test.tsx` can catch a regression of this exact
 * kind: `VoicePicker.test.tsx` runs against the real `react-i18next` with no
 * catalog loaded, so `t(key, fallback)` always returns `fallback` regardless
 * of `key` — indistinguishable from calling `humanizeFacetValue` directly.
 * `VoiceLibrarySection.facets.test.tsx` mocks `t` the same way, for the same
 * reason (see its own header comment). This file's mock is deliberately
 * DIFFERENT: it answers a SMALL catalog by KEY, and falls back to the
 * default only for a key it does not recognize — so a render that skipped
 * the keyed lookup and called `humanizeFacetValue` alone would show the
 * WRONG (humanized, not catalog) text here and fail the assertion below.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, within, fireEvent } from '@testing-library/react';

const CATALOG: Record<string, string> = {
  'voiceLibrary.voice': 'Voice',
  'voiceLibrary.filter.ageLabel': 'Age',
  // The real en catalog's `age.middle_aged` is "Middle-aged" (hyphenated).
  // `humanizeFacetValue('middle_aged')` alone produces "Middle aged" (a
  // space, from a blind `_` → ` ` replace) — the two are deliberately
  // different strings so a fallback-only render is caught, not merely
  // coincidentally matched.
  'voiceLibrary.filter.age.middle_aged': 'Middle-aged',
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, def?: string) => CATALOG[key] ?? def ?? key }),
}));

// Imported after the mock so it resolves against the mocked module — Vitest
// hoists `vi.mock` above imports regardless of source order, but the import
// is placed below for readability.
import VoicePicker from './VoicePicker';

const base = {
  selectedId: 'builtin:Aged',
  onSelect: vi.fn(),
  onAskDelete: vi.fn(),
  playingId: null,
  loadingId: null,
  capability: { importModes: [] as ('upload' | 'record')[], facetFilter: true },
};

const AGED = {
  id: 'builtin:Aged', label: 'Aged', group: 'builtin' as const, removable: false,
  meta: { facets: { age: 'middle_aged' } },
};

beforeEach(() => { vi.clearAllMocks(); cleanup(); });

describe('VoicePicker facet value translation', () => {
  it('renders a facet value through the locale catalog rather than the humanized tag alone', () => {
    render(<VoicePicker {...base} voices={[AGED]} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    const ageSelect = screen.getByLabelText('Age');
    expect(within(ageSelect).getByText('Middle-aged')).toBeInTheDocument();
    expect(within(ageSelect).queryByText('Middle aged')).not.toBeInTheDocument();
  });
});
