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

}  // namespace

std::string sk_op_spelling(const sk_op_desc &d, const char *weight) {
    std::string s = ggml_op_name(static_cast<ggml_op>(d.op)) + param_suffix(d) + "[";
    for (int i = 0; i < 5; ++i) { if (i) s += ","; s += type_name(d.src_type[i], weight); }
    return s + "]->" + type_name(d.dst_type, weight);
}

void sk_ops_add(std::vector<sk_op_desc> &nodes, const sk_op_desc &d) {
    for (auto &n : nodes) {
        if (!n.same_node(d)) continue;
        max_into(n.max_ne_src0, d.max_ne_src0); max_into(n.max_ne_src1, d.max_ne_src1); max_into(n.max_ne_dst, d.max_ne_dst);
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
    s += "# dtypes-in-file:"; for (const auto &t : r.dtypes_in_file) s += " " + t; s += "\n";
    for (const auto &d : r.nodes) {
        s += "op=" + std::string(ggml_op_name(static_cast<ggml_op>(d.op)));
        s += " params=" + hexparams(d);
        s += " dst=" + type_name(d.dst_type, nullptr);
        s += " src=["; for (int i = 0; i < 5; ++i) { if (i) s += ","; s += type_name(d.src_type[i], nullptr); } s += "]";
        s += " ne0=[" + std::to_string(d.ne0_src0) + "," + std::to_string(d.ne0_src1) + "," + std::to_string(d.ne0_dst) + "]";
        s += " max0=" + ne_str(d.max_ne_src0) + " max1=" + ne_str(d.max_ne_src1) + " maxd=" + ne_str(d.max_ne_dst);
        s += " contig=[" + std::to_string(d.contig_src0 ? 1 : 0) + "," + std::to_string(d.contig_src1 ? 1 : 0) + "]";
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
            else if (k == "contig") {
                int a = 1, b = 1;
                if (std::sscanf(v.c_str(), "[%d,%d]", &a, &b) != 2) return fail("bad contig");
                d.contig_src0 = a; d.contig_src1 = b;
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
