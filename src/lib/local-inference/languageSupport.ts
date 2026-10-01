/**
 * Language tables the Local Inference language list is computed from
 * (ASR ∩ TTS). Static by design: the list must not depend on the network
 * or on what is downloaded.
 */

/**
 * Whisper's languages: transformers.js's WHISPER_LANGUAGES (@huggingface/transformers,
 * dist/transformers.web.js), 99 entries, as app codes — `tl` → `fil` and `jw` → `jv`
 * by Intl canonicalization.
 */
export const WHISPER_LANGUAGES: readonly string[] = ["en","zh","de","es","ru","ko","fr","ja","pt","tr","pl","ca","nl","ar","sv","it","id","hi","fi","vi","he","uk","el","ms","cs","ro","da","hu","ta","no","th","ur","hr","bg","lt","la","mi","ml","cy","sk","te","fa","lv","bn","sr","az","sl","kn","et","mk","br","eu","is","hy","ne","mn","bs","kk","sq","sw","gl","mr","pa","si","km","sn","yo","so","af","oc","ka","be","tg","sd","gu","am","yi","lo","uz","fo","ht","ps","tk","nn","mt","sa","lb","my","bo","fil","mg","as","tt","haw","ln","ha","ba","jv","su"];

/**
 * Edge TTS's languages: the primary subtags of every voice `Locale` in its voice
 * list (speech.platform.bing.com …/voices/list), 322 voices / 142 locales / 75
 * languages, snapshot taken 2026-10-02. Norwegian is `nb` there, so it does not
 * count for Whisper's `no`.
 */
export const EDGE_TTS_LANGUAGES: readonly string[] = ["af","am","ar","az","bg","bn","bs","ca","cs","cy","da","de","el","en","es","et","fa","fi","fil","fr","ga","gl","gu","he","hi","hr","hu","id","is","it","iu","ja","jv","ka","kk","km","kn","ko","lo","lt","lv","mk","ml","mn","mr","ms","mt","my","nb","ne","nl","pl","ps","pt","ro","ru","si","sk","sl","so","sq","sr","su","sv","sw","ta","te","th","tr","uk","ur","uz","vi","zh","zu"];
