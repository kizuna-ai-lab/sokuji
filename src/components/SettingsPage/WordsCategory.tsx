// src/components/SettingsPage/WordsCategory.tsx
//
// "Word list and background" (spec §9): one table for the whole app — written as (required), translation, often
// heard as — and the session background beside it, both sent to each service at the start of a session in the field
// it has for them. A small table says which services use which column. Locked during a session, like the line-up:
// what is sent is read at the start.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';
import { addWords, normaliseEntries, useWordList, type WordEntry } from '../../lib/words/list';
import { WORD_LIMITS } from '../../lib/words/forService';
import FormInput from '../Settings/shared/FormInput';
import type { CategoryBodyProps } from './SettingsPage';
import './WordsCategory.scss';

/** The services' own names: brands, not words to translate. "This device" is the local engines. */
const SERVICE_NAMES: Readonly<Record<string, string>> = {
  soniox: 'Soniox', openai: 'OpenAI Realtime', qwen_livetranslate: 'Qwen LiveTranslate', volcengine_ast2: 'Doubao AST 2.0', gemini: 'Gemini Live',
};

interface Draft { written: string; translation: string; heardAs: string }
const toDraft = (e: WordEntry): Draft => ({ written: e.written, translation: e.translation ?? '', heardAs: e.heardAs ?? '' });

/** Pasted lines, one entry each: `written`, or `written = translation` (split at the first `=`). */
export function parsePasted(text: string): WordEntry[] {
  return normaliseEntries(text.split('\n').map((line) => {
    const eq = line.indexOf('=');
    return eq < 0 ? { written: line } : { written: line.slice(0, eq), translation: line.slice(eq + 1) };
  }));
}

export function WordsCategory({ locked }: CategoryBodyProps) {
  const { t } = useTranslation();
  const entries = useWordList((s) => s.entries);
  const background = useWordList((s) => s.background);
  const loaded = useWordList((s) => s.loaded);
  const [rows, setRows] = useState<Draft[]>(() => entries.map(toDraft));
  const [backgroundDraft, setBackgroundDraft] = useState(background);
  const [pasted, setPasted] = useState('');

  useEffect(() => { if (!loaded) void useWordList.getState().load(); }, [loaded]);
  // What is stored, when it changes outside this page (a name added from the notes) or once loaded; a row still being
  // filled in (nothing written yet) stays while what is stored is what the rows make.
  useEffect(() => {
    setRows((now) => (JSON.stringify(normaliseEntries(now)) === JSON.stringify(entries) ? now : entries.map(toDraft)));
  }, [entries]);
  useEffect(() => { setBackgroundDraft(background); }, [background]);

  const save = (next: Draft[]) => {
    setRows(next);
    // Leaving a cell that changed nothing writes nothing.
    if (JSON.stringify(normaliseEntries(next)) === JSON.stringify(useWordList.getState().entries)) return;
    void useWordList.getState().setEntries(next);
  };
  const edit = (i: number, field: keyof Draft, value: string) => setRows(rows.map((r, k) => (k === i ? { ...r, [field]: value } : r)));
  const addPasted = async () => {
    await addWords(parsePasted(pasted));
    setPasted('');
  };

  const byModel = t('settingsPage.wordList.byModel', 'Depends on model');
  const columnName: Record<string, string> = {
    terms: t('settingsPage.wordList.written', 'Written as'),
    translations: t('settingsPage.wordList.translation', 'Translation'),
    heardAs: t('settingsPage.wordList.heardAs', 'Often heard as'),
    background: t('settingsPage.wordList.background', 'Session background'),
  };

  return (
    <div className="settings-category words-category">
      <p className="words-category__hint">
        {t('settingsPage.wordList.hint', 'Names and terms for every service, sent at the start of each session. Each service gets the columns it has a place for.')}
      </p>

      <table className="words-category__table">
        <thead>
          <tr>
            <th scope="col">{columnName.terms}</th>
            <th scope="col">{columnName.translations}</th>
            <th scope="col">{columnName.heardAs}</th>
            <th scope="col"><span className="visually-hidden">{t('settingsPage.wordList.remove', 'Remove')}</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {(['written', 'translation', 'heardAs'] as const).map((field) => (
                <td key={field}>
                  <FormInput
                    aria-label={`${field === 'written' ? columnName.terms : field === 'translation' ? columnName.translations : columnName.heardAs} ${i + 1}`}
                    value={r[field]} disabled={locked} spellCheck={false}
                    onChange={(e) => edit(i, field, e.target.value)} onBlur={() => save(rows)}
                  />
                </td>
              ))}
              <td>
                <button type="button" className="model-row__btn" disabled={locked} aria-label={`${t('settingsPage.wordList.remove', 'Remove')} ${i + 1}`}
                  onClick={() => save(rows.filter((_, k) => k !== i))}>
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="model-row__btn words-category__add" disabled={locked}
        onClick={() => setRows([...rows, { written: '', translation: '', heardAs: '' }])}>
        <Plus size={14} aria-hidden="true" /> {t('settingsPage.wordList.addRow', 'Add a row')}
      </button>

      <div className="words-category__paste">
        <label htmlFor="words-paste">{t('settingsPage.wordList.paste', 'Paste several: one per line, "written" or "written = translation"')}</label>
        <textarea id="words-paste" rows={3} value={pasted} disabled={locked} spellCheck={false} onChange={(e) => setPasted(e.target.value)} />
        <button type="button" className="model-row__btn" disabled={locked || !pasted.trim()} onClick={() => void addPasted()}>
          {t('settingsPage.wordList.addPasted', 'Add these')}
        </button>
      </div>

      <div className="words-category__background">
        <label htmlFor="words-background">{columnName.background}</label>
        <small>{t('settingsPage.wordList.backgroundHint', 'What the session is about: an agenda, a topic, who takes part.')}</small>
        <textarea id="words-background" rows={4} value={backgroundDraft} disabled={locked}
          onChange={(e) => setBackgroundDraft(e.target.value)} onBlur={() => void useWordList.getState().setBackground(backgroundDraft)} />
      </div>

      <table className="words-category__usage">
        <caption>{t('settingsPage.wordList.usage', 'Which services use what')}</caption>
        <thead>
          <tr><th scope="col">{t('settingsPage.wordList.service', 'Service')}</th>{Object.values(columnName).map((c) => <th scope="col" key={c}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {Object.entries(WORD_LIMITS).map(([id, limit]) => (
            <tr key={id}>
              <th scope="row">{SERVICE_NAMES[id] ?? t('settingsPage.wordList.thisDevice', 'This device')}</th>
              {(['terms', 'translations', 'heardAs', 'background'] as const).map((c) => (
                <td key={c}>{!limit.columns.includes(c) ? '—' : limit.byModel?.includes(c) ? byModel : '✓'}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <small className="words-category__others">
        {t('settingsPage.wordList.byModelNote', 'Depends on model: OpenAI takes the background with its older transcription models only; Gemini Live takes the terms with gemini-3.8-live only; this device reads the list with its large language model translators only.')}
      </small>
      <small className="words-category__others">
        {t('settingsPage.wordList.others', 'OpenAI Translate, OpenAI Live and Palabra have no place for a word list; they get none.')}
      </small>
    </div>
  );
}
