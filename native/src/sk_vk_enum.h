/* Vulkan device profile through the LOADER, never through ggml-vulkan's private structs
 * and never by linking libvulkan: sk_vk_enum.cpp dlopens the loader at call time. */
#pragma once
#include "sokuji_native.h"
#include "ggml-backend.h"

/* Fill driver/uuid/features/uma for the ggml Vulkan device `dev` (ggml description
 * `description`). false — out untouched — when the loader is absent, the enumeration
 * fails, or the selected device list does not match ggml's (spec §3.1). */
bool sk_vk_fill_profile(ggml_backend_dev_t dev, const char *description, sk_device_profile *out);
