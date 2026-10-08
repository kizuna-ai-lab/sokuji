#define SOKUJI_NATIVE_BUILD 1
#include "sokuji_native.h"

#include "engine/framework/runtime/registry.h"

#include <algorithm>
#include <string>
#include <vector>

/* engine::runtime::ModelRegistry::families() (not "loaders()": the registry.h at v0.7.0
 * exposes families directly, there is no loader-enumeration accessor) reports every loader
 * make_default_registry() knows about, already deduplicated and sorted. This is a raw
 * "what got compiled" diagnostic, not a support list: "silero_vad" and "marblenet_vad" show up
 * whatever the composite selects, since registry.cpp registers both unconditionally, and a
 * selected name registers every loader of its CMake target ("moss_tts_nano" shares its target
 * with "moss_tts_local"). A target a selected family's DEPENDS links in (miotts's "miocodec"
 * and "qwen3_asr") registers no loader, so it is not listed. Deciding which families
 * are *supported* is the sidecar's Python catalog's job, not this function's. */
extern "C" SK_API int32_t sk_audio_families(const char **out, int32_t capacity) {
    static const std::vector<std::string> names = [] {
        auto registry = engine::runtime::make_default_registry();
        std::vector<std::string> v = registry.families();
        std::sort(v.begin(), v.end());
        return v;
    }();
    if (!out || capacity <= 0) return static_cast<int32_t>(names.size());
    int32_t n = 0;
    for (; n < capacity && static_cast<size_t>(n) < names.size(); ++n) out[n] = names[n].c_str();
    return n;
}
