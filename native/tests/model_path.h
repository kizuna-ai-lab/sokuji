/* The test cache's model layout (native/README.md, "Test model directories"): every
 * SK_TEST_TTS_<X>_DIR holds ONE quant of one card, its main GGUF plus whatever companion files
 * that card stages beside it (per-quant components, a codec). The main GGUF is the LARGEST
 * .gguf directly inside the directory; ties go to the lexicographically first name, and
 * subdirectories are not searched. A path that already names a .gguf is returned as given; a
 * directory without one yields "". _main_gguf in python/tests/test_sokuji_native.py applies
 * the same rule. model_ggufs lists every GGUF a model path stands for. */
#pragma once
#include <algorithm>
#include <cstdint>
#include <filesystem>
#include <string>
#include <system_error>
#include <vector>

static std::string find_gguf(const std::string &path) {
    if (path.size() > 5 && path.compare(path.size() - 5, 5, ".gguf") == 0) return path;
    std::error_code ec;
    std::string best;
    std::uintmax_t best_size = 0;
    for (const auto &e : std::filesystem::directory_iterator(path, ec)) {
        if (e.path().extension() != ".gguf" || !e.is_regular_file(ec)) continue;
        const std::uintmax_t size = e.file_size(ec);
        if (ec) continue;
        const std::string p = e.path().string();
        if (best.empty() || size > best_size || (size == best_size && p < best)) {
            best = p;
            best_size = size;
        }
    }
    return best;
}

/* Every GGUF a model path stands for, sorted: a directory's .gguf files directly inside it (the
 * main one and the companions the card stages beside it; subdirectories not searched), or a path
 * naming a .gguf, that file alone. A file stands alone because the asr/translate test models are
 * single files in the cache root, beside unrelated models. */
static std::vector<std::string> model_ggufs(const std::string &path) {
    if (path.size() > 5 && path.compare(path.size() - 5, 5, ".gguf") == 0) return {path};
    std::error_code ec;
    std::vector<std::string> out;
    for (const auto &e : std::filesystem::directory_iterator(path, ec))
        if (e.path().extension() == ".gguf" && e.is_regular_file(ec)) out.push_back(e.path().string());
    std::sort(out.begin(), out.end());
    return out;
}
