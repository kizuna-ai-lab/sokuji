#define SOKUJI_NATIVE_BUILD 1
#include "sokuji_native.h"

#include "engine/framework/runtime/registry.h"

#include <algorithm>
#include <string>
#include <vector>

/* engine::runtime::ModelRegistry::families() (not "loaders()": the registry.h at v0.7.0
 * exposes families directly, there is no loader-enumeration accessor) reports every loader
 * make_default_registry() knows about. That is more than our six selected families:
 *   - "silero_vad" and "marblenet_vad" are two small VAD paths audio.cpp always compiles
 *     and always registers, outside the AUDIOCPP_MODELS composite entirely (see its
 *     CMakeLists.txt around engine_model_marblenet_vad: "kept outside the selectable
 *     composite list for now").
 *   - our AUDIOCPP_MODELS entry "moss_tts_nano" is an ALIAS of the CMake target "moss",
 *     which also builds and registers the sibling loader "moss_tts_local" (both loaders
 *     are listed under the one audiocpp_add_model(moss ...) LOADERS clause; the alias
 *     mechanism can only pick a target, not a single loader within it).
 * So make_default_registry() here actually reports marblenet_vad + moss_tts_local in
 * addition to our six. Both are harmless dead code from this library's point of view -
 * nothing in sokuji-native ever asks for them - so we filter the registry down to the
 * six families this build actually supports before reporting them through the ABI. */
extern "C" SK_API int32_t sk_audio_families(const char **out, int32_t capacity) {
    static const std::vector<std::string> names = [] {
        static const std::vector<std::string> supported = {
            "moss_tts_nano", "omnivoice", "pocket_tts", "qwen3_tts", "silero_vad", "supertonic",
        };
        auto registry = engine::runtime::make_default_registry();
        std::vector<std::string> all = registry.families();
        std::vector<std::string> v;
        for (const auto &f : all) {
            if (std::find(supported.begin(), supported.end(), f) != supported.end()) v.push_back(f);
        }
        std::sort(v.begin(), v.end());
        return v;
    }();
    if (!out || capacity <= 0) return static_cast<int32_t>(names.size());
    int32_t n = 0;
    for (; n < capacity && static_cast<size_t>(n) < names.size(); ++n) out[n] = names[n].c_str();
    return n;
}
