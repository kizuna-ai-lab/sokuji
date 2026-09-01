/**
 * The voice dropdown's group headers ("Presets" / "My Voices").
 *
 * Under `appearance: base-select` the picker is ours to theme, but an
 * <optgroup>'s `label` attribute is painted by the UA in black with no box we
 * can align — invisible on the dark picker, and offset from the option text.
 * The customizable-select spec's answer is a <legend> child, which Chromium
 * renders INSTEAD of the attribute and which CSS can reach; Settings.scss
 * styles it in the shared @supports block.
 *
 * The legend is gated on supportsBaseSelect() because a classic popup has no
 * use for it: React's validateDOMNesting rejects <legend> inside <optgroup>,
 * and the pre-relaxation select content model would flatten it anyway. The
 * `label` attribute stays in both modes — it is what the classic popup paints
 * and what names the group for assistive tech.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
import VoiceLibrarySection from './VoiceLibrarySection';

// vi.hoisted, like ProviderSection.select.test.tsx does for this same mock:
// vi.mock's factory is hoisted above a plain module-level const, and this file
// imports the component statically, so the factory runs first. It only closes
// over the state rather than reading it, which is why the plain form worked —
// hoisting removes the dependency on that detail.
const baseSelect = vi.hoisted(() => ({ supported: true }));
vi.mock('../../../utils/supportsBaseSelect', () => ({
  supportsBaseSelect: () => baseSelect.supported,
}));

const props = {
  selectedId: 'preset:0',
  onSelect: () => {},
  onRename: async () => {},
  onDelete: async () => {},
  onImport: async () => {},
  voices: [
    { id: 'preset:0', label: 'Sarah', group: 'builtin' as const, removable: false },
    { id: 'custom:1', label: 'Mine', group: 'custom' as const, removable: true },
  ],
  capability: { importModes: ['upload' as const], curation: false, presentation: 'dropdown' as const },
};

describe('VoiceLibrarySection dropdown group headers', () => {
  beforeEach(() => {
    baseSelect.supported = true;
    cleanup();
  });

  it('gives every optgroup a <legend> mirroring its label when base-select is supported', () => {
    render(<VoiceLibrarySection {...props} />);
    const select = screen.getByRole('combobox');

    for (const name of ['Presets', 'My Voices']) {
      const group = within(select).getByRole('group', { name });
      // The attribute stays: it names the group and is what a classic popup paints.
      expect(group).toHaveAttribute('label', name);
      const legend = group.querySelector('legend');
      expect(legend).not.toBeNull();
      expect(legend).toHaveTextContent(name);
    }
  });

  it('omits the <legend> when the runtime has no base-select', () => {
    baseSelect.supported = false;
    render(<VoiceLibrarySection {...props} />);
    const select = screen.getByRole('combobox');

    expect(select.querySelectorAll('legend')).toHaveLength(0);
    // The groups themselves — and their labels — are unchanged.
    expect(within(select).getByRole('group', { name: 'Presets' })).toBeInTheDocument();
    expect(within(select).getByRole('group', { name: 'My Voices' })).toBeInTheDocument();
  });
});
