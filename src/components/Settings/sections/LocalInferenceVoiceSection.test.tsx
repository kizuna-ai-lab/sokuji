import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import LocalInferenceVoiceSection from './LocalInferenceVoiceSection';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, fb?: string) => fb ?? _k }),
}));
// Engine resolution drives which control renders.
vi.mock('../../../lib/local-inference/modelManifest', () => ({
  getManifestEntry: (id: string) => ({
    'edge-model': { engine: 'edge-tts' },
    'super-model': { engine: 'supertonic' },
    'matcha-model': { engine: 'matcha' },
  }[id]),
}));
// VoiceLibrarySection is covered by its own tests — stub to a marker + capture props.
let lastVLS: any = null;
vi.mock('./VoiceLibrarySection', () => ({
  __esModule: true,
  default: (props: any) => { lastVLS = props; return <div data-testid="vls" />; },
}));

const base = {
  isSessionActive: false,
  edgeVoices: [{ ShortName: 'en-US-A', label: 'A' }, { ShortName: 'en-US-B', label: 'B' }],
  edgeVoiceStatus: 'loaded' as const,
  edgeTtsVoice: 'en-US-A',
  supertonicVoices: [{ id: 'preset:0', label: 'Sarah', group: 'builtin' as const, removable: false }],
  supertonicSelectedId: 'preset:0',
  onImportVoice: vi.fn(), onRenameVoice: vi.fn(), onDeleteVoice: vi.fn(),
  ttsSpeakerId: 0, numSpeakers: 8,
  onUpdate: vi.fn(),
};

beforeEach(() => { lastVLS = null; vi.clearAllMocks(); });

describe('LocalInferenceVoiceSection', () => {
  it('edge engine → <select> writes edgeTtsVoice', () => {
    const onUpdate = vi.fn();
    render(<LocalInferenceVoiceSection {...base} ttsModel="edge-model" onUpdate={onUpdate} />);
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'en-US-B' } });
    expect(onUpdate).toHaveBeenCalledWith({ edgeTtsVoice: 'en-US-B' });
  });

  it('supertonic engine → renders VoiceLibrarySection with dropdown/upload capability', () => {
    render(<LocalInferenceVoiceSection {...base} ttsModel="super-model" />);
    expect(screen.getByTestId('vls')).toBeInTheDocument();
    expect(lastVLS.capability).toEqual({ importModes: ['upload'] });
    expect(lastVLS.selectedId).toBe('preset:0');
  });

  it('supertonic select writes ttsSpeakerId via sidFromVoiceId', () => {
    const onUpdate = vi.fn();
    render(<LocalInferenceVoiceSection {...base} ttsModel="super-model" onUpdate={onUpdate}
      supertonicVoices={[{ id: 'imported:7', label: 'Mine', group: 'custom', removable: true }]} />);
    lastVLS.onSelect('imported:7');
    expect(onUpdate).toHaveBeenCalledWith({ ttsSpeakerId: 7 });
  });

  it('other engine → speaker slider writes ttsSpeakerId', () => {
    const onUpdate = vi.fn();
    render(<LocalInferenceVoiceSection {...base} ttsModel="matcha-model" onUpdate={onUpdate} />);
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '3' } });
    expect(onUpdate).toHaveBeenCalledWith({ ttsSpeakerId: 3 });
  });

  // THIS IS A GUARD, not a failing test — do not wait for it to go red.
  // Verified before dispatch: `LocalInferenceVoiceSection.tsx` sets
  // `previewable` nowhere, and `canAuditionVoice` returns
  // `v.previewable ?? v.group === 'custom'`, so a Supertonic preset
  // (`group: 'builtin'`, flag absent) already yields false and renders no ▶.
  // The case passes on arrival, which is the point: it fences the seam so a
  // later provider marking its presets previewable cannot silently give
  // Supertonic an audition button it has no way to satisfy. Label it a guard
  // in your report and move on; contriving a failure here would mean breaking
  // the behaviour you are trying to protect.
  //
  // The module-level mock above stubs VoiceLibrarySection to a marker div so
  // the other cases in this file can assert on prop wiring in isolation —
  // that stub has no button/grid at all, so it can't stand in for this case,
  // which needs the REAL VoiceLibrarySection (and its VoicePicker) rendered
  // to prove something about actual markup. Unmock for this one case and
  // re-import a fresh module graph, using the same primitives as
  // providerOrder.test.ts / kizunaProviderGating.test.ts (vi.doUnmock +
  // vi.resetModules + dynamic import) — but the shape here is the INVERSE of
  // theirs: those files carry no top-level mock of the specifier in question
  // and reset+unmock it in beforeEach ahead of EVERY test, so each case
  // starts from the real module and opts INTO its own mock. Here
  // VoiceLibrarySection is mocked persistently at the top level for every
  // case, and only this one case opts out, with nothing restoring the mock
  // afterward. The invariant that keeps that safe is narrower than "last
  // test in the file": no LATER case in this file dynamically re-imports
  // './LocalInferenceVoiceSection' without first re-mocking
  // VoiceLibrarySection.
  it('offers no audition control for Supertonic presets', async () => {
    vi.doUnmock('./VoiceLibrarySection');
    vi.resetModules();
    const { default: RealLocalInferenceVoiceSection } = await import('./LocalInferenceVoiceSection');
    render(<RealLocalInferenceVoiceSection {...base} ttsModel="super-model" />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    // Presence before absence: the popover must actually have opened, and
    // must actually contain the Supertonic voice row, before "no ▶ inside
    // it" proves anything. Scoped to the grid — not the whole document —
    // because the trigger's own accessible name concatenates the selected
    // voice's label with its subtitle, so an unscoped query would also match
    // the trigger and could pass even if the popover never opened.
    const grid = within(screen.getByRole('dialog')).getByRole('grid');
    expect(within(grid).getByText('Sarah')).toBeInTheDocument();
    expect(within(grid).queryByRole('button', { name: /play/i })).not.toBeInTheDocument();
  });
});
