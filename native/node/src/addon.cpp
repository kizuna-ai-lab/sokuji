// sokuji_native_node.node: module init and the export table. Each source file adds its own
// functions to `exports`; the JS surface is declared in ../index.d.ts.
#include "addon.h"

#include <napi.h>

#if defined(_WIN32)
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#else
#include <dlfcn.h>
#endif

namespace sk_node {

AddonData &Data(Napi::Env env) {
    return *env.GetInstanceData<AddonData>();
}

}  // namespace sk_node

namespace {

// Keeps this module mapped for the life of the process. Node unloads an addon when the last
// environment that loaded it ends (a worker_threads Worker), but code here must outlive
// every environment: libsokuji_native keeps calling the log sink it was given (common.cpp),
// and the misc worker's thread (worker.cpp) never ends. Unloading would also unload the
// library and ggml, and loading them again reruns ggml's static initialisers, which abort
// when run twice. Best effort: on failure the module is merely unloadable, as before.
void PinThisModule() {
    static const char anchor = 0;   // any address inside this module
#if defined(_WIN32)
    HMODULE self = nullptr;
    GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_PIN,
                       reinterpret_cast<LPCWSTR>(&anchor), &self);
#else
    Dl_info info{};
    if (dladdr(&anchor, &info) != 0 && info.dli_fname != nullptr) {
        dlopen(info.dli_fname, RTLD_LAZY | RTLD_NOLOAD | RTLD_NODELETE);   // the handle is never closed
    }
#endif
}

// NODE_API_MODULE pastes this name into an identifier, so it must be unqualified.
Napi::Object InitAddon(Napi::Env env, Napi::Object exports) {
    PinThisModule();
    env.SetInstanceData(new sk_node::AddonData());   // deleted with the environment
    sk_node::RegisterCommon(env, exports);
    sk_node::RegisterAsr(env, exports);
    return exports;
}

}  // namespace

NODE_API_MODULE(sokuji_native_node, InitAddon)
