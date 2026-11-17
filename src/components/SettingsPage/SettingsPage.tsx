// src/components/SettingsPage/SettingsPage.tsx
//
// One settings page with its categories on the left (providers and stages
// design, section 8). Two forms: on a desktop window at least 768 px wide the
// navigation and the content side by side; in the extension and in narrower
// windows the category list first, then one category at a time.
import React, { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, Lock, Search } from 'lucide-react';
import { useSessionLocked } from '../../app/useRun';
import useSettingsStore, { useNavigateToSettings, useSettingsNavigationTarget } from '../../stores/settingsStore';
import { isExtension } from '../../utils/environment';
import { CATEGORIES, GROUPS, filterCategories, targetToCategory, type Category, type CategoryId } from './categories';
import { LineUpCategory } from './LineUpCategory';
import { AccountsCategory } from './AccountsCategory';
import { AudioCategory, ModelsCategory } from './DeviceCategories';
import { DisplayCategory } from './DisplayCategory';
import { GeneralCategory } from './GeneralCategory';
import { HistoryCategory } from './HistoryCategory';
import { WordsCategory } from './WordsCategory';
import { useWideForm } from './useWideForm';
// Today's sections (rows, selects, key fields) are styled there; the old panel that loaded it is gone.
import '../Settings/Settings.scss';
import './SettingsPage.scss';

export interface CategoryBodyProps {
  locked: boolean;
  /** The navigation target that opened this category (a notice, the tour), or null when the user picked it. */
  openedBy?: string | null;
}
export type CategoryBodies = Partial<Record<CategoryId, ComponentType<CategoryBodyProps>>>;

/** Each category's body; a category without one shows its title only. */
export const CATEGORY_BODIES: CategoryBodies = {
  lineup: LineUpCategory,
  words: WordsCategory,
  accounts: AccountsCategory,
  models: ModelsCategory,
  audio: AudioCategory,
  display: DisplayCategory,
  history: HistoryCategory,
  general: GeneralCategory,
};


const TITLES: Record<CategoryId, string> = {
  lineup: 'Languages and line-up', words: 'Word list and background', accounts: 'Accounts and keys', models: 'Models and storage',
  audio: 'Audio', display: 'Display', history: 'History and notes', general: 'General',
};
/** The line under a category's title (the mock's): what the category is for. Categories without one show none. */
const INTROS: Partial<Record<CategoryId, string>> = {
  accounts: 'Accounts and keys: each service is filled in once. Once it is, what it can do is chosen in "Languages and line-up".',
  models: 'Every model downloaded to this computer is managed here: the ones sessions use, the helpers, and imported voices.',
  audio: 'Microphone, speech and the other side\'s audio. Everything except "Translation the other side hears" can be changed during a session.',
  display: 'The same values as the buttons above the conversation and on the caption bar: change them on either side, and they apply at once. The main window and caption mode each keep their own.',
};
const GROUP_TITLES: Record<string, string> = { session: 'Session', providers: 'Providers and models', devices: 'Devices and display', data: 'Data', app: 'App' };

/** A dialog inside a hidden panel must not block this page's Escape: panels stay mounted and hide with display:none. */
const isVisibleDialogOpen = (): boolean => {
  for (const dialog of document.querySelectorAll<HTMLElement>('[role="dialog"]')) {
    let hidden = false;
    for (let node: HTMLElement | null = dialog; node; node = node.parentElement) {
      if (node.style.display === 'none') { hidden = true; break; }
    }
    if (!hidden) return true;
  }
  return false;
};


export function SettingsPage({ onClose, bodies = CATEGORY_BODIES }: { onClose(): void; bodies?: CategoryBodies }): React.JSX.Element {
  const { t } = useTranslation();
  const locked = useSessionLocked();
  const root = useRef<HTMLDivElement>(null);
  const wide = useWideForm(root);
  const target = useSettingsNavigationTarget();
  const navigateToSettings = useNavigateToSettings();
  const shown = useMemo(() => CATEGORIES.filter((c) => c.shown() && !(c.desktopOnly && isExtension())), []);
  const [query, setQuery] = useState('');
  /** The open category; null in the narrow form means the list. */
  const [open, setOpenState] = useState<CategoryId | null>(null);
  const [openedBy, setOpenedBy] = useState<string | null>(null);
  /** The user's own pick: no target opened it. */
  const setOpen = (id: CategoryId | null) => { setOpenedBy(null); setOpenState(id); };
  const navigationRun = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null);
  /** The category last open in the narrow form: Back returns the focus to its entry in the list. */
  const lastOpen = useRef<CategoryId | null>(null);
  const current: CategoryId | null = open ?? (wide ? shown[0]?.id ?? null : null);

  const title = (c: Category) => t(c.titleKey, TITLES[c.id]);
  const listed = filterCategories(query, (key) => t(key, ''), shown);

  // A navigation target opens its category, then highlights its element as the old panel did.
  useEffect(() => {
    if (!target) return;
    const run = ++navigationRun.current;
    const { category, anchor } = targetToCategory(target);
    setOpenState(category);
    setOpenedBy(target);
    if (!anchor) {
      navigateToSettings(null);
      return;
    }
    let highlightTimer: ReturnType<typeof setTimeout> | undefined;
    let highlighted: HTMLElement | null = null;
    const scrollTimer = setTimeout(() => {
      const element = document.getElementById(`${anchor}-section`);
      if (!element) {
        navigateToSettings(null);
        return;
      }
      element.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
      element.classList.add('highlight');
      highlighted = element;
      highlightTimer = setTimeout(() => {
        element.classList.remove('highlight');
        highlighted = null;
        navigateToSettings(null);
      }, 3000);
    }, 150);
    return () => {
      clearTimeout(scrollTimer);
      if (highlightTimer) clearTimeout(highlightTimer);
      highlighted?.classList.remove('highlight');
      // Closing the page hides it, which cancels the timer that would have cleared the target; left set, the next
      // navigation to the same target would change nothing and the page would not open. Deferred a microtask: by
      // then StrictMode's rehearsal, a newer target or a reopened page has started a newer run; a real close has not.
      queueMicrotask(() => {
        if (navigationRun.current !== run) return;
        if (useSettingsStore.getState().settingsNavigationTarget === target) navigateToSettings(null);
      });
    };
  }, [target, navigateToSettings]);

  // In the narrow form one view replaces the other: the focus goes to the category opened, and back to its entry.
  useEffect(() => {
    if (wide) return;
    if (open) {
      lastOpen.current = open;
      heading.current?.focus();
    } else if (lastOpen.current) {
      root.current?.querySelector<HTMLButtonElement>(`[data-category="${lastOpen.current}"]`)?.focus();
      lastOpen.current = null;
    }
  }, [wide, open]);

  // Esc: back to the list from a category in the narrow form; otherwise close. A field or a dialog that handled it wins.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || isVisibleDialogOpen()) return;
      if (!wide && open) setOpen(null);
      else onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [wide, open, onClose]);

  const lockNote = (c: Category) => (c.lockedInSession === 'open'
    ? t('settingsPage.changeable', 'Changeable during a session')
    : c.lockedInSession === 'locked'
      ? t('settingsPage.lockedNote', 'Locked during a session')
      : t('settingsPage.partlyLocked', 'Partly locked during a session'));

  const list = (
    <>
      <label className="settings-page__search">
        <Search size={14} aria-hidden="true" />
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)}
          // Esc first clears what was typed; on an empty box it closes the page as anywhere else.
          onKeyDown={(e) => { if (e.key === 'Escape' && query) { e.preventDefault(); setQuery(''); } }}
          placeholder={t('settingsPage.search', 'Search settings')} aria-label={t('settingsPage.search', 'Search settings')} />
      </label>
      {GROUPS.map((group) => {
        const items = listed.filter((c) => c.group === group);
        if (!items.length) return null;
        return (
          <div className="settings-page__group" key={group}>
            <h3>{t(`settingsPage.groups.${group}`, GROUP_TITLES[group])}</h3>
            {items.map((c) => (
              <button key={c.id} type="button" data-category={c.id} className={`settings-page__item${c.id === current ? ' is-current' : ''}`}
                aria-current={c.id === current ? 'page' : undefined} onClick={() => setOpen(c.id)}>
                <span>{title(c)}</span>
                {locked && <small>{c.lockedInSession !== 'open' && <Lock size={10} aria-hidden="true" />} {lockNote(c)}</small>}
              </button>
            ))}
          </div>
        );
      })}
    </>
  );

  const Body = current ? bodies[current] : undefined;
  const currentCategory = CATEGORIES.find((c) => c.id === current);
  const content = currentCategory && (
    <section className="settings-page__content">
      <header>
        {!wide && (
          <button type="button" className="settings-page__back" onClick={() => setOpen(null)}>
            <ChevronLeft size={14} aria-hidden="true" /> {t('settingsPage.backToList', 'Back to the list')}
          </button>
        )}
        <h2 ref={heading} tabIndex={-1}>{title(currentCategory)}</h2>
        {INTROS[currentCategory.id] && <p className="settings-page__intro">{t(`settingsPage.intro.${currentCategory.id}`, INTROS[currentCategory.id]!)}</p>}
      </header>
      <div className="settings-page__body">{Body ? <Body locked={locked} openedBy={openedBy} /> : null}</div>
    </section>
  );

  return (
    <div ref={root} className={`settings-page ${wide ? 'settings-page--wide' : 'settings-page--narrow'}`} data-testid="settings-page">
      {locked && (
        <div className="settings-page__locked" role="status">
          {t('settingsPage.lockedLine', 'A session is running. Languages, the line-up, the word list, models and keys are locked; audio, display and the rest can be changed.')}
        </div>
      )}
      {wide ? (
        <div className="settings-page__columns">
          <nav className="settings-page__nav" aria-label={t('settingsPage.title', 'Settings')}>
            <button type="button" className="settings-page__back" onClick={onClose}>
              <ChevronLeft size={14} aria-hidden="true" /> {t('settingsPage.back', 'Back to the session')}
            </button>
            {list}
          </nav>
          {content}
        </div>
      ) : current ? content : (
        <nav className="settings-page__nav" aria-label={t('settingsPage.title', 'Settings')}>
          <button type="button" className="settings-page__back" onClick={onClose}>
            <ChevronLeft size={14} aria-hidden="true" /> {t('settingsPage.back', 'Back to the session')}
          </button>
          {list}
        </nav>
      )}
    </div>
  );
}

export default SettingsPage;
