/* The .ops text form (spec A §3.2). Pure: ggml's name tables are the only thing it touches,
 * so it compiles into the library and, unchanged, straight into the test binaries. */
#include "sk_ops.h"
#include "ggml.h"

#include <algorithm>
#include <cctype>
#include <cstdio>
#include <cstring>
#include <sstream>
#include <stdexcept>

namespace {

int32_t type_from_name(const std::string &s) {
    if (s == "-") return SK_SRC_ABSENT;
    if (s == "WEIGHT") return SK_SRC_WEIGHT;
    for (int t = 0; t < GGML_TYPE_COUNT; ++t) {
        const char *n = ggml_type_name(static_cast<ggml_type>(t));
        if (n && s == n) return t;
    }
    return -100;
}
std::string type_name(int32_t t, const char *weight) {
    if (t == SK_SRC_ABSENT) return "-";
    if (t == SK_SRC_WEIGHT) return weight ? weight : "WEIGHT";
    return ggml_type_name(static_cast<ggml_type>(t));
}
int32_t op_from_name(const std::string &s) {
    for (int o = 0; o < GGML_OP_COUNT; ++o) if (s == ggml_op_name(static_cast<ggml_op>(o))) return o;
    return -1;
}
std::string param_suffix(const sk_op_desc &d) {
    if (d.op == GGML_OP_UNARY) return std::string(".") + ggml_unary_op_name(static_cast<ggml_unary_op>(d.op_params[0]));
    if (d.op == GGML_OP_GLU)   return std::string(".") + ggml_glu_op_name(static_cast<ggml_glu_op>(d.op_params[0]));
    if (d.op == GGML_OP_ROPE)  return ".mode" + std::to_string(d.op_params[2]);
    return "";
}
std::string ne_str(const std::array<int64_t, 4> &a) {
    return "[" + std::to_string(a[0]) + "," + std::to_string(a[1]) + "," + std::to_string(a[2]) + "," + std::to_string(a[3]) + "]";
}
bool parse_ne(const std::string &s, std::array<int64_t, 4> &out) {
    long long a = 0, b = 0, c = 0, e = 0;
    if (std::sscanf(s.c_str(), "[%lld,%lld,%lld,%lld]", &a, &b, &c, &e) != 4) return false;
    out = {a, b, c, e};
    return true;
}
std::string hexparams(const sk_op_desc &d) {
    bool any = false; for (int v : d.op_params) any |= v != 0;
    if (!any) return "-";
    char buf[16]; std::string s;
    for (int v : d.op_params) { std::snprintf(buf, sizeof buf, "%08x", static_cast<uint32_t>(v)); s += buf; }
    return s;
}
/* Hardened against a garbage payload: every caller trusts this bool + error contract, and
 * sk_device_supports_ops parses a shipped .ops file at first use — a bad field must never
 * throw std::invalid_argument/std::out_of_range through it. */
bool parse_params(const std::string &s, std::array<int32_t, 16> &out) {
    out.fill(0);
    if (s == "-") return true;
    if (s.size() != 16 * 8) return false;
    for (int i = 0; i < 16; ++i) {
        const std::string chunk = s.substr(i * 8, 8);
        if (!std::all_of(chunk.begin(), chunk.end(), [](unsigned char c) { return std::isxdigit(c) != 0; })) return false;
        try {
            out[i] = static_cast<int32_t>(std::stoul(chunk, nullptr, 16));
        } catch (const std::exception &) {
            return false;
        }
    }
    return true;
}
void max_into(std::array<int64_t, 4> &a, const std::array<int64_t, 4> &b) { for (int i = 0; i < 4; ++i) a[i] = std::max(a[i], b[i]); }

/* "<p0><p1><p2><p3><d|s>", e.g. "0123d" contiguous, "1023d" transposed, "0213d" a
 * row-contiguous permute, "0123s" a strided view. */
std::string layout_str(const sk_layout &l) {
    std::string s;
    for (int k = 0; k < 4; ++k) s += static_cast<char>('0' + l.perm[k]);
    s += l.dense ? 'd' : 's';
    return s;
}
bool parse_layout(const std::string &s, sk_layout &out) {
    if (s.size() != 5) return false;
    bool seen[4] = {false, false, false, false};
    for (int k = 0; k < 4; ++k) {
        if (s[k] < '0' || s[k] > '3') return false;
        const int a = s[k] - '0';
        if (seen[a]) return false;                    // must be a permutation
        seen[a] = true;
        out.perm[k] = a;
    }
    if (s[4] != 'd' && s[4] != 's') return false;
    out.dense = s[4] == 'd';
    return true;
}

}  // namespace

std::array<int64_t, 4> sk_layout_dense_nb(const std::array<int32_t, 4> &perm,
                                          const std::array<int64_t, 4> &ne, int32_t type) {
    const ggml_type t = static_cast<ggml_type>(type);
    std::array<int64_t, 4> nb{0, 0, 0, 0};
    int64_t acc = static_cast<int64_t>(ggml_type_size(t));
    for (int k = 0; k < 4; ++k) {
        const int a = perm[k];
        if (a < 0 || a > 3) return {0, 0, 0, 0};
        nb[a] = acc;
        // ggml's own rule: the innermost axis advances by one BLOCK per blck_size elements.
        acc *= (k == 0) ? (ne[a] / static_cast<int64_t>(ggml_blck_size(t))) : ne[a];
    }
    return nb;
}

sk_layout sk_layout_of(const ggml_tensor *t) {
    sk_layout l;
    if (!t) return l;
    std::array<int64_t, 4> ne{t->ne[0], t->ne[1], t->ne[2], t->ne[3]}, nb{
        static_cast<int64_t>(t->nb[0]), static_cast<int64_t>(t->nb[1]),
        static_cast<int64_t>(t->nb[2]), static_cast<int64_t>(t->nb[3])};
    // Axis order by ascending stride. Ties (an axis of extent 1 shares its neighbour's stride)
    // break by axis index, so the natural order wins whenever it can — a tensor ggml itself
    // would call contiguous never records as permuted.
    std::array<int32_t, 4> perm{0, 1, 2, 3};
    std::stable_sort(perm.begin(), perm.end(), [&](int32_t a, int32_t b) { return nb[a] < nb[b]; });
    l.perm = perm;
    l.nb = nb;
    l.dense = sk_layout_dense_nb(perm, ne, t->type) == nb;
    return l;
}

std::string sk_op_spelling(const sk_op_desc &d, const char *weight) {
    std::string s = ggml_op_name(static_cast<ggml_op>(d.op)) + param_suffix(d) + "[";
    for (int i = 0; i < 5; ++i) { if (i) s += ","; s += type_name(d.src_type[i], weight); }
    return s + "]->" + type_name(d.dst_type, weight);
}

void sk_ops_add(std::vector<sk_op_desc> &nodes, const sk_op_desc &d) {
    for (auto &n : nodes) {
        if (!n.same_node(d)) continue;
        max_into(n.max_ne_src0, d.max_ne_src0); max_into(n.max_ne_src1, d.max_ne_src1); max_into(n.max_ne_dst, d.max_ne_dst);
        max_into(n.lay_src0.nb, d.lay_src0.nb); max_into(n.lay_src1.nb, d.lay_src1.nb); max_into(n.lay_dst.nb, d.lay_dst.nb);
        n.max_bytes = std::max(n.max_bytes, d.max_bytes);
        return;
    }
    nodes.push_back(d);
}

std::string sk_ops_format(const sk_op_recording &r) {
    std::string s;
    s += "# stage: " + r.stage + " ; family: " + r.family + "\n";
    s += "# engine: " + r.engine + "\n";
    s += "# source: " + r.source_file + "\n";
    s += "# recorded-on: " + (r.recorded_on.empty() ? std::string("cpu") : r.recorded_on) + "\n";
    s += "# dtypes-in-file:"; for (const auto &t : r.dtypes_in_file) s += " " + t; s += "\n";
    for (const auto &d : r.nodes) {
        s += "op=" + std::string(ggml_op_name(static_cast<ggml_op>(d.op)));
        s += " params=" + hexparams(d);
        s += " dst=" + type_name(d.dst_type, nullptr);
        s += " src=["; for (int i = 0; i < 5; ++i) { if (i) s += ","; s += type_name(d.src_type[i], nullptr); } s += "]";
        s += " ne0=[" + std::to_string(d.ne0_src0) + "," + std::to_string(d.ne0_src1) + "," + std::to_string(d.ne0_dst) + "]";
        s += " max0=" + ne_str(d.max_ne_src0) + " max1=" + ne_str(d.max_ne_src1) + " maxd=" + ne_str(d.max_ne_dst);
        s += " layout=[" + layout_str(d.lay_src0) + "," + layout_str(d.lay_src1) + "," + layout_str(d.lay_dst) + "]";
        // Strides only where they are not implied by perm + ne.
        if (!d.lay_src0.dense) s += " nb0=" + ne_str(d.lay_src0.nb);
        if (!d.lay_src1.dense) s += " nb1=" + ne_str(d.lay_src1.nb);
        if (!d.lay_dst.dense)  s += " nbd=" + ne_str(d.lay_dst.nb);
        s += " host=" + std::to_string(d.host ? 1 : 0);
        s += " maxbytes=" + std::to_string(d.max_bytes) + "\n";
    }
    return s;
}

bool sk_ops_parse(const std::string &text, sk_op_recording &out, std::string &error) {
    out = sk_op_recording{};
    std::istringstream in(text);
    std::string line; int lineno = 0;
    auto fail = [&](const std::string &m) { error = "line " + std::to_string(lineno) + ": " + m; return false; };
    while (std::getline(in, line)) {
        ++lineno;
        if (line.empty()) continue;
        if (line[0] == '#') {
            if (line.rfind("# stage: ", 0) == 0) {
                auto semi = line.find(" ; family: ");
                if (semi == std::string::npos) return fail("bad stage/family header");
                out.stage = line.substr(9, semi - 9); out.family = line.substr(semi + 11);
            } else if (line.rfind("# engine: ", 0) == 0) out.engine = line.substr(10);
            else if (line.rfind("# source: ", 0) == 0) out.source_file = line.substr(10);
            else if (line.rfind("# recorded-on: ", 0) == 0) out.recorded_on = line.substr(15);
            else if (line.rfind("# dtypes-in-file:", 0) == 0) {
                std::istringstream ts(line.substr(17)); std::string t;
                while (ts >> t) out.dtypes_in_file.push_back(t);
            }
            continue;
        }
        sk_op_desc d{};
        std::istringstream fs(line); std::string kv; int seen = 0;
        while (fs >> kv) {
            auto eq = kv.find('='); if (eq == std::string::npos) return fail("bad field " + kv);
            std::string k = kv.substr(0, eq), v = kv.substr(eq + 1);
            if (k == "op") { d.op = op_from_name(v); if (d.op < 0) return fail("unknown op " + v); ++seen; }
            else if (k == "params") { if (!parse_params(v, d.op_params)) return fail("bad params"); }
            else if (k == "dst") { d.dst_type = type_from_name(v); if (d.dst_type == -100) return fail("bad dst type " + v); ++seen; }
            else if (k == "src") {
                if (v.size() < 2 || v.front() != '[' || v.back() != ']') return fail("bad src list");
                std::istringstream ss(v.substr(1, v.size() - 2)); std::string t; int i = 0;
                while (std::getline(ss, t, ',') && i < 5) { d.src_type[i] = type_from_name(t); if (d.src_type[i] == -100) return fail("bad src type " + t); ++i; }
            }
            else if (k == "ne0") { long long a = 1, b = 1, c = 1; if (std::sscanf(v.c_str(), "[%lld,%lld,%lld]", &a, &b, &c) != 3) return fail("bad ne0"); d.ne0_src0 = a; d.ne0_src1 = b; d.ne0_dst = c; }
            else if (k == "max0") { if (!parse_ne(v, d.max_ne_src0)) return fail("bad max0"); }
            else if (k == "max1") { if (!parse_ne(v, d.max_ne_src1)) return fail("bad max1"); }
            else if (k == "maxd") { if (!parse_ne(v, d.max_ne_dst)) return fail("bad maxd"); }
            /* `contig=` (the round-1 field) is deliberately NOT accepted: it falls through to
             * the unknown-field branch below, so a stale .ops file fails loudly instead of
             * being read with default layouts. */
            else if (k == "layout") {
                if (v.size() != 1 + 5 + 1 + 5 + 1 + 5 + 1 || v.front() != '[' || v.back() != ']') return fail("bad layout list");
                if (!parse_layout(v.substr(1, 5), d.lay_src0)) return fail("bad layout src0");
                if (v[6] != ',' || v[12] != ',') return fail("bad layout list");
                if (!parse_layout(v.substr(7, 5), d.lay_src1)) return fail("bad layout src1");
                if (!parse_layout(v.substr(13, 5), d.lay_dst)) return fail("bad layout dst");
            }
            else if (k == "nb0") { if (!parse_ne(v, d.lay_src0.nb)) return fail("bad nb0"); }
            else if (k == "nb1") { if (!parse_ne(v, d.lay_src1.nb)) return fail("bad nb1"); }
            else if (k == "nbd") { if (!parse_ne(v, d.lay_dst.nb)) return fail("bad nbd"); }
            else if (k == "host") {
                if (v != "0" && v != "1") return fail("bad host");
                d.host = v == "1";
            }
            else if (k == "maxbytes") {
                if (v.empty() || !std::all_of(v.begin(), v.end(), [](unsigned char c) { return std::isdigit(c) != 0; })) return fail("bad maxbytes");
                try {
                    d.max_bytes = std::stoull(v);
                } catch (const std::exception &) {
                    return fail("bad maxbytes");
                }
            }
            else return fail("unknown field " + k);
        }
        if (seen < 2) return fail("op and dst are required");
        sk_ops_add(out.nodes, d);
    }
    return true;
}
