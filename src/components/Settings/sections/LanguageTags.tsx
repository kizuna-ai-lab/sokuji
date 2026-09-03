import React from 'react';
import { useTranslation } from 'react-i18next';
import Tooltip from '../../Tooltip/Tooltip';
import { languageNameFor } from '../engine/languageName';

/** The catalogs' "any language" markers — the WASM manifest's `multilingual`,
 *  the native catalog's `multi` (Whisper) — a single entry that carries no
 *  list of its own; its tooltip just says so. */
const MULTI_MARKERS = new Set(['multilingual', 'multi']);

/**
 * A model card's language tags (decision 2026-09-03): one supported language
 * shows as before, a single chip with its code; two or more collapse into
 * one "Multi" chip whose hover tooltip lists every language by name, so a
 * 99-language ASR model no longer stacks rows of chips under its name. A
 * bare "multilingual" marker is the same chip with a one-word tooltip.
 * Shared by the native and WASM library cards.
 */
export const LanguageTags: React.FC<{ languages: readonly string[] }> = ({ languages }) => {
  const { t } = useTranslation();
  const codes = Array.from(new Set(languages.filter((l) => typeof l === 'string' && l.trim() !== '')));
  if (codes.length === 0) return null;

  const multiLabel = t('models.multiLanguage', 'Multi');
  const multiChip = <span className="model-card__lang-tag model-card__lang-tag--multi">{multiLabel}</span>;
  const listed = codes.filter((c) => !MULTI_MARKERS.has(c));

  if (listed.length === 0) {
    // Only markers: nothing to list, the tooltip states what the chip means.
    return (
      <Tooltip content={t('models.multilingual', 'Multilingual')} position="top">
        {multiChip}
      </Tooltip>
    );
  }
  if (codes.length === 1) {
    return <span className="model-card__lang-tag">{codes[0]}</span>;
  }

  const content = (
    <div className="model-card__lang-list">
      <div className="model-card__lang-list-count">
        {t('models.languagesCount', '{{count}} languages', { count: listed.length })}
      </div>
      <div>{listed.map(languageNameFor).join(', ')}</div>
    </div>
  );
  return (
    <Tooltip content={content} position="top" maxWidth={320}>
      {multiChip}
    </Tooltip>
  );
};

export default LanguageTags;
