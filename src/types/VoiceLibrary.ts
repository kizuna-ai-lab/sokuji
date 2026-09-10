/**
 * Capability contract between a voice-library UI and the provider adapter
 * backing it. Consumed on both sides of the local-inference provider boundary
 * (the WASM lane's Supertonic voice section and the native lane's voice
 * stores), so it lives in the neutral types layer rather than inside the
 * component that happens to render it.
 */
/**
 * What a provider knows about how one voice SOUNDS, as opaque tag strings.
 *
 * Deliberately untyped beyond `string`: Soniox documents `gender` and `age` as
 * closed enums but leaves `accent`, `use_case` and `style` free-form, and it
 * has grown all three without warning. A union type here would turn "Soniox
 * added an accent" into a compile error in a file nobody is looking at, so the
 * vocabulary is derived from the data instead (see `facetVocabulary`).
 *
 * Every field is optional because not every voice is classified — cloned
 * voices carry no metadata at all.
 */
export interface VoiceFacets {
  gender?: string;
  age?: string;
  accent?: string;
  /** What the voice is suited for. A voice may carry several. */
  useCase?: string[];
  /** How the voice sounds. A voice may carry several. */
  style?: string[];
  /** The provider's own one-line character description, in whatever language
   *  the provider publishes it (Soniox: English only). Searchable, and shown
   *  beneath the voice name where the presentation has room. */
  description?: string;
}

/** Which facet values the user has narrowed to. Empty/absent = no narrowing. */
export interface VoiceFacetCriteria {
  gender?: string | null;
  age?: string | null;
  accent?: string | null;
  /** ALL of these must be present on the voice, matching Soniox's own
   *  `GET /v1/shared-voices` semantics. */
  useCase?: string[];
  /** ALL of these must be present on the voice. */
  style?: string[];
}

export interface VoiceLibraryCapability {
  /** Which import affordances to render. `upload` → file picker + drop zone;
   *  `record` → microphone Record button. */
  importModes: ('upload' | 'record')[];
  /** When true, only curated builtins are shown by default with a "show all"
   *  expander revealing the rest. When false, all builtins are shown. */
  curation: boolean;
  /** `accept` filter for the upload file input. Defaults to the JSON voice-card
   *  filter (Supertonic) when unset; native voice cloning passes an audio filter. */
  accept?: string;
  /** How voice SELECTION is presented. `'list'` (default) renders a clickable
   *  list of voices; `'dropdown'` renders a `<select>` with optgroups (the
   *  original Supertonic affordance). Curation does not apply in dropdown mode. */
  presentation?: 'list' | 'dropdown';
  /** When true, captured clips must carry a reference transcript (native
   *  zero-shot cloning models that require ICL text). Renders a labeled
   *  transcript input in the manage toolbar and disables Import/Record until
   *  it's non-empty. Omitted/false → no new UI, unchanged behavior. */
  transcriptRequired?: boolean;
  /** Longest usable reference clip in seconds for THIS model. Cloning models
   *  differ by orders of magnitude (OmniVoice's decode degrades past ~8 s,
   *  local models take 20 s, Soniox takes 2 min), so the limit is
   *  provider-declared: recording shows a countdown and
   *  auto-stops at it; imports longer than it are rejected. Unset → the
   *  store/UI default. */
  maxClipSeconds?: number;
  /** Shortest usable reference clip in seconds. Unset → the store/UI default. */
  minClipSeconds?: number;
  /** Render the facet filter bar (search + gender/age/accent/use-case/style)
   *  above the voice list. Worth it only for a roster too large to scan —
   *  Soniox ships 200 built-ins — and only useful when the entries carry
   *  `meta.facets`. The bar builds its own vocabulary from those facets, so
   *  turning it on needs no further declaration here. Unset/false → no bar,
   *  and no change to any existing provider's picker. */
  facetFilter?: boolean;
  /** Set false when the adapter can only stage ONE clip per gesture (e.g.
   *  Soniox's confirm-modal flow holds a single pending clip): the file picker
   *  loses `multiple` and a multi-file drop keeps only the first file instead
   *  of silently last-wins overwriting. Unset/true → unchanged multi-import. */
  multipleImport?: boolean;
}
