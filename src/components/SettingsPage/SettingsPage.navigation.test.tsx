// The settings page's navigation, search and session lock, at page level.
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

const env = vi.hoisted(() => ({ extension: false, locked: false }));
vi.mock('../../utils/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/environment')>()),
  isExtension: () => env.extension,
}));
vi.mock('../../app/useRun', () => ({ useSessionLocked: () => env.locked }));

import i18n from 'i18next';
import { changeLanguageWithLoad } from '../../locales';
import { SettingsPage, type CategoryBodies } from './SettingsPage';
import useSettingsStore from '../../stores/settingsStore';
import type { CategoryId } from './categories';

// Each category's body stands in as a marker, so the test sees which body is showing.
const IDS: CategoryId[] = ['lineup', 'words', 'accounts', 'models', 'audio', 'display', 'history', 'general'];
const bodies: CategoryBodies = Object.fromEntries(IDS.map((id) => [id, () => <div data-testid={`body-${id}`} />]));

const EN_GROUPS = [
  ['Session', ['Languages and line-up', 'Word list and background']],
  ['Providers and models', ['Accounts and keys', 'Models and storage']],
  ['Devices and display', ['Audio', 'Display']],
  ['Data', ['History and notes']],
  ['App', ['General']],
] as const;

/** The navigation as drawn: each group's title with its categories' titles, in order. */
function drawnGroups(): Array<[string, string[]]> {
  const nav = screen.getByRole('navigation');
  return [...nav.querySelectorAll('.settings-page__group')].map((g) => [
    g.querySelector('h3')!.textContent ?? '',
    [...g.querySelectorAll('button[data-category]')].map((b) => b.querySelector('span')!.textContent ?? ''),
  ]);
}
const search = () => screen.getByRole('searchbox');
const shownBody = () => screen.getByTestId(/^body-/).dataset.testid;

beforeEach(async () => {
  env.extension = false; env.locked = false;
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 });
  useSettingsStore.setState({ settingsNavigationTarget: null });
  await changeLanguageWithLoad('en');
});
afterEach(() => cleanup());
afterAll(async () => { await i18n.changeLanguage('en'); });

describe('settings categories and groups', () => {
  // categories.ts shows all eight on the desktop, History and notes and Word list included; History is desktop-only
  // (absent in the extension), the word list is in both.
  it('lists 8 categories on the desktop in 5 groups, in the agreed order, under their group titles', () => {
    render(<SettingsPage onClose={vi.fn()} bodies={bodies} />);
    expect(drawnGroups()).toEqual(EN_GROUPS.map(([g, cs]) => [g, [...cs]]));
    expect(screen.getByRole('navigation').querySelectorAll('button[data-category]')).toHaveLength(8);
  });

  it('names the groups in the interface language (Chinese)', async () => {
    await changeLanguageWithLoad('zh_CN');
    render(<SettingsPage onClose={vi.fn()} bodies={bodies} />);
    expect(drawnGroups()).toEqual([
      ['会话', ['语言与会话组成', '词表与背景']],
      ['服务商与模型', ['账号与密钥', '模型与存储']],
      ['设备与显示', ['音频', '显示']],
      ['数据', ['历史与纪要']],
      ['应用', ['通用']],
    ]);
  });

  it('in the extension lists 7: no History and notes, and no empty Data group', () => {
    env.extension = true;
    render(<SettingsPage onClose={vi.fn()} bodies={bodies} />);
    const groups = drawnGroups();
    expect(groups.map(([g]) => g)).toEqual(['Session', 'Providers and models', 'Devices and display', 'App']);
    expect(groups.flatMap(([, cs]) => cs)).toHaveLength(7);
    expect(groups.flatMap(([, cs]) => cs)).toContain('Word list and background');
  });

  it('clicking each category swaps the content on the right while the navigation stays as it was', () => {
    render(<SettingsPage onClose={vi.fn()} bodies={bodies} />);
    const nav = screen.getByRole('navigation');
    const before = drawnGroups();
    for (const id of IDS) {
      const button = nav.querySelector<HTMLButtonElement>(`button[data-category="${id}"]`)!;
      fireEvent.click(button);
      expect(shownBody()).toBe(`body-${id}`);
      expect(button).toHaveAttribute('aria-current', 'page');
      expect(nav.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
      // The same element, the same list: the navigation is not rebuilt or reordered by a click.
      expect(screen.getByRole('navigation')).toBe(nav);
      expect(drawnGroups()).toEqual(before);
    }
  });
});

describe('search in the settings', () => {
  const listed = () => drawnGroups().flatMap(([, cs]) => cs);

  it('"字号" (font size) in Chinese finds Display only, under its own group', async () => {
    await changeLanguageWithLoad('zh_CN');
    render(<SettingsPage onClose={vi.fn()} bodies={bodies} />);
    fireEvent.change(search(), { target: { value: '字号' } });
    expect(drawnGroups()).toEqual([['设备与显示', ['显示']]]);
  });

  it('"纪要" (notes) in Chinese finds History and notes, and the line-up whose fourth card writes them', async () => {
    await changeLanguageWithLoad('zh_CN');
    render(<SettingsPage onClose={vi.fn()} bodies={bodies} />);
    fireEvent.change(search(), { target: { value: '纪要' } });
    expect(listed()).toEqual(['语言与会话组成', '历史与纪要']);
    // Only the groups holding a hit are drawn: no empty group headings.
    expect(drawnGroups().map(([g]) => g)).toEqual(['会话', '数据']);
  });

  it('"font" in English finds Display', () => {
    render(<SettingsPage onClose={vi.fn()} bodies={bodies} />);
    fireEvent.change(search(), { target: { value: 'font' } });
    expect(listed()).toEqual(['Display']);
  });

  it('a provider name finds Accounts and keys, in any interface language', async () => {
    render(<SettingsPage onClose={vi.fn()} bodies={bodies} />);
    for (const name of ['Soniox', 'KizunaAI', 'kizuna ai', 'Palabra AI', 'OpenAI Realtime', 'Google Gemini', 'Doubao AST']) {
      fireEvent.change(search(), { target: { value: name } });
      expect(listed()).toEqual(['Accounts and keys']);
    }
    // Only names are matched without their spaces: a query does not run across the spaces of other words.
    fireEvent.change(search(), { target: { value: 'sand' } });
    expect(listed()).toEqual([]);
    await changeLanguageWithLoad('zh_CN');
    fireEvent.change(search(), { target: { value: 'openai' } });
    expect(listed()).toEqual(['账号与密钥']);
  });

  it('a found category opens on click', async () => {
    await changeLanguageWithLoad('zh_CN');
    render(<SettingsPage onClose={vi.fn()} bodies={bodies} />);
    fireEvent.change(search(), { target: { value: '字号' } });
    fireEvent.click(screen.getByRole('button', { name: /^显示/ }));
    expect(shownBody()).toBe('body-display');
  });

  it('a query nothing matches draws no group and no category at all', () => {
    render(<SettingsPage onClose={vi.fn()} bodies={bodies} />);
    fireEvent.change(search(), { target: { value: 'zzz-nothing' } });
    expect(drawnGroups()).toEqual([]);
    expect(screen.getByRole('navigation').querySelectorAll('h3')).toHaveLength(0);
  });

  it('clearing the query brings every category back', () => {
    render(<SettingsPage onClose={vi.fn()} bodies={bodies} />);
    fireEvent.change(search(), { target: { value: 'font' } });
    fireEvent.change(search(), { target: { value: '' } });
    expect(listed()).toHaveLength(8);
  });
});

describe('locked during a session (page level)', () => {
  const note = (name: RegExp) => screen.getByRole('button', { name }).querySelector('small')?.textContent?.trim();

  it('labels every category: locked, partly locked, or changeable', () => {
    env.locked = true;
    render(<SettingsPage onClose={vi.fn()} bodies={bodies} />);
    expect(note(/^Languages and line-up/)).toBe('Locked during a session');
    expect(note(/^Word list and background/)).toBe('Locked during a session');
    expect(note(/^Models and storage/)).toBe('Locked during a session');
    expect(note(/^Accounts and keys/)).toBe('Partly locked during a session');
    expect(note(/^Audio/)).toBe('Partly locked during a session');
    expect(note(/^Display/)).toBe('Changeable during a session');
    expect(note(/^History and notes/)).toBe('Changeable during a session');
    expect(note(/^General/)).toBe('Partly locked during a session');
  });

  it('labels them in Chinese with "会话中锁定" and "会话中部分锁定"', async () => {
    await changeLanguageWithLoad('zh_CN');
    env.locked = true;
    render(<SettingsPage onClose={vi.fn()} bodies={bodies} />);
    expect(note(/^语言与会话组成/)).toBe('会话中锁定');
    expect(note(/^账号与密钥/)).toBe('会话中部分锁定');
  });

  it('hands each body the lock, and once the session stops the labels and the line go and every body is unlocked', () => {
    const probe: CategoryBodies = Object.fromEntries(IDS.map((id) => [id, ({ locked }: { locked: boolean }) => <div data-testid={`body-${id}`} data-locked={String(locked)} />]));
    env.locked = true;
    const { rerender } = render(<SettingsPage onClose={vi.fn()} bodies={probe} />);
    for (const id of IDS) {
      fireEvent.click(screen.getByRole('navigation').querySelector(`button[data-category="${id}"]`)!);
      expect(screen.getByTestId(`body-${id}`)).toHaveAttribute('data-locked', 'true');
    }
    env.locked = false;
    rerender(<SettingsPage onClose={vi.fn()} bodies={probe} />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('navigation').querySelectorAll('small')).toHaveLength(0);
    // The category open before the stop is still open, now unlocked.
    expect(screen.getByTestId('body-general')).toHaveAttribute('data-locked', 'false');
  });
});
