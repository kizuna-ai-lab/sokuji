import type React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { AUTO } from '../../lib/provider/languages';
import { languageLabel } from '../../lib/language/label';
import type { LanguageContext } from '../../lib/provider/types';
import { fakeProvider } from '../../providers/fake/provider';
import { FAKE_DEFAULTS } from '../../providers/fake/settings';
import { PIN_SEPARATOR } from '../../lib/language/order';
import { LanguagePairSection } from './LanguagePairSection';
import { aroundVerb, VERB_MARK } from './receiveWords';

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  // The key itself; with a `verb` it says where the verb goes, after the key (as a sentence template would).
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, a?: unknown, b?: unknown) => {
        const options = (typeof a === 'object' ? a : b) as { verb?: string } | undefined;
        return options?.verb ? `${key} ${options.verb}` : key;
      },
    }),
  };
});

const draw = (
  pair: { source: string; target: string },
  onChange = vi.fn(),
  extra: {
    sentence?: { mode: 'speaker' | 'participant' | 'both'; textOnly: boolean; participantSpeaks?: boolean };
    provider?: typeof fakeProvider;
    receive?: React.ComponentProps<typeof LanguagePairSection>['receive'];
    disabled?: boolean;
  } = {},
) => {
  render(
    <LanguagePairSection
      provider={extra.provider ?? fakeProvider}
      settings={FAKE_DEFAULTS}
      pair={pair}
      onChange={onChange}
      sentence={extra.sentence}
      receive={extra.receive}
      disabled={extra.disabled}
    />,
  );
  return onChange;
};
/** The hear-or-read choices on the page: the selects offering 'hear' and 'read'. */
const receiveSelects = () => (screen.getAllByRole('combobox') as HTMLSelectElement[]).filter((s) => values(s).includes('hear'));
const choice = (hears: boolean, blocked: string | null = null) => ({ hears, onChange: vi.fn(), blocked });
const values = (select: HTMLElement) => [...(select as HTMLSelectElement).options].map((o) => o.value);
const disabledValues = (select: HTMLSelectElement) => [...select.options].filter((o) => o.disabled).map((o) => o.value);
// The codes on offer, whatever the display order, pinned copies or separator.
const codesOf = (select: HTMLElement) => [...new Set(values(select).filter((v) => v !== PIN_SEPARATOR))].sort();

describe('LanguagePairSection', () => {
  it('names each option from the code, not from the option (unified language codes)', () => {
    // The file's react-i18next mock carries no i18n object: names come out in English.
    const provider = {
      ...fakeProvider,
      languages: {
        ...fakeProvider.languages,
        sources: () => [{ value: 'zh-Hant' }, { value: 'zh-TW' }],
        targets: () => [{ value: 'zh-TW' }],
      },
    } as unknown as typeof fakeProvider;
    draw({ source: 'zh-Hant', target: 'zh-TW' }, vi.fn(), { provider });
    const texts = [...document.querySelectorAll('option')].map((o) => o.textContent);
    expect([...new Set(texts.filter((x) => x !== '──────────'))].sort()).toEqual([languageLabel('zh-Hant', 'en'), languageLabel('zh-TW', 'en')].sort());
    expect(languageLabel('zh-Hant', 'en')).not.toBe(languageLabel('zh-TW', 'en'));
  });

  it("offers exactly the provider's codes: its sources, and the targets of the chosen source", () => {
    draw({ source: 'en', target: 'ja' });
    expect(codesOf(screen.getByLabelText('settings.sourceLanguage'))).toEqual([AUTO, 'en', 'ja', 'zh'].sort());
    expect(codesOf(screen.getByLabelText('settings.targetLanguage'))).toEqual(['ja', 'zh']);
  });

  it('pins the current pair above a disabled separator, then lists auto first in the rest', () => {
    draw({ source: 'ja', target: 'en' });
    const select = screen.getByLabelText('settings.sourceLanguage') as HTMLSelectElement;
    expect(values(select).slice(0, 4)).toEqual(['ja', 'en', PIN_SEPARATOR, AUTO]);
    const separator = select.options[2];
    expect(separator.disabled).toBe(true);
    expect(separator.value).toBe(PIN_SEPARATOR);
  });

  it('names the AUTO source with the shared auto-detect label', () => {
    draw({ source: AUTO, target: 'en' });
    expect((screen.getByRole('option', { name: 'common.autoDetect' }) as HTMLOptionElement).value).toBe(AUTO);
  });

  it('moves the target when the new source does not offer it', () => {
    const onChange = draw({ source: 'en', target: 'ja' });
    fireEvent.change(screen.getByLabelText('settings.sourceLanguage'), { target: { value: 'ja' } });
    expect(onChange).toHaveBeenCalledWith({ source: 'ja', target: 'en' });
  });

  it('keeps the target when the new source offers it', () => {
    const onChange = draw({ source: 'en', target: 'ja' });
    fireEvent.change(screen.getByLabelText('settings.sourceLanguage'), { target: { value: 'zh' } });
    expect(onChange).toHaveBeenCalledWith({ source: 'zh', target: 'ja' });
  });

  it('changes the target', () => {
    const onChange = draw({ source: 'en', target: 'ja' });
    fireEvent.change(screen.getByLabelText('settings.targetLanguage'), { target: { value: 'zh' } });
    expect(onChange).toHaveBeenCalledWith({ source: 'en', target: 'zh' });
  });

  it('swaps a pair the provider supports in reverse', () => {
    const onChange = draw({ source: 'en', target: 'ja' });
    fireEvent.click(screen.getByTitle('simpleConfig.swapLanguages'));
    expect(onChange).toHaveBeenCalledWith({ source: 'ja', target: 'en' });
  });

  it('cannot swap an AUTO source', () => {
    draw({ source: AUTO, target: 'en' });
    expect(screen.getByTitle('simpleConfig.swapLanguages')).toBeDisabled();
  });

  it('the heading holds a help tooltip trigger (parity with LanguageSection.tsx)', () => {
    const { container } = render(
      <LanguagePairSection provider={fakeProvider} settings={FAKE_DEFAULTS} pair={{ source: 'en', target: 'ja' }} onChange={vi.fn()} />,
    );
    expect(container.querySelector('h3 .tooltip-trigger')).toBeTruthy();
  });

  it('leaves its heading out where the page names the languages already (the settings page, mock v18)', () => {
    const { container } = render(
      <LanguagePairSection provider={fakeProvider} settings={FAKE_DEFAULTS} pair={{ source: 'en', target: 'ja' }} onChange={vi.fn()} heading={false} />,
    );
    expect(container.querySelector('h3')).toBeNull();
    expect(container.querySelector('.language-pair-row')).not.toBeNull();
  });

  describe('with a sentence', () => {
    it("'both': I speak / they hear, and the mirror line shows", () => {
      draw({ source: 'ja', target: 'en' }, undefined, { sentence: { mode: 'both', textOnly: false } });
      expect(screen.getByText('settings.langSentence.iSpeak')).toBeTruthy();
      expect(screen.getByText('settings.langSentence.theyHear')).toBeTruthy();
      expect(screen.getByTestId('language-mirror-line')).toBeTruthy();
    });

    it("'participant': I read / they speak, and no mirror line", () => {
      draw({ source: 'ja', target: 'en' }, undefined, { sentence: { mode: 'participant', textOnly: false } });
      expect(screen.getByText('settings.langSentence.iRead')).toBeTruthy();
      expect(screen.getByText('settings.langSentence.theySpeak')).toBeTruthy();
      expect(screen.queryByTestId('language-mirror-line')).toBeNull();
    });

    it("'participant' with the other side's translation read to me: I hear / they speak", () => {
      draw({ source: 'ja', target: 'en' }, undefined, { sentence: { mode: 'participant', textOnly: false, participantSpeaks: true } });
      expect(screen.getByText('settings.langSentence.iHear')).toBeTruthy();
      expect(screen.getByText('settings.langSentence.theySpeak')).toBeTruthy();
    });

    it("'both': the mirror line reads I hear while the other side's translation is read to me, else I read", () => {
      draw({ source: 'ja', target: 'en' }, undefined, { sentence: { mode: 'both', textOnly: false, participantSpeaks: true } });
      expect(screen.getByTestId('language-mirror-line').textContent).toBe('settings.langSentence.mirrorHear');
      cleanup();
      draw({ source: 'ja', target: 'en' }, undefined, { sentence: { mode: 'both', textOnly: false, participantSpeaks: false } });
      expect(screen.getByTestId('language-mirror-line').textContent).toBe('settings.langSentence.mirror');
    });

    it("textOnly on an 'optional' provider: they read", () => {
      draw({ source: 'ja', target: 'en' }, undefined, { sentence: { mode: 'speaker', textOnly: true } });
      expect(screen.getByText('settings.langSentence.iSpeak')).toBeTruthy();
      expect(screen.getByText('settings.langSentence.theyRead')).toBeTruthy();
    });
  });
});

// Owner, 2026-11-18 (design 1): on the line-up page the sentence's "hear / read" words are the switches themselves.
describe('LanguagePairSection — hearing or reading, chosen in the sentence', () => {
  it("'speaker': the other side's word is a choice of hearing or reading, and choosing reading turns hearing off", () => {
    const theirs = choice(true);
    draw({ source: 'ja', target: 'en' }, undefined, { sentence: { mode: 'speaker', textOnly: false }, receive: { theirs } });
    const [select] = receiveSelects();
    expect(select.value).toBe('hear');
    // Only the verb is the choice (owner, 2026-11-19): the subject stays plain text before it, as the sentence puts it.
    expect([...select.options].map((o) => o.textContent)).toEqual(['settings.langSentence.theyHearVerb', 'settings.langSentence.theyReadVerb']);
    const word = select.closest('.language-receive-label')!;
    expect(word.firstChild?.textContent).toBe('settings.langSentence.theyReceiveHear ');
    expect(select.getAttribute('aria-label')).toBe('settings.langSentence.theyHear / settings.langSentence.theyRead');
    fireEvent.change(select, { target: { value: 'read' } });
    expect(theirs.onChange).toHaveBeenCalledWith(false);
  });

  // Review (PR #797): the sentence is the chosen verb's, as the subject can change with the verb (French: j'[entends],
  // je [lis]).
  it("sets the word in the sentence of the verb chosen", () => {
    draw({ source: 'ja', target: 'en' }, undefined, { sentence: { mode: 'speaker', textOnly: false }, receive: { theirs: choice(false) } });
    expect(receiveSelects()[0].closest('.language-receive-label')!.firstChild?.textContent).toBe('settings.langSentence.theyReceiveRead ');
  });

  it("'participant': my word is the choice, and choosing hearing turns it on", () => {
    const mine = choice(false);
    draw({ source: 'ja', target: 'en' }, undefined, { sentence: { mode: 'participant', textOnly: false }, receive: { mine } });
    const [select] = receiveSelects();
    expect([...select.options].map((o) => o.textContent)).toEqual(['settings.langSentence.iHearVerb', 'settings.langSentence.iReadVerb']);
    expect(select.closest('.language-receive-label')!.firstChild?.textContent).toBe('settings.langSentence.iReceiveRead ');
    expect(select.value).toBe('read');
    fireEvent.change(select, { target: { value: 'hear' } });
    expect(mine.onChange).toHaveBeenCalledWith(true);
  });

  it("'both': the other side's leg is a row like mine — they speak, I hear or read — over the same pair", () => {
    const onChange = draw({ source: 'ja', target: 'en' }, undefined, { sentence: { mode: 'both', textOnly: false }, receive: { theirs: choice(true), mine: choice(false) } });
    expect(receiveSelects()).toHaveLength(2);
    const row = screen.getByTestId('language-their-row');
    expect(row.textContent).toContain('settings.langSentence.theySpeak');
    const [theirLanguage, myLanguage] = [...row.querySelectorAll('select.language-select')] as HTMLSelectElement[];
    // The other side speaks the pair's target, and I get its source: one pair, so a change here is the first row's too.
    expect([theirLanguage.value, myLanguage.value]).toEqual(['en', 'ja']);
    fireEvent.change(theirLanguage, { target: { value: 'zh' } });
    expect(onChange).toHaveBeenLastCalledWith({ source: 'ja', target: 'zh' });
    expect(row.querySelector('select.language-receive')).not.toBeNull();
    expect(screen.queryByTestId('language-mirror-line')).toBeNull();
  });

  it("'both' with an automatic source: the other side's row keeps its choice, and never offers automatic as the language I get", () => {
    const onChange = draw({ source: AUTO, target: 'en' }, undefined, { sentence: { mode: 'both', textOnly: false }, receive: { theirs: choice(true), mine: choice(false) } });
    const row = screen.getByTestId('language-their-row');
    expect(row.querySelector('select.language-receive')).not.toBeNull();
    const myLanguage = row.querySelectorAll('select.language-select')[1] as HTMLSelectElement;
    const auto = [...myLanguage.options].filter((o) => o.value === AUTO);
    // Shown as it stands, but not a choice.
    expect(auto).toHaveLength(1);
    expect(auto[0].disabled).toBe(true);
    // Review (PR #784): nor is their language, with no language I get to run their leg: it shows, unchosen.
    const theirLanguage = row.querySelectorAll('select.language-select')[0] as HTMLSelectElement;
    expect([...theirLanguage.options].map((o) => [o.value, o.disabled])).toEqual([['en', true]]);
    fireEvent.change(myLanguage, { target: { value: 'ja' } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ source: 'ja' }));
  });

  it("'both': the other side's row shows their leg as the provider reverses it, and maps a change back to the pair", () => {
    // A provider whose reverse is its own codes, not a swap (as Palabra's): their leg of zh → en-GB is en → zh-Hans.
    const provider = {
      ...fakeProvider,
      languages: {
        ...fakeProvider.languages,
        sources: () => [{ value: 'en' }, { value: 'zh' }],
        targets: () => [{ value: 'en-US' }, { value: 'en-GB' }, { value: 'zh-Hans' }],
        reverse: ({ source, target }: { source: string; target: string }) => ({ source: target.split('-')[0], target: source === 'zh' ? 'zh-Hans' : 'en-US' }),
      },
    } as unknown as typeof fakeProvider;
    const onChange = draw({ source: 'zh', target: 'en-GB' }, undefined, { provider, sentence: { mode: 'both', textOnly: false }, receive: { theirs: choice(true), mine: choice(false) } });
    const row = screen.getByTestId('language-their-row');
    const [theirLanguage, myLanguage] = [...row.querySelectorAll('select.language-select')] as HTMLSelectElement[];
    expect([theirLanguage.value, myLanguage.value]).toEqual(['en', 'zh-Hans']);
    // Their leg's own codes, once each: two English targets are one language they speak.
    expect(codesOf(theirLanguage)).toEqual(['en', 'zh']);
    expect(codesOf(myLanguage)).toEqual(['en-US', 'zh-Hans']);
    fireEvent.change(theirLanguage, { target: { value: 'zh' } });
    expect(onChange).toHaveBeenLastCalledWith({ source: 'zh', target: 'zh-Hans' });
    fireEvent.change(myLanguage, { target: { value: 'en-US' } });
    expect(onChange).toHaveBeenLastCalledWith({ source: 'en', target: 'en-GB' });
  });

  // Review (PR #784): a choice there whose leg would not run (the provider's reverse is null for it) is not offered; it
  // would write a pair Start then refuses.
  it("'both': the other side's row offers only languages their leg runs in, and shows one it does not, unchosen", () => {
    // Basque has no reverse (as Palabra's `eu`): eu → es cannot run the other way.
    const provider = {
      ...fakeProvider,
      languages: {
        ...fakeProvider.languages,
        sources: () => [{ value: 'en' }, { value: 'eu' }, { value: 'es' }],
        targets: () => [{ value: 'es' }, { value: 'en' }],
        reverse: ({ source, target }: { source: string; target: string }) => (source === 'eu' ? null : { source: target, target: source }),
      },
    } as unknown as typeof fakeProvider;
    const receive = { theirs: choice(true), mine: choice(false) };
    draw({ source: 'en', target: 'es' }, undefined, { provider, sentence: { mode: 'both', textOnly: false }, receive });
    let myLanguage = screen.getByTestId('language-their-row').querySelectorAll('select.language-select')[1] as HTMLSelectElement;
    expect(codesOf(myLanguage)).toEqual(['en', 'es']);
    cleanup();
    // A pair already set that way (from the first row): its language shows, but is not a choice.
    draw({ source: 'eu', target: 'es' }, undefined, { provider, sentence: { mode: 'both', textOnly: false }, receive });
    myLanguage = screen.getByTestId('language-their-row').querySelectorAll('select.language-select')[1] as HTMLSelectElement;
    expect(myLanguage.value).toBe('eu');
    expect([...myLanguage.options].filter((o) => o.value === 'eu').map((o) => o.disabled)).toEqual([true]);
  });

  // Review (PR #784): their row checks a choice as Start's gate does, under their own leg's context: here my leg speaks
  // and theirs reads, and only a run that speaks narrows the offer.
  it("'both': checks the other side's choices under their own leg's context, not the whole run's", () => {
    const provider = {
      ...fakeProvider,
      languages: {
        ...fakeProvider.languages,
        sources: () => [{ value: 'en' }, { value: 'zh' }, { value: 'ru' }],
        targets: (source: string, _s: unknown, ctx?: LanguageContext) => (ctx?.speech ? ['en', 'zh'] : ['en', 'zh', 'ru']).filter((t) => t !== source).map((value) => ({ value })),
        reverse: undefined,
      },
    } as unknown as typeof fakeProvider;
    render(
      <LanguagePairSection
        provider={provider} settings={FAKE_DEFAULTS} pair={{ source: 'en', target: 'zh' }} onChange={vi.fn()}
        sentence={{ mode: 'both', textOnly: false }} receive={{ theirs: choice(true), mine: choice(false) }}
        context={{ speech: true }} reverseContext={{ speech: false }}
      />,
    );
    const myLanguage = screen.getByTestId('language-their-row').querySelectorAll('select.language-select')[1] as HTMLSelectElement;
    // ru → zh runs, and so does its reverse zh → ru for a leg that reads.
    expect(codesOf(myLanguage)).toEqual(['en', 'ru', 'zh']);
  });

  // Review (PR #784): a language I get is checked as the pair it would make, after the target is moved to fit it.
  it("'both': checks each language I get as the pair choosing it makes", () => {
    const targets: Record<string, string[]> = { en: ['ja'], ja: ['en', 'zh'], zh: ['en'] };
    const provider = {
      ...fakeProvider,
      languages: {
        ...fakeProvider.languages,
        sources: () => [{ value: 'en' }, { value: 'ja' }, { value: 'zh' }],
        targets: (source: string) => (targets[source] ?? []).map((value) => ({ value })),
        reverse: undefined,
      },
    } as unknown as typeof fakeProvider;
    const onChange = draw({ source: 'en', target: 'ja' }, undefined, { provider, sentence: { mode: 'both', textOnly: false }, receive: { theirs: choice(true), mine: choice(false) } });
    const myLanguage = screen.getByTestId('language-their-row').querySelectorAll('select.language-select')[1] as HTMLSelectElement;
    // Chinese would make zh → en, whose reverse en → zh this provider does not run.
    expect(codesOf(myLanguage)).toEqual(['en', 'ja']);
    fireEvent.change(myLanguage, { target: { value: 'ja' } });
    expect(onChange).toHaveBeenLastCalledWith({ source: 'ja', target: 'en' });
  });

  // CI, PR #784: the other side's row asks the provider's language rules for every choice, and a provider's rules can be
  // costly (the local engine's go through its model manifest); they are asked once each, and not at all without the row.
  it("asks each language rule once while drawing the other side's row, and not at all for it elsewhere", () => {
    const codes = Array.from({ length: 30 }, (_, i) => `l${i}`);
    const sources = vi.fn(() => codes.map((value) => ({ value })));
    const targets = vi.fn((source: string) => codes.filter((c) => c !== source).map((value) => ({ value })));
    const provider = { ...fakeProvider, languages: { ...fakeProvider.languages, sources, targets, reverse: undefined } } as unknown as typeof fakeProvider;
    draw({ source: 'l0', target: 'l1' }, undefined, { provider, sentence: { mode: 'both', textOnly: false } });
    const without = { sources: sources.mock.calls.length, targets: targets.mock.calls.length };
    cleanup();
    sources.mockClear();
    targets.mockClear();
    draw({ source: 'l0', target: 'l1' }, undefined, { provider, sentence: { mode: 'both', textOnly: false }, receive: { theirs: choice(true), mine: choice(false) } });
    expect(screen.getByTestId('language-their-row')).toBeTruthy();
    // The row adds one question per context and source at most.
    expect(sources.mock.calls.length).toBeLessThanOrEqual(without.sources + 1);
    expect(targets.mock.calls.length).toBeLessThanOrEqual(without.targets + codes.length);
    expect(without.sources).toBeLessThanOrEqual(3);
  });

  it("each reason's link opens the switch of the side it explains", () => {
    const openAudio = vi.fn();
    draw({ source: 'ja', target: 'en' }, undefined, {
      sentence: { mode: 'both', textOnly: false },
      receive: { theirs: choice(true, 'audioPanel.otherHearsAlwaysSpeaks'), mine: choice(false, 'audioPanel.blockedWholeSystem'), onOpenAudio: openAudio },
    });
    const links = screen.getAllByRole('button', { name: 'mainPanel.audioSettings' });
    expect(links).toHaveLength(2);
    fireEvent.click(links[0]);
    fireEvent.click(links[1]);
    expect(openAudio.mock.calls).toEqual([['theirs'], ['mine']]);
  });

  it('two sides blocked for the same reason each keep their own link', () => {
    const openAudio = vi.fn();
    draw({ source: 'ja', target: 'en' }, undefined, {
      sentence: { mode: 'both', textOnly: false },
      receive: { theirs: choice(true, 'audioPanel.rowLockedByRun'), mine: choice(false, 'audioPanel.rowLockedByRun'), onOpenAudio: openAudio },
    });
    const links = screen.getAllByRole('button', { name: 'mainPanel.audioSettings' });
    expect(links).toHaveLength(2);
    links.forEach((link) => fireEvent.click(link));
    expect(openAudio.mock.calls).toEqual([['theirs'], ['mine']]);
  });

  it("locks a choice by its own reason, not the section's: during a session the languages lock, a switchable word does not", () => {
    draw({ source: 'ja', target: 'en' }, undefined, {
      sentence: { mode: 'both', textOnly: false }, disabled: true,
      receive: { theirs: choice(true, 'audioPanel.rowLockedByRun'), mine: choice(true) },
    });
    const [theirs, mine] = receiveSelects();
    // Both still open: the locked one offers only what it is.
    expect([theirs.disabled, mine.disabled]).toEqual([false, false]);
    expect(disabledValues(theirs)).toEqual(['read']);
    expect(disabledValues(mine)).toEqual([]);
    expect((screen.getAllByRole('combobox').filter((s) => s.classList.contains('language-select')) as HTMLSelectElement[]).every((s) => s.disabled)).toBe(true);
  });

  it('a choice that cannot be changed still opens, showing what it cannot become greyed, with why and the way to the audio settings (owner, 2026-11-18)', () => {
    const openAudio = vi.fn();
    draw({ source: 'ja', target: 'en' }, undefined, {
      sentence: { mode: 'participant', textOnly: false },
      receive: { mine: choice(false, 'audioPanel.blockedWholeSystem'), onOpenAudio: openAudio },
    });
    const [select] = receiveSelects();
    expect(select.disabled).toBe(false);
    expect(select.value).toBe('read');
    expect(disabledValues(select)).toEqual(['hear']);
    expect(select.getAttribute('aria-describedby')).toBe(screen.getByText('audioPanel.blockedWholeSystem').closest('p')!.id);
    fireEvent.click(screen.getByRole('button', { name: 'mainPanel.audioSettings' }));
    expect(openAudio).toHaveBeenCalledWith('mine');
  });
});

describe('LanguagePairSection — a language context (Stage 2 Volcengine AST2, choice 1)', () => {
  const opt = (value: string) => ({ value, name: value, englishName: value });
  /** Speaking offers en and ja; text also ko — Doubao AST 2.0's shape. */
  const offered = (context?: LanguageContext) => [opt('en'), opt('ja'), ...(context?.speech ? [] : [opt('ko')])];
  const moody = {
    ...fakeProvider,
    languages: {
      sources: (_s: unknown, context?: LanguageContext) => offered(context),
      targets: (source: string, _s: unknown, context?: LanguageContext) => offered(context).filter((o) => o.value !== source),
    },
  } as unknown as typeof fakeProvider;
  const drawIn = (context: LanguageContext | undefined, pair: { source: string; target: string }, onChange = vi.fn()) => {
    render(<LanguagePairSection provider={moody} settings={FAKE_DEFAULTS} pair={pair} onChange={onChange} context={context} />);
    return onChange;
  };

  it('lists the offer for the context, and the widest one without', () => {
    drawIn({ speech: true }, { source: 'en', target: 'ja' });
    expect(codesOf(screen.getByLabelText('settings.sourceLanguage'))).toEqual(['en', 'ja']);
    expect(codesOf(screen.getByLabelText('settings.targetLanguage'))).toEqual(['ja']);
    cleanup();
    drawIn(undefined, { source: 'en', target: 'ja' });
    expect(codesOf(screen.getByLabelText('settings.sourceLanguage'))).toEqual(['en', 'ja', 'ko']);
  });

  it('normalizes a new source within the context, and swaps only within it', () => {
    const onChange = drawIn({ speech: true }, { source: 'en', target: 'ja' });
    fireEvent.change(screen.getByLabelText('settings.sourceLanguage'), { target: { value: 'ja' } });
    expect(onChange).toHaveBeenCalledWith({ source: 'ja', target: 'en' });
    cleanup();
    drawIn({ speech: false }, { source: 'en', target: 'ko' });
    expect(screen.getByTitle('simpleConfig.swapLanguages')).not.toBeDisabled();
    cleanup();
    drawIn({ speech: true }, { source: 'en', target: 'ko' });
    expect(screen.getByTitle('simpleConfig.swapLanguages')).toBeDisabled();
  });
});

// Owner, 2026-11-19: only the verb is the choice, set in its sentence as the language orders it.
describe('aroundVerb', () => {
  it('gives the text before the verb, and after it where the language puts some there', () => {
    expect(aroundVerb(`they ${VERB_MARK}`)).toEqual(['they ', '']);
    expect(aroundVerb(`相手が${VERB_MARK}言語`)).toEqual(['相手が', '言語']);
    expect(aroundVerb(`${VERB_MARK} nila sa`)).toEqual(['', ' nila sa']);
  });

  it('gives nothing either side where the verb carries its subject', () => {
    expect(aroundVerb(VERB_MARK)).toEqual(['', '']);
  });

  it('leaves out a sentence that lost its verb, rather than showing it beside one it does not hold', () => {
    expect(aroundVerb('they hear')).toEqual(['', '']);
  });
});
