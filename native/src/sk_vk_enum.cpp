#include "sk_vk_enum.h"
#include "sk_internal.h"

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <sstream>

namespace {

// VkPhysicalDeviceType / VkDriverId numeric values (vulkan_core.h); literals so the pure
// selection compiles without the headers on every lane.
constexpr int32_t kTypeIntegrated = 1, kTypeDiscrete = 2, kTypeCpu = 4;
constexpr int32_t kAmdProprietary = 1, kAmdOpenSource = 2, kMesaRadv = 3, kNvidiaProprietary = 4,
                  kIntelProprietaryWindows = 5, kIntelOpenSourceMesa = 6, kQualcommProprietary = 12,
                  kMoltenVk = 14, kMesaTurnip = 18, kMesaDozen = 23, kMesaNvk = 24;

/* PINNED to ggml v0.22.0 ggml-vulkan.cpp ggml_vk_instance_init's driver priorities (~7515-7545):
 * lower is better. Re-check on every ggml pin bump (native/README.md).
 * ggml builds this table per duplicate pair, keyed on the OLD device's vendorID (only the
 * matching vendor's rows exist, plus Dozen); flattening it is equivalent here because a
 * duplicate pair is one physical GPU, hence one vendor. */
int priority(int32_t driver_id) {
    switch (driver_id) {
        case kMesaRadv:                return 1;
        case kAmdOpenSource:           return 2;
        case kAmdProprietary:          return 3;
        case kIntelOpenSourceMesa:     return 1;
        case kIntelProprietaryWindows: return 2;
        case kNvidiaProprietary:       return 1;
        case kMesaNvk:                 return 2;
        case kQualcommProprietary:     return 1;
        case kMesaTurnip:              return 2;
        case kMesaDozen:               return 100;
        default:                       return INT32_MAX;   // ggml: an unknown driver loses even to Dozen
    }
}

}  // namespace

std::vector<size_t> sk_vk_select_like_ggml(const std::vector<sk_vk_record> &raw, const char *visible_env) {
    std::vector<size_t> out;
    if (visible_env && *visible_env) {
        std::stringstream ss(visible_env);
        std::string tok;
        while (std::getline(ss, tok, ',')) {
            char *end = nullptr;
            long v = std::strtol(tok.c_str(), &end, 10);
            if (end != tok.c_str() && v >= 0 && static_cast<size_t>(v) < raw.size()) out.push_back(static_cast<size_t>(v));
        }
        return out;
    }
    std::vector<size_t> eligible;
    for (size_t i = 0; i < raw.size(); ++i) {
        const auto &r = raw[i];
        if ((r.device_type == kTypeDiscrete || r.device_type == kTypeIntegrated) && r.storage16) eligible.push_back(i);
    }
    /* ggml_vk_instance_init's dedup, ORDER INCLUDED: a duplicate that wins on driver priority
     * ERASES the loser and is APPENDED at the end (not swapped in place); a duplicate that
     * loses is skipped. Ordinals must match ggml's or the positional profile match degrades
     * every Vulkan device to known=0. */
    std::vector<size_t> kept;
    for (size_t i : eligible) {
        bool skip = false;
        for (auto it = kept.begin(); it != kept.end(); ++it) {
            const auto &a = raw[*it], &b = raw[i];
            const bool same = (!a.uuid_hex.empty() && a.uuid_hex == b.uuid_hex) ||
                              (a.luid_valid && b.luid_valid && a.luid_hex == b.luid_hex);
            const bool both_moltenvk = a.driver_id == kMoltenVk && b.driver_id == kMoltenVk;
            if (same && !both_moltenvk) {
                if (priority(b.driver_id) < priority(a.driver_id)) { kept.erase(it); kept.push_back(i); }
                skip = true;
                break;
            }
        }
        if (!skip) kept.push_back(i);
    }
    if (!kept.empty()) return kept;
    for (size_t i = 0; i < raw.size(); ++i) if (raw[i].device_type != kTypeCpu) return {i};
    return {};
}

#if !defined(SK_VK_ENUM_NO_LOADER) && defined(SK_HAVE_VULKAN_HEADERS)
#include <vulkan/vulkan.h>
/* The pinned Vulkan-Headers (v1.4.311) must win over any system copy — jammy's are 1.3.204,
 * and VkPhysicalDeviceShaderBfloat16FeaturesKHR / VkPhysicalDeviceCooperativeMatrix2FeaturesNV
 * below arrived in 1.4.304. A wrong include order fails here, not on a user's device. */
static_assert(VK_HEADER_VERSION >= 311, "Vulkan headers older than the pinned v1.4.311");

#if defined(_WIN32)
#  include <windows.h>
#else
#  include <dlfcn.h>
#endif

namespace {

struct Loader {
    void *handle = nullptr;
    PFN_vkGetInstanceProcAddr gipa = nullptr;
    bool open() {
#if defined(_WIN32)
        HMODULE h = LoadLibraryW(L"vulkan-1.dll");
        if (!h) return false;
        handle = h;
        gipa = reinterpret_cast<PFN_vkGetInstanceProcAddr>(GetProcAddress(h, "vkGetInstanceProcAddr"));
#else
        handle = dlopen("libvulkan.so.1", RTLD_NOW | RTLD_LOCAL);
        if (!handle) return false;
        gipa = reinterpret_cast<PFN_vkGetInstanceProcAddr>(dlsym(handle, "vkGetInstanceProcAddr"));
#endif
        return gipa != nullptr;
    }
    template <class F> F get(VkInstance inst, const char *name) { return reinterpret_cast<F>(gipa(inst, name)); }
    ~Loader() {
#if defined(_WIN32)
        if (handle) FreeLibrary(static_cast<HMODULE>(handle));
#else
        if (handle) dlclose(handle);
#endif
    }
};

std::string hex(const uint8_t *p, size_t n) {
    static const char *d = "0123456789abcdef";
    std::string s; s.reserve(n * 2);
    for (size_t i = 0; i < n; ++i) { s += d[p[i] >> 4]; s += d[p[i] & 15]; }
    return s;
}

bool has_ext(const std::vector<VkExtensionProperties> &exts, const char *name) {
    for (const auto &e : exts) if (std::strcmp(e.extensionName, name) == 0) return true;
    return false;
}

/* Enumerate through the loader. Empty vector = loader absent or enumeration failed. */
std::vector<sk_vk_record> enumerate_raw() {
    std::vector<sk_vk_record> out;
    Loader ld;
    if (!ld.open()) return out;
    auto vkCreateInstance = ld.get<PFN_vkCreateInstance>(VK_NULL_HANDLE, "vkCreateInstance");
    if (!vkCreateInstance) return out;
    VkApplicationInfo app = { VK_STRUCTURE_TYPE_APPLICATION_INFO, nullptr, "sokuji_native", 1, nullptr, 0, VK_API_VERSION_1_1 };
    VkInstanceCreateInfo ci = { VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO, nullptr, 0, &app, 0, nullptr, 0, nullptr };
    VkInstance inst = VK_NULL_HANDLE;
    if (vkCreateInstance(&ci, nullptr, &inst) != VK_SUCCESS) return out;
    auto vkDestroyInstance = ld.get<PFN_vkDestroyInstance>(inst, "vkDestroyInstance");
    auto vkEnumeratePhysicalDevices = ld.get<PFN_vkEnumeratePhysicalDevices>(inst, "vkEnumeratePhysicalDevices");
    auto vkGetPhysicalDeviceProperties2 = ld.get<PFN_vkGetPhysicalDeviceProperties2>(inst, "vkGetPhysicalDeviceProperties2");
    auto vkGetPhysicalDeviceFeatures2 = ld.get<PFN_vkGetPhysicalDeviceFeatures2>(inst, "vkGetPhysicalDeviceFeatures2");
    auto vkEnumerateDeviceExtensionProperties = ld.get<PFN_vkEnumerateDeviceExtensionProperties>(inst, "vkEnumerateDeviceExtensionProperties");
    if (vkEnumeratePhysicalDevices && vkGetPhysicalDeviceProperties2 && vkGetPhysicalDeviceFeatures2 && vkEnumerateDeviceExtensionProperties) {
        uint32_t n = 0;
        vkEnumeratePhysicalDevices(inst, &n, nullptr);
        std::vector<VkPhysicalDevice> pds(n);
        vkEnumeratePhysicalDevices(inst, &n, pds.data());
        for (VkPhysicalDevice pd : pds) {
            sk_vk_record r;
            uint32_t ne = 0;
            vkEnumerateDeviceExtensionProperties(pd, nullptr, &ne, nullptr);
            std::vector<VkExtensionProperties> exts(ne);
            vkEnumerateDeviceExtensionProperties(pd, nullptr, &ne, exts.data());

            VkPhysicalDeviceDriverProperties drv = { VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_DRIVER_PROPERTIES };
            VkPhysicalDeviceIDProperties idp = { VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_ID_PROPERTIES, &drv };
            VkPhysicalDeviceProperties2 props = { VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_PROPERTIES_2, &idp };
            vkGetPhysicalDeviceProperties2(pd, &props);
            r.name = props.properties.deviceName;
            r.device_type = static_cast<int32_t>(props.properties.deviceType);
            r.driver_id = static_cast<int32_t>(drv.driverID);
            r.driver_name = drv.driverName;
            r.driver_info = drv.driverInfo;
            r.uuid_hex = hex(idp.deviceUUID, VK_UUID_SIZE);
            r.luid_valid = idp.deviceLUIDValid == VK_TRUE;
            r.luid_hex = hex(idp.deviceLUID, VK_LUID_SIZE);

            // Feature structs: zero-initialised, chained ONLY when the extension is listed.
            VkPhysicalDeviceVulkan11Features v11 = { VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_VULKAN_1_1_FEATURES };
            VkPhysicalDeviceShaderFloat16Int8Features f16i8 = { VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_SHADER_FLOAT16_INT8_FEATURES };
            VkPhysicalDeviceShaderIntegerDotProductFeatures idot = { VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_SHADER_INTEGER_DOT_PRODUCT_FEATURES };
            VkPhysicalDeviceCooperativeMatrixFeaturesKHR cm = { VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_COOPERATIVE_MATRIX_FEATURES_KHR };
            VkPhysicalDeviceShaderBfloat16FeaturesKHR bf16 = { VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_SHADER_BFLOAT16_FEATURES_KHR };
            VkPhysicalDeviceCooperativeMatrix2FeaturesNV cm2 = { VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_COOPERATIVE_MATRIX_2_FEATURES_NV };
            VkPhysicalDeviceFeatures2 feats = { VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_FEATURES_2, &v11 };
            void **tail = &v11.pNext;
            auto chain = [&](void *s, void **next) { *tail = s; tail = next; };
            if (has_ext(exts, "VK_KHR_shader_float16_int8"))        chain(&f16i8, &f16i8.pNext);
            if (has_ext(exts, "VK_KHR_shader_integer_dot_product")) chain(&idot, &idot.pNext);
            if (has_ext(exts, "VK_KHR_cooperative_matrix"))         chain(&cm, &cm.pNext);
            if (has_ext(exts, "VK_KHR_shader_bfloat16"))            chain(&bf16, &bf16.pNext);
            if (has_ext(exts, "VK_NV_cooperative_matrix2"))         chain(&cm2, &cm2.pNext);
            vkGetPhysicalDeviceFeatures2(pd, &feats);
            r.storage16 = v11.storageBuffer16BitAccess == VK_TRUE;
            if (f16i8.shaderFloat16) r.features |= SK_FEAT_VK_SHADER_FLOAT16;
            if (bf16.shaderBFloat16Type) r.features |= SK_FEAT_VK_SHADER_BFLOAT16;
            if (idot.shaderIntegerDotProduct) r.features |= SK_FEAT_VK_INTEGER_DOT;
            if (cm.cooperativeMatrix) r.features |= SK_FEAT_VK_COOPMAT;
            if (cm2.cooperativeMatrixWorkgroupScope) r.features |= SK_FEAT_VK_COOPMAT2;
            if (props.properties.deviceType == VK_PHYSICAL_DEVICE_TYPE_INTEGRATED_GPU) r.features |= SK_FEAT_UMA;
            out.push_back(std::move(r));
        }
    }
    if (vkDestroyInstance) vkDestroyInstance(inst, nullptr);
    return out;
}

size_t ggml_vulkan_count() {
    size_t n = 0;
    for (ggml_backend_dev_t d : sk::devices()) if (sk::kind_of(d) == SK_DEVICE_VULKAN) ++n;
    return n;
}
size_t ggml_vulkan_ordinal(ggml_backend_dev_t dev) {   // position of `dev` among ggml's Vulkan devices
    size_t k = 0;
    for (ggml_backend_dev_t d : sk::devices()) { if (d == dev) return k; if (sk::kind_of(d) == SK_DEVICE_VULKAN) ++k; }
    return k;
}

}  // namespace

bool sk_vk_fill_profile(ggml_backend_dev_t dev, const char *description, sk_device_profile *out) {
    static std::vector<sk_vk_record> raw;            // enumerate once per process
    static std::vector<size_t> selected;
    static bool done = false;
    if (!done) {
        raw = enumerate_raw();
        selected = sk_vk_select_like_ggml(raw, std::getenv("GGML_VK_VISIBLE_DEVICES"));
        done = true;
    }
    if (raw.empty()) return false;                   // loader absent / enumeration failed
    if (selected.size() != ggml_vulkan_count()) {
        std::string msg = "sk_device_profile_get: Vulkan device list mismatch — loader selection [";
        for (size_t i : selected) msg += raw[i].name + ";";
        msg += "] vs ggml count " + std::to_string(ggml_vulkan_count()) + "; profiles unknown";
        sk::log_line(2, msg.c_str());
        return false;
    }
    const sk_vk_record &r = raw[selected[ggml_vulkan_ordinal(dev)]];
    if (r.name != description) {                     // positional match must agree by name
        sk::log_line(2, ("sk_device_profile_get: positional match disagrees with ggml description (" + r.name + " vs " + description + ")").c_str());
        return false;
    }
    std::snprintf(out->driver_name, sizeof out->driver_name, "%s", r.driver_name.c_str());
    std::snprintf(out->driver_version, sizeof out->driver_version, "%s", r.driver_info.c_str());
    std::snprintf(out->device_uuid, sizeof out->device_uuid, "%s", r.uuid_hex.c_str());
    out->features = r.features;
    return true;
}
#elif !defined(SK_VK_ENUM_NO_LOADER)
bool sk_vk_fill_profile(ggml_backend_dev_t, const char *, sk_device_profile *) { return false; }
#endif
