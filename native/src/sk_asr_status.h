#pragma once
// Which transcribe.cpp run statuses still leave a readable transcript in the session.
#include "transcribe.h"

namespace sk {

// OUTPUT_TRUNCATED: the decode budget ran out. OUTPUT_REPETITION (transcribe.cpp 0.3.0, #166):
// the repetition guard stopped a looping decode and dropped the repeats. Both keep the partial
// transcript readable, so sk_asr returns it rather than failing the run.
inline bool asr_result_bearing(transcribe_status st) {
    return st == TRANSCRIBE_OK || st == TRANSCRIBE_ERR_OUTPUT_TRUNCATED ||
           st == TRANSCRIBE_ERR_OUTPUT_REPETITION;
}

}  // namespace sk
