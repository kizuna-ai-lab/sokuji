# Soniox Slice 2 — Person Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Soniox's speaker labels reach every surface: a leg that has had two people shows "Speaker N" in the conversation, the subtitle window, the LAN viewer, the exports and the auto-save.

**Architecture:** The participant's own Soniox socket asks for diarization (the shared socket already does). The adapter's utterance machine gives each utterance a socket-scoped `person` (`${epoch}.${label}`), carried by the contract's `segmentOpened` / `segmentText` into L1's `Segment` and L2's `Row`. One pure function, `people(entries)`, numbers the people of each leg by first appearance and says whether a leg is labelled; every surface asks it, so their numbers agree.

**Tech Stack:** TypeScript (strict), React 18, Vitest + Testing Library, SCSS, i18next catalogs (30), the LAN viewer's generated strings.

**Spec:** `docs/superpowers/specs/2026-10-08-soniox-speaker-labels-face-to-face-design.md` (Slice 2; decisions D4–D7). Read it with this plan.

## Global Constraints

- Everything in the repository is English: code, comments, test names, commit messages (conventional commits). Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Commit locally; never push.
- TDD: write the failing test, watch it fail, then implement. Run a single file with `npx vitest run <path>`.
- Comment like the surrounding code: short, the reason not the mechanics. No comment on a line that reads plainly.
- The contract field is named `person` (never `speaker`: `LegName`'s `'speaker'` is the Me leg). The Soniox value is `` `${epoch}.${label}` ``.
- D4: diarization on the participant's one-way socket and on every shared socket; never on the speaker's own socket.
- D6: a leg shows labels only once it has had two distinct people; until then it reads "Me" / "Other" as today.
- The fixed interface slice 3 consumes, exactly (`src/lib/view/people.ts`): `interface People { numberOf(leg: LegName, person: string | undefined): number | undefined; labelled(leg: LegName): boolean }` and `function people(entries: readonly Entry[]): People`. There is no off switch: face-to-face (slice 3) strips `person` in the adapter, so its legs never label.
- The JSON export stays `sokuji-conversation/2` (`person` is additive and optional).
- One phrase, "Speaker {{n}}": key `mainPanel.displayMode.person` in all 30 catalogs (the export reuses it), and its twin `viewer.legend.person`; run `node scripts/gen-viewer-strings.mjs` after editing any `viewer.*` string.
- The project's lib is ES2020: no `Array.prototype.at`.
- `src/providers` may not call `console.error` / `console.warn` (`consoleLedger.consistency.test.ts`); adapter code may not import stores or `report.ts` (`sessionSide.consistency.test.ts`). Nothing here needs either.
- Slice 1 (hints) edits the same `sttConfig()` hints spread and the split tests' `language_hints` lines; this plan's edits there are written to apply on top of either version — match by content, not by line number, in `adapter.ts` and `adapter.both.test.ts`.

## Review Focus

1. **A reconnect mid-session.** Soniox numbers from 1 again on a resumed socket; the same raw label after a 503 resume is a new person (`2.1`, not `1.1`), so it gets a new number rather than merging into someone else's. Pinned in Task 5 (`Utterances.abandon` and the adapter's resume path).
2. **Labels arriving retroactively.** The moment a second person appears, rows already drawn and LAN entries already sent must gain their numbers: the display list must not reuse the unlabelled item, and the publisher must re-send the earlier entry. Pinned in Task 6 and Task 9.
3. **An early label the final tokens contradict.** A partial token's label must not leave the utterance on the wrong person: the final originals' majority wins and is re-sent, even when the text did not change. Pinned in Task 5.
4. **Others mode alone in the LAN viewer.** With one leg (`twoLegs` false) the viewer showed no side tag at all; a labelled leg must still show "Speaker N" at each change. Pinned in Task 10.
5. **The compact band's cap and its notices.** The 2000-character cap can cut a marked first run, and a notice can sit between two runs of one person; neither may drop a later dot or draw a second one for the same person. Pinned in Task 8.

---

### Task 1: `person` on the contract and in L1

**Files:**
- Modify: `src/lib/contract/adapter.ts:77-79`
- Modify: `src/lib/conversation/types.ts:29`
- Modify: `src/lib/conversation/Conversation.ts:85-86, 201-228, 333-343`
- Test: `src/lib/conversation/Conversation.test.ts`

**Interfaces:**
- Produces: `AdapterEvents.segmentOpened(e: { ref; side; origin?; person?: string })`, `AdapterEvents.segmentText(e: { ref; text; timing?; language?; person?: string })`, `Segment.person?: string`. A defined `person` on `segmentText` replaces the segment's; an undefined one keeps it.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/conversation/Conversation.test.ts`:

```ts
describe('Conversation — person', () => {
  it('records the person given at open; a later defined one replaces it, an absent one keeps it', () => {
    const { conv, apply } = make();
    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'source', person: '1.1' } });
    expect(conv.snapshot().segments[0].person).toBe('1.1');
    apply({ kind: 'segmentText', payload: { ref: 1, text: 'Hi', person: '1.2' } });
    expect(conv.snapshot().segments[0].person).toBe('1.2');
    apply({ kind: 'segmentText', payload: { ref: 1, text: 'Hi there' } });
    expect(conv.snapshot().segments[0].person).toBe('1.2');
  });

  it('takes a person-only snapshot as a change, with no growth mark', () => {
    const { conv, apply } = make();
    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'source', person: '1.1' } });
    apply({ kind: 'segmentText', payload: { ref: 1, text: 'Hello' } });
    const before = conv.snapshot();
    apply({ kind: 'segmentText', payload: { ref: 1, text: 'Hello', person: '1.2' } });
    const after = conv.snapshot();
    expect(after).not.toBe(before);
    expect(after.segments[0].person).toBe('1.2');
    expect(after.segments[0].marks).toHaveLength(before.segments[0].marks.length);
  });

  it('has no person for a segment the adapter never labelled', () => {
    const { conv, apply } = make();
    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'source' } }, { kind: 'segmentText', payload: { ref: 1, text: 'Hi' } });
    expect(conv.snapshot().segments[0].person).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/conversation/Conversation.test.ts`
Expected: FAIL — TypeScript/vitest reports `person` does not exist on the payload type, or the assertions see `undefined`.

- [ ] **Step 3: Write the minimal implementation**

`src/lib/contract/adapter.ts`, lines 77-79, become:

```ts
  /** `person`: who said it, an adapter-scoped label (diarization), the same on a source and its translation. Absent: the adapter cannot tell. */
  segmentOpened(e: { ref: Ref; side: Side; origin?: string; person?: string }): void;
  /** Always the whole text; a snapshot, never a delta. A defined `person` replaces the segment's. */
  segmentText(e: { ref: Ref; text: string; timing?: SegmentTiming; language?: string; person?: string }): void;
```

`src/lib/conversation/types.ts`, after line 29 (`language?: string;`):

```ts
  /** Who said it, as the adapter labels people (diarization): a scoped label, never a name. */
  person?: string;
```

`src/lib/conversation/Conversation.ts`, lines 85-86:

```ts
      case 'segmentOpened': return this.open(event.payload.ref, event.payload.side, event.payload.origin, event.payload.person);
      case 'segmentText': return this.text(event.payload.ref, event.payload.text, event.payload.timing, event.payload.language, event.payload.person);
```

`open` (line 201) and its segment literal (lines 206-210):

```ts
  private open(ref: number, side: Segment['side'], origin?: string, person?: string): void {
```

```ts
    const seg: Segment = {
      id: `${this.opts.session}:${this.opts.leg}:${n}`,
      ref, side, text: '', final: false,
      openedAt: this.opts.clock.now(), marks: [], origin, person, speech,
    };
```

`text` (lines 217-228):

```ts
  private text(ref: number, text: string, timing?: SegmentTiming, language?: string, person?: string): void {
    this.unfilled.delete(ref);
    const i = this.indexByRef.get(ref);
    if (i === undefined) return this.violation(`text for ref ${ref} before it opened`);
    const seg = this.segments[i];
    if (seg.text === text && sameTiming(seg.timing, timing ?? seg.timing) && (language ?? seg.language) === seg.language
      && (person ?? seg.person) === seg.person) return;
    // A timing-, language- or person-only snapshot is not growth: a mark there
    // would read as the end of a pause to L2's cut.
    const revision = seg.final;
    this.replaceText(i, text, { timing, language, person, mark: seg.text !== text });
    if (revision) this.clampRanges(i);
  }
```

`replaceText` (lines 333-343): add `person?: string` to `o`, and keep the segment's when absent:

```ts
  private replaceText(i: number, text: string, o: { timing?: SegmentTiming; language?: string; person?: string; mark: boolean }): void {
```

```ts
    this.replace(i, { ...seg, text, timing: o.timing ?? seg.timing, language: o.language ?? seg.language, person: o.person ?? seg.person, marks, speech });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/conversation src/lib/contract`
Expected: PASS (the new cases and every existing one).

- [ ] **Step 5: Commit**

```bash
git add src/lib/contract/adapter.ts src/lib/conversation/types.ts src/lib/conversation/Conversation.ts src/lib/conversation/Conversation.test.ts
git commit -m "feat(contract): carry a segment's person from the adapter into L1

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `person` on L2's rows

**Files:**
- Modify: `src/lib/projection/types.ts:20-21`
- Modify: `src/lib/projection/cut.ts:78`
- Modify: `src/lib/projection/project.ts:151`
- Test: `src/lib/projection/cut.test.ts`, `src/lib/projection/project.test.ts`

**Interfaces:**
- Consumes: `Segment.person` (Task 1).
- Produces: `Row.person?: string`, present only when the segment has one; `sameRow` tells rows apart by it.

- [ ] **Step 1: Write the failing tests**

In `src/lib/projection/cut.test.ts`, inside `describe('cutSegment', …)` after the "leaves the language off" case:

```ts
  it("gives every row the segment's person, and leaves it off a segment that has none", () => {
    const rows = cutSegment(seg({ text: 'One. Two.', person: '1.2' }), sentences);
    expect(rows.map((r) => r.person)).toEqual(['1.2', '1.2']);
    expect(cutSegment(seg({ text: 'One.' }), off)[0]).not.toHaveProperty('person');
  });
```

In `src/lib/projection/project.test.ts`, change the import on line 3 to `import { createProjector, DEFAULT_PROJECTION, sameRow } from './project';` and append:

```ts
describe('sameRow', () => {
  it('tells two rows apart by their person', () => {
    const r = { key: 'a:0', segmentId: 'a', side: 'source' as const, start: 0, end: 1, text: 'x', final: true };
    expect(sameRow({ ...r, person: '1.1' }, { ...r, person: '1.1' })).toBe(true);
    expect(sameRow({ ...r, person: '1.1' }, { ...r, person: '1.2' })).toBe(false);
    expect(sameRow(r, { ...r, person: '1.1' })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/projection/cut.test.ts src/lib/projection/project.test.ts`
Expected: FAIL — rows carry no `person`; `sameRow` answers `true` for different people.

- [ ] **Step 3: Write the minimal implementation**

`src/lib/projection/types.ts`, after line 21 (`language?: string;`):

```ts
  /** The segment's person (`Segment.person`), when the adapter labels people. */
  person?: string;
```

`src/lib/projection/cut.ts`, after line 78:

```ts
    ...(seg.person !== undefined ? { person: seg.person } : {}),
```

`src/lib/projection/project.ts`, line 151:

```ts
  if (a.text !== b.text || a.final !== b.final || a.language !== b.language || a.person !== b.person) return false;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/projection`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/projection/types.ts src/lib/projection/cut.ts src/lib/projection/project.ts src/lib/projection/cut.test.ts src/lib/projection/project.test.ts
git commit -m "feat(projection): rows carry their segment's person

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `people()` — one numbering for every surface

**Files:**
- Create: `src/lib/view/people.ts`
- Test: `src/lib/view/people.test.ts`

**Interfaces:**
- Consumes: `Row.person` (Task 2).
- Produces (fixed; slice 3 relies on segments without `person` reading as unlabelled):

```ts
export interface People {
  numberOf(leg: LegName, person: string | undefined): number | undefined;
  labelled(leg: LegName): boolean;
}
export function people(entries: readonly Entry[]): People;
/** An exchange's person: its source's first, else its translation's. */
export function entryPerson(entry: Extract<Entry, { kind: 'exchange' }>): string | undefined;
```

- [ ] **Step 1: Write the failing test**

Create `src/lib/view/people.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { LegName } from '../conversation/types';
import type { Entry, Row } from '../projection/types';
import { entryPerson, people } from './people';

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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/view/people.test.ts`
Expected: FAIL — `Cannot find module './people'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/view/people.ts`:

```ts
/**
 * Who is speaking, numbered for display (spec 2026-10-08, slice 2): per leg,
 * each adapter label in order of first appearance → 1, 2, 3, …. A leg is
 * labelled once it has had two people; until then it reads as its leg. One
 * function, so the list, the subtitle bands, the LAN viewer and the export
 * agree on every number.
 */
import type { LegName } from '../conversation/types';
import type { Entry } from '../projection/types';

export interface People {
  /** 1-based display number of `person` on `leg`, by first appearance in the entries; undefined when `person` is undefined or the leg is not labelled. */
  numberOf(leg: LegName, person: string | undefined): number | undefined;
  /** The leg has had two or more distinct people. */
  labelled(leg: LegName): boolean;
}

type Exchange = Extract<Entry, { kind: 'exchange' }>;

/** An exchange's person: a group is one utterance, so its rows share one — the source's first, else the translation's. */
export function entryPerson(entry: Exchange): string | undefined {
  for (const row of entry.source) if (row.person !== undefined) return row.person;
  for (const row of entry.translation) if (row.person !== undefined) return row.person;
  return undefined;
}

export function people(entries: readonly Entry[]): People {
  const order: Record<LegName, Map<string, number>> = { speaker: new Map(), participant: new Map() };
  for (const entry of entries) {
    if (entry.kind !== 'exchange') continue;
    const person = entryPerson(entry);
    const seen = order[entry.leg];
    if (person !== undefined && !seen.has(person)) seen.set(person, seen.size + 1);
  }
  const labelled = (leg: LegName) => order[leg].size >= 2;
  return {
    labelled,
    numberOf: (leg, person) => (person !== undefined && labelled(leg) ? order[leg].get(person) : undefined),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/view/people.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/view/people.ts src/lib/view/people.test.ts
git commit -m "feat(view): number each leg's people by first appearance

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Diarization on the participant's own Soniox socket

The single-leg `start` names its core `'speaker'` whatever leg it serves (`adapter.ts:483`), so the core cannot tell an Others run from a Me run. The builder can: `SharedSettings.reversed(direction)` is true exactly for the participant's direction (`src/lib/session/shared.ts:20`). The builder records it on the config; the adapter reads it.

**Files:**
- Modify: `src/providers/soniox/config.ts:24-37, 134, 145-157`
- Modify: `src/providers/soniox/adapter.ts` — `sttConfig()`, after the hints spread (today lines 266-268)
- Test: `src/providers/soniox/config.test.ts`, `src/providers/soniox/adapter.test.ts:20-37` (the `started` helper) and a new case, `src/providers/soniox/adapter.both.test.ts` (the `both` helper's `buildSoniox` call and the split config case)

**Interfaces:**
- Produces: `SonioxConfig.diarize: boolean` — true on the participant's leg. The STT config frame carries `enable_speaker_diarization: true` when the socket is shared or `diarize` is true.

- [ ] **Step 1: Write the failing tests**

`src/providers/soniox/config.test.ts` (its `SHARED.reversed` is `direction.source === 'ja'`, so `AUTO_CTX` is the participant's direction there) — append:

```ts
describe('buildSoniox — diarize', () => {
  it("labels people on the participant's leg only", () => {
    expect(build().diarize).toBe(true);
    expect(build({}, { ...AUTO_CTX, direction: { source: 'en', target: 'ja' } }).diarize).toBe(false);
  });
});
```

`src/providers/soniox/adapter.test.ts`: give `started` a `shared` option. Its signature and `buildSoniox` call (lines 21 and 28) become:

```ts
function started(o: { context?: SessionContext; settings?: Partial<SonioxSettings>; credentials?: SonioxCredentials; shared?: SharedSettings } = {}) {
```

```ts
    { context, config: buildSoniox(context, { ...SONIOX_DEFAULTS, ...o.settings }, o.shared ?? SHARED), credentials: o.credentials ?? KEY, clock, signal: controller.signal },
```

add `import type { SharedSettings } from '../../lib/provider/types';` to the imports, and add inside `describe('the Soniox adapter: one leg', …)`:

```ts
  it("asks the participant's own socket for diarization, and never the speaker's", async () => {
    const participant = await live({ shared: { ...SHARED, reversed: () => true } });
    expect(participant.stt().sentJson<Json>()[0]).toMatchObject({ enable_speaker_diarization: true });
    const speaker = await live();
    expect(speaker.stt().sentJson<Json>()[0]).not.toHaveProperty('enable_speaker_diarization');
  });
```

`src/providers/soniox/adapter.both.test.ts`: the participant's request must be built as the app builds it. Above `function both(`, add:

```ts
/** The app's rule (`shared.ts`): the participant's direction is the pair's reverse. */
const BOTH_SHARED: SharedSettings = { ...SHARED, reversed: (direction) => direction.source === 'ja' };
```

import `type SharedSettings` from `'../../lib/provider/types'`; in `both()`'s `request` change `buildSoniox(contexts[leg], s, SHARED)` to `buildSoniox(contexts[leg], s, BOTH_SHARED)`; and in the case "split: two sessions on two STT sockets, each on its own direction and key" replace

```ts
    expect(par).not.toHaveProperty('enable_speaker_diarization');
```

with

```ts
    expect(par).toMatchObject({ enable_speaker_diarization: true });
```

(and rename the case to "split: two sessions on two STT sockets, each on its own direction and key; the participant's labels its people").

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/providers/soniox/config.test.ts src/providers/soniox/adapter.test.ts src/providers/soniox/adapter.both.test.ts`
Expected: FAIL — `diarize` is undefined; the participant's split socket sends no `enable_speaker_diarization`.

- [ ] **Step 3: Write the minimal implementation**

`src/providers/soniox/config.ts` — in `SonioxConfig` after `sharedBoth` (line 36):

```ts
  /** The participant's leg: its own socket labels its people (the shared socket always does). */
  diarize: boolean;
```

line 134, the parameter is used now:

```ts
export function buildSoniox(context: SessionContext, s: SonioxSettings, shared: SharedSettings): SonioxConfig {
```

and the returned object (after `sharedBoth: s.bothModeSharedSession,`, line 156):

```ts
    diarize: shared.reversed(context.direction),
```

`src/providers/soniox/adapter.ts` — in `sttConfig()`, directly after the spread that holds the hints (the `...(this.o.shared ? { languageHints: …, enableSpeakerDiarization: true } : …)` entry), add:

```ts
      // The participant's own socket labels its people too; the shared one already does, above.
      ...(!this.o.shared && config.diarize ? { enableSpeakerDiarization: true } : {}),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/providers/soniox src/providers/sessionSide.consistency.test.ts`
Expected: PASS (`provider.test.ts`, `kizuna.test.ts`, `lease.test.ts` build through `buildSoniox` and keep passing).

- [ ] **Step 5: Commit**

```bash
git add src/providers/soniox/config.ts src/providers/soniox/adapter.ts src/providers/soniox/config.test.ts src/providers/soniox/adapter.test.ts src/providers/soniox/adapter.both.test.ts
git commit -m "feat(soniox): label people on the participant's own socket

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Each utterance's person, scoped to its socket

**Files:**
- Modify: `src/providers/soniox/utterances.ts:50-71, 73-80, 109-119, 133-146, 154-177, 238-258`
- Test: `src/providers/soniox/utterances.test.ts`, `src/providers/soniox/adapter.test.ts`

**Interfaces:**
- Consumes: `SonioxToken.speaker` (`sttStream.ts:32`), the contract's `person` (Task 1), `started({ shared })` (Task 4).
- Produces: every `segmentOpened` / `segmentText` of an utterance carries `person: '<epoch>.<label>'` when Soniox labelled it; the epoch starts at 1 and `abandon()` (the 503 resume) adds one.

- [ ] **Step 1: Write the failing tests**

Append to `src/providers/soniox/utterances.test.ts`, inside `describe('Utterances', …)`:

```ts
  it("labels the source and its translation with the first token's speaker, scoped to the socket", () => {
    const { machine, segments } = setup();
    machine.message([orig('Hello', true, { speaker: '2' }), tr('こんにちは')]);
    expect(segments()).toEqual([
      { kind: 'segmentOpened', payload: { ref: 1, side: 'source', origin: 'u1', person: '1.2' } },
      { kind: 'segmentOpened', payload: { ref: 2, side: 'translation', origin: 'u1', person: '1.2' } },
      { kind: 'segmentText', payload: { ref: 1, text: 'Hello', language: 'en', person: '1.2' } },
      { kind: 'segmentText', payload: { ref: 2, text: 'こんにちは', language: 'ja', person: '1.2' } },
    ]);
  });

  it("lets the final originals outvote an early label, and re-sends the text for it alone", () => {
    const { machine, segments, textsOf } = setup();
    machine.message([orig('Yes', false, { speaker: '2' })]);
    machine.message([orig('Yes', true, { speaker: '1' }), orig(' I', true, { speaker: '1' }), tr('はい')]);
    expect(textsOf(1).map((p) => p.person)).toEqual(['1.2', '1.1']);
    const translationOpen = segments().find((s) => s.kind === 'segmentOpened' && s.payload.side === 'translation');
    expect(translationOpen?.payload).toMatchObject({ person: '1.1' });
    machine.message([orig('.', true, { speaker: '2' }), END]);
    // Two votes to one: the new text keeps the person.
    expect(textsOf(1).map((p) => [p.text, p.person])).toEqual([['Yes', '1.2'], ['Yes I', '1.1'], ['Yes I.', '1.1']]);
  });

  it('sends a change of person alone as a new snapshot', () => {
    const { machine, textsOf } = setup();
    machine.message([orig('Hi', false, { speaker: '2' })]);
    machine.message([orig('Hi', true, { speaker: '1' })]);
    expect(textsOf(1).map((p) => [p.text, p.person])).toEqual([['Hi', '1.2'], ['Hi', '1.1']]);
  });

  it('starts a new epoch after a resume: the same label on the new socket is someone new', () => {
    const { machine, segments } = setup();
    machine.message([orig('A', true, { speaker: '1' })]);
    machine.abandon();
    machine.message([orig('B', true, { speaker: '1' })]);
    const opened = segments().filter((s) => s.kind === 'segmentOpened').map((s) => (s.payload as { person?: string }).person);
    expect(opened).toEqual(['1.1', '2.1']);
  });
```

Append to `src/providers/soniox/adapter.test.ts`, inside `describe('the Soniox adapter: one leg', …)`:

```ts
  it('labels each segment with its person, and a resumed socket starts a new epoch', async () => {
    const h = await live({ shared: { ...SHARED, reversed: () => true } });
    h.stt().receive(msg({ ...orig('Hello.'), speaker: '1' }, tr('こんにちは。'), END));
    await resumeOnce(h);
    h.stt().receive(msg({ ...orig('Again.'), speaker: '1' }, tr('また。'), END));
    expect(h.of('segmentOpened').map((e) => e.payload.person)).toEqual(['1.1', '1.1', '2.1', '2.1']);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/providers/soniox/utterances.test.ts src/providers/soniox/adapter.test.ts`
Expected: FAIL — no payload carries `person`.

- [ ] **Step 3: Write the minimal implementation**

`src/providers/soniox/utterances.ts`.

In `interface Utterance` (after `origin: string;`, line 52):

```ts
  /** The socket its labels belong to: a resumed socket numbers people from 1 again. */
  epoch: number;
  /** The first token's speaker label, until final originals outvote it. */
  firstLabel?: string;
  /** Final original tokens per speaker label. */
  labels: Map<string, number>;
```

Above `export class Utterances` add:

```ts
/** Who said `u`: the label most of its final originals carry, else its first token's — scoped to its socket. */
function personOf(u: Utterance): string | undefined {
  let best = u.firstLabel;
  let most = best === undefined ? 0 : u.labels.get(best) ?? 0;
  for (const [label, count] of u.labels) {
    if (count > most) {
      best = label;
      most = count;
    }
  }
  return best === undefined ? undefined : `${u.epoch}.${best}`;
}

/** The payload field, only when there is a person. */
function personField(u: Utterance): { person?: string } {
  const person = personOf(u);
  return person === undefined ? {} : { person };
}
```

In the class fields (after `private stopped = false;`, line 79):

```ts
  /** Bumped by `abandon()`: the resume's new socket mints its own speaker labels. */
  private epoch = 1;
```

In `message()`, the original branch (line 117) counts final labels:

```ts
        if (token.is_final) {
          u.sourceFinal += text;
          if (token.speaker) u.labels.set(token.speaker, (u.labels.get(token.speaker) ?? 0) + 1);
        } else {
          sourcePartial += text;
        }
```

(replacing `if (token.is_final) u.sourceFinal += text;` / `else sourcePartial += text;`).

In `abandon()`, last line before the closing brace (after `this.endPrevious();`):

```ts
    this.epoch += 1;
```

In `begin()` (lines 156-159):

```ts
    const u: Utterance = {
      leg: this.o.legFor(token), origin: `u${this.count}`, epoch: this.epoch, firstLabel: token.speaker, labels: new Map(),
      sourceClosed: false, sourceFinal: '', translation: 'none', translationFinal: '', spokenUpTo: 0,
    };
```

`openSource` (line 167) and `openTranslation` (line 174) payloads:

```ts
    this.emit(u, { kind: 'segmentOpened', payload: { ref: u.sourceRef, side: 'source', origin: u.origin, ...personField(u) } });
```

```ts
    this.emit(u, { kind: 'segmentOpened', payload: { ref: u.translationRef, side: 'translation', origin: u.origin, ...personField(u) } });
```

`show()` (lines 242-245):

```ts
      const key = JSON.stringify([text, timing, u.sourceLanguage, personOf(u)]);
      if (key !== u.sourceShown) {
        u.sourceShown = key;
        this.emit(u, { kind: 'segmentText', payload: { ref: u.sourceRef, text, ...(timing ? { timing } : {}), ...(u.sourceLanguage ? { language: u.sourceLanguage } : {}), ...personField(u) } });
      }
```

`showTranslation()` (lines 254-257):

```ts
    const key = JSON.stringify([text, u.translationLanguage, personOf(u)]);
    if (key === u.translationShown) return;
    u.translationShown = key;
    this.emit(u, { kind: 'segmentText', payload: { ref: u.translationRef, text, ...(u.translationLanguage ? { language: u.translationLanguage } : {}), ...personField(u) } });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/providers/soniox src/providers/sessionSide.consistency.test.ts src/lib/diagnostics/consoleLedger.consistency.test.ts`
Expected: PASS — the old utterance cases still match exactly (their tokens carry no `speaker`, so no `person` key appears).

- [ ] **Step 5: Commit**

```bash
git add src/providers/soniox/utterances.ts src/providers/soniox/utterances.test.ts src/providers/soniox/adapter.test.ts
git commit -m "feat(soniox): give each utterance its person, scoped to its socket

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The display list opens a header where the person changes

**Files:**
- Modify: `src/lib/view/filter.ts:6-9, 17-30, 61-102`
- Test: `src/lib/view/filter.test.ts`

**Interfaces:**
- Consumes: `people`, `entryPerson`, `People` (Task 3).
- Produces: `DisplayItem` row gains `person?: number` (the display number); `displayItems(entries, filters, previous = [], who: People = people(entries))`. Callers that pass nothing (`MainPanel.tsx:183`, `SubtitleBands.tsx:61`, `SpinePreview.tsx:163`) get labels.

- [ ] **Step 1: Write the failing tests**

In `src/lib/view/filter.test.ts`, add `import type { People } from './people';` after line 3, and below the `row` helper:

```ts
const said = (r: Row, person: string): Row => ({ ...r, person });
const numbers = (items: ReturnType<typeof displayItems>) => items.map((i) => (i.kind === 'row' ? i.person ?? null : 'notice'));
```

and append inside `describe('displayItems', …)`:

```ts
  it('opens a header where the person changes inside a labelled leg, and numbers its rows', () => {
    const entries = [
      exchange('a', 'participant', [said(row('p1', 'source'), '1.1')], [said(row('p2', 'translation'), '1.1')]),
      exchange('b', 'participant', [said(row('p3', 'source'), '1.2')], []),
      exchange('c', 'participant', [said(row('p4', 'source'), '1.2')], []),
    ];
    const items = displayItems(entries, both);
    expect(shape(items)).toEqual(['p1:0+h+e', 'p2:0+e', 'p3:0+h+e', 'p4:0+e']);
    expect(numbers(items)).toEqual([1, 1, 2, 2]);
  });

  it('numbers nothing and opens no extra header while a leg has had one person', () => {
    const entries = [
      exchange('a', 'participant', [said(row('p1', 'source'), '1.1')], []),
      exchange('b', 'participant', [said(row('p2', 'source'), '1.1')], []),
    ];
    const items = displayItems(entries, both);
    expect(shape(items)).toEqual(['p1:0+h+e', 'p2:0+e']);
    expect(numbers(items)).toEqual([null, null]);
  });

  it('re-draws rows already drawn once a second person appears', () => {
    const first = [exchange('a', 'participant', [said(row('p1', 'source'), '1.1')], [])];
    const before = displayItems(first, both);
    const after = displayItems([...first, exchange('b', 'participant', [said(row('p2', 'source'), '1.2')], [])], both, before);
    expect(after[0]).not.toBe(before[0]);
    expect(numbers(after)).toEqual([1, 2]);
  });

  it('opens the person header on the translation side alone too', () => {
    const entries = [
      exchange('a', 'participant', [said(row('p1', 'source'), '1.1')], [said(row('p2', 'translation'), '1.1')]),
      exchange('b', 'participant', [said(row('p3', 'source'), '1.2')], [said(row('p4', 'translation'), '1.2')]),
    ];
    expect(shape(displayItems(entries, { ...both, participant: 'translation' }))).toEqual(['p2:0+h+e', 'p4:0+h+e']);
  });

  it('takes a People that turns labels off', () => {
    const entries = [
      exchange('a', 'participant', [said(row('p1', 'source'), '1.1')], []),
      exchange('b', 'participant', [said(row('p2', 'source'), '1.2')], []),
    ];
    const nobody: People = { labelled: () => false, numberOf: () => undefined };
    const items = displayItems(entries, both, [], nobody);
    expect(shape(items)).toEqual(['p1:0+h+e', 'p2:0+e']);
    expect(numbers(items)).toEqual([null, null]);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/view/filter.test.ts`
Expected: FAIL — no `person` on items, no header at a person change.

- [ ] **Step 3: Write the minimal implementation**

`src/lib/view/filter.ts`.

Imports (after line 9):

```ts
import { entryPerson, people, type People } from './people';
```

In `DisplayItem`'s row variant, replace the `header` doc and add `person`:

```ts
      /** A header opens here: the leg, or a labelled leg's person, changed since the last row drawn. */
      header: boolean;
      /** The last row drawn of its segment: where that segment's replay button goes. */
      endsSegment: boolean;
      /** The person's display number (`people()`), on a labelled leg. */
      person?: number;
```

Update the doc above `displayItems` (line 62-63) to say "A header opens where the leg or a labelled leg's person changes from the last row drawn"; then the function:

```ts
export function displayItems(
  entries: readonly Entry[],
  filters: LegFilters,
  previous: readonly DisplayItem[] = [],
  who: People = people(entries),
): DisplayItem[] {
  const byKey = new Map<string, DisplayItem>();
  for (const item of previous) {
    byKey.set(item.kind === 'notice' ? `n:${item.notice.id}` : item.row.key, item);
  }
  const out: DisplayItem[] = [];
  let lastLeg: LegName | null = null;
  let lastPerson: number | undefined;
  for (const entry of entries) {
    if (entry.kind === 'notice') {
      const old = byKey.get(`n:${entry.id}`);
      out.push(old?.kind === 'notice' && old.notice === entry ? old : { kind: 'notice', notice: entry });
      continue;
    }
    const filter = filters[entry.leg];
    const rows = [
      ...(showsSide(filter, 'source') ? entry.source : []),
      ...(showsSide(filter, 'translation') ? entry.translation : []),
    ];
    const person = who.numberOf(entry.leg, entryPerson(entry));
    rows.forEach((row, i) => {
      const header = lastLeg !== entry.leg || lastPerson !== person;
      const endsSegment = rows[i + 1]?.segmentId !== row.segmentId;
      const old = byKey.get(row.key);
      out.push(
        old?.kind === 'row' && sameRow(old.row, row) && old.header === header && old.endsSegment === endsSegment
          && old.t === entry.t && old.leg === entry.leg && old.person === person
          && old.languages.source === entry.languages.source && old.languages.target === entry.languages.target
          ? old
          : { kind: 'row', row, leg: entry.leg, languages: entry.languages, t: entry.t, header, endsSegment, person },
      );
      lastLeg = entry.leg;
      lastPerson = person;
    });
  }
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/view src/components/Conversation src/components/MainPanel src/components/Subtitle`
Expected: PASS (existing items carry `person: undefined`, which `toEqual` ignores).

- [ ] **Step 5: Commit**

```bash
git add src/lib/view/filter.ts src/lib/view/filter.test.ts
git commit -m "feat(view): open a header where a labelled leg's person changes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The conversation names each person

**Files:**
- Modify: `src/components/Conversation/ConversationList.tsx:128-163`
- Modify: `src/components/MainPanel/ConversationRow.scss:26-44`
- Modify: `src/locales/*/translation.json` (30 catalogs: `mainPanel.displayMode.person`)
- Test: `src/components/Conversation/ConversationList.test.tsx`

**Interfaces:**
- Consumes: `DisplayItem.person` (Task 6).
- Produces: the key `mainPanel.displayMode.person` = "Speaker {{n}}" (Tasks 8 and 11 reuse it).

- [ ] **Step 1: Write the failing tests**

In `src/components/Conversation/ConversationList.test.tsx`, make the mocked `t` interpolate (lines 7-12 become):

```tsx
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | ({ defaultValue?: string } & Record<string, unknown>)) =>
      typeof fallback === 'string'
        ? fallback
        : (fallback?.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (m, name: string) => (fallback && name in fallback ? String(fallback[name]) : m)),
  }),
}));
```

and append inside `describe('ConversationList — rows', …)`:

```tsx
  it("names a labelled leg's person in the header, the number in the avatar", () => {
    const { container } = render(<ConversationList {...props({ items: [rowItem({ leg: 'participant', person: 2 })] })} />);
    expect(container.querySelector('.row-header .row-name-text')?.textContent).toBe('Speaker 2');
    expect(container.querySelector('.row-avatar.avatar-participant.person-1 .row-avatar__number')?.textContent).toBe('2');
  });

  it('keeps the leg name and its icon for a row with no person', () => {
    const { container } = render(<ConversationList {...props()} />);
    expect(container.querySelector('.row-header .row-name-text')?.textContent).toBe('Me');
    expect(container.querySelector('.row-avatar__number')).toBeNull();
  });

  it("names the person on the compact row's dot", () => {
    const { container } = render(<ConversationList {...props({ compact: true, items: [rowItem({ leg: 'participant', person: 3 })] })} />);
    expect(container.querySelector('.row-role-dot')?.getAttribute('aria-label')).toBe('Speaker 3');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/Conversation/ConversationList.test.tsx`
Expected: FAIL — the header reads "Other", no `.row-avatar__number`.

- [ ] **Step 3: Write the implementation**

`src/components/Conversation/ConversationList.tsx` — `scopeName` (lines 134-137):

```tsx
  const scopeName = item.person !== undefined
    ? t('mainPanel.displayMode.person', { defaultValue: 'Speaker {{n}}', n: item.person })
    : t(
      leg === 'speaker' ? 'mainPanel.displayMode.speaker' : 'mainPanel.displayMode.participant',
      leg === 'speaker' ? 'Me' : 'Other',
    );
```

the avatar (lines 151-153):

```tsx
          <div className={`row-avatar avatar-${leg}${item.person !== undefined ? ` person-${(item.person - 1) % 3}` : ''}`}>
            {item.person !== undefined
              ? <span className="row-avatar__number">{item.person}</span>
              : leg === 'speaker' ? <User size={12} /> : <Users size={12} />}
          </div>
```

(The compact dot already reads `scopeName`.)

`src/components/MainPanel/ConversationRow.scss` — inside `.row-avatar`, after the `&.avatar-participant` block (line 43), and a new rule after `.row-avatar` closes (line 44):

```scss

  // A labelled leg's people: the leg's colour, a shade per person in turn.
  &.avatar-speaker.person-1 { background: tk.$color-speaker; color: #1a1a1a; }
  &.avatar-speaker.person-2 { background: #005c45; }
  &.avatar-participant.person-1 { background: #f8c471; }
  &.avatar-participant.person-2 { background: #ca6f1e; color: #fff; }
}

.row-avatar__number {
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
}
```

(the `}` shown closes `.row-avatar`, replacing the one on line 44).

The catalogs — every one round-trips through `JSON.stringify(…, null, 2)` + newline unchanged (checked), so a script edits them without reformatting. From the repo root:

```bash
node --input-type=module <<'EOF'
import { readFileSync, writeFileSync } from 'node:fs';
const SPEAKER = {
  en: 'Speaker {{n}}', ar: 'المتحدث {{n}}', bn: 'বক্তা {{n}}', de: 'Sprecher {{n}}', es: 'Hablante {{n}}',
  fa: 'گوینده {{n}}', fi: 'Puhuja {{n}}', fil: 'Tagapagsalita {{n}}', fr: 'Intervenant {{n}}', he: 'דובר {{n}}',
  hi: 'वक्ता {{n}}', id: 'Pembicara {{n}}', it: 'Interlocutore {{n}}', ja: '話者 {{n}}', ko: '화자 {{n}}',
  ms: 'Penutur {{n}}', nl: 'Spreker {{n}}', pl: 'Mówca {{n}}', pt_BR: 'Falante {{n}}', pt_PT: 'Orador {{n}}',
  ru: 'Говорящий {{n}}', sv: 'Talare {{n}}', ta: 'பேச்சாளர் {{n}}', te: 'వక్త {{n}}', th: 'ผู้พูด {{n}}',
  tr: 'Konuşmacı {{n}}', uk: 'Мовець {{n}}', vi: 'Người nói {{n}}', zh_CN: '说话人 {{n}}', zh_TW: '說話者 {{n}}',
};
for (const [id, words] of Object.entries(SPEAKER)) {
  const file = `src/locales/${id}/translation.json`;
  const catalog = JSON.parse(readFileSync(file, 'utf8'));
  catalog.mainPanel.displayMode.person = words;
  writeFileSync(file, `${JSON.stringify(catalog, null, 2)}\n`);
}
console.log(`wrote ${Object.keys(SPEAKER).length} catalogs`);
EOF
```

Expected output: `wrote 30 catalogs`; `git diff --stat src/locales` shows 30 files, one line each.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/Conversation src/locales`
Expected: PASS (`locales.consistency.test.ts`: same keys everywhere, `{{n}}` preserved).

- [ ] **Step 5: Commit**

```bash
git add src/components/Conversation/ConversationList.tsx src/components/Conversation/ConversationList.test.tsx src/components/MainPanel/ConversationRow.scss src/locales
git commit -m "feat(conversation): name each person of a labelled leg

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: A numbered dot where the person changes in the compact subtitle bands

The expanded subtitle body is `ConversationList` over `displayItems` and has its labels from Tasks 6–7. The compact bands join each leg's text into one line, so a change of person is marked inline.

**Files:**
- Modify: `src/lib/subtitle/bands.ts:11-31, 51-82, 92-124`
- Modify: `src/components/Subtitle/SubtitleBands.tsx:84-160`
- Modify: `src/components/Subtitle/SubtitleStream.scss` — inside `&.compact`, after the `.subtitle-stream__line--speaker` rule (line 70)
- Test: `src/lib/subtitle/bands.test.ts`, `src/components/Subtitle/SubtitleBands.test.tsx`

**Interfaces:**
- Consumes: `people`, `entryPerson`, `People` (Task 3); `mainPanel.displayMode.person` (Task 7).
- Produces: `BandPiece.person?: number`, `BandPiece.mark?: true` (on the first piece of a run whose person differs from the band's previous run); `buildBands(entries, filters, words, maxChars = BAND_MAX_CHARS, who: People = people(entries))`.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/subtitle/bands.test.ts` (after the existing helpers):

```ts
const said = (r: Row, person: string): Row => ({ ...r, person });
const dots = (band: Band) => band.pieces.map((piece) => (piece.mark ? String(piece.person) : '-'));

describe('buildBands — people', () => {
  it('marks the first run of each change of person on a labelled leg, the same number on both bands', () => {
    const bands = buildBands([
      exchange('a', 'participant', [said(row('s1', 0, 0, 'One.'), '1.1')], [said(row('t1', 0, 0, '一。', 'translation'), '1.1')]),
      exchange('b', 'participant', [said(row('s2', 0, 0, 'Two.'), '1.2')], [said(row('t2', 0, 0, '二。', 'translation'), '1.2')]),
      exchange('c', 'participant', [said(row('s3', 0, 0, 'Three.'), '1.2')], [said(row('t3', 0, 0, '三。', 'translation'), '1.2')]),
    ], both, words);
    expect(bands.map((band) => [band.id, dots(band)])).toEqual([
      ['participant-source', ['1', '2', '-']],
      ['participant-translation', ['1', '2', '-']],
    ]);
  });

  it('marks nothing while the leg has had one person', () => {
    const bands = buildBands([
      exchange('a', 'participant', [said(row('s1', 0, 0, 'One.'), '1.1')]),
      exchange('b', 'participant', [said(row('s2', 0, 0, 'Two.'), '1.1')]),
    ], both, words);
    expect(dots(bands[0])).toEqual(['-', '-']);
  });

  it('draws no second dot across a notice, and keeps later dots when the cap cuts the first', () => {
    const notice: Entry = { kind: 'notice', id: 'n', leg: 'participant', severity: 'warning', message: 'w', at: 0 };
    const entries = [
      exchange('a', 'participant', [], [said(row('t1', 0, 0, 'A long first line.', 'translation'), '1.1')]),
      notice,
      exchange('b', 'participant', [], [said(row('t2', 0, 0, 'Same.', 'translation'), '1.1')]),
      exchange('c', 'participant', [], [said(row('t3', 0, 0, 'Other.', 'translation'), '1.2')]),
    ];
    expect(dots(buildBands(entries, both, words)[0])).toEqual(['1', '-', '-', '2']);
    expect(dots(buildBands(entries, both, words, 12)[0])).toEqual(['-', '2']);
  });
});
```

In `src/components/Subtitle/SubtitleBands.test.tsx`, make the mocked `t` interpolate exactly as in Task 7 (lines 7-12), and append:

```tsx
describe('SubtitleBody — compact, people', () => {
  it("draws a numbered dot where a labelled leg's person changes", () => {
    const said = (r: Row, person: string): Row => ({ ...r, person });
    const other = (id: string, source: Row[], translation: Row[]): Entry =>
      ({ kind: 'exchange', id, leg: 'participant', languages: { source: 'en', target: 'ja' }, pairing: 'stated', source, translation, t: 0 });
    const entries = [
      other('a', [said(row('s1', 0, 0, 'One.'), '1.1')], [said(row('t1', 0, 0, '一。', 'translation'), '1.1')]),
      other('b', [said(row('s2', 0, 0, 'Two.'), '1.2')], [said(row('t2', 0, 0, '二。', 'translation'), '1.2')]),
    ];
    const { container } = render(<SubtitleBody {...props({ entries })} />);
    const marks = [...container.querySelectorAll('.subtitle-stream__line--translation .subtitle-stream__person')];
    expect(marks.map((m) => [m.textContent, m.getAttribute('aria-label')])).toEqual([['1', 'Speaker 1'], ['2', 'Speaker 2']]);
    expect(container.querySelectorAll('.subtitle-stream__person')).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/subtitle/bands.test.ts src/components/Subtitle/SubtitleBands.test.tsx`
Expected: FAIL — no piece carries `mark`; no `.subtitle-stream__person`.

- [ ] **Step 3: Write the implementation**

`src/lib/subtitle/bands.ts`.

Imports (after line 15):

```ts
import { entryPerson, people, type People } from '../view/people';
```

`BandPiece` (after `notice?: NoticeEntry;`, line 30):

```ts
  /** The person's display number, on a labelled leg's row. */
  person?: number;
  /** The first piece of a run whose person differs from the band's previous run: a numbered dot goes before it. */
  mark?: true;
```

`Item` (after `notice?: NoticeEntry;`, line 56):

```ts
  person?: number;
```

`buildBands` (lines 59-82):

```ts
export function buildBands(
  entries: readonly Entry[],
  filters: LegFilters,
  words: (notice: NoticeEntry) => string,
  maxChars = BAND_MAX_CHARS,
  who: People = people(entries),
): Band[] {
  const items = new Map<string, Item[]>(ORDER.map(({ leg, side }) => [`${leg}-${side}`, []]));
  for (const entry of entries) {
    if (entry.kind === 'notice') {
      items.get(`${entry.leg}-translation`)!.push({ key: entry.id, text: words(entry), notice: entry });
      continue;
    }
    const person = who.numberOf(entry.leg, entryPerson(entry));
    for (const side of ['source', 'translation'] as const) {
      if (!showsSide(filters[entry.leg], side)) continue;
      const band = items.get(`${entry.leg}-${side}`)!;
      for (const row of side === 'source' ? entry.source : entry.translation) {
        band.push({ key: row.key, text: row.text, segmentId: row.segmentId, start: row.start, ...(person !== undefined ? { person } : {}) });
      }
    }
  }
  return ORDER
    .map(({ leg, side }) => ({ id: `${leg}-${side}`, leg, side, pieces: piecesOf(items.get(`${leg}-${side}`)!, maxChars) }))
    .filter((band) => band.pieces.length > 0);
}
```

In `piecesOf`, add a sentence to its doc ("A run whose person differs from the previous run's — a notice is not a run of anyone — gets a mark on its first piece."), then (lines 99-124):

```ts
  const pieces: BandPiece[] = [];
  let previousPerson: number | undefined;
  for (const run of runs) {
    const whole = run.map((item) => item.text).join('');
    const from = whole.length - whole.trimStart().length;
    const to = whole.trimEnd().length;
    const person = run[0].person;
    const marked = run[0].segmentId !== undefined && person !== undefined && person !== previousPerson;
    if (run[0].segmentId !== undefined) previousPerson = person;
    let at = 0;
    let first = true;
    for (const item of run) {
      const start = Math.max(from, at);
      const end = Math.min(to, at + item.text.length);
      if (end > start) {
        const text = item.text.slice(start - at, end - at);
        const previous = pieces[pieces.length - 1];
        const before = first && previous !== undefined && needsSpace(previous.text, text) ? ' ' : '';
        pieces.push({
          key: item.key,
          text,
          before,
          ...(item.segmentId !== undefined ? { segmentId: item.segmentId, start: (item.start ?? 0) + (start - at) } : {}),
          ...(item.notice ? { notice: item.notice } : {}),
          ...(item.person !== undefined ? { person: item.person } : {}),
          ...(first && marked ? { mark: true as const } : {}),
        });
        first = false;
      }
      at += item.text.length;
    }
  }
```

`src/components/Subtitle/SubtitleBands.tsx`.

In `SubtitleBands`, the `Run` element (lines 110-115):

```tsx
              <Run
                key={run.key}
                run={run}
                lit={lit}
                isNew={newItemHighlightEnabled && stateOf(run.key) === 'new'}
                mark={run.mark && run.person !== undefined ? t('mainPanel.displayMode.person', { defaultValue: 'Speaker {{n}}', n: run.person }) : null}
              />
```

`RunOf` (after `pieces: BandPiece[];`, line 130):

```ts
  /** The run's person and whether a dot goes before it (`buildBands`). */
  person?: number;
  mark: boolean;
```

`runsOf`'s push (line 145):

```ts
      runs.push({ key: piece.segmentId ?? piece.key, segmentId: piece.segmentId, before: piece.before, pieces: [piece], person: piece.person, mark: piece.mark === true });
```

`Run` (lines 151-160):

```tsx
function Run({ run, lit, isNew, mark }: { run: RunOf; lit: ReadonlyMap<SegmentId, number>; isNew: boolean; mark: string | null }) {
  const className = isNew ? 'subtitle-stream__item subtitle-stream__item--new' : 'subtitle-stream__item';
  const upTo = run.segmentId === undefined ? undefined : lit.get(run.segmentId);
  return (
    <span className={className} data-segment={run.segmentId}>
      {run.before}
      {mark !== null && run.person !== undefined && (
        <span className={`subtitle-stream__person person-${(run.person - 1) % 3}`} role="img" aria-label={mark}>{run.person}</span>
      )}
      {run.pieces.map((piece) => <Stretch key={piece.key} piece={piece} upTo={upTo} />)}
    </span>
  );
}
```

`src/components/Subtitle/SubtitleStream.scss` — inside `&.compact`, after the `.subtitle-stream__line--speaker { … }` rule (line 70):

```scss

    // A labelled leg's person changes here: a numbered dot in the leg's colour, scaled with the text.
    .subtitle-stream__person {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 1.05em;
      height: 1.05em;
      margin-right: 0.25em;
      border-radius: 50%;
      font-size: 0.62em;
      font-style: normal;
      font-weight: 700;
      vertical-align: 0.15em;
      color: #1a1a1a;
    }
    .subtitle-stream__line--participant .subtitle-stream__person {
      background: tk.$color-participant;
      &.person-1 { background: #f8c471; }
      &.person-2 { background: #ca6f1e; color: #fff; }
    }
    .subtitle-stream__line--speaker .subtitle-stream__person {
      background: tk.$color-speaker;
      &.person-1 { background: #5fd6b4; }
      &.person-2 { background: tk.$color-speaker-fill; color: #fff; }
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/subtitle src/components/Subtitle`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/subtitle/bands.ts src/lib/subtitle/bands.test.ts src/components/Subtitle/SubtitleBands.tsx src/components/Subtitle/SubtitleBands.test.tsx src/components/Subtitle/SubtitleStream.scss
git commit -m "feat(subtitle): mark each change of person in the compact bands

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The LAN publisher sends each entry's person

**Files:**
- Modify: `src/lib/share/types.ts:10-17`
- Modify: `src/lib/share/viewerEntry.ts`
- Modify: `src/lib/share/publisher.ts:7-12, 26-54`
- Test: `src/lib/share/viewerEntry.test.ts`, `src/lib/share/publisher.test.ts`

**Interfaces:**
- Consumes: `people`, `entryPerson` (Task 3).
- Produces: `ViewerEntry.person?: number`; `toViewerEntry(entry: Entry, person?: number): ViewerEntry | null`.

- [ ] **Step 1: Write the failing tests**

Append inside `describe('toViewerEntry', …)` in `src/lib/share/viewerEntry.test.ts`:

```ts
  it("carries the person's display number when there is one", () => {
    const entry: Entry = {
      kind: 'exchange', id: 'participant:s:r1:participant:1', leg: 'participant', languages: { source: 'en', target: 'ja' },
      pairing: 'stated', t: 1000, source: [row('r1:participant:1:0', 'Hi', true)], translation: [],
    };
    expect(toViewerEntry(entry, 2)).toMatchObject({ person: 2 });
    expect(toViewerEntry(entry)).not.toHaveProperty('person');
  });
```

Append inside `describe('startSharePublisher', …)` in `src/lib/share/publisher.test.ts`:

```ts
  it('re-sends an earlier entry once its leg has a second person', async () => {
    const said = (id: string, person: string): Entry => {
      const e = exchange(id, '1') as Extract<Entry, { kind: 'exchange' }>;
      return { ...e, leg: 'participant', source: e.source.map((r) => ({ ...r, person })) };
    };
    const h = harness();
    const a = said('pa', '1.1');
    h.view.set({ entries: [a] });
    await flush();
    expect(lastOf(h.port.patch.mock.calls)![0].upsert.map((e) => [e.id, e.person])).toEqual([['pa', undefined]]);
    h.view.set({ entries: [a, said('pb', '1.2')] });
    await flush();
    expect(lastOf(h.port.patch.mock.calls)![0].upsert.map((e) => [e.id, e.person])).toEqual([['pa', 1], ['pb', 2]]);
    h.stop();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/share`
Expected: FAIL — no `person` on viewer entries.

- [ ] **Step 3: Write the implementation**

`src/lib/share/types.ts` — in `ViewerEntry`, after `translation: ViewerRow[];`:

```ts
  /** The person's display number, on a labelled leg (`people()`). */
  person?: number;
```

`src/lib/share/viewerEntry.ts`:

```ts
/** What a viewer reads of one entry, with its person's display number when its leg is labelled; notices stay with the host (spec 2026-10-04 §3.1). */
export function toViewerEntry(entry: Entry, person?: number): ViewerEntry | null {
  if (entry.kind !== 'exchange') return null;
  return {
    id: entry.id,
    leg: entry.leg,
    t: entry.t,
    languages: { source: entry.languages.source, target: entry.languages.target },
    source: entry.source.map(row),
    translation: entry.translation.map(row),
    ...(person !== undefined ? { person } : {}),
  };
}
```

`src/lib/share/publisher.ts` — import (after line 12):

```ts
import { entryPerson, people } from '../view/people';
```

the cache (line 28) and `items` (lines 42-54). An entry's number can change without the entry changing — the leg gains its second person — so the cache keeps the number it was built with:

```ts
  const cache = new WeakMap<Entry, { person: number | undefined; item: ShareItem | null }>();
```

```ts
  const items = (): ShareItem[] => {
    const out: ShareItem[] = [];
    const entries = sources.view.get().entries;
    const who = people(entries);
    for (const entry of entries) {
      const person = entry.kind === 'exchange' ? who.numberOf(entry.leg, entryPerson(entry)) : undefined;
      let hit = cache.get(entry);
      if (hit === undefined || hit.person !== person) {
        const viewer = toViewerEntry(entry, person);
        hit = { person, item: viewer ? { entry: viewer, json: JSON.stringify(viewer) } : null };
        cache.set(entry, hit);
      }
      if (hit.item) out.push(hit.item);
    }
    return out;
  };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/share`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/share/types.ts src/lib/share/viewerEntry.ts src/lib/share/publisher.ts src/lib/share/viewerEntry.test.ts src/lib/share/publisher.test.ts
git commit -m "feat(share): send each LAN entry its person's number

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: The LAN viewer shows "Speaker N"

**Files:**
- Modify: `src/viewer/CaptionList.tsx:82-97`
- Modify: `src/viewer/transcript.ts:15`
- Modify: `src/locales/*/translation.json` (30 catalogs: `viewer.legend.person`), then regenerate `src/viewer/strings.generated.ts`
- Test: `src/viewer/CaptionList.test.tsx`, `src/viewer/transcript.test.ts`

**Interfaces:**
- Consumes: `ViewerEntry.person` (Task 9).
- Produces: the key `viewer.legend.person` = "Speaker {{n}}".

- [ ] **Step 1: Write the failing tests**

Append inside `describe('CaptionList', …)` in `src/viewer/CaptionList.test.tsx`:

```tsx
  it("names the person at each change, on a single leg too", () => {
    const said = (id: string, tr: string, person: number): ViewerEntry => ({ ...entry(id, tr), leg: 'participant', person });
    render(
      <CaptionList
        t={(key, params) => (params ? `${key}:${params.n}` : key)} entries={[said('e1', '一', 1), said('e2', '二', 1), said('e3', '三', 2)]}
        choice={{ code: 'zh-CN', both: false }} completeOnly={false} layout="phone" twoLegs={false}
        notice={null} emptyText="nothing yet" following onFollowingChange={() => {}}
      />,
    );
    expect([...document.querySelectorAll('.viewer-entry__side')].map((n) => n.textContent)).toEqual(['viewer.legend.person:1', 'viewer.legend.person:2']);
  });
```

In `src/viewer/transcript.test.ts`, change line 7 to

```ts
const t = makeT({ transcript: { header: 'Saved {{time}}' }, legend: { person: 'Speaker {{n}}' } }, undefined);
```

and append inside `describe('transcriptText', …)`:

```ts
  it("names the entry's person on its time line", () => {
    const text = transcriptText([{ ...e('a', 'Hi', '你好'), person: 2 }], { code: 'zh-CN', both: false }, t, at);
    expect(text).toBe('Saved 2026-10-04 19:12:05\n\n[19:12:05] Speaker 2\n你好\n');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/viewer/CaptionList.test.tsx src/viewer/transcript.test.ts`
Expected: FAIL — no side tag with `twoLegs` false; no name on the time line.

- [ ] **Step 3: Write the implementation**

`src/viewer/CaptionList.tsx`, lines 82-97:

```tsx
  // A turn starts where the side, or a labelled side's person, differs from the
  // last line shown. Visibility is read cheaply (no pieces), so unchanged lines
  // still skip re-rendering.
  let lastLeg: ViewerEntry['leg'] | null = null;
  let lastPerson: number | undefined;
  const rows = entries.map((entry) => {
    const { primary, secondary } = sidesFor(entry, choice.code);
    const visible = shows(primary, completeOnly) || (choice.both && shows(secondary, completeOnly));
    const turn = visible && (entry.leg !== lastLeg || entry.person !== lastPerson);
    if (visible) {
      lastLeg = entry.leg;
      lastPerson = entry.person;
    }
    const side = !turn ? null
      : entry.person !== undefined ? t('viewer.legend.person', { n: entry.person })
        : twoLegs ? t(SIDE_KEYS[entry.leg]) : null;
    return (
      <CaptionRow
        key={entry.id} entry={entry} code={choice.code} both={choice.both}
        completeOnly={completeOnly} desktop={layout === 'desktop'}
        side={side}
      />
    );
  });
```

`src/viewer/transcript.ts`, line 15:

```ts
    lines.push(entry.person !== undefined ? `[${formatLocalTime(entry.t)}] ${t('viewer.legend.person', { n: entry.person })}` : `[${formatLocalTime(entry.t)}]`);
```

The catalogs and the generated strings — from the repo root:

```bash
node --input-type=module <<'EOF'
import { readFileSync, writeFileSync } from 'node:fs';
const SPEAKER = {
  en: 'Speaker {{n}}', ar: 'المتحدث {{n}}', bn: 'বক্তা {{n}}', de: 'Sprecher {{n}}', es: 'Hablante {{n}}',
  fa: 'گوینده {{n}}', fi: 'Puhuja {{n}}', fil: 'Tagapagsalita {{n}}', fr: 'Intervenant {{n}}', he: 'דובר {{n}}',
  hi: 'वक्ता {{n}}', id: 'Pembicara {{n}}', it: 'Interlocutore {{n}}', ja: '話者 {{n}}', ko: '화자 {{n}}',
  ms: 'Penutur {{n}}', nl: 'Spreker {{n}}', pl: 'Mówca {{n}}', pt_BR: 'Falante {{n}}', pt_PT: 'Orador {{n}}',
  ru: 'Говорящий {{n}}', sv: 'Talare {{n}}', ta: 'பேச்சாளர் {{n}}', te: 'వక్త {{n}}', th: 'ผู้พูด {{n}}',
  tr: 'Konuşmacı {{n}}', uk: 'Мовець {{n}}', vi: 'Người nói {{n}}', zh_CN: '说话人 {{n}}', zh_TW: '說話者 {{n}}',
};
for (const [id, words] of Object.entries(SPEAKER)) {
  const file = `src/locales/${id}/translation.json`;
  const catalog = JSON.parse(readFileSync(file, 'utf8'));
  catalog.viewer.legend.person = words;
  writeFileSync(file, `${JSON.stringify(catalog, null, 2)}\n`);
}
console.log(`wrote ${Object.keys(SPEAKER).length} catalogs`);
EOF
node scripts/gen-viewer-strings.mjs
```

Expected output: `wrote 30 catalogs`, then `wrote src/viewer/strings.generated.ts (30 catalogs)`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/viewer src/locales`
Expected: PASS — including `viewerStrings.consistency.test.ts` (the key is named literally in `CaptionList.tsx` and `transcript.ts`) and `strings.test.ts` (the generated file matches the catalogs).

- [ ] **Step 5: Commit**

```bash
git add src/viewer/CaptionList.tsx src/viewer/transcript.ts src/viewer/CaptionList.test.tsx src/viewer/transcript.test.ts src/viewer/strings.generated.ts src/locales
git commit -m "feat(viewer): name each person on the LAN caption page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: The exports and the auto-save name each person

**Files:**
- Modify: `src/lib/export/transcript.ts:7-17, 58-69, 132-179`
- Modify: `src/lib/export/exporter.ts:36-55`
- Modify: `src/components/Conversation/useConversationExporter.ts:10`
- Modify: `src/lib/export/appAutoSave.ts:32`
- Test: `src/lib/export/transcript.test.ts`, `src/lib/export/exporter.test.ts`, `src/lib/export/appAutoSave.test.ts`

**Interfaces:**
- Consumes: `people`, `entryPerson` (Task 3); `mainPanel.displayMode.person` (Task 7).
- Produces: `TranscriptLabels.person(n: number): string`; `TranscriptGroup.person?: number`; `exportWords(t: (key: string, defaultValue: string, params?: Record<string, string | number>) => string)`.

- [ ] **Step 1: Write the failing tests**

`src/lib/export/transcript.test.ts` — add `person` to the shared `options.labels` (line 29):

```ts
  labels: { me: 'Me', other: 'Other', noTranslation: '(no translation)', noSource: '(no source)', person: (n: number) => `Speaker ${n}` },
```

and append:

```ts
describe('people', () => {
  const said = (s: Segment, person: string) => rows(s).map((r) => ({ ...r, person }));
  const p1 = seg('participant', { text: 'First.', openedAt: 20_000 });
  const p2 = seg('participant', { text: 'Second.', openedAt: 21_000 });
  const labelled: Entry[] = [
    { kind: 'exchange', id: 'p1', leg: 'participant', languages: legs[1].languages, pairing: 'stated', source: said(p1, '1.1'), translation: [], t: 20_000 },
    { kind: 'exchange', id: 'p2', leg: 'participant', languages: legs[1].languages, pairing: 'stated', source: said(p2, '1.2'), translation: [], t: 21_000 },
  ];
  const peopleLegs: Leg[] = [{ ...legs[1], segments: [p1, p2] }];

  it("writes a labelled leg's person in the JSON, and nothing for an unlabelled one", () => {
    expect(renderTranscriptJson(labelled, peopleLegs).groups.map((g) => g.person)).toEqual([1, 2]);
    expect(renderTranscriptJson(entries, legs).groups.every((g) => !('person' in g))).toBe(true);
  });

  it("heads each block with the person's name, whatever the scope", () => {
    expect(renderTranscriptTxt(labelled, peopleLegs, options)).toContain('[t20000] Speaker 1\n');
    expect(renderTranscriptTxt(labelled, peopleLegs, { ...options, scope: { speaker: 'both', participant: 'source' } })).toContain('[t21000] Speaker 2\n');
  });
});
```

`src/lib/export/exporter.test.ts` — the `exportWords` case (lines 79-89) becomes:

```ts
  it("reads today's export keys, the two new ones, and the person's", () => {
    const keyed = exportWords((key, defaultValue, params) => `${key}|${defaultValue}${params ? `|${JSON.stringify(params)}` : ''}`);
    const { person, ...labels } = keyed.labels;
    expect(labels).toEqual({
      me: 'mainPanel.export.speakerYou|Me',
      other: 'mainPanel.export.speakerOther|Other',
      noTranslation: 'mainPanel.export.noTranslation|(no translation)',
      noSource: 'mainPanel.export.noSource|(no source)',
    });
    expect(person(3)).toBe('mainPanel.displayMode.person|Speaker {{n}}|{"n":3}');
    expect(keyed.header.narrowed).toBe('mainPanel.export.headerNarrowed|Note: this export was narrowed at export time — some lines were left out.');
  });
```

`src/lib/export/appAutoSave.test.ts` — append inside `describe('autoSaveConversation', …)`:

```ts
  it("names each person of a labelled leg in the saved text", async () => {
    const people: Leg = {
      ...participantLeg,
      segments: [
        seg({ id: 'r:participant:1', text: 'One.', origin: 'q1', openedAt: 1_700_000_010_000, person: '1.1' }),
        seg({ id: 'r:participant:2', text: 'Two.', origin: 'q2', openedAt: 1_700_000_011_000, person: '1.2' }),
      ],
    };
    expect(await autoSaveConversation([people], info, { note })).toBe('saved');
    const [content] = downloadFile.mock.calls[0];
    expect(content).toMatch(/\] Speaker 1\n {2}One\.\n/);
    expect(content).toMatch(/\] Speaker 2\n {2}Two\.\n/);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/export`
Expected: FAIL — no `person` in groups or labels; the TXT reads "Other".

- [ ] **Step 3: Write the implementation**

`src/lib/export/transcript.ts`.

Import (after line 10):

```ts
import { entryPerson, people } from '../view/people';
```

`TranscriptLabels` (after `noSource: string;`):

```ts
  /** A labelled leg's person, by display number. */
  person(n: number): string;
```

`TranscriptGroup` (after `pairing: Pairing;`):

```ts
  /** The person's display number, on a labelled leg. */
  person?: number;
```

`renderTranscriptJson` — before the loop (after `const notices …`):

```ts
  const who = people(entries);
```

and the group (line 147):

```ts
    const person = who.numberOf(e.leg, entryPerson(e));
    const group: TranscriptGroup = { id: e.id, leg: e.leg, t: e.t, pairing: e.pairing, ...(person !== undefined ? { person } : {}) };
```

`renderTranscriptTxt` — the block's first line (line 173):

```ts
    const who = g.person !== undefined ? o.labels.person(g.person) : g.leg === 'speaker' ? o.labels.me : o.labels.other;
    lines.push(`${o.formatTime(g.t)} ${who}`);
```

`src/lib/export/exporter.ts` — `exportWords` (lines 36-44):

```ts
/** The words an export writes: today's `mainPanel.export.*` keys, plus the two for a missing side and the person's (the conversation's own key). */
export function exportWords(t: (key: string, defaultValue: string, params?: Record<string, string | number>) => string): ExportWords {
  return {
    labels: {
      me: t('mainPanel.export.speakerYou', 'Me'),
      other: t('mainPanel.export.speakerOther', 'Other'),
      noTranslation: t('mainPanel.export.noTranslation', '(no translation)'),
      noSource: t('mainPanel.export.noSource', '(no source)'),
      person: (n) => t('mainPanel.displayMode.person', 'Speaker {{n}}', { n }),
    },
```

`src/components/Conversation/useConversationExporter.ts`, line 10:

```ts
  const words = useMemo(() => exportWords((key, defaultValue, params) => t(key, { defaultValue, ...params })), [t]);
```

`src/lib/export/appAutoSave.ts`, line 32:

```ts
      words: exportWords((key, defaultValue, params) => i18n.t(key, { defaultValue, ...params })),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/export src/components/Conversation src/components/MainPanel`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/export/transcript.ts src/lib/export/exporter.ts src/lib/export/appAutoSave.ts src/components/Conversation/useConversationExporter.ts src/lib/export/transcript.test.ts src/lib/export/exporter.test.ts src/lib/export/appAutoSave.test.ts
git commit -m "feat(export): name each person in the exports and the auto-save

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Whole-slice verification

**Files:** none changed unless a check fails.

- [ ] **Step 1: Run the full suite**

Run: `npx vitest run`
Expected: every file passes (642+ files before this slice, plus `people.test.ts`).

- [ ] **Step 2: Typecheck the touched files**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "src/(lib/(contract|conversation|projection|view|subtitle|share|export)|providers/soniox|components/(Conversation|Subtitle|MainPanel)|viewer)/" || echo "no errors in touched areas"`
Expected: `no errors in touched areas` (the repo has unrelated pre-existing `tsc` errors elsewhere; none may be added here).

- [ ] **Step 3: Build the viewer and check its bundle**

Run: `npm run build && node scripts/check-viewer-bundle.mjs`
Expected: the build succeeds and the viewer bundle check passes (the viewer still imports no catalog).

- [ ] **Step 4: Record the live checks for the owner** (needs a Soniox key; ask before running anything that bills)

- Others mode on a recorded meeting played as system audio: after the second voice, the conversation's headers read "Speaker 1 / Speaker 2" and earlier rows gained their numbers.
- The same run in the subtitle window, compact and expanded; the LAN page on a phone; Export TXT and JSON; the auto-save at Stop.
- One voice only: no label anywhere.
- A forced resume (network drop) mid-meeting: new people continue the numbering.

---

## Self-Review

- **Spec coverage (Slice 2 / D4–D7):** wire, participant one-way socket → Task 4; contract `person` → Task 1; Soniox label at first token, final-originals majority, socket epoch, translation shares the label → Task 5; L1 → Task 1; L2 → Task 2; numbering, labelled at two, new epoch = new people → Task 3; main conversation and header on person change → Tasks 6–7; subtitle window compact dot (expanded via Tasks 6–7) → Task 8; LAN viewer → Tasks 9–10; JSON `person`, TXT header, auto-save → Task 11; one phrase in 30 catalogs plus its `viewer.*` twin and regeneration → Tasks 7 and 10.
- **Placeholders:** none; every code step carries its code.
- **Type consistency:** `person?: string` on events, `Segment`, `Row`; `person?: number` (display) on `DisplayItem`, `BandPiece`, `ViewerEntry`, `TranscriptGroup`; `people()` / `entryPerson()` / `People` as fixed in Task 3, used unchanged in Tasks 6, 8, 9, 11; `SonioxConfig.diarize` set in Task 4, read in Task 4.
- **Review Focus:** 1 → Task 5 (utterances epoch, adapter resume); 2 → Task 6 (re-draw), Task 9 (re-send); 3 → Task 5 (outvote, person-only snapshot); 4 → Task 10 (single leg); 5 → Task 8 (notice, cap).
