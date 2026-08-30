#define SOKUJI_NATIVE_BUILD 1
#include "sokuji_native.h"
#include "sk_internal.h"

#include "engine/framework/core/backend.h"
#include "engine/framework/core/module.h"
#include "engine/framework/runtime/model.h"
#include "engine/framework/runtime/registry.h"
#include "engine/framework/runtime/session.h"

#include <algorithm>
#include <cstdint>
#include <exception>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

namespace rt = engine::runtime;

struct sk_vad {
    std::unique_ptr<rt::ILoadedVoiceModel> model;
    std::unique_ptr<rt::IVoiceTaskSession> session;
    rt::IStreamingVoiceTaskSession *stream = nullptr;   // the same object, streaming view
    int64_t cursor = 0;                                 // samples fed since the last reset
    int64_t last_end = 0;                               // end of the last emitted segment
    bool in_speech = false;
};

namespace {

constexpr int kRate = 16000;
constexpr size_t kChunk = 512;

std::string default_weights() { return sk::own_directory() + "/silero_vad_16k.safetensors"; }

void clear(sk_vad_event *out) { if (out) { out->kind = SK_VAD_NONE; out->sample = 0; out->probability = 0.f; out->seg_start = 0; out->seg_end = 0; } }

// Translate one StreamEvent into at most one sk_vad_event (silero emits at most one
// transition per 512-sample chunk).
void translate(sk_vad *v, const rt::StreamEvent &ev, sk_vad_event *out) {
    for (const auto &va : ev.voice_activity) {
        if (va.kind == rt::VoiceActivityEvent::Kind::SpeechStart) {
            v->in_speech = true;
            if (out) { out->kind = SK_VAD_SPEECH_START; out->sample = va.sample; out->probability = va.probability; }
        } else if (va.kind == rt::VoiceActivityEvent::Kind::SpeechEnd) {
            v->in_speech = false;
            int64_t s = va.segment ? va.segment->span.start_sample : v->last_end;
            int64_t e = va.segment ? va.segment->span.end_sample : va.sample;
            v->last_end = e;
            if (out) { out->kind = SK_VAD_SPEECH_END; out->sample = e; out->probability = va.probability; out->seg_start = s; out->seg_end = e; }
        }
    }
}

}  // namespace

extern "C" {

SK_API sk_status sk_vad_open(const sk_vad_options *o, sk_vad **out) {
    if (out) *out = nullptr;
    if (!out) { sk::set_error("sk_vad_open: out-pointer is required"); return SK_ERR_INVALID_ARGUMENT; }
    int threads = 0;
    {
        std::lock_guard<std::mutex> lock(sk::mutex());
        if (!sk::require_init("sk_vad_open")) return SK_ERR_NOT_INITIALISED;
        threads = sk::threads();
    }
    try {
        auto registry = rt::make_default_registry();
        rt::ModelLoadRequest req;
        req.model_path = (o && o->weights && *o->weights) ? std::string(o->weights) : default_weights();   // Ruling H
        req.family_hint = "silero_vad";
        auto model = registry.load(req);

        rt::SessionOptions so;
        so.backend.type = engine::core::BackendType::Cpu;                       // Ruling B
        so.backend.device = 0;
        so.backend.threads = std::max(1, threads);
        float threshold = (o && o->threshold > 0.f) ? o->threshold : 0.5f;
        int min_speech = (o && o->min_speech_ms > 0) ? o->min_speech_ms : 250;
        int min_silence = (o && o->min_silence_ms > 0) ? o->min_silence_ms : 100;
        int pad = (o && o->speech_pad_ms >= 0) ? o->speech_pad_ms : 30;
        so.options["threshold"] = std::to_string(threshold);
        so.options["min_speech_duration_ms"] = std::to_string(min_speech);
        so.options["min_silence_duration_ms"] = std::to_string(min_silence);
        so.options["speech_pad_ms"] = std::to_string(pad);
        if (o && o->max_speech_s > 0.f) so.options["max_speech_duration_s"] = std::to_string(o->max_speech_s);

        rt::TaskSpec spec;
        spec.task = rt::VoiceTaskKind::Vad;
        spec.mode = rt::RunMode::Streaming;
        auto session = model->create_task_session(spec, so);
        auto *stream = dynamic_cast<rt::IStreamingVoiceTaskSession *>(session.get());
        if (!stream) throw std::runtime_error("silero_vad session is not streaming-capable");
        session->prepare(rt::SessionPreparationRequest{});                     // 16 kHz
        stream->reset();

        auto *v = new sk_vad;
        v->model = std::move(model);
        v->session = std::move(session);
        v->stream = stream;
        *out = v;
        return SK_OK;
    } catch (const std::exception &e) {
        sk::set_error(std::string("sk_vad_open: ") + e.what());
        return SK_ERR_BACKEND;
    }
}

SK_API sk_status sk_vad_feed(sk_vad *v, const float *pcm512, sk_vad_event *out) {
    clear(out);
    if (!v || !pcm512) { sk::set_error("sk_vad_feed: vad and pcm512 are required"); return SK_ERR_INVALID_ARGUMENT; }
    try {
        rt::AudioChunk chunk;
        chunk.sample_rate = kRate;
        chunk.channels = 1;
        chunk.start_sample = v->cursor;
        chunk.samples.assign(pcm512, pcm512 + kChunk);
        rt::StreamEvent ev = v->stream->process_audio_chunk(chunk);
        v->cursor += static_cast<int64_t>(kChunk);
        translate(v, ev, out);
        return SK_OK;
    } catch (const std::exception &e) {
        sk::set_error(std::string("sk_vad_feed: ") + e.what());
        return SK_ERR_BACKEND;
    }
}

SK_API sk_status sk_vad_finalize(sk_vad *v, sk_vad_event *out) {
    clear(out);
    if (!v) { sk::set_error("sk_vad_finalize: vad is required"); return SK_ERR_INVALID_ARGUMENT; }
    try {
        rt::TaskResult result = v->stream->finalize();
        // finalize() returns every segment of the stream; the only one not yet reported is
        // a trailing segment that ends after the last END we emitted.
        for (const auto &seg : result.speech_segments) {
            if (seg.span.end_sample > v->last_end && seg.span.start_sample >= v->last_end) {
                if (out) { out->kind = SK_VAD_SPEECH_END; out->sample = seg.span.end_sample; out->probability = seg.confidence;
                           out->seg_start = seg.span.start_sample; out->seg_end = seg.span.end_sample; }
                v->last_end = seg.span.end_sample;
            }
        }
        v->stream->reset();
        v->cursor = 0; v->last_end = 0; v->in_speech = false;
        return SK_OK;
    } catch (const std::exception &e) {
        sk::set_error(std::string("sk_vad_finalize: ") + e.what());
        return SK_ERR_BACKEND;
    }
}

SK_API void sk_vad_reset(sk_vad *v) {
    if (!v) return;
    try { v->stream->reset(); } catch (const std::exception &) {}
    v->cursor = 0; v->last_end = 0; v->in_speech = false;
}

SK_API void sk_vad_close(sk_vad *v) {
    delete v;   // session before model: member order in the struct guarantees it
}

}  // extern "C"
