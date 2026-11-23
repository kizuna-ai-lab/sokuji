// Per-environment addon state and each source file's export registration.
#pragma once

#include <napi.h>

namespace sk_node {

// Set as the environment's instance data at module init; freed with the environment.
struct AddonData {
    Napi::FunctionReference asr_model;   // the AsrModel class (asr.cpp)
};

AddonData &Data(Napi::Env env);

void RegisterCommon(Napi::Env env, Napi::Object exports);   // common.cpp
void RegisterAsr(Napi::Env env, Napi::Object exports);      // asr.cpp

}  // namespace sk_node
