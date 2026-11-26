// sokuji_native_node.node: module init and the export table. Each source file adds its own
// functions to `exports`; the JS surface is declared in ../index.d.ts.
#include "addon.h"
#include "worker.h"

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

// The environment is ending (the process's own, or a worker_threads Worker's): cancel and join
// every worker its handles own, before Node finalizes the handles. Hooks run in reverse order of
// registration, so this one, registered at init, runs after the cleanup hooks of the jobs and of
// the log sink (registered later): no job posts to the environment any more.
void CleanupEnvironment(void *env) {
    sk_node::HandleWorker::StopOwnedBy(static_cast<napi_env>(env));
}

// process.exit() and a natural exit both emit process 'exit' before the C runtime's exit() runs
// the exit handlers; process.exit() runs no environment cleanup hook. Registering the exit handler
// now puts it after every static the library built so far (lazily, at the first load or the
// first compute), so it runs before their destructors (worker.h). Best effort: a failure here
// leaves the handler registered at init().
void RegisterExitListener(Napi::Env env) {
    try {
        Napi::Value process = env.Global().Get("process");
        if (!process.IsObject() || !process.As<Napi::Object>().Get("once").IsFunction()) return;
        Napi::Object p = process.As<Napi::Object>();
        Napi::Function listener = Napi::Function::New(env, [](const Napi::CallbackInfo &info) {
            sk_node::InstallExitHandler();
            return info.Env().Undefined();
        }, "sokujiNativeExit");
        p.Get("once").As<Napi::Function>().Call(p, {Napi::String::New(env, "exit"), listener});
    } catch (const Napi::Error &) {
    }
}

// NODE_API_MODULE pastes this name into an identifier, so it must be unqualified.
Napi::Object InitAddon(Napi::Env env, Napi::Object exports) {
    PinThisModule();
    RegisterExitListener(env);
    if (napi_add_env_cleanup_hook(env, CleanupEnvironment, env) != napi_ok) {
        throw Napi::Error::New(env, "cannot register the addon's environment cleanup hook");
    }
    env.SetInstanceData(new sk_node::AddonData());   // deleted with the environment
    sk_node::RegisterCommon(env, exports);
    sk_node::RegisterAsr(env, exports);
    sk_node::RegisterTranslate(env, exports);
    sk_node::RegisterTts(env, exports);
    sk_node::RegisterResample(env, exports);
    return exports;
}

}  // namespace

NODE_API_MODULE(sokuji_native_node, InitAddon)
