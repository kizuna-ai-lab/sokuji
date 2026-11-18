// src/components/LanguagePairText/LanguagePairText.tsx
//
// Two language names with an arrow between them, the way a session translates: the conversation's footer, the History
// list and the record page. The arrow is drawn: as a character it came from whatever font had one (Cantarell on
// Ubuntu), small and below the names' middle (owner, 2026-11-19). The character is kept, unseen, for a screen reader
// and for copying. Mine stays first, at the left, in a right-to-left script too (review, 2026-11-18): the pair is laid
// out left to right, each name in its own direction.
import { ArrowLeft, ArrowRight, ArrowRightLeft } from 'lucide-react';
import './LanguagePairText.scss';

export type LanguageArrow = '→' | '←' | '⇄';

const ICONS = { '→': ArrowRight, '←': ArrowLeft, '⇄': ArrowRightLeft } as const;

export interface LanguagePairTextProps {
  left: string;
  arrow: LanguageArrow;
  right: string;
}

export function LanguagePairText({ left, arrow, right }: LanguagePairTextProps) {
  const Icon = ICONS[arrow];
  return (
    <span className="language-pair-text" dir="ltr">
      <bdi>{left}</bdi>
      {' '}
      <span className="language-pair-text__said">{arrow}</span>
      <Icon className="language-pair-text__arrow" aria-hidden="true" />
      {' '}
      <bdi>{right}</bdi>
    </span>
  );
}
