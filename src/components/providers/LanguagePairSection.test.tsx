import { describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { AUTO } from '../../lib/provider/languages';
import type { LanguageContext } from '../../lib/provider/types';
import { fakeProvider } from '../../providers/fake/provider';
import { FAKE_DEFAULTS } from '../../providers/fake/settings';
import { LanguagePairSection } from './LanguagePairSection';

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return { ...actual, useTranslation: () => ({ t: (key: string) => key }) };
});

const draw = (
  pair: { source: string; target: string },
  onChange = vi.fn(),
  extra: { sentence?: { mode: 'speaker' | 'participant' | 'both'; textOnly: boolean }; provider?: typeof fakeProvider } = {},
) => {
  render(
    <LanguagePairSection
      provider={extra.provider ?? fakeProvider}
      settings={FAKE_DEFAULTS}
      pair={pair}
      onChange={onChange}
      sentence={extra.sentence}
    />,
  );
  return onChange;
};
const values = (select: HTMLElement) => [...(select as HTMLSelectElement).options].map((o) => o.value);

describe('LanguagePairSection', () => {
  it("lists the provider's sources, and the targets of the chosen source", () => {
    draw({ source: 'en', target: 'ja' });
    expect(values(screen.getByLabelText('settings.sourceLanguage'))).toEqual([AUTO, 'en', 'ja', 'zh']);
    expect(values(screen.getByLabelText('settings.targetLanguage'))).toEqual(['ja', 'zh']);
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

    it("textOnly on an 'optional' provider: they read", () => {
      draw({ source: 'ja', target: 'en' }, undefined, { sentence: { mode: 'speaker', textOnly: true } });
      expect(screen.getByText('settings.langSentence.iSpeak')).toBeTruthy();
      expect(screen.getByText('settings.langSentence.theyRead')).toBeTruthy();
    });
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
    expect(values(screen.getByLabelText('settings.sourceLanguage'))).toEqual(['en', 'ja']);
    expect(values(screen.getByLabelText('settings.targetLanguage'))).toEqual(['ja']);
    cleanup();
    drawIn(undefined, { source: 'en', target: 'ja' });
    expect(values(screen.getByLabelText('settings.sourceLanguage'))).toEqual(['en', 'ja', 'ko']);
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
