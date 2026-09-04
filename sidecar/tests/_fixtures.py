"""Machines with a known device profile (spec A). Shared by test_accel.py and test_planner.py."""
from sokuji_sidecar import accel


def _known_gpu_machine(kind="vulkan"):
    dev = accel.DeviceProfile(0, kind, f"{kind}0", "GB10", 96 << 30, True, frozenset(), "NVIDIA", "580", "ab" * 16, "")
    cpu = accel.DeviceProfile(1, "cpu", "CPU", "CPU", 120 << 30, True, frozenset(), "", "", "", "NEON=1")
    return accel.Machine(os="Linux", arch="x86_64", cpu_cores=8, apple_silicon=False,
                         installed=frozenset({"native_tts", "native_translate", "native_asr"}), fingerprint="fp",
                         tc_kinds=(kind, "cpu"), gpus=((kind, "GB10", 96 << 30),), devices=(dev, cpu), generation="G1")
