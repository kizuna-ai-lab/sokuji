/* record_ops <module_dir> <stage> <family> <model-dir-or-gguf> <out.ops> <supertonic-dir> [flash_attn 0|1|2]
 * asr/translate run on the recording device (registered before sk_init); tts runs on the CPU
 * device with the audio.cpp shim. Records ONE forward pass and writes the .ops file. */
#undef NDEBUG
#include <cassert>
#include <cstdlib>
#include "record_common.h"

int main(int argc, char **argv) {
    if (argc < 7) { std::fprintf(stderr, "usage: record_ops <module_dir> <stage> <family> <model> <out.ops> <supertonic-dir> [flash_attn]\n"); return 2; }
    const std::string stage = argv[2], family = argv[3], model = argv[4], out = argv[5], supertonic = argv[6];
    const int32_t fa = argc > 7 ? std::atoi(argv[7]) : 0;
    sk_record_register_device();                                   // BEFORE sk_init: first call wins
    sk_init_options opts = {}; opts.abi_version = SK_ABI_VERSION; opts.n_threads = 4; opts.module_dir = argv[1];
    assert(sk_init(&opts) == SK_OK);
    sk_device devs[16]; const int n = sk_devices(devs, 16);
    const sk_device *cpu = nullptr, *rec = nullptr;
    for (int i = 0; i < n; ++i) {
        if (devs[i].kind == SK_DEVICE_CPU) cpu = &devs[i];
        if (std::strcmp(devs[i].name, "SKREC0") == 0) rec = &devs[i];
    }
    assert(cpu && rec);
    const int count = record_family(stage, family, model, stage == "tts" ? cpu : rec, out, fa, supertonic);
    std::printf("record_ops: %d nodes -> %s\n", count, out.c_str());
    return count > 0 ? 0 : 1;
}
