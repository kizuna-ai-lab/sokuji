// src/components/Settings/sections/AsrFactsHelp.tsx
//
// What a recognition card's accuracy grade and speed meter mean, in their tooltips: the model's own measured figure,
// then the whole scale with the model's place on it — what error rate each letter stands for, and what time limit
// each step of the meter stands for (owner, 2026-11-27). The scales are the catalog's (`asrBenchmarks.ts`).
import React from 'react';
import { useTranslation } from 'react-i18next';
import { GRADE_BANDS, SPEED_LIMITS, SPEED_METER_STEPS, subGradeEdges } from '../../../lib/local-inference/native/asrBenchmarks';
import './AsrFactsHelp.scss';

/** One decimal at most, in the interface's language ("5.8", "5,8"). */
function useNumber(): (n: number) => string {
  const { i18n } = useTranslation();
  let format: Intl.NumberFormat;
  try {
    format = new Intl.NumberFormat((i18n?.language || 'en').replace('_', '-'), { maximumFractionDigits: 1 });
  } catch {
    format = new Intl.NumberFormat('en', { maximumFractionDigits: 1 });
  }
  return (n) => format.format(n);
}

/** A five-step meter with `level` steps lit, as on the card. */
export const SpeedMeter: React.FC<{ level: number; className?: string }> = ({ level, className }) => (
  <span className={`asr-meter${className ? ` ${className}` : ''}`} aria-hidden="true">
    {Array.from({ length: SPEED_METER_STEPS }, (_, n) => <i key={n} className={n < level ? 'on' : undefined} />)}
  </span>
);

export const GradeHelp: React.FC<{ language: string; grade: string | undefined; error: number | undefined }> = ({ language, grade, error }) => {
  const { t } = useTranslation();
  const num = useNumber();
  const letter = grade?.[0];
  const sub = letter === 'A' || letter === 'B' || letter === 'C' ? subGradeEdges(letter) : null;
  return (
    <div className="asr-help" data-testid="grade-help">
      <strong>{grade
        ? t('models.gradeHelp.title', 'Accuracy in {{language}}: {{grade}}', { language, grade })
        : t('models.gradeNone', 'Accuracy in {{language}} was not measured', { language })}</strong>
      {error !== undefined && (
        <div>{t('models.gradeHelp.measured', 'Measured error rate: {{error}}%', { error: num(error) })}</div>
      )}
      <table className="asr-scale">
        <tbody>
          {GRADE_BANDS.map((b) => (
            <tr key={b.letter} className={b.letter === letter ? 'asr-scale__row--this' : undefined}>
              <th scope="row"><span className="asr-scale__letter">{b.letter}</span></th>
              <td>{b.to === undefined
                ? t('models.gradeHelp.above', '{{from}}% or more', { from: num(b.from) })
                : b.from === 0
                  ? t('models.gradeHelp.below', 'under {{to}}%', { to: num(b.to) })
                  : t('models.gradeHelp.band', '{{from}}–{{to}}%', { from: num(b.from), to: num(b.to) })}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {sub && (
        <div className="asr-help__note">
          {t('models.gradeHelp.subGrades', 'A, B and C are each split in three: {{plus}} is {{a}}–{{b}}%, {{plain}} {{b}}–{{c}}%, {{minus}} {{c}}–{{d}}%.', {
            plus: `${letter}+`, plain: letter, minus: `${letter}-`, a: num(sub[0]), b: num(sub[1]), c: num(sub[2]), d: num(sub[3]),
          })}
        </div>
      )}
      <div className="asr-help__note">
        {t('models.gradeHelp.method', 'The error rate is the share of speech the model gets wrong on the FLEURS test recordings, measured on its Q8_0 version. Your own voice, microphone and noise will change the result.')}
      </div>
    </div>
  );
};

export const SpeedHelp: React.FC<{ level: number | undefined; waitSeconds: number | undefined }> = ({ level, waitSeconds }) => {
  const { t } = useTranslation();
  const num = useNumber();
  // Fastest first: five steps lit within the first limit, … one within the last, none over it.
  const rows = [
    ...SPEED_LIMITS.map((limit, i) => ({ steps: SPEED_LIMITS.length - i, text: t('models.speedHelp.within', 'within {{seconds}} s', { seconds: num(limit) }) })),
    { steps: 0, text: t('models.speedHelp.over', 'over {{seconds}} s', { seconds: num(SPEED_LIMITS[SPEED_LIMITS.length - 1]) }) },
  ];
  return (
    <div className="asr-help" data-testid="speed-help">
      <strong>{level === undefined
        ? t('models.speedNone', 'Speed was not measured')
        : t('models.speedHelp.title', 'Speed: {{level}} of {{max}}', { level, max: SPEED_METER_STEPS })}</strong>
      {waitSeconds !== undefined && (
        <div>{t('models.speedHelp.measured', 'Measured: {{seconds}} s to process the 30-second recording', { seconds: num(waitSeconds) })}</div>
      )}
      <table className="asr-scale">
        <tbody>
          {rows.map((r) => (
            <tr key={r.steps} className={r.steps === level ? 'asr-scale__row--this' : undefined}>
              <th scope="row" aria-label={t('models.speedHelp.title', 'Speed: {{level}} of {{max}}', { level: r.steps, max: SPEED_METER_STEPS })}><SpeedMeter level={r.steps} /></th>
              <td>{r.text}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="asr-help__note">
        {t('models.speedHelp.method', 'The time the model takes to process a 30-second recording on the catalog’s test computer (an AMD Ryzen 4750U laptop, using its GPU). Your computer may be faster or slower.')}
      </div>
    </div>
  );
};
