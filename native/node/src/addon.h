// Per-environment addon state and each source file's export registration.
#pragma once

#include <napi.h>

#include <string>

namespace sk_node {

// Set as the environment's instance data at module init; freed with the environment.
struct AddonData {
    Napi::FunctionReference asr_model;   // the AsrModel class (asr.cpp)
    Napi::FunctionReference asr_stream;  // the AsrStream class (asr.cpp)
    Napi::FunctionReference translator;  // the Translator class (translate.cpp)
    Napi::FunctionReference tts;         // the Tts class (tts.cpp)
};

AddonData &Data(Napi::Env env);

// A warning (level 2) through the library's log path: the sink given to init(), and stderr.
// Any thread; never throws except for running out of memory.
void LogWarning(const std::string &message);   // common.cpp

void RegisterCommon(Napi::Env env, Napi::Object exports);      // common.cpp
void RegisterAsr(Napi::Env env, Napi::Object exports);         // asr.cpp
void RegisterTranslate(Napi::Env env, Napi::Object exports);   // translate.cpp
void RegisterTts(Napi::Env env, Napi::Object exports);         // tts.cpp
void RegisterResample(Napi::Env env, Napi::Object exports);    // resample.cpp

}  // namespace sk_node
