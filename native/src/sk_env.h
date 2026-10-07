/* Internal to libsokuji_native: the engine environment switches whose defaults sokuji chooses.
 * Header-only so native/tests/test_tts_request.cpp, which does not link sk_common.cpp, can check
 * them. Never installed. */
#pragma once
#include <cstdlib>

namespace sk {

// Sets an environment switch an engine reads, process-wide, unless the environment already has a
// value for it: a developer's own export (e.g. "0" to compare against a default) still wins.
inline void set_env_default(const char *name, const char *value) {
#if defined(_WIN32)
    if (!std::getenv(name)) _putenv_s(name, value);
#else
    setenv(name, value, 0);
#endif
}

// sk_init calls this once per process, under its library lock, before any model exists. It does
// not run per load: setenv is not safe against a concurrent getenv in glibc, and the sidecar
// loads TTS on an executor worker while translate loads on the loop thread.
inline void set_engine_env_defaults() {
    // echo_tts denoises every chunk over the full trained 640-latent (29.72 s) window unless
    // AUDIOCPP_ECHO_TTS_ADAPTIVE_WINDOW is set; the adaptive window sizes it from the text and
    // retries at full length when that estimate runs out (community_models/echo_tts/
    // session.cpp:84-112, 485-523). Choice (2026-10-06): on, so a few seconds of translated
    // speech no longer pays for 29.72 s of denoising. A request's max_duration_sec would pin the
    // window and skip that retry (session.cpp:267-279, 503), cutting a long utterance mid-word.
    set_env_default("AUDIOCPP_ECHO_TTS_ADAPTIVE_WINDOW", "1");
}

}  // namespace sk
