import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../../services/ServiceFactory', () => ({
  ServiceFactory: { getSettingsService: () => ({ getSetting: async (_k: string, d: unknown) => d, setSetting: async () => ({ success: true }) }) },
}));

import { EngineSurface } from './EngineSurface';
import { useSettingsStore } from '../../../stores/settingsStore';
import type { EngineAdapter } from './EngineTypes';

let mockRichSelect = false;
vi.mock('../../../utils/supportsBaseSelect', () => ({
  supportsBaseSelect: () => mockRichSelect,
}));

vi.mock('react-i18next', () => ({
  // The settings store, where Browse library… navigates (B-20), loads the translations.
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (key: string, defaultValue?: string, options?: Record<string, string>) => {
      if (options) {
        let result = defaultValue || key;
        Object.entries(options).forEach(([k, v]) => {
          result = result.replace(`{{${k}}}`, v);
        });
        return result;
      }
      return defaultValue || key;
    },
  }),
}));

const adapter = (over: Partial<EngineAdapter> = {}): EngineAdapter => ({
  directions: [
    { dir: 'ja→en', src: 'ja', tgt: 'en' },
    { dir: 'en→ja', src: 'en', tgt: 'ja' },
  ],
  resolved: ({ stage }) => (stage === 'tts' ? null : { modelId: 'm1', source: 'auto' }),
  autoPick: ({ stage }) => (stage === 'tts' ? null : 'm1'),
  displayName: (id) => (id === 'm1' ? 'Model One' : id),
  languageName: (code) => code,
  readyCandidates: () => [{ id: 'm1', name: 'Model One', sizeLabel: '10 MB' }, { id: 'm2', name: 'Model Two' }],
  select: vi.fn(),
  stagesFor: (_dir, isSpeaker) => (isSpeaker ? ['asr', 'translation', 'tts'] : ['asr', 'translation']),
  disabled: false,
  ...over,
});

const surface = (a = adapter(), effectiveMode: 'speaker' | 'participant' | 'both' = 'both') => render(
  <EngineSurface adapter={a} effectiveMode={effectiveMode} />);

const asrSelect = (index = 0) =>
  screen.getAllByRole('combobox', { name: /ASR/ })[index] as HTMLSelectElement;

describe('EngineSurface / EnginePage (dropdown form, 2026-08-23)', () => {
  // The tour's models step points at the engine's slots on the settings page.
  it('carries the tour anchor of the models step on its slots page', () => {
    const { container } = surface();
    expect(container.querySelector('[data-tour="engine-chips"]')).toHaveClass('engine-surface');
  });

  it('renders both directions in "both" mode: speaker leg 3 selects, participant leg 2', () => {
    surface();
    expect(screen.getByText('ja → en')).toBeInTheDocument();
    expect(screen.getByText('en → ja')).toBeInTheDocument();
    expect(screen.getAllByRole('combobox', { name: /ASR/ })).toHaveLength(2);
    expect(screen.getAllByRole('combobox', { name: /TTS/ })).toHaveLength(1);
    expect(screen.getAllByRole('combobox')).toHaveLength(5);
  });

  it('the select lists Auto (with the resolved name) first, candidates with sizes, Browse library… last', () => {
    surface();
    const options = Array.from(asrSelect().options).map((o) => o.textContent);
    expect(options[0]).toBe('Auto · Model One');
    expect(options[1]).toBe('Model One · 10 MB');
    expect(options[2]).toBe('Model Two');
    expect(options[3]).toBe('Browse library…');
  });

  it('picking a model writes the pick; picking Auto writes the empty string', () => {
    const a = adapter();
    surface(a);
    fireEvent.change(asrSelect(), { target: { value: 'm2' } });
    expect(a.select).toHaveBeenCalledWith({ dir: 'ja→en', stage: 'asr' }, 'm2');
    fireEvent.change(asrSelect(), { target: { value: '' } });
    expect(a.select).toHaveBeenCalledWith({ dir: 'ja→en', stage: 'asr' }, '');
  });

  it('an explicit pick renders as the select value; auto renders as ""', () => {
    const a = adapter({
      resolved: ({ stage }) =>
        stage === 'translation' ? { modelId: 'm2', source: 'explicit' } : { modelId: 'm1', source: 'auto' },
    });
    surface(a);
    const tr = screen.getAllByRole('combobox', { name: /Translation/ })[0] as HTMLSelectElement;
    expect(tr.value).toBe('m2');
    expect(asrSelect().value).toBe('');
  });

  it('the Auto option names what auto WOULD pick even while an explicit pick is active', () => {
    const a = adapter({
      resolved: ({ stage }) =>
        stage === 'tts' ? null : { modelId: 'm2', source: 'explicit' },
      autoPick: ({ stage }) => (stage === 'tts' ? null : 'm1'),
    });
    surface(a);
    expect(asrSelect().value).toBe('m2');
    expect(asrSelect().options[0].textContent).toBe('Auto · Model One');
  });

  it('a slot with no resolution carries the missing modifier and a plain Auto label', () => {
    surface();
    const tts = screen.getAllByRole('combobox', { name: /TTS/ })[0] as HTMLSelectElement;
    expect(tts.className).toContain('engine-slot__select--missing');
    expect(tts.options[0].textContent).toBe('Auto');
  });

  // B-20: the model library is Models and storage now; Browse library… opens that slot's stage there.
  it("the Browse library option opens THAT slot's stage in Models and storage and keeps the selection", async () => {
    useSettingsStore.setState({ settingsNavigationTarget: null });
    const a = adapter();
    surface(a);
    fireEvent.change(asrSelect(), { target: { value: '__browse__' } });
    // Deferred one task (see the change handler: the select's top-layer picker must finish closing first).
    await waitFor(() => expect(useSettingsStore.getState().settingsNavigationTarget).toBe('models-asr'));
    expect(a.select).not.toHaveBeenCalled();
    expect(asrSelect().value).toBe('');
    const tts = screen.getAllByRole('combobox', { name: /TTS/ })[0];
    fireEvent.change(tts, { target: { value: '__browse__' } });
    await waitFor(() => expect(useSettingsStore.getState().settingsNavigationTarget).toBe('models-tts'));
  });

  it('has no library page of its own: no Back, no "Library · …" title', async () => {
    surface();
    fireEvent.change(asrSelect(), { target: { value: '__browse__' } });
    await waitFor(() => expect(useSettingsStore.getState().settingsNavigationTarget).toBe('models-asr'));
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    expect(screen.queryByText(/Library ·/)).toBeNull();
    expect(asrSelect()).toBeInTheDocument();
  });

  it('has no storage footer: usage, deleting and importing live on the Models and storage page (B-18)', () => {
    surface();
    expect(screen.queryByRole('button', { name: /Storage/ })).toBeNull();
    expect(document.querySelector('.engine-storage-footer')).toBeNull();
  });

  it('disabled adapter renders every select disabled', () => {
    surface(adapter({ disabled: true }));
    for (const c of screen.getAllByRole('combobox')) expect(c).toBeDisabled();
  });

  it('speaker mode shows only the forward direction; participant only the reverse', () => {
    surface(adapter(), 'speaker');
    expect(screen.getByText('ja → en')).toBeInTheDocument();
    expect(screen.queryByText('en → ja')).not.toBeInTheDocument();
    expect(screen.getAllByRole('combobox')).toHaveLength(3);
  });

  it('participant mode shows only the reverse direction, with its 2-stage set', () => {
    surface(adapter(), 'participant');
    expect(screen.queryByText('ja → en')).not.toBeInTheDocument();
    expect(screen.getByText('en → ja')).toBeInTheDocument();
    expect(screen.getAllByRole('combobox')).toHaveLength(2);
    expect(screen.queryByRole('combobox', { name: /TTS/ })).not.toBeInTheDocument();
  });

  it('rich mode (base-select): spans for name/meta, a selectedcontent mirror, and the browse action class', () => {
    mockRichSelect = true;
    try {
      surface();
      const select = asrSelect();
      // Closed-control mirror present.
      expect(select.querySelector('button > selectedcontent')).not.toBeNull();
      // Auto option: muted provenance prefix + name span.
      expect(select.options[0].querySelector('.engine-opt__auto')?.textContent).toBe('Auto · ');
      // Candidate option: name and right-aligned meta as separate spans.
      const cand = select.options[1];
      expect(cand.querySelector('.engine-opt__name')?.textContent).toBe('Model One');
      expect(cand.querySelector('.engine-opt__meta')?.textContent).toBe('10 MB');
      // Browse option carries its action class.
      const browse = Array.from(select.options).find((o) => o.value === '__browse__')!;
      expect(browse.classList.contains('engine-opt--browse')).toBe(true);
    } finally {
      mockRichSelect = false;
    }
  });

  it('a mode switch kills a pending flash — revealing a direction later never replays it', () => {
    const props = { adapter: adapter() };
    const { rerender } = render(
      <EngineSurface {...props} initialSlot={{ dir: 'en→ja', stage: 'asr' }} effectiveMode="both" />);
    expect(document.querySelector('.engine-slot.highlight')).toBeInTheDocument();

    rerender(<EngineSurface {...props} initialSlot={{ dir: 'en→ja', stage: 'asr' }} effectiveMode="speaker" />);
    expect(screen.queryByText('en → ja')).not.toBeInTheDocument();

    rerender(<EngineSurface {...props} initialSlot={{ dir: 'en→ja', stage: 'asr' }} effectiveMode="both" />);
    expect(screen.getByText('en → ja')).toBeInTheDocument();
    expect(document.querySelector('.engine-slot.highlight')).not.toBeInTheDocument();
  });

  it('never renders the old per-slot extras row (the compute-device control lives in the library only)', () => {
    surface();
    expect(document.querySelector('.engine-slot__extras')).not.toBeInTheDocument();
  });
});

describe('EnginePage — per-slot compute-device badge (B\'2, 2026-09-03)', () => {
  const Badge = ({ stage, id }: { stage: string; id: string }) => <span id={id} data-testid={`badge-${stage}`}>badge:{stage}</span>;

  it('renders the adapter-supplied badge for every slot, inside that slot\'s control, and pads the select for it', () => {
    const a = adapter({ slotBadge: (slot, id) => <Badge stage={slot.stage} id={id} /> });
    surface(a);
    // One badge per rendered slot: 3 for the speaker leg (asr/translation/tts), 2 for participant.
    const badges = screen.getAllByTestId(/^badge-/);
    expect(badges).toHaveLength(5);
    for (const b of badges) {
      const control = b.closest('.engine-slot__control');
      expect(control).not.toBeNull();
      expect(control!.querySelector('select')).toHaveClass('engine-slot__select--badged');
    }
  });

  it('each select describes itself by its own badge (aria-describedby → the badge\'s id), ids unique per slot', () => {
    const a = adapter({ slotBadge: (slot, id) => <Badge stage={slot.stage} id={id} /> });
    surface(a);
    const ids = new Set<string>();
    for (const sel of document.querySelectorAll('select.engine-slot__select')) {
      const id = sel.getAttribute('aria-describedby');
      expect(id).toBeTruthy();
      const badge = document.getElementById(id!);
      expect(badge).not.toBeNull();
      expect(badge!.closest('.engine-slot__control')).toBe(sel.closest('.engine-slot__control'));
      ids.add(id!);
    }
    expect(ids.size).toBe(5);
  });

  it('an adapter without slotBadge (WASM-shaped) renders no badge, leaves the select unpadded and undescribed', () => {
    surface(adapter());
    expect(screen.queryByTestId(/^badge-/)).not.toBeInTheDocument();
    expect(document.querySelector('.engine-slot__select--badged')).toBeNull();
    expect(document.querySelector('select[aria-describedby]')).toBeNull();
  });
});
