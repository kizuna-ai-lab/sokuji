// sokuji_native_node.node: module init and the export table. Each source file adds its own
// functions to `exports`; the JS surface is declared in ../index.d.ts.
#include <napi.h>

namespace sk_node {
void RegisterCommon(Napi::Env env, Napi::Object exports);   // common.cpp
}  // namespace sk_node

namespace {

// NODE_API_MODULE pastes this name into an identifier, so it must be unqualified.
Napi::Object InitAddon(Napi::Env env, Napi::Object exports) {
    sk_node::RegisterCommon(env, exports);
    return exports;
}

}  // namespace

NODE_API_MODULE(sokuji_native_node, InitAddon)
