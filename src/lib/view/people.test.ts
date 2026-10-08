import { describe, it, expect } from 'vitest';
import type { LegName } from '../conversation/types';
import type { Entry, Row } from '../projection/types';
import { entryPerson, people, personShade } from './people';

const row = (id: string, side: 'source' | 'translation', person?: string): Row =>
  ({ key: `${id}:0`, segmentId: id, side, start: 0, end: 1, text: 'x', final: true, ...(person ? { person } : {}) });
const exchange = (id: string, leg: LegName, person?: string): Extract<Entry, { kind: 'exchange' }> =>
  ({ kind: 'exchange', id, leg, languages: { source: 'en', target: 'ja' }, pairing: 'stated', source: [row(`${id}s`, 'source', person)], translation: [row(`${id}t`, 'translation', person)], t: 0 });

describe('people', () => {
  it('numbers each leg by first appearance, once the leg has had two people', () => {
    const who = people([exchange('a', 'participant', '1.3'), exchange('b', 'participant', '1.1'), exchange('c', 'participant', '1.3')]);
    expect(who.labelled('participant')).toBe(true);
    expect(who.numberOf('participant', '1.3')).toBe(1);
    expect(who.numberOf('participant', '1.1')).toBe(2);
    expect(who.numberOf('participant', undefined)).toBeUndefined();
  });

  it('labels nothing while a leg has had one person, and keeps the legs apart', () => {
    const who = people([exchange('a', 'speaker', '1.1'), exchange('b', 'participant', '1.2'), exchange('c', 'participant', '1.2')]);
    expect(who.labelled('speaker')).toBe(false);
    expect(who.labelled('participant')).toBe(false);
    expect(who.numberOf('participant', '1.2')).toBeUndefined();
  });

  it('counts a label from a resumed socket as someone new', () => {
    const who = people([exchange('a', 'participant', '1.1'), exchange('b', 'participant', '1.2'), exchange('c', 'participant', '2.1')]);
    expect(who.numberOf('participant', '2.1')).toBe(3);
  });

  it('ignores notices and unlabelled exchanges', () => {
    const notice: Entry = { kind: 'notice', id: 'n', leg: 'participant', severity: 'warning', message: 'w', at: 0 };
    const entries = [exchange('a', 'participant', '1.1'), notice, exchange('b', 'participant'), exchange('c', 'participant', '1.2')];
    expect(people(entries).numberOf('participant', '1.2')).toBe(2);
    expect(people([exchange('a', 'participant'), exchange('b', 'participant')]).labelled('participant')).toBe(false);
  });
});

describe('entryPerson', () => {
  it("is the source's person, else the translation's", () => {
    expect(entryPerson(exchange('a', 'participant', '1.2'))).toBe('1.2');
    const translationOnly = { ...exchange('b', 'participant'), translation: [row('bt', 'translation', '1.4')] };
    expect(entryPerson(translationOnly)).toBe('1.4');
    expect(entryPerson(exchange('c', 'participant'))).toBeUndefined();
  });
});

describe('personShade', () => {
  it('maps display number 1, 4, 7 … to shade 0', () => {
    expect(personShade(1)).toBe(0);
    expect(personShade(4)).toBe(0);
    expect(personShade(7)).toBe(0);
  });

  it('maps display number 2, 5, 8 … to shade 1', () => {
    expect(personShade(2)).toBe(1);
    expect(personShade(5)).toBe(1);
    expect(personShade(8)).toBe(1);
  });

  it('maps display number 3, 6, 9 … to shade 2', () => {
    expect(personShade(3)).toBe(2);
    expect(personShade(6)).toBe(2);
    expect(personShade(9)).toBe(2);
  });
});
