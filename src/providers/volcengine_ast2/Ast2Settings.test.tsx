import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
const tooltips: unknown[] = [];
vi.mock('../../components/Tooltip/Tooltip', () => ({ default: ({ content }: { content: unknown }) => { tooltips.push(content); return null; } }));
const { openExternalUrl } = vi.hoisted(() => ({ openExternalUrl: vi.fn() }));
vi.mock('../../utils/openExternalUrl', () => ({ openExternalUrl }));
import type { VoiceLibrarySectionProps } from '../../components/Settings/sections/VoiceLibrarySection';
const { library, previewVoice } = vi.hoisted(() => ({ library: [] as VoiceLibrarySectionProps[], previewVoice: vi.fn(async () => null) }));
vi.mock('../../components/Settings/sections/VoiceLibrarySection', () => ({
  default: (props: VoiceLibrarySectionProps) => { library.push(props); return null; },
}));
vi.mock('./preview', () => ({ previewVoice }));
const libraryProps = () => library[library.length - 1];

import { Ast2SettingsView, Ast2VoiceSummary } from './Ast2Settings';
import { AST2_DEFAULTS } from './settings';
import { voicesFor } from './catalog';

beforeEach(() => {
  tooltips.length = 0;
  openExternalUrl.mockClear();
  library.length = 0;
  previewVoice.mockClear();
});

describe("Doubao AST 2.0's settings view", () => {
  it('draws the three library ids, each with its tooltip and its console page, writing its own field', () => {
    const update = vi.fn();
    render(<Ast2SettingsView settings={{ ...AST2_DEFAULTS, hotWordTableId: 'hot-1' }} update={update} />);
    expect(screen.getByRole('heading', { name: 'settings.volcengineAST2CustomVocabulary' })).toBeInTheDocument();
    expect((screen.getByLabelText('settings.volcengineAST2HotWordLibraryId') as HTMLInputElement).value).toBe('hot-1');
    fireEvent.change(screen.getByLabelText('settings.volcengineAST2HotWordLibraryId'), { target: { value: 'hot-2' } });
    fireEvent.change(screen.getByLabelText('settings.volcengineAST2ReplacementLibraryId'), { target: { value: 'rep-1' } });
    fireEvent.change(screen.getByLabelText('settings.volcengineAST2GlossaryLibraryId'), { target: { value: 'glo-1' } });
    expect(update.mock.calls).toEqual([[{ hotWordTableId: 'hot-2' }], [{ replacementTableId: 'rep-1' }], [{ glossaryTableId: 'glo-1' }]]);
    expect(tooltips).toEqual(expect.arrayContaining([
      'settings.volcengineAST2HotWordLibraryTooltip', 'settings.volcengineAST2ReplacementLibraryTooltip', 'settings.volcengineAST2GlossaryLibraryTooltip',
    ]));
    const pages = screen.getAllByRole('link').map((a) => [a.textContent, a.getAttribute('href')]);
    expect(pages).toEqual([
      ['settings.volcengineAST2HotWordManage', 'https://console.volcengine.com/speech/hotword'],
      ['settings.volcengineAST2ReplacementManage', 'https://console.volcengine.com/speech/correctword'],
      ['settings.volcengineAST2GlossaryManage', 'https://console.volcengine.com/speech/glossary'],
    ]);
    fireEvent.click(screen.getByRole('link', { name: 'settings.volcengineAST2GlossaryManage' }));
    expect(openExternalUrl).toHaveBeenCalledWith('https://console.volcengine.com/speech/glossary');
  });

  it('says invalid ids are ignored, and what Doubao AST 2.0 does', () => {
    render(<Ast2SettingsView settings={AST2_DEFAULTS} update={vi.fn()} />);
    expect(screen.getByText('settings.volcengineAST2CustomVocabularyFooter')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'settings.volcengineAST2Info' })).toBeInTheDocument();
    expect(screen.getByText('settings.volcengineAST2InfoText').className).toBe('volcengine-info-notice');
  });

  it('lists cloning first, then the voices of the target in their own language, and writes the choice to the target (#577 catalog §3)', () => {
    const update = vi.fn();
    render(<Ast2SettingsView settings={AST2_DEFAULTS} update={update} pair={{ source: 'zh', target: 'en' }} />);
    expect(screen.getByRole('heading', { name: 'settings.voiceSettings' })).toBeInTheDocument();
    const props = libraryProps();
    expect(props.voices[0]).toMatchObject({ id: 'clone', label: 'providers.volcengine_ast2.voiceClone', group: 'builtin', removable: false });
    expect(props.voices.slice(1).map((v) => v.id)).toEqual(voicesFor('en').map((v) => v.id));
    // Cloning has a heading of its own; the catalog stays under "Presets" (decision 2026-10-03).
    expect(props.voices[0].section).toBe('providers.volcengine_ast2.voiceGroupClone');
    expect(props.voices.slice(1).every((v) => v.section === undefined)).toBe(true);
    // The description shows under the picker once chosen; the categories are the "use case" facet, in Chinese.
    expect(props.voices.find((v) => v.id === 'zh_male_jingqiangkanye_moon_bigtts')).toMatchObject({
      label: 'Harmony',
      previewable: true,
      meta: { facets: { gender: 'male', age: 'young', useCase: ['美式英语'], description: '有气泡音的京圈少爷，潇洒直率，幽默阳光。' } },
    });
    expect(props.selectedId).toBe('clone');
    expect(props.capability).toEqual({ importModes: [], facetFilter: true });
    // No AST2-only footnote under the library (his call).
    expect(props.manageNote).toBeUndefined();
    props.onSelect('en_male_alex_uranus_bigtts');
    expect(update).toHaveBeenCalledWith({ voices: { en: 'en_male_alex_uranus_bigtts' } });
  });

  it('lists no cloning entry for a pair cloning does not run, and selects the effective voice', () => {
    render(<Ast2SettingsView settings={AST2_DEFAULTS} update={vi.fn()} pair={{ source: 'ko', target: 'en' }} />);
    const props = libraryProps();
    expect(props.voices.map((v) => v.id)).not.toContain('clone');
    expect(props.selectedId).toBe('zh_female_vv_uranus_bigtts');
  });

  it('shows no voice section for a target no voice speaks and cloning cannot run (a text-only zh → ru)', () => {
    render(<Ast2SettingsView settings={AST2_DEFAULTS} update={vi.fn()} pair={{ source: 'zh', target: 'ru' }} />);
    expect(library).toHaveLength(0);
    expect(screen.queryByRole('heading', { name: 'settings.voiceSettings' })).toBeNull();
    // The rest of the view still renders.
    expect(screen.getByRole('heading', { name: 'settings.volcengineAST2CustomVocabulary' })).toBeInTheDocument();
  });

  it("writes the new target's slot after the target changed, leaving the old one (Review Focus)", () => {
    const update = vi.fn();
    const settings = { ...AST2_DEFAULTS, voices: { en: 'en_male_alex_uranus_bigtts' } };
    render(<Ast2SettingsView settings={settings} update={update} pair={{ source: 'zh', target: 'ja' }} />);
    libraryProps().onSelect('ja_female_bv024_uranus_bigtts');
    expect(update).toHaveBeenCalledWith({ voices: { en: 'en_male_alex_uranus_bigtts', ja: 'ja_female_bv024_uranus_bigtts' } });
  });

  it('auditions through previewVoice for the shown target, and locks the library while disabled', async () => {
    render(<Ast2SettingsView settings={AST2_DEFAULTS} update={vi.fn()} pair={{ source: 'zh', target: 'ja' }} disabled />);
    const props = libraryProps();
    expect(props.isSessionActive).toBe(true);
    await props.onPreview!('ja_female_bv024_uranus_bigtts');
    expect(previewVoice).toHaveBeenCalledWith('ja_female_bv024_uranus_bigtts', 'ja', undefined);
  });

  it('one row while only my leg speaks, in the section the Settings deep link lands on', () => {
    const { container } = render(<Ast2SettingsView settings={AST2_DEFAULTS} update={vi.fn()} pair={{ source: 'zh', target: 'ja' }} />);
    expect(library).toHaveLength(1);
    expect(libraryProps().label).toBeUndefined();
    expect(container.querySelector('#voice-settings-section')).not.toBeNull();
  });

  it("with the other party spoken, a second row: my language's voices, cloning where it runs the reverse, written to my language's slot", async () => {
    const update = vi.fn();
    const settings = { ...AST2_DEFAULTS, voices: { ja: 'ja_female_bv024_uranus_bigtts' } };
    render(<Ast2SettingsView settings={settings} update={update} pair={{ source: 'zh', target: 'ja' }} participantSpeaks />);
    const [mine, theirs] = library.slice(-2);
    expect(mine.label).toBe('settings.voiceTheyHear');
    expect(mine.selectedId).toBe('ja_female_bv024_uranus_bigtts');
    expect(theirs.label).toBe('settings.voiceIHear');
    expect(theirs.voices[0]).toMatchObject({ id: 'clone', label: 'providers.volcengine_ast2.voiceClone' });
    expect(theirs.voices.slice(1).map((v) => v.id)).toEqual(voicesFor('zh').map((v) => v.id));
    // Nothing chosen for Chinese: the reverse (ja → zh) clones, so I hear the other person's own voice.
    expect(theirs.selectedId).toBe('clone');
    theirs.onSelect('zh_female_vv_uranus_bigtts');
    expect(update).toHaveBeenCalledWith({ voices: { ja: 'ja_female_bv024_uranus_bigtts', zh: 'zh_female_vv_uranus_bigtts' } });
    await theirs.onPreview!('zh_female_vv_uranus_bigtts');
    expect(previewVoice).toHaveBeenCalledWith('zh_female_vv_uranus_bigtts', 'zh', undefined);
  });

  it('Chinese↔English reads one slot for both sides: one row, which says so', () => {
    render(<Ast2SettingsView settings={AST2_DEFAULTS} update={vi.fn()} pair={{ source: 'zh+en', target: 'zh+en' }} participantSpeaks />);
    expect(library).toHaveLength(1);
    expect(libraryProps().label).toBeUndefined();
    expect(libraryProps().note).toBe('providers.volcengine_ast2.voiceSharedZhEn');
  });

  it('locks the three library-id fields while disabled', () => {
    render(<Ast2SettingsView settings={AST2_DEFAULTS} update={vi.fn()} disabled />);
    for (const label of ['settings.volcengineAST2HotWordLibraryId', 'settings.volcengineAST2ReplacementLibraryId', 'settings.volcengineAST2GlossaryLibraryId']) {
      expect(screen.getByLabelText(label)).toBeDisabled();
    }
  });
});

describe('Ast2VoiceSummary', () => {
  const text = (settings: typeof AST2_DEFAULTS, pair: { source: string; target: string }, leg: 'speaker' | 'participant') =>
    render(<Ast2VoiceSummary settings={settings} update={() => {}} pair={pair} leg={leg} />).container.textContent;

  it("names each leg's voice by its own direction: the catalog's name, or whose own voice is cloned", () => {
    const jaVoice = voicesFor('ja').find((v) => v.id === 'ja_female_bv024_uranus_bigtts')!.name;
    const settings = { ...AST2_DEFAULTS, voices: { ja: 'ja_female_bv024_uranus_bigtts' } };
    expect(text(settings, { source: 'zh', target: 'ja' }, 'speaker')).toBe(jaVoice);
    // ja → zh: nothing chosen for Chinese, and cloning runs it.
    expect(text(settings, { source: 'zh', target: 'ja' }, 'participant')).toBe('providers.volcengine_ast2.voiceSummaryCloneTheirs');
    expect(text(AST2_DEFAULTS, { source: 'zh', target: 'en' }, 'speaker')).toBe('providers.volcengine_ast2.voiceSummaryCloneMine');
    // en → ko: cloning does not run it, so Korean's first catalog voice.
    expect(text(AST2_DEFAULTS, { source: 'ko', target: 'en' }, 'participant')).toBe(voicesFor('ko')[0].name);
  });

  it('names nothing for a target no voice speaks', () => {
    expect(text(AST2_DEFAULTS, { source: 'zh', target: 'ru' }, 'speaker')).toBe('');
  });
});
