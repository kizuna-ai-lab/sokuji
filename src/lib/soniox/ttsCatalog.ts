/**
 * What Soniox Text-to-Speech accepts: the model id, the built-in voice roster,
 * and the wire options that go with them.
 *
 * This module exists because `tts-rt-v1` → `tts-rt-v2` was not the drop-in the
 * vendor changelog promised. Soniox announced v2 as "fully compatible ... simply
 * replace the model name" (GA 2026-08-11, v1 removed 2026-08-31), but v2 drops
 * seven voices that v1 served — Claire, Elise, Jack, Maya, Meera, Noah, Sofia —
 * and rejects them with HTTP 400. Sokuji had the model id copied into five
 * modules and the default voice into four, so a rename-per-call-site migration
 * had five chances to miss one.
 *
 * A settings file written under v1 can still name one of the dropped voices.
 * That is deliberately not repaired here. The alternative — a rewrite table
 * mapping retired names onto a survivor — hides a roster change behind a silent
 * voice substitution, and has to be carried forever afterwards.
 *
 * What a stale name actually does depends on who is asking, because "not in
 * this roster" is also how the app recognizes a CLONED voice:
 *
 *  - BYOK: the name reaches the wire, Soniox answers 400, and the session
 *    degrades to subtitles the way any other TTS failure does.
 *  - Managed (Kizuna AI): MainPanel reads it as a cloned voice and runs the
 *    managed-voice preparation path first.
 *  - Settings: SonioxVoiceSection lists it as an unknown stored voice — the
 *    same presentation a deleted clone gets, delete affordance included.
 *
 * Only the first is a property of this module. The other two are the existing
 * "unknown id ⇒ cloned voice" heuristic meeting a roster that shrank, and they
 * behave that way for any name the roster does not list.
 *
 * The roster is a SNAPSHOT (source: `GET /v1/tts-models`, 70 voices,
 * 2026-08-11), not a contract: Soniox deleted the voice table from its own docs
 * in favour of that endpoint, and the roster moved (71 → 70) within hours of GA.
 */
import type { VoiceOption } from '../../services/providers/ProviderConfig';

/** The only TTS model id Sokuji sends. Every call site imports this one. */
export const SONIOX_TTS_MODEL = 'tts-rt-v2';

/**
 * Shortens the pauses BETWEEN words without changing how fast the words
 * themselves are spoken (that is `speed`, and the two are independent).
 *
 * On by default because v2's natural pacing is slower than the v1 it replaces:
 * measured against v1 on identical text, voice and speed, v2 runs ~14% longer
 * with this off and ~7% shorter with it on. Leaving it off would have shipped
 * the upgrade as a pacing regression in a live-translation product — and, since
 * Soniox bills generated audio, a bill increase nobody asked for.
 */
export const SONIOX_REDUCE_SILENCE = true;

/** Present in the v2 roster, so it survives the migration. */
export const SONIOX_DEFAULT_VOICE = 'Adrian';

/**
 * Built-in v2 voices. Descriptions are Soniox's own, kept because accent is the
 * part users pick on and it appears nowhere else in the UI.
 */
export const SONIOX_VOICES: VoiceOption[] = [
  { name: 'Daniel', value: 'Daniel' }, // male — A rich, steady male voice with a polished tone, controlled pacing, and a…
  { name: 'Nina', value: 'Nina' }, // female — A bright, expressive female voice with youthful energy, natural rhythm, a…
  { name: 'Bryce', value: 'Bryce' }, // male — A deep, powerful male voice with strong projection and a commanding delivery
  { name: 'Kayla', value: 'Kayla' }, // female — A natural Gen Z female voice with a casual, low-key, and unpolished style
  { name: 'Nora', value: 'Nora' }, // female — A young female voice with a casual, chatty style and an inquisitive tone
  { name: 'Emerson', value: 'Emerson' }, // male — A warm, elegant male voice with a formal style and a slight American accent
  { name: 'Miles', value: 'Miles' }, // male — A deep, smooth British male voice with a relaxed, intimate delivery
  { name: 'Imogen', value: 'Imogen' }, // female — A clear British female voice with a sincere, down-to-earth, and professio…
  { name: 'Alistair', value: 'Alistair' }, // male — An older British male voice with a gentle, warm, and grandfatherly sound
  { name: 'Bennett', value: 'Bennett' }, // male — A deep, articulate male voice with the calm authority of an experienced t…
  { name: 'Harlan', value: 'Harlan' }, // male — A polished American male narrator with clear, steady delivery for factual…
  { name: 'Emma', value: 'Emma' }, // female — A smooth, natural female voice with a relaxed pace, subtle warmth, and a…
  { name: 'Adrian', value: 'Adrian' }, // male — A deep, focused male voice with crisp articulation, measured pacing, and…
  { name: 'Grace', value: 'Grace' }, // female — A gentle, soothing female voice with soft clarity, unhurried pacing, and…
  { name: 'Owen', value: 'Owen' }, // male — A grounded male voice with even pacing and a dry, composed tone that feel…
  { name: 'Mina', value: 'Mina' }, // female — A soft, thoughtful female voice with gentle clarity, steady pacing, and a…
  { name: 'Kenji', value: 'Kenji' }, // male — A calm, precise male voice with smooth clarity, balanced pacing, and a co…
  { name: 'Rafael', value: 'Rafael' }, // male — A clear, composed male voice with a warm Spanish accent, balanced pacing,…
  { name: 'Mateo', value: 'Mateo' }, // male — A warm, youthful male voice with a soft Spanish accent, clear pacing, and…
  { name: 'Lucia', value: 'Lucia' }, // female — A clear, mature female voice with a natural Spanish accent, steady pacing…
  { name: 'Oliver', value: 'Oliver' }, // male — A refined male voice with a smooth British accent, gentle pacing, and a c…
  { name: 'Arthur', value: 'Arthur' }, // male — A deep, mature male voice with a rich British accent, measured pacing, an…
  { name: 'Isla', value: 'Isla' }, // female — A lively female voice with a bright British accent, clear delivery, and e…
  { name: 'Victoria', value: 'Victoria' }, // female — A poised female voice with a refined British accent, smooth pacing, and a…
  { name: 'Cooper', value: 'Cooper' }, // male — A bold male voice with a strong Australian accent, relaxed pacing, and a…
  { name: 'Mason', value: 'Mason' }, // male — A relaxed male voice with a natural Australian accent, smooth pacing, and…
  { name: 'Ruby', value: 'Ruby' }, // female — A confident female voice with a natural Australian accent, lively pacing,…
  { name: 'Arjun', value: 'Arjun' }, // male — A deep male voice with a natural Indian accent, warm resonance, and an ea…
  { name: 'Rohan', value: 'Rohan' }, // male — A lively male voice with a natural Indian accent, expressive rhythm, and…
  { name: 'Priya', value: 'Priya' }, // female — A clear female voice with a natural Indian accent, warm pacing, and a com…
  { name: 'Trevor', value: 'Trevor' }, // male — A casual male voice with a slightly gritty tone and a confident, unrehear…
  { name: 'Evan', value: 'Evan' }, // male — A friendly, clear male voice that makes detailed information easy to follow
  { name: 'Nathan', value: 'Nathan' }, // male — A deep, gentle male voice with a soft, calming delivery
  { name: 'Karan', value: 'Karan' }, // male — A deep, friendly male voice with an Indian accent and a light, upbeat touch
  { name: 'Wesley', value: 'Wesley' }, // male — A rich, deep male voice with a smooth and authoritative sound
  { name: 'Curtis', value: 'Curtis' }, // male — A deep, resonant male voice with a relaxed and comforting tone
  { name: 'Preston', value: 'Preston' }, // male — A confident, friendly male voice with lively emphasis and a persuasive tone
  { name: 'Walter', value: 'Walter' }, // male — A deep, mature male voice with an earnest, kind, and sincere delivery
  { name: 'Russell', value: 'Russell' }, // male — A deep, gravelly male voice with a warm and intimate delivery
  { name: 'Tunde', value: 'Tunde' }, // male — A young nigerian male voice with a deep, melodic sound
  { name: 'Nigel', value: 'Nigel' }, // male — A warm, neutral British male voice with a clean and balanced delivery
  { name: 'Shane', value: 'Shane' }, // male — A pleasant male voice with clear speech and steady, easy pacing
  { name: 'Silas', value: 'Silas' }, // male — An older, deep male voice with a rugged Southern drawl and a wise, unhurr…
  { name: 'Reid', value: 'Reid' }, // male — A calm, precise male voice with a steady and trustworthy delivery
  { name: 'Emilio', value: 'Emilio' }, // male — A lively male voice with a Mexican accent and a warm, joyful energy
  { name: 'Dominic', value: 'Dominic' }, // male — A deep male voice with a wide emotional range and a bold, dramatic delivery
  { name: 'Elliot', value: 'Elliot' }, // male — A soft-spoken British male voice with warm, calm, and even delivery
  { name: 'Hugo', value: 'Hugo' }, // male — A deep British male voice with a dramatic, polished storytelling style
  { name: 'Sebastian', value: 'Sebastian' }, // male — A deep, gravelly British male voice with an intimate and understated sarc…
  { name: 'Haruto', value: 'Haruto' }, // male — A young male voice with a calm, smooth, and measured delivery
  { name: 'Freddie', value: 'Freddie' }, // male — A youthful British male voice with a warm, friendly, and enthusiastic style
  { name: 'Logan', value: 'Logan' }, // male — A warm, conversational male voice with a natural and quietly confident de…
  { name: 'Poppy', value: 'Poppy' }, // female — A youthful British female voice with bright energy and an easy, casual style
  { name: 'Harper', value: 'Harper' }, // female — A relaxed female voice with natural pauses and a casual, unscripted delivery
  { name: 'Cordelia', value: 'Cordelia' }, // female — A calm, polished female character voice with an elegant but menacing edge
  { name: 'Reese', value: 'Reese' }, // female — A young female voice with confident energy and a bold, determined delivery
  { name: 'Hazel', value: 'Hazel' }, // female — A warm female voice with a clear, natural, and understated delivery
  { name: 'Juliet', value: 'Juliet' }, // female — A warm, soothing female voice with slow, poetic phrasing
  { name: 'Piper', value: 'Piper' }, // female — A cheerful female voice with upbeat energy and a bright, lively delivery
  { name: 'Reyna', value: 'Reyna' }, // female — A mature female voice with a powerful theatrical range and a warm, comman…
  { name: 'Sloane', value: 'Sloane' }, // female — A crisp, articulate female narrator with enough range to keep long storie…
  { name: 'Iris', value: 'Iris' }, // female — A clear, patient female voice with a gentle and reassuring tone
  { name: 'Freya', value: 'Freya' }, // female — A clear, bright British female voice with a neutral and easy-to-follow de…
  { name: 'Brooke', value: 'Brooke' }, // female — A bright American female voice with a casual, friendly conversational style
  { name: 'Bonnie', value: 'Bonnie' }, // female — A soft Australian female voice with a gentle, calming delivery
  { name: 'Arabella', value: 'Arabella' }, // female — A rich, silky British female voice with a soft and sophisticated delivery
  { name: 'Colleen', value: 'Colleen' }, // female — A warm, clear female voice that moves naturally between storytelling and…
  { name: 'Margo', value: 'Margo' }, // female — A dry female voice with flat delivery and sharp, understated sarcasm
  { name: 'Bianca', value: 'Bianca' }, // female — A serious female voice with a Brazilian accent and crisp, deliberate deli…
  { name: 'Sari', value: 'Sari' }, // female — A calm female voice with a gentle, deep tone and clear delivery
];
