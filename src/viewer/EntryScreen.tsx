// src/viewer/EntryScreen.tsx
import React from 'react';
import Button from '../components/Settings/shared/Button';
import type { ShareState } from '../lib/share/types';
import type { T } from './strings';
import { choiceOptions, type Choice } from './text';

interface EntryScreenProps {
  t: T;
  name(code: string): string;
  pair: ShareState['pair'] | null;
  choice: Choice;
  onChoose(choice: Choice): void;
  onStart(): void;
}

const same = (a: Choice, b: Choice) => a.code === b.code && a.both === b.both;

const EntryScreen: React.FC<EntryScreenProps> = ({ t, name, pair, choice, onChoose, onStart }) => (
  <main className="viewer-enter">
    <h1 className="viewer-enter__title">{t('viewer.title')}</h1>
    {pair ? (
      <>
        <p className="viewer-enter__pair">{`${name(pair.source)} ⇄ ${name(pair.target)}`}</p>
        <fieldset className="viewer-enter__choices">
          <legend>{t('viewer.enter.iRead')}</legend>
          {choiceOptions(pair).map((option) => {
            const selected = option.both ? choice.both : same(option, choice);
            const other = option.both ? (choice.code === pair.source ? pair.target : pair.source) : '';
            const first = option.both ? (choice.code === pair.source ? pair.source : pair.target) : '';
            return (
              <button
                key={`${option.code}:${option.both}`}
                type="button"
                className={`viewer-option ${selected ? 'selected' : ''}`.trim()}
                aria-pressed={selected}
                onClick={() => onChoose(option.both ? { code: first, both: true } : option)}
              >
                <b>{option.both ? t('viewer.enter.both') : name(option.code)}</b>
                {option.both && <span>{t('viewer.enter.bothHint', { first: name(first), second: name(other) })}</span>}
              </button>
            );
          })}
        </fieldset>
      </>
    ) : (
      <p className="viewer-enter__pair">{t('viewer.connecting')}</p>
    )}
    <Button variant="primary" onClick={onStart} disabled={!pair}>{t('viewer.enter.start')}</Button>
    <p className="viewer-enter__note">{t('viewer.enter.insecureNote')}</p>
  </main>
);

export default EntryScreen;
