/**
 * Capability contract between a voice-library UI and the provider adapter
 * backing it. Consumed on both sides of the local-inference provider boundary
 * (the WASM lane's Supertonic voice section and the native lane's voice
 * stores), so it lives in the neutral types layer rather than inside the
 * component that happens to render it.
 */
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
   *  differ (e.g. OmniVoice's decode degrades past ~8 s while others accept
   *  20 s), so the limit is provider-declared: recording shows a countdown and
   *  auto-stops at it; imports longer than it are rejected. Unset → the
   *  store/UI default. */
  maxClipSeconds?: number;
  /** Shortest usable reference clip in seconds. Unset → the store/UI default. */
  minClipSeconds?: number;
}
