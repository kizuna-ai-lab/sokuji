// resample(): a synchronous interleaved-float resampler over the vendored speexdsp
// (third_party/speexdsp, quality 10), the replacement for the soxr call the engine used.
#include "addon.h"
#include "args.h"

#include <napi.h>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

// resample.c is compiled with RANDOM_PREFIX=sokuji, which renames every public symbol.
#include "../third_party/speexdsp/speex_resampler.h"

namespace sk_node {
namespace {

constexpr int kQuality = 10;   // SPEEX_RESAMPLER_QUALITY_MAX

// An integer >= 1 that fits int32: a non-number or non-integer is a TypeError, below 1 a RangeError.
int32_t PositiveIntArg(const Napi::CallbackInfo &info, size_t i, const char *name) {
    const int32_t v = IndexArg(info, i, name);
    if (v < 1) throw Napi::RangeError::New(info.Env(), std::string(name) + " must be at least 1");
    return v;
}

struct ResamplerDeleter {
    void operator()(SpeexResamplerState *st) const { sokuji_resampler_destroy(st); }
};

Napi::Value Resample(const Napi::CallbackInfo &info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsTypedArray() ||
        info[0].As<Napi::TypedArray>().TypedArrayType() != napi_float32_array) {
        throw Napi::TypeError::New(env, "pcm must be a Float32Array");
    }
    Napi::Float32Array pcm = info[0].As<Napi::Float32Array>();
    const uint32_t channels = static_cast<uint32_t>(PositiveIntArg(info, 1, "channels"));
    const uint32_t from_rate = static_cast<uint32_t>(PositiveIntArg(info, 2, "fromRate"));
    const uint32_t to_rate = static_cast<uint32_t>(PositiveIntArg(info, 3, "toRate"));
    const size_t samples = pcm.ElementLength();
    if (samples % channels != 0) {
        throw Napi::Error::New(env, "pcm length (" + std::to_string(samples) +
                                    ") must be a multiple of channels (" + std::to_string(channels) + ")");
    }
    const size_t frames = samples / channels;

    // Output frames: round(frames * to / from), half up, exact in integers.
    const uint64_t out_frames =
        (static_cast<uint64_t>(frames) * to_rate * 2 + from_rate) / (static_cast<uint64_t>(from_rate) * 2);
    Napi::Float32Array out = Napi::Float32Array::New(env, static_cast<size_t>(out_frames) * channels);
    if (from_rate == to_rate || frames == 0) {
        if (samples > 0) std::memcpy(out.Data(), pcm.Data(), samples * sizeof(float));
        return out;
    }

    int err = 0;
    std::unique_ptr<SpeexResamplerState, ResamplerDeleter> st(
        sokuji_resampler_init(channels, from_rate, to_rate, kQuality, &err));
    if (!st || err != 0) {
        throw Napi::Error::New(env, std::string("resample: ") + sokuji_resampler_strerror(err));
    }

    // The filter delays its output by input_latency frames. skip_zeros drops that delay at the
    // start (the output begins at the first input sample); feeding that many zeros after the
    // signal pushes the tail out, and the output is cut to the rule's length.
    sokuji_resampler_skip_zeros(st.get());
    const size_t latency = static_cast<size_t>(sokuji_resampler_get_input_latency(st.get()));
    std::vector<float> in(pcm.Data(), pcm.Data() + samples);
    in.resize((frames + latency) * channels, 0.0f);
    const size_t in_frames = frames + latency;
    // Capacity with slack: speexdsp may emit a frame or two beyond the exact ratio.
    const size_t cap_frames = static_cast<size_t>(
        (static_cast<uint64_t>(in_frames) * to_rate + from_rate - 1) / from_rate) + 16;
    std::vector<float> res(cap_frames * channels, 0.0f);

    spx_uint32_t in_len = static_cast<spx_uint32_t>(in_frames);
    spx_uint32_t out_len = static_cast<spx_uint32_t>(cap_frames);
    const int rc = sokuji_resampler_process_interleaved_float(st.get(), in.data(), &in_len, res.data(), &out_len);
    if (rc != 0 || in_len != in_frames) {
        throw Napi::Error::New(env, std::string("resample: ") + sokuji_resampler_strerror(rc != 0 ? rc : 1));
    }
    // Normally out_len >= out_frames; any shortfall stays the zeros the buffer started with.
    const size_t n = std::min(static_cast<size_t>(out_len), static_cast<size_t>(out_frames)) * channels;
    std::memcpy(out.Data(), res.data(), n * sizeof(float));
    return out;
}

}  // namespace

void RegisterResample(Napi::Env env, Napi::Object exports) {
    exports.Set("resample", Napi::Function::New(env, Resample, "resample"));
}

}  // namespace sk_node
