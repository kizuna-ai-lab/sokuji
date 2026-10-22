import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { resolve } from 'node:path';
import { compile } from 'sass';

// The desktop draws the area beside the switch and asks the picker; the extension flips it.
const env = vi.hoisted(() => ({ electron: false }));
vi.mock('../../utils/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/environment')>()),
  isElectron: () => env.electron,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>, values?: Record<string, unknown>) => {
      const options = typeof fallback === 'object' ? fallback : values;
      const text = typeof fallback === 'string' ? fallback : key;
      return options ? text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options[name])) : text;
    },
  }),
}));
// A tooltip draws nothing, but its words stay reachable for a test that reads what a row says: the `data-tooltip` attribute.
vi.mock('../../components/Tooltip/Tooltip', () => ({ default: ({ content }: { content?: unknown }) => (typeof content === 'string' ? <i data-tooltip={content} /> : null) }));
import type { VoiceLibrarySectionProps } from '../../components/Settings/sections/VoiceLibrarySection';
const { library } = vi.hoisted(() => ({ library: [] as VoiceLibrarySectionProps[] }));
vi.mock('../../components/Settings/sections/VoiceLibrarySection', () => ({
  default: function Library(props: VoiceLibrarySectionProps) {
    library.push(props);
    return null;
  },
}));

import de from '../../locales/de/translation.json';
import en from '../../locales/en/translation.json';
import ja from '../../locales/ja/translation.json';
import nl from '../../locales/nl/translation.json';
import type { SettingsProps } from '../../lib/provider/types';
import type { CaptureSourceInfo } from '../../lib/screen/desktopFrames';
import { useScreenContextStore, type PickedSource, type PickReason } from '../../stores/screenContextStore';
import { KizunaQwenSettingsView, QwenSettingsView, QwenVoiceSummary } from './QwenSettings';
import { QWEN_DEFAULTS, QWEN_VOICES, SPEAKER_CLONE, SPEAKER_CLONE_ONCE, type QwenSettings } from './settings';

const props = (patch: Partial<SettingsProps<QwenSettings>> = {}): SettingsProps<QwenSettings> => ({ settings: QWEN_DEFAULTS, update: vi.fn(), ...patch });
beforeEach(() => {
  library.length = 0;
  env.electron = false;
  useScreenContextStore.setState({ picked: null, pickSource: null, preparing: false });
});

describe('QwenSettingsView (spec §4, §7)', () => {
  it("lists the two clones first under their own heading — every turn, then the first speaker once — then the 47 presets under Presets, with no preview", () => {
    render(<QwenSettingsView {...props()} />);
    expect(library).toHaveLength(1);
    const [mine] = library;
    expect(mine.voices.slice(0, 2)).toEqual([
      { id: SPEAKER_CLONE, label: "Clone the speaker's voice", group: 'builtin', removable: false, section: 'Voice cloning' },
      { id: SPEAKER_CLONE_ONCE, label: "Clone the first speaker's voice", group: 'builtin', removable: false, section: 'Voice cloning' },
    ]);
    expect(mine.voices.slice(2).map((v) => v.id)).toEqual(QWEN_VOICES.map((v) => v.value));
    expect(mine.voices.slice(2).every((v) => v.section === undefined)).toBe(true);
    expect(mine.onPreview).toBeUndefined();
    expect(mine.selectedId).toBe('Tina');
  });

  it('edits the preferred translations, one source=target per line, under Custom Vocabulary', () => {
    const update = vi.fn();
    const { container } = render(<QwenSettingsView {...props({ update, settings: { ...QWEN_DEFAULTS, hotwords: '实时翻译=LiveTranslate' } })} />);
    expect(Array.from(container.querySelectorAll('.settings-section > h2')).map((h) => h.textContent)).toContain('Custom Vocabulary');
    const field = screen.getByLabelText('Preferred Translations') as HTMLTextAreaElement;
    expect(field.value).toBe('实时翻译=LiveTranslate');
    expect(field.placeholder).toBe('One source=target per line');
    fireEvent.change(field, { target: { value: '实时翻译=LiveTranslate\n交流=chat' } });
    expect(update).toHaveBeenCalledWith({ hotwords: '实时翻译=LiveTranslate\n交流=chat' });
  });

  it('locks the vocabulary while a run is not idle', () => {
    render(<QwenSettingsView {...props({ disabled: true })} />);
    expect((screen.getByLabelText('Preferred Translations') as HTMLTextAreaElement).disabled).toBe(true);
  });

  it('writes my choice, the clone included', () => {
    const update = vi.fn();
    render(<QwenSettingsView {...props({ update })} />);
    library[0].onSelect(SPEAKER_CLONE);
    expect(update).toHaveBeenCalledWith({ voice: SPEAKER_CLONE });
  });

  it("adds the other party's row only while the participant speaks, writing its own field", () => {
    const update = vi.fn();
    render(<QwenSettingsView {...props({ update, participantSpeaks: true })} />);
    expect(library).toHaveLength(2);
    expect(library[1].selectedId).toBe('Ethan');
    library[1].onSelect('Serena');
    expect(update).toHaveBeenCalledWith({ participantVoice: 'Serena' });
  });

  it('offers Screen context as a switch under the voice, off by default, writing only that field', () => {
    const update = vi.fn();
    render(<QwenSettingsView settings={QWEN_DEFAULTS} update={update} />);
    const sw = screen.getByRole('switch', { name: 'Screen context' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(sw);
    expect(update).toHaveBeenCalledWith({ screenContext: true });
  });
  it('marks the switch Beta, as a badge right after its label (owner, 2026-10-22)', () => {
    render(<QwenSettingsView settings={QWEN_DEFAULTS} update={() => {}} />);
    const row = screen.getByTestId('qwen-screen-context');
    const badge = row.querySelector('.setting-row__badge');
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toBe('Beta');
    expect(badge!.previousElementSibling!.textContent).toBe('Screen context');
  });
  it('locks the switch while a run is not idle, and says in words only where frames go and how they are billed', () => {
    const update = vi.fn();
    render(<QwenSettingsView settings={QWEN_DEFAULTS} update={update} disabled />);
    const sw = screen.getByRole('switch', { name: 'Screen context' });
    // The switch is a div with role="switch", so it is locked by aria-disabled, not by a disabled attribute.
    expect(sw).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(sw);
    expect(update).not.toHaveBeenCalled();
    const row = screen.getByTestId('qwen-screen-context');
    const tooltips = Array.from(row.querySelectorAll('[data-tooltip]'), (el) => el.getAttribute('data-tooltip')).join(' ');
    const words = `${row.textContent} ${tooltips}`;
    expect(words).toMatch(/Alibaba Cloud/);
    expect(words).toMatch(/Kizuna AI never receives them/);
    expect(words).not.toMatch(/[$¥%\d]/);
    // No line under the switch (owner, 2026-10-22): where the pictures go is the tooltip's, and the picker's privacy line.
    expect(row.querySelector('.setting-description')).toBeNull();
    expect(tooltips).toMatch(/Alibaba Cloud's Qwen service/);
    // The charge is per second of speech, whichever account pays it.
    expect(tooltips).toMatch(/for every second of speech/);
    expect(tooltips).toMatch(/Alibaba Cloud bill with your own key/);
    // The area is chosen in the settings as the switch goes on, not at a session's start (owner, 2026-10-22).
    expect(tooltips).toMatch(/^Lets the model see one window, tab or screen you choose, so /);
    expect(tooltips).not.toMatch(/when a session starts/);
  });

  it('names the storefront the check found under the key, and nothing before a check', () => {
    const { rerender } = render(<QwenSettingsView {...props({ models: [{ id: 'cn' }] })} />);
    expect(screen.getByText('Key from 千问云 (mainland China)')).toBeTruthy();
    rerender(<QwenSettingsView {...props({ models: [{ id: 'intl' }] })} />);
    expect(screen.getByText('Key from QwenCloud (international)')).toBeTruthy();
    rerender(<QwenSettingsView {...props({ models: [] })} />);
    expect(screen.queryByText(/^Key from/)).toBeNull();
  });
});

describe('Screen context — the area chosen in the settings (owner, 2026-10-22, rulings 1, 4, 5)', () => {
  const SLIDES: CaptureSourceInfo = { id: 'window:1', name: 'Slides', kind: 'window', thumbnail: 'data:image/png;base64,U0xJREVT', appIcon: null };
  const NOTES: CaptureSourceInfo = { id: 'window:2', name: 'Notes', kind: 'window', thumbnail: 'data:image/png;base64,Tk9URVM=', appIcon: null };
  const ON = { ...QWEN_DEFAULTS, screenContext: true };
  const sc = () => useScreenContextStore.getState();
  /** The panel's picker, answered by the test: `answer(pick)` settles the call it last took. */
  function picker() {
    let answer: (picked: PickedSource | null) => void = () => {};
    const pickSource = vi.fn((_reason?: PickReason) => new Promise<PickedSource | null>((resolve) => { answer = resolve; }));
    sc().setPickSource(pickSource);
    return { pickSource, answer: async (picked: PickedSource | null) => { await act(async () => { answer(picked); }); } };
  }
  /** The choice in the switch's line (option B, owner 2026-10-22): between the help and the switch. */
  const accessory = () => screen.getByTestId('qwen-screen-context').querySelector<HTMLElement>('.setting-row__accessory');
  const button = (name: string | RegExp) => within(screen.getByTestId('qwen-screen-context')).queryByRole('button', { name });
  const source = () => button(/^The model will see: /);

  beforeEach(() => {
    env.electron = true;
  });

  it('turning the switch on asks the picker at once; a pick is held and turns it on', async () => {
    const update = vi.fn();
    const { pickSource, answer } = picker();
    render(<QwenSettingsView settings={QWEN_DEFAULTS} update={update} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Screen context' }));
    expect(pickSource).toHaveBeenCalledTimes(1);
    expect(pickSource).toHaveBeenCalledWith();
    // Not on before the answer: a cancel leaves it off.
    expect(update).not.toHaveBeenCalled();
    await answer({ kind: 'desktop', source: SLIDES });
    expect(sc().picked).toEqual({ kind: 'desktop', source: SLIDES });
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({ screenContext: true });
  });

  it('a cancel leaves the switch off and holds nothing', async () => {
    const update = vi.fn();
    const { answer } = picker();
    render(<QwenSettingsView settings={QWEN_DEFAULTS} update={update} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Screen context' }));
    await answer(null);
    expect(update).not.toHaveBeenCalled();
    expect(sc().picked).toBeNull();
  });

  it('with no panel to ask (none mounted), the switch turns on alone: the picker opens at Start', () => {
    const update = vi.fn();
    render(<QwenSettingsView settings={QWEN_DEFAULTS} update={update} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Screen context' }));
    expect(update).toHaveBeenCalledWith({ screenContext: true });
  });

  it('turning it off writes it off and lets the pick go', () => {
    const update = vi.fn();
    const { pickSource } = picker();
    sc().setPicked({ kind: 'desktop', source: SLIDES });
    render(<QwenSettingsView settings={ON} update={update} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Screen context' }));
    expect(update).toHaveBeenCalledWith({ screenContext: false });
    expect(sc().picked).toBeNull();
    expect(pickSource).not.toHaveBeenCalled();
  });

  it('while on with a window held, shows its picture and name in a button just before the switch, named for what the model will see; a click asks the picker again', async () => {
    const update = vi.fn();
    const { pickSource, answer } = picker();
    sc().setPicked({ kind: 'desktop', source: SLIDES });
    render(<QwenSettingsView settings={ON} update={update} />);
    const held = source()!;
    expect(held).not.toBeNull();
    expect(held.closest('.setting-row__accessory')).toBe(accessory());
    expect(accessory()!.nextElementSibling!.querySelector('[role="switch"]')).not.toBeNull();
    expect(held).toHaveClass('qwen-screen-context__source');
    expect(held).toHaveAttribute('aria-label', 'The model will see: Slides');
    expect(held).toHaveAttribute('title', 'The model will see: Slides');
    expect(held.querySelector('img')).toHaveAttribute('src', SLIDES.thumbnail);
    expect(held.querySelector('.qwen-screen-context__name')?.textContent).toBe('Slides');
    // One line: no caption under the switch, and no Change or Clear (turning the switch off lets the pick go).
    expect(screen.getByTestId('qwen-screen-context').querySelector('.qwen-screen-context__picked')).toBeNull();
    expect(button('Change')).toBeNull();
    expect(button('Clear')).toBeNull();
    expect(button('Choose…')).toBeNull();

    // A pick replaces the held one, a cancel keeps it.
    fireEvent.click(held);
    expect(pickSource).toHaveBeenCalledTimes(1);
    expect(pickSource).toHaveBeenCalledWith();
    await answer({ kind: 'desktop', source: NOTES });
    expect(sc().picked).toEqual({ kind: 'desktop', source: NOTES });
    expect(source()).toHaveAttribute('aria-label', 'The model will see: Notes');
    expect(source()!.querySelector('img')).toHaveAttribute('src', NOTES.thumbnail);
    fireEvent.click(source()!);
    await answer(null);
    expect(sc().picked).toEqual({ kind: 'desktop', source: NOTES });
    expect(update).not.toHaveBeenCalled();
  });

  it('while on with nothing held (an app restart keeps the switch, never the window), offers an empty slot in the picture\'s place — a "+", Choose… beside it — named Choose…, its title saying when you will be asked', async () => {
    const update = vi.fn();
    const { pickSource, answer } = picker();
    render(<QwenSettingsView settings={ON} update={update} />);
    const choose = button('Choose…')!;
    expect(choose.closest('.setting-row__accessory')).toBe(accessory());
    expect(choose).toHaveAttribute('aria-label', 'Choose…');
    expect(choose).toHaveAttribute('title', "No window chosen yet: you'll be asked when the session starts.");
    expect(choose).toHaveClass('qwen-screen-context__source', 'qwen-screen-context__source--empty');
    // The slot stands where the picture would, the "+" in it; the word rides beside it as the window's name does.
    expect(choose.firstElementChild).toHaveClass('qwen-screen-context__slot');
    expect(choose.querySelector('.qwen-screen-context__slot svg')).not.toBeNull();
    expect(choose.querySelector('.qwen-screen-context__caption')?.textContent).toBe('Choose…');
    expect(choose.querySelector('img')).toBeNull();
    expect(source()).toBeNull();
    fireEvent.click(choose);
    expect(pickSource).toHaveBeenCalledTimes(1);
    await answer({ kind: 'desktop', source: SLIDES });
    expect(sc().picked).toEqual({ kind: 'desktop', source: SLIDES });
    expect(source()).toHaveAttribute('aria-label', 'The model will see: Slides');
    expect(update).not.toHaveBeenCalled();
  });

  it("while on with the portal's button held (Wayland), shows a timer named At start, the words beside it, the system's chooser in its title: no button chooses anything here", () => {
    picker();
    sc().setPicked({ kind: 'portal' });
    render(<QwenSettingsView settings={ON} update={vi.fn()} />);
    const atStart = accessory()!.querySelector('.qwen-screen-context__at-start')!;
    expect(atStart).toHaveAttribute('title', 'The system asks which window or screen when the session starts.');
    const icon = within(atStart as HTMLElement).getByRole('img', { name: 'At start' });
    expect(icon.querySelector('svg')).not.toBeNull();
    // The words are what the icon is named, so they are hidden from the accessibility tree (not read twice).
    const words = atStart.querySelector('.qwen-screen-context__caption')!;
    expect(words.textContent).toBe('At start');
    expect(words).toHaveAttribute('aria-hidden', 'true');
    expect(accessory()!.querySelectorAll('button')).toHaveLength(0);
  });

  it('draws nothing beside the switch while it is off', () => {
    picker();
    sc().setPicked({ kind: 'desktop', source: SLIDES });
    render(<QwenSettingsView settings={QWEN_DEFAULTS} update={vi.fn()} />);
    expect(accessory()).toBeNull();
    expect(screen.getByTestId('qwen-screen-context').querySelectorAll('button')).toHaveLength(0);
  });

  it('locks the choice while a run is not idle, and while no picker is mounted', () => {
    picker();
    sc().setPicked({ kind: 'desktop', source: SLIDES });
    const { unmount } = render(<QwenSettingsView settings={ON} update={vi.fn()} disabled />);
    expect(source()).toBeDisabled();
    unmount();

    sc().setPickSource(null);
    const held = render(<QwenSettingsView settings={ON} update={vi.fn()} />);
    expect(source()).toBeDisabled();
    held.unmount();

    sc().setPicked(null);
    render(<QwenSettingsView settings={ON} update={vi.fn()} />);
    expect(button('Choose…')).toBeDisabled();
  });

  it('locks the switch and the choice while Start checks the area (the runner is still idle then)', () => {
    const update = vi.fn();
    const { pickSource } = picker();
    sc().setPicked({ kind: 'desktop', source: SLIDES });
    useScreenContextStore.setState({ preparing: true });
    const { unmount } = render(<QwenSettingsView settings={ON} update={update} />);
    const sw = screen.getByRole('switch', { name: 'Screen context' });
    expect(sw).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(sw);
    expect(update).not.toHaveBeenCalled();
    expect(source()).toBeDisabled();
    unmount();

    sc().setPicked(null);
    render(<QwenSettingsView settings={ON} update={update} />);
    expect(button('Choose…')).toBeDisabled();
    expect(pickSource).not.toHaveBeenCalled();

    // Settled: unlocked again.
    act(() => { useScreenContextStore.setState({ preparing: false }); });
    expect(button('Choose…')).not.toBeDisabled();
  });

  it('the extension has no picker: the switch just flips, and nothing is drawn beside it (the meeting tab is used)', () => {
    env.electron = false;
    const update = vi.fn();
    const { pickSource } = picker();
    const { unmount } = render(<QwenSettingsView settings={QWEN_DEFAULTS} update={update} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Screen context' }));
    expect(pickSource).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({ screenContext: true });
    unmount();
    sc().setPicked({ kind: 'desktop', source: SLIDES });
    render(<QwenSettingsView settings={ON} update={update} />);
    expect(accessory()).toBeNull();
  });

  it("the row's words are in the catalog: At start added, Change and Clear retired with the caption line", () => {
    const words = en.providers.qwen_livetranslate as Record<string, string>;
    expect(words.screenContextAtStart).toBe('At start');
    expect(words).not.toHaveProperty('screenContextChange');
    expect(words).not.toHaveProperty('screenContextClear');
    for (const key of ['screenContextPicked', 'screenContextPortal', 'screenContextNone', 'screenContextChoose']) expect(words).toHaveProperty(key);
  });

  it('a one-word label may break at its seam when the chip leaves it no room (the 300px panel): a soft hyphen in German and Dutch, a zero-width space in Japanese', () => {
    const label = (catalog: typeof en) => (catalog.providers.qwen_livetranslate as Record<string, string>).screenContext;
    expect(label(de)).toBe('Bildschirm­kontext');
    expect(label(nl)).toBe('Scherm­context');
    expect(label(ja)).toBe('画面​コンテキスト');
  });

  it('the managed view shows the same choice', () => {
    picker();
    sc().setPicked({ kind: 'desktop', source: SLIDES });
    render(<KizunaQwenSettingsView settings={ON} update={vi.fn()} />);
    expect(source()).toHaveAttribute('aria-label', 'The model will see: Slides');
  });

  describe("styled in the settings-control dialect, at the mockup's sizes (compiled Settings.scss)", () => {
    const { css } = compile(resolve(__dirname, '../../components/Settings/Settings.scss'));
    const rule = (selector: string, within = css) => new RegExp(String.raw`(^|\n)\s*${selector.replace(/[.()]/g, '\\$&')}\s*\{([^}]*)\}`).exec(within)?.[2] ?? '';

    it('the source button: 26px tall, the control background and border, 4px radius, the secondary text at 12px, allowed to shrink', () => {
      const button = rule('.qwen-screen-context__source');
      expect(button).toMatch(/height:\s*26px/);
      expect(button).toMatch(/background:\s*#333/);
      expect(button).toMatch(/border:\s*1px solid #444/);
      expect(button).toMatch(/border-radius:\s*4px/);
      expect(button).toMatch(/color:\s*#ccc/);
      expect(button).toMatch(/font-size:\s*12px/);
      expect(button).toMatch(/min-width:\s*0/);
    });

    it('the picture: 32 × 18, cropped to fill, 2px radius', () => {
      const thumb = rule('.qwen-screen-context__thumb');
      expect(thumb).toMatch(/width:\s*32px/);
      expect(thumb).toMatch(/height:\s*18px/);
      expect(thumb).toMatch(/object-fit:\s*cover/);
      expect(thumb).toMatch(/border-radius:\s*2px/);
    });

    it('the name is one ellipsized line', () => {
      const name = rule('.qwen-screen-context__name');
      expect(name).toMatch(/white-space:\s*nowrap/);
      expect(name).toMatch(/text-overflow:\s*ellipsis/);
      expect(name).toMatch(/overflow:\s*hidden/);
    });

    it('nothing held: the same chip box with a dashed slot the picture\'s size and no chevron, allowed to shrink like the chosen chip', () => {
      const slot = rule('.qwen-screen-context__slot');
      expect(slot).toMatch(/width:\s*32px/);
      expect(slot).toMatch(/height:\s*18px/);
      expect(slot).toMatch(/border:\s*1px dashed/);
      expect(slot).toMatch(/border-radius:\s*2px/);
      const empty = rule('.qwen-screen-context__source--empty');
      expect(empty).not.toMatch(/border-style:\s*dashed/);
      expect(empty).not.toMatch(/flex:\s*none/);
      expect(rule('.qwen-screen-context__source--empty::after')).toMatch(/content:\s*none/);
      expect(rule('.qwen-screen-context__caption')).toMatch(/text-overflow:\s*ellipsis/);
    });

    it('Wayland: a muted icon with 12px words, not a button', () => {
      expect(rule('.qwen-screen-context__at-start')).toMatch(/color:\s*#888/);
      expect(rule('.qwen-screen-context__at-start')).toMatch(/font-size:\s*12px/);
    });

    it('the row is an inline-size container; below 360px of its width every state is its picture alone — no name or words, no chevron (the 300px panel)', () => {
      expect(rule('.qwen-screen-context')).toMatch(/container:\s*qwen-screen-context\s*\/\s*inline-size/);
      const at = css.indexOf('@container qwen-screen-context (width < 360px)');
      expect(at).toBeGreaterThan(-1);
      const query = css.slice(at, css.indexOf('\n}', at) + 2);
      // A selector's rule inside the query, whether it stands alone or in a group.
      const hidden = (selector: string) => new RegExp(String.raw`${selector.replace(/[.()]/g, '\\$&')}(,[^{]*)?\s*\{[^}]*display:\s*none`).test(query);
      expect(hidden('.qwen-screen-context__name')).toBe(true);
      expect(hidden('.qwen-screen-context__caption')).toBe(true);
      // Both chips — the picture and the empty slot — close up round it.
      expect(rule('.qwen-screen-context__source', query)).toMatch(/padding:\s*0 4px/);
      expect(rule('.qwen-screen-context__source::after', query)).toMatch(/content:\s*none/);
    });

    it("the switch shares the chip's centre line: this row drops the toggle's stray top margin", () => {
      expect(rule('.qwen-screen-context .setting-row__switch')).toMatch(/margin-top:\s*0/);
    });

    it('the caption line and its keys are gone', () => {
      expect(css).not.toMatch(/\.qwen-screen-context__(picked|text|button)\b/);
    });
  });
});

describe('KizunaQwenSettingsView (the managed view, Beijing region spec §8)', () => {
  it('renders a Region select with Singapore and 北京 (Beijing), selected from the settings, above the shared view', () => {
    const { container } = render(<KizunaQwenSettingsView {...props({ settings: { ...QWEN_DEFAULTS, region: 'cn' } })} />);
    const select = container.querySelector('#qwen-region-select') as HTMLSelectElement;
    expect(select.value).toBe('cn');
    expect(Array.from(select.options).map((o) => [o.value, o.textContent])).toEqual([['sg', 'Singapore'], ['cn', '北京 (Beijing)']]);
    expect(select.closest('.settings-section')?.querySelector('h2')?.textContent).toContain('Region');
    expect(library).toHaveLength(1);
  });

  it('picking Beijing writes the region and nothing else', () => {
    const update = vi.fn();
    const { container } = render(<KizunaQwenSettingsView {...props({ update })} />);
    fireEvent.change(container.querySelector('#qwen-region-select') as HTMLSelectElement, { target: { value: 'cn' } });
    expect(update).toHaveBeenCalledWith({ region: 'cn' });
  });

  it('locks the select while a run is not idle', () => {
    const { container } = render(<KizunaQwenSettingsView {...props({ disabled: true })} />);
    expect((container.querySelector('#qwen-region-select') as HTMLSelectElement).disabled).toBe(true);
  });

  // Beijing answers slowly from networks outside mainland China (2026-10-21: 9–15 s to the first
  // word from Japan over IPv6, against 0.7 s to Singapore). The note under the select is what a
  // visitor who picked it sees without hovering the tooltip; Singapore shows nothing.
  it('shows the latency note under the select only while Beijing is picked', () => {
    const beijing = render(<KizunaQwenSettingsView {...props({ settings: { ...QWEN_DEFAULTS, region: 'cn' } })} />);
    const note = beijing.container.querySelector('#qwen-region-note');
    expect(note?.textContent).toContain('try Singapore');
    expect(note?.closest('#qwen-region-section')).not.toBeNull();
    beijing.unmount();
    const singapore = render(<KizunaQwenSettingsView {...props({ settings: { ...QWEN_DEFAULTS, region: 'sg' } })} />);
    expect(singapore.container.querySelector('#qwen-region-note')).toBeNull();
  });

  it('the managed view shows the same switch', () => {
    render(<KizunaQwenSettingsView settings={QWEN_DEFAULTS} update={() => {}} />);
    expect(screen.getByRole('switch', { name: 'Screen context' })).toBeInTheDocument();
  });

  it('the own-key view shows no region', () => {
    const { container } = render(<QwenSettingsView {...props()} />);
    expect(container.querySelector('#qwen-region-select')).toBeNull();
  });
});

describe('QwenVoiceSummary', () => {
  it("names each leg's voice as its run speaks it, and the clone by whose voice it is", () => {
    const summary = (settings: QwenSettings, leg: 'speaker' | 'participant') => render(<QwenVoiceSummary {...props({ settings })} leg={leg} />).container.textContent;
    expect(summary({ ...QWEN_DEFAULTS, voice: SPEAKER_CLONE, participantVoice: 'Liora Mira' }, 'speaker')).toBe('Your own voice (cloned)');
    expect(summary({ ...QWEN_DEFAULTS, voice: SPEAKER_CLONE_ONCE, participantVoice: 'Liora Mira' }, 'speaker')).toBe('Your own voice (cloned)');
    expect(summary({ ...QWEN_DEFAULTS, voice: SPEAKER_CLONE, participantVoice: SPEAKER_CLONE }, 'participant')).toBe('Their own voice (cloned)');
    expect(summary({ ...QWEN_DEFAULTS, voice: 'Tina', participantVoice: SPEAKER_CLONE_ONCE }, 'participant')).toBe('Their own voice (cloned)');
    expect(summary({ ...QWEN_DEFAULTS, voice: SPEAKER_CLONE, participantVoice: 'Liora Mira' }, 'participant')).toBe('Liora Mira');
    expect(summary({ ...QWEN_DEFAULTS, voice: 'Ethan', participantVoice: 'Ethan' }, 'participant')).toBe('Tina');
  });
});
