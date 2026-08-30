// Slice-2 VAD surface test. No download: the silero weights ship in the audio.cpp tree and
// are installed next to the library; the test points at the source copy explicitly.
#undef NDEBUG
#include <cassert>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>
#include "sokuji_native.h"
#include "wav.h"

int main(int argc, char **argv) {
    const char *module_dir = argc > 1 ? argv[1] : ".";

    sk_vad *before = nullptr;
    assert(sk_vad_open(nullptr, &before) == SK_ERR_NOT_INITIALISED);
    assert(before == nullptr);

    sk_init_options opts = {};
    opts.abi_version = SK_ABI_VERSION;
    opts.n_threads = 2;
    opts.module_dir = module_dir;
    assert(sk_init(&opts) == SK_OK);

    sk_vad_options bad = {};
    bad.weights = "/nonexistent/silero.safetensors";
    sk_vad *v = nullptr;
    assert(sk_vad_open(&bad, &v) == SK_ERR_BACKEND);
    assert(v == nullptr && std::strstr(sk_last_error(), "sk_vad_open") != nullptr);

    sk_vad_options o = {};
    o.weights = SK_TEST_VAD_WEIGHTS;                 // the source-tree copy
    o.min_silence_ms = 500;                          // the sidecar's values (sherpa defaults)
    o.min_speech_ms = 250;
    o.speech_pad_ms = -1;
    assert(sk_vad_open(&o, &v) == SK_OK && v != nullptr);

    std::vector<float> jfk = read_wav_16k_mono(SK_TEST_SAMPLE_WAV);
    float wrong[100] = {};
    sk_vad_event ev = {};
    (void)wrong;                                       // (the C ABI takes pcm512; a short buffer is UB, not tested)

    int starts = 0, ends = 0;
    int64_t last_end = -1, first_start = -1;
    for (size_t off = 0; off + 512 <= jfk.size(); off += 512) {
        assert(sk_vad_feed(v, jfk.data() + off, &ev) == SK_OK);
        if (ev.kind == SK_VAD_SPEECH_START) { ++starts; if (first_start < 0) first_start = ev.sample; }
        if (ev.kind == SK_VAD_SPEECH_END) {
            ++ends;
            assert(ev.seg_end > ev.seg_start && ev.seg_end <= static_cast<int64_t>(off + 512));
            assert(ev.seg_start >= last_end);            // segments never overlap or go backwards
            last_end = ev.seg_end;
        }
    }
    sk_vad_event tail = {};
    assert(sk_vad_finalize(v, &tail) == SK_OK);        // closes a trailing open segment, if any
    if (tail.kind == SK_VAD_SPEECH_END) ++ends;
    std::printf("test_vad: %d starts, %d ends, first start at sample %lld\n", starts, ends, static_cast<long long>(first_start));
    assert(starts >= 1 && ends >= 1 && ends <= starts);
    assert(first_start >= 0 && first_start < 16000 * 2);   // JFK starts speaking within the first 2 s

    // reset: the same audio again yields the same first start
    sk_vad_reset(v);
    int64_t first_again = -1;
    for (size_t off = 0; off + 512 <= jfk.size() && first_again < 0; off += 512) {
        assert(sk_vad_feed(v, jfk.data() + off, &ev) == SK_OK);
        if (ev.kind == SK_VAD_SPEECH_START) first_again = ev.sample;
    }
    assert(first_again == first_start);

    // speech_pad_ms = 0: the one asymmetric default rule (< 0 = default 30 ms pad, 0 = no
    // pad, a valid value in its own right). Same weights and other options as `o`.
    sk_vad_options o0 = o;
    o0.speech_pad_ms = 0;
    sk_vad *v0 = nullptr;
    assert(sk_vad_open(&o0, &v0) == SK_OK && v0 != nullptr);
    int64_t first_pad0 = -1;
    sk_vad_event ev0 = {};
    for (size_t off = 0; off + 512 <= jfk.size() && first_pad0 < 0; off += 512) {
        assert(sk_vad_feed(v0, jfk.data() + off, &ev0) == SK_OK);
        if (ev0.kind == SK_VAD_SPEECH_START) first_pad0 = ev0.sample;
    }
    assert(first_pad0 > first_start);                  // no pad subtracted -> a later reported start
    assert(first_pad0 - first_start <= 512 + 480);      // pad-30 subtracts 480 samples; tolerate one chunk
    sk_vad_close(v0);

    assert(sk_vad_feed(nullptr, jfk.data(), &ev) == SK_ERR_INVALID_ARGUMENT);
    sk_vad_close(v);
    sk_vad_close(nullptr);

    sk_vad *dflt = nullptr;                             // NULL weights: next to the library — only the stage has it
    sk_status rc = sk_vad_open(nullptr, &dflt);
    std::printf("test_vad: default-weights open -> %d (%s)\n", rc, rc == SK_OK ? "found next to the library" : sk_last_error());
    if (rc == SK_OK) sk_vad_close(dflt);
    return 0;
}
