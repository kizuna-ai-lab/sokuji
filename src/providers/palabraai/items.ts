/**
 * Palabra's messages become segments (survey §2.8; ruling 6). One sentence
 * is one `transcription_id`, on all four of its text messages and on every
 * chunk of its speech (the owner's probe): the origin that pairs each
 * translation with its source, stated. A source opens at its first partial
 * and closes when validated — with the sentence splitter on, a long
 * transcription validates in parts, `<id>_part_<n>`, the first taking over
 * the row its partials opened and each later part a row of its own (the
 * owner's session, 2026-09-30); a translation — one per `translation_part_id`
 * — opens at its first text or its first audio, whichever comes first, and
 * closes at its final text. A sentence's speech arrives as a burst after
 * its text, ending at `last_chunk`: once both are in, the text is tiled
 * over the chunks by their sample counts (`speechRanges`, Soniox's fill-in),
 * so karaoke lights a sentence once its burst is whole. Pure and
 * timer-free: the adapter hands it what the server said, in order, and
 * frames it itself.
 */
import type { AdapterEvents, Ref } from '../../lib/contract/adapter';
import { tileSpan } from '../../lib/contract/ranges';
import type { OutputAudio, Transcription } from './wire';

interface Source { ref: Ref; text: string; closed: boolean }

interface Translation {
  ref: Ref;
  sentence: string;
  text: string;
  closed: boolean;
  /** The sample count of each chunk of speech emitted for this ref, in order: the entries `speechRanges` names by index. */
  samples: number[];
  /** Its sentence's last chunk has come: no more speech is expected. */
  spoken: boolean;
  /** Its ranges are filled in: a chunk after that plays with none. */
  ranged: boolean;
}

/** The first part when a message names none: the probe's every sentence was part 0. */
const FIRST_PART = '0';

/**
 * The transcription a sentence splitter's part was cut from: with the
 * splitter on, a long transcription's partials carry its own id (or, later,
 * a part's) while it validates in parts, `<id>_part_<n>`, each with its own
 * translation (the owner's session, 2026-09-30).
 */
const transcriptionOf = (id: string): string => id.replace(/_part_\d+$/, '');

/**
 * What `text` says beyond `said`, the parts of its transcription already
 * validated, compared without whitespace (the server joins parts with a
 * space); the text whole when it does not begin with them, and null when
 * nothing is left.
 */
function unsaid(text: string, said: string): string | null {
  let i = 0;
  let j = 0;
  while (j < said.length) {
    if (/\s/.test(said[j])) { j++; continue; }
    while (i < text.length && /\s/.test(text[i])) i++;
    if (i >= text.length || text[i] !== said[j]) return text;
    i++;
    j++;
  }
  const rest = text.slice(i).trimStart();
  return rest.length > 0 ? rest : null;
}

export class PalabraItems {
  private nextRef = 1;
  /** Validated sources by the id they validated under: a final said twice, or a partial after it, changes nothing. */
  private readonly sources = new Map<string, Source>();
  /** The one open row per transcription that shows its partial text, until its next part validates onto it. */
  private readonly live = new Map<string, Source>();
  /** Per transcription, the text of its parts validated so far: what a later partial still repeating them does not show again. */
  private readonly said = new Map<string, string>();
  private readonly translations = new Map<string, Translation>();
  private stopped = false;

  constructor(private readonly events: AdapterEvents) {}

  /**
   * A partial transcription: its transcription's open row — opened at the
   * first — shows the text so far, less the parts already validated. Ignored
   * once its own id is validated, and without an id (none was ever seen).
   */
  sourcePartial(t: Transcription): void {
    if (this.stopped || t.id === undefined) return;
    if (this.sources.get(t.id)?.closed) return;
    const transcription = transcriptionOf(t.id);
    const text = unsaid(t.text, this.said.get(transcription) ?? '');
    if (text === null) return;
    let source = this.live.get(transcription);
    if (!source) {
      source = this.open(t.id);
      this.live.set(transcription, source);
    }
    this.sourceText(source, { ...t, text });
  }

  /**
   * A validated transcription: the sentence's final text, and its source
   * closed — once, under its own id. It takes over its transcription's open
   * row when there is one (a splitter's first part, or a sentence never
   * split), else it has a row of its own. With no id, a source of its own,
   * paired with nothing.
   */
  sourceFinal(t: Transcription): void {
    if (this.stopped) return;
    if (t.id === undefined) {
      const ref = this.nextRef++;
      this.events.segmentOpened({ ref, side: 'source' });
      this.events.segmentText({ ref, text: t.text, ...(t.language ? { language: t.language } : {}) });
      this.events.segmentClosed({ ref });
      return;
    }
    if (this.sources.get(t.id)?.closed) return;
    const transcription = transcriptionOf(t.id);
    const source = this.live.get(transcription) ?? this.open(t.id);
    this.live.delete(transcription);
    this.sources.set(t.id, source);
    this.said.set(transcription, (this.said.get(transcription) ?? '') + t.text);
    // Unlike a partial, the final always sends (choice 12; the owner's
    // probe: 46 of 46 sentences validate with their last partial's text),
    // so an unchanged text still reaches the row, and a refined language
    // still reaches the badge.
    source.text = t.text;
    this.events.segmentText({ ref: source.ref, text: t.text, ...(t.language ? { language: t.language } : {}) });
    source.closed = true;
    this.events.segmentClosed({ ref: source.ref, origin: t.id });
  }

  /** A partial translation (only with `translate_partial_transcriptions` on): its whole text so far. Ignored once final, and without an id. */
  translationPartial(t: Transcription): void {
    if (this.stopped || t.id === undefined) return;
    const translation = this.translation(t.id, t.part ?? FIRST_PART);
    if (translation.closed) return;
    this.translationText(translation, t.text);
  }

  /** A translated transcription: the part's final text, and its translation closed — once. With no id, a translation of its own, paired with nothing. */
  translationFinal(t: Transcription): void {
    if (this.stopped) return;
    if (t.id === undefined) {
      const ref = this.nextRef++;
      this.events.segmentOpened({ ref, side: 'translation' });
      this.events.segmentText({ ref, text: t.text });
      this.events.segmentClosed({ ref });
      return;
    }
    const translation = this.translation(t.id, t.part ?? FIRST_PART);
    if (translation.closed) return;
    // The final always sends too (choice 12; the owner's probe: 46 of 46
    // sentences validate with their last partial's text): the equal-text
    // skip stays for partials only, so an untouched or repeated part's
    // text still reaches the row rather than staying blank.
    translation.text = t.text;
    this.events.segmentText({ ref: translation.ref, text: t.text });
    translation.closed = true;
    this.events.segmentClosed({ ref: translation.ref, origin: t.id });
    this.fill(translation);
  }

  /**
   * A chunk of speech, on its part's translation — opened empty when no
   * text came first, so audio never waits for a segment. Its sentence's
   * last chunk ends the speech of every part of it; each fills in its
   * ranges once its text is final too. A chunk with no id plays with no
   * segment. An empty chunk emits nothing, and still ends a burst.
   */
  audio(a: Pick<OutputAudio, 'id' | 'part' | 'last'>, pcm: Int16Array): void {
    if (this.stopped) return;
    if (a.id === undefined) {
      if (pcm.length > 0) this.events.audio({ pcm });
      return;
    }
    const translation = this.translation(a.id, a.part ?? FIRST_PART);
    if (pcm.length > 0) {
      this.events.audio({ pcm, ref: translation.ref });
      if (!translation.ranged) translation.samples.push(pcm.length);
    }
    if (!a.last) return;
    for (const t of this.translations.values()) {
      if (t.sentence !== a.id || t.samples.length === 0 || t.spoken) continue;
      t.spoken = true;
      this.fill(t);
    }
  }

  /** Nothing more is emitted: the leg has ended. */
  stop(): void {
    this.stopped = true;
  }

  /** A source row opened under `id`; the id it validates under states its origin at the close. */
  private open(id: string): Source {
    const source: Source = { ref: this.nextRef++, text: '', closed: false };
    this.events.segmentOpened({ ref: source.ref, side: 'source', origin: id });
    return source;
  }

  private sourceText(source: Source, t: Transcription): void {
    if (t.text === source.text) return;
    source.text = t.text;
    // The language the server heard: under an `auto` source, what the row's badge and the fill-in read (ruling 8).
    this.events.segmentText({ ref: source.ref, text: t.text, ...(t.language ? { language: t.language } : {}) });
  }

  private translation(id: string, part: string): Translation {
    const key = `${id}\u0000${part}`;
    let translation = this.translations.get(key);
    if (!translation) {
      translation = { ref: this.nextRef++, sentence: id, text: '', closed: false, samples: [], spoken: false, ranged: false };
      this.translations.set(key, translation);
      this.events.segmentOpened({ ref: translation.ref, side: 'translation', origin: id });
    }
    return translation;
  }

  private translationText(translation: Translation, text: string): void {
    if (text === translation.text) return;
    translation.text = text;
    this.events.segmentText({ ref: translation.ref, text });
  }

  /** The part's text tiled over its chunks by sample count, once its burst is whole and its text final (ruling 6): the entries in order, 0 first. */
  private fill(t: Translation): void {
    if (t.ranged || !t.spoken || !t.closed || t.samples.length === 0 || t.text.length === 0) return;
    t.ranged = true;
    const ranges = tileSpan([0, t.text.length], t.samples, t.text);
    this.events.speechRanges({ ref: t.ref, ranges: ranges.map((range, index) => ({ index, range })) });
  }
}
