/* Internal to libsokuji_native: the GGUFs a TTS family loads from outside its model's own folder.
 * One definition for both readers: sk_tts_load hands each to its family as a session option
 * (sk_tts.cpp, family_load), and the op recorder reads their tensors with the model's
 * (native/tests/model_tensors.h, tts_model_tensors), so a recording's `# dtypes-in-file:` and
 * WEIGHT names cover what the family really loads. Header-only, since the recorder links only
 * the library's C ABI. Never installed. */
#pragma once
#include <filesystem>
#include <string>
#include <system_error>
#include <vector>

namespace sk {

struct TtsCompanion {
    const char *session_option;        // the session option that hands the file to the family
    std::filesystem::path path;
};

// The companions `family` loads from outside the folder of `model_path` (its main GGUF, or that
// GGUF's folder), at the repo-relative layout the sidecar stages a card's companions in
// (catalog Deployment.companions, tts_backend.load). Whether a file exists is the caller's to
// check.
inline std::vector<TtsCompanion> tts_sibling_companions(const std::string &family,
                                                        const std::filesystem::path &model_path) {
    std::vector<TtsCompanion> out;
    if (family == "miotts") {
        // The session loads its MioCodec at construction from miotts.codec_model_path, defaulting
        // to <model_root>/../MioCodec-25Hz-44.1kHz-v2 (audio.cpp models/miotts/session.cpp:84-97,
        // 609-611); for a GGUF with embedded sidecars model_root is a $TMPDIR snapshot, so the
        // default never exists. The card stages the q8_0 codec every rung pairs with at its
        // repo-relative path, a sibling of the model's folder.
        std::error_code ec;
        std::filesystem::path dir = std::filesystem::is_regular_file(model_path, ec) ? model_path.parent_path()
                                                                                     : model_path;
        if (!dir.has_filename()) dir = dir.parent_path();   // a trailing separator
        out.push_back({"miotts.codec_model_path",
                       dir.parent_path() / "MioCodec-25Hz-44.1kHz-v2-GGUF" / "miocodec-25hz-44khz-v2-q8_0.gguf"});
    }
    return out;
}

}  // namespace sk
