// Pure test of the ggml-faithful Vulkan device selection (spec §3.1): no loader, no GPU.
#undef NDEBUG
#include <cassert>
#include <string>
#include <vector>
#include "sk_vk_enum.h"

static sk_vk_record rec(const char *name, const char *uuid, int type, int driver, bool s16 = true) {
    sk_vk_record r; r.name = name; r.uuid_hex = uuid; r.luid_valid = false;
    r.device_type = type; r.driver_id = driver; r.storage16 = s16; r.features = 0; return r;
}
// VkPhysicalDeviceType: OTHER 0, INTEGRATED 1, DISCRETE 2, VIRTUAL 3, CPU 4.
// VkDriverId: AMD_PROPRIETARY 1, AMD_OPEN_SOURCE 2, MESA_RADV 3, NVIDIA_PROPRIETARY 4,
// INTEL_PROPRIETARY_WINDOWS 5, INTEL_OPEN_SOURCE_MESA 6, QUALCOMM_PROPRIETARY 12,
// MESA_LLVMPIPE 13, MOLTENVK 14, MESA_TURNIP 18, MESA_DOZEN 23, MESA_NVK 24.
int main() {
    {   // Dual ICD, one card: RADV (3) beats AMDVLK (2) beats proprietary (1).
        std::vector<sk_vk_record> raw = { rec("RX 7800", "aaaa", 2, 2), rec("RX 7800", "aaaa", 2, 3) };
        auto sel = sk_vk_select_like_ggml(raw, nullptr);
        assert(sel.size() == 1 && sel[0] == 1);
    }
    {   // llvmpipe (type CPU) ahead of a real GPU is dropped; virtual GPUs too.
        std::vector<sk_vk_record> raw = { rec("llvmpipe", "bbbb", 4, 13), rec("Arc A770", "cccc", 2, 6), rec("virt", "dddd", 3, 6) };
        auto sel = sk_vk_select_like_ggml(raw, nullptr);
        assert(sel.size() == 1 && sel[0] == 1);
    }
    {   // No 16-bit storage → dropped.
        std::vector<sk_vk_record> raw = { rec("old", "eeee", 2, 4, false), rec("new", "ffff", 2, 4) };
        auto sel = sk_vk_select_like_ggml(raw, nullptr);
        assert(sel.size() == 1 && sel[0] == 1);
    }
    {   // GGML_VK_VISIBLE_DEVICES = raw indices, no filtering at all.
        std::vector<sk_vk_record> raw = { rec("llvmpipe", "bbbb", 4, 13), rec("Arc", "cccc", 2, 6) };
        auto sel = sk_vk_select_like_ggml(raw, "0,1");
        assert(sel.size() == 2 && sel[0] == 0 && sel[1] == 1);
    }
    {   // Nothing survives → the first non-CPU device.
        std::vector<sk_vk_record> raw = { rec("llvmpipe", "bbbb", 4, 13), rec("virt", "dddd", 3, 6) };
        auto sel = sk_vk_select_like_ggml(raw, nullptr);
        assert(sel.size() == 1 && sel[0] == 1);
    }
    {   // Two MoltenVK entries for one UUID are NOT collapsed.
        std::vector<sk_vk_record> raw = { rec("M4", "1111", 1, 14), rec("M4", "1111", 1, 14) };
        auto sel = sk_vk_select_like_ggml(raw, nullptr);
        assert(sel.size() == 2);
    }
    {   // ORDINALS follow ggml: a later duplicate that wins on priority erases the loser and is
        // APPENDED, so on a multi-GPU box the RADV entry lands after the NVIDIA card; a later
        // duplicate that loses is skipped and the earlier winner keeps its slot.
        std::vector<sk_vk_record> raw = { rec("RTX", "nnnn", 2, 4), rec("RX", "aaaa", 2, 2), rec("RX", "aaaa", 2, 3) };
        auto sel = sk_vk_select_like_ggml(raw, nullptr);
        assert(sel.size() == 2 && sel[0] == 0 && sel[1] == 2);
        std::vector<sk_vk_record> raw2 = { rec("RX", "aaaa", 2, 3), rec("RX", "aaaa", 2, 2), rec("RTX", "nnnn", 2, 4) };
        auto sel2 = sk_vk_select_like_ggml(raw2, nullptr);
        assert(sel2.size() == 2 && sel2[0] == 0 && sel2[1] == 2);
    }
    {   // An unknown driver id ranks INT32_MAX: it loses even to Dozen (23) for the same UUID.
        std::vector<sk_vk_record> raw = { rec("X", "gggg", 2, 99), rec("X", "gggg", 2, 23) };
        auto sel = sk_vk_select_like_ggml(raw, nullptr);
        assert(sel.size() == 1 && sel[0] == 1);
    }
    return 0;
}
