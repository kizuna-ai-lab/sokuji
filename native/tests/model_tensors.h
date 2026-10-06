/* The tensors an op recording is taken against: the names and matrix-tensor dtypes of every GGUF
 * a model path stands for (model_ggufs: a directory's main GGUF and the companions staged beside
 * it, or one named file). `# dtypes-in-file:` is that union of matrix dtypes (ggml_n_dims >= 2),
 * the set WEIGHT expands over, as accel.weight_dtypes unions a rung's main and companion GGUFs;
 * the recorder refuses a WEIGHT whose dtype is outside it (owner's ruling 2026-10-06,
 * op-coverage precision). `names` lists every tensor of every file, so a named companion weight
 * is detected as WEIGHT the way a main-file one is. */
#pragma once
#include <cstdio>
#include <set>
#include <string>
#include <vector>
#include "gguf.h"
#include "ggml.h"
#include "model_path.h"

/* Appends to `names` and `matrix_dtypes`; false (with a stderr line) when the path holds no GGUF
 * or one cannot be read. */
static bool model_tensors(const std::string &path, std::vector<std::string> &names,
                          std::set<std::string> &matrix_dtypes) {
    const std::vector<std::string> files = model_ggufs(path);
    if (files.empty()) { std::fprintf(stderr, "model_tensors: no .gguf in %s\n", path.c_str()); return false; }
    for (const std::string &file : files) {
        ggml_context *meta = nullptr;
        gguf_init_params ip = { /*no_alloc*/ true, /*ctx*/ &meta };
        gguf_context *g = gguf_init_from_file(file.c_str(), ip);
        if (!g) { std::fprintf(stderr, "model_tensors: cannot read %s\n", file.c_str()); return false; }
        bool ok = true;
        for (int64_t i = 0; i < gguf_get_n_tensors(g) && ok; ++i) {
            const char *name = gguf_get_tensor_name(g, i);
            names.push_back(name);
            const ggml_tensor *t = ggml_get_tensor(meta, name);
            if (!t) { std::fprintf(stderr, "model_tensors: no tensor %s in %s's metadata\n", name, file.c_str()); ok = false; }
            else if (ggml_n_dims(t) >= 2) matrix_dtypes.insert(ggml_type_name(gguf_get_tensor_type(g, i)));
        }
        ggml_free(meta);
        gguf_free(g);
        if (!ok) return false;
    }
    return true;
}
