// src/components/LanguagePairText/LanguagePairText.tsx
//
// Two language names with an arrow icon between them, the way a session translates: the conversation's footer, the
// History list and the record page. An icon, not a character: the interface's fonts have no arrow, so each machine drew
// one from a different font (Cantarell, Liberation Sans), small and below the names' middle (owner, 2026-11-19). Mine
// stays first, at the left, in a right-to-left script too (review, 2026-11-18): the pair is laid out left to right, each
// name in its own direction. A screen reader reads the icon by its label between the names.
import type { LucideIcon } from 'lucide-react';
import './LanguagePairText.scss';

export interface LanguagePairTextProps {
  left: string;
  /** ArrowRight, ArrowLeft or ArrowRightLeft, as the session translates. */
  arrow: LucideIcon;
  /** What the icon says, for a screen reader: "translated into", "translated from", "translated both ways". */
  label: string;
  right: string;
}

export function LanguagePairText({ left, arrow: Arrow, label, right }: LanguagePairTextProps) {
  return (
    <span className="language-pair-text" dir="ltr">
      <bdi>{left}</bdi>
      {' '}
      <Arrow className="language-pair-text__arrow" role="img" aria-label={label} />
      {' '}
      <bdi>{right}</bdi>
    </span>
  );
}
