// src/components/History/languageDirection.ts
//
// A session's languages as the History list and the record page show them. A record keeps "my language" and the other
// side's; which way the session translated depends on whose speech it heard (owner, 2026-11-18): "Me" translated mine
// into theirs, "Other" theirs into mine, "Both" and face to face each way.
import { languageLabel } from '../../lib/language/label';

export function languageDirection(r: { mode: string; myLanguage: string; targetLanguage: string }, ui: string): string {
  const mine = languageLabel(r.myLanguage, ui);
  const theirs = languageLabel(r.targetLanguage, ui);
  if (r.mode === 'participant') return `${theirs} → ${mine}`;
  if (r.mode === 'both' || r.mode === 'face-to-face') return `${mine} ⇄ ${theirs}`;
  return `${mine} → ${theirs}`;
}
