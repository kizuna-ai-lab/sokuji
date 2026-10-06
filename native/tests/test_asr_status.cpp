// Which transcribe.cpp run statuses still leave a readable transcript (sk_asr_status.h).
// Pure: no model, no backend.
#undef NDEBUG   // every native test does this: the lanes build Release, and assert() is the test
#include <cassert>
#include <cstdio>
#include "sk_asr_status.h"

int main() {
    assert(sk::asr_result_bearing(TRANSCRIBE_OK));
    assert(sk::asr_result_bearing(TRANSCRIBE_ERR_OUTPUT_TRUNCATED));
    // transcribe.cpp 0.3.0 (#166): a looping decode is stopped early with the repeats dropped;
    // the partial transcript stays readable exactly as for OUTPUT_TRUNCATED.
    assert(sk::asr_result_bearing(TRANSCRIBE_ERR_OUTPUT_REPETITION));
    assert(!sk::asr_result_bearing(TRANSCRIBE_ERR_ABORTED));
    assert(!sk::asr_result_bearing(TRANSCRIBE_ERR_BACKEND));
    assert(!sk::asr_result_bearing(TRANSCRIBE_ERR_INVALID_ARG));
    std::puts("test_asr_status: ok");
    return 0;
}
