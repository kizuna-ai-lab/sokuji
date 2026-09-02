// Test-only WAV reader over dr_wav (from the fetched transcribe.cpp tree). 16 kHz mono only.
#pragma once
#define DR_WAV_IMPLEMENTATION
#include "dr_wav.h"
#include <cassert>
#include <vector>

static std::vector<float> read_wav_16k_mono(const char *path) {
    unsigned int channels = 0, rate = 0;
    drwav_uint64 frames = 0;
    float *data = drwav_open_file_and_read_pcm_frames_f32(path, &channels, &rate, &frames, NULL);
    assert(data != nullptr && "could not read the sample WAV");
    assert(channels == 1 && rate == 16000 && "test WAVs must be 16 kHz mono");
    std::vector<float> out(data, data + frames);
    drwav_free(data, NULL);
    return out;
}
