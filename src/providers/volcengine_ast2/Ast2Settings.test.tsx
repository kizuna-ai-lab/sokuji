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

import { Ast2SettingsView } from './Ast2Settings';
import { AST2_DEFAULTS } from './settings';

beforeEach(() => {
  tooltips.length = 0;
  openExternalUrl.mockClear();
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

  it('locks the three fields while disabled', () => {
    render(<Ast2SettingsView settings={AST2_DEFAULTS} update={vi.fn()} disabled />);
    for (const label of ['settings.volcengineAST2HotWordLibraryId', 'settings.volcengineAST2ReplacementLibraryId', 'settings.volcengineAST2GlossaryLibraryId']) {
      expect(screen.getByLabelText(label)).toBeDisabled();
    }
  });
});
