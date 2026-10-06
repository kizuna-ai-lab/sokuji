// The test cache's main-GGUF rule (model_path.h) on a scratch directory: the largest .gguf
// directly inside wins, ties go to the first name, subdirectories and other extensions are
// ignored, a path naming a .gguf comes back unchanged, and a directory without one yields "".
// model_ggufs lists every GGUF the path stands for.
#undef NDEBUG
#include <cassert>
#include <chrono>
#include <cstdio>
#include <fstream>
#include <string>
#include <vector>
#include "model_path.h"

namespace fs = std::filesystem;

static void write_bytes(const fs::path &p, size_t n) {
    std::ofstream f(p, std::ios::binary);
    const std::string s(n, '\0');
    f.write(s.data(), static_cast<std::streamsize>(s.size()));
}

static std::string name_of(const std::string &p) { return fs::path(p).filename().string(); }

int main() {
    const auto stamp = std::chrono::steady_clock::now().time_since_epoch().count();
    const fs::path root = fs::temp_directory_path() / ("sk-model-path-" + std::to_string(stamp));
    fs::remove_all(root);
    fs::create_directories(root / "codec");

    // LFM2.5-Audio's shape: the backbone and its three per-quant components side by side.
    write_bytes(root / "mmproj-model-Q8_0.gguf", 300);
    write_bytes(root / "vocoder-model-Q8_0.gguf", 200);
    write_bytes(root / "tokenizer-model-Q8_0.gguf", 80);
    write_bytes(root / "model-Q8_0.gguf", 1200);
    write_bytes(root / "README.md", 5000);                   // larger, but not a .gguf
    write_bytes(root / "codec" / "codec-q8_0.gguf", 9000);   // larger, but in a subdirectory
    assert(name_of(find_gguf(root.string())) == "model-Q8_0.gguf");

    // A path that already names a .gguf comes back as given, even a companion's.
    const std::string companion = (root / "vocoder-model-Q8_0.gguf").string();
    assert(find_gguf(companion) == companion);

    // Ties go to the first name, whatever order the directory lists them in.
    fs::create_directories(root / "tie");
    write_bytes(root / "tie" / "b.gguf", 64);
    write_bytes(root / "tie" / "a.gguf", 64);
    assert(name_of(find_gguf((root / "tie").string())) == "a.gguf");

    // Nothing to find: "", and the caller reports it.
    fs::create_directories(root / "empty");
    assert(find_gguf((root / "empty").string()).empty());

    // Every GGUF a model path stands for: a directory's .gguf files directly inside it, sorted
    // (the main one and its companions); a path naming a .gguf, that file alone, since an
    // asr/translate test model is one file in the cache root beside unrelated models.
    const std::vector<std::string> all = model_ggufs(root.string());
    assert(all.size() == 4);
    assert(name_of(all[0]) == "mmproj-model-Q8_0.gguf" && name_of(all[1]) == "model-Q8_0.gguf" &&
           name_of(all[2]) == "tokenizer-model-Q8_0.gguf" && name_of(all[3]) == "vocoder-model-Q8_0.gguf");
    assert(model_ggufs(companion) == std::vector<std::string>{companion});
    assert(model_ggufs((root / "empty").string()).empty());

    fs::remove_all(root);
    std::puts("test_model_path ok");
    return 0;
}
