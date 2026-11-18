// src/components/History/languageDirection.ts
//
// A session's languages as the History list and the record page show them. A record keeps "my language" and the other
// side's; which way the session translated depends on whose speech it heard (owner, 2026-11-18): "Me" translated mine
// into theirs, "Other" theirs into mine, "Both" and face to face each way.
import { languageLabel } from '../../lib/language/label';
import { parseCode } from '../../lib/language/code';
import { ArrowRight, ArrowRightLeft } from 'lucide-react';
import type { LanguagePairTextProps } from '../LanguagePairText/LanguagePairText';

type Translate = (key: string, fallback: string) => string;

export function languageDirection(r: { mode: string; myLanguage: string; targetLanguage: string }, ui: string, t: Translate): LanguagePairTextProps {
  const both = t('common.translatedBothWays', 'translated both ways');
  // A bidirectional pair (`zh+en`) is kept as both of the record's languages: its two languages, once, each way (review).
  const pair = r.myLanguage === r.targetLanguage ? parseCode(r.myLanguage) : null;
  if (pair?.kind === 'pair') return { left: languageLabel(pair.a, ui), arrow: ArrowRightLeft, label: both, right: languageLabel(pair.b, ui) };
  const mine = languageLabel(r.myLanguage, ui);
  const theirs = languageLabel(r.targetLanguage, ui);
  const into = t('common.translatedInto', 'translated into');
  if (r.mode === 'participant') return { left: theirs, arrow: ArrowRight, label: into, right: mine };
  if (r.mode === 'both' || r.mode === 'face-to-face') {
    return { left: mine, arrow: ArrowRightLeft, label: both, right: theirs };
  }
  return { left: mine, arrow: ArrowRight, label: into, right: theirs };
}
