/* Vulkan device profile through the LOADER, never through ggml-vulkan's private structs
 * and never by linking libvulkan: sk_vk_enum.cpp dlopens the loader at call time. */
#pragma once
#include <cstdint>
#include <string>
#include <vector>
#include "sokuji_native.h"
#include "ggml-backend.h"

struct sk_vk_record {
    std::string name;            // VkPhysicalDeviceProperties.deviceName
    std::string uuid_hex;        // VkPhysicalDeviceIDProperties.deviceUUID, 32 hex chars
    std::string luid_hex;        // deviceLUID, 16 hex chars; meaningful iff luid_valid
    bool        luid_valid = false;
    int32_t     device_type = 0; // VkPhysicalDeviceType
    int32_t     driver_id = 0;   // VkDriverId
    bool        storage16 = false;   // VkPhysicalDeviceVulkan11Features.storageBuffer16BitAccess
    uint32_t    features = 0;    // sk_feature bits (raw)
    std::string driver_name, driver_info;
};

/* ggml_vk_instance_init's device list, replicated (ggml-vulkan.cpp:7441-7581 at v0.22.0):
 *  - GGML_VK_VISIBLE_DEVICES set → those raw indices, no filtering;
 *  - else keep DISCRETE/INTEGRATED devices with 16-bit storage, collapse duplicates by UUID
 *    (or LUID when valid; never when both drivers are MoltenVK) keeping the driver ggml's
 *    priority table prefers; if nothing survives, the first non-CPU device.
 * Returns raw indices in ggml's order. Pure: unit-tested with fake records. */
std::vector<size_t> sk_vk_select_like_ggml(const std::vector<sk_vk_record> &raw, const char *visible_env);

/* Fill driver/uuid/features/uma for ggml Vulkan device `dev`. false (out untouched) when the
 * loader is absent, the enumeration fails, or the selected list does not match ggml's Vulkan
 * device count (a mismatch is logged with both lists). */
bool sk_vk_fill_profile(ggml_backend_dev_t dev, const char *description, sk_device_profile *out);
