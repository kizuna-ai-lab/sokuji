# OpenAI Live smoke

`live-smoke.mjs` replays a 24 kHz mono PCM16 clip into a `gpt-live-1` interpreter session
at real time and reports when the translation started and finished, the transcripts on both
sides, delegation events (must stay 0 under the interpreter prompt) and the session's
billed seconds. It is the reference the provider was designed against (spike of
2026-09-12, see `docs/superpowers/specs/2026-09-12-openai-live-provider-design.md`).

    OPENAI_API_KEY=sk-... node benchmark/openai-live/live-smoke.mjs --clip clip.pcm --target Japanese

After the clip the script keeps sending silence until the output has been quiet for
`--quiet` ms (default 15000; a long monologue's last translation lands 8–20 s after speech
ends), capped at `--max-tail` ms (default 60000). It gives up if `session.started` has not
arrived 15 s after the socket opened.

Exit code 1 means an `error` frame or an early socket close was seen. Expect the first
voiced translation 4–30 s after speech starts and the last 8–20 s after a long monologue
ends; that is the model's pacing, not a client fault.
