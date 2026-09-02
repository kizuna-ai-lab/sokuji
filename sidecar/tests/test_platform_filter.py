import asyncio

from sokuji_sidecar import accel, catalog


# Machine shape mirrors tests/test_accel.py (slice 4): accelerator identity
# is `gpus` (kind, description, mem_total) plus `tc_kinds` from the native
# probe — no `nvidia`/`dml_adapters`/`ort_cuda` fields (has_nvidia and its
# NVIDIA-by-description fallback died with the ONNX TTS backends, R4).
def _machine(*, apple=False, gpus=(), tc=(), installed=frozenset({"be"})):
    return accel.Machine(os="Linux", arch="x86_64", cpu_cores=8,
                         apple_silicon=apple, installed=installed,
                         fingerprint="pf-test", tc_kinds=tc, gpus=gpus)


# An NVIDIA GPU as the tc probe reports it on the dev 4070 box; `tc=("vulkan",
# "cpu")` alongside these `gpus` is what actually lights the gpu-vulkan tier
# now (see the module docstring above) — the two signals always travel
# together on a real box.
_NV_GPUS = (("vulkan", "NVIDIA GeForce RTX 4070 SUPER", 12 << 30),)


def _asr(*deps):
    return catalog.AsrModel("m", "M", ("multi",), deps)


def test_current_platform_maps_system(monkeypatch):
    for sysname, tag in (("Linux", "linux"), ("Windows", "windows"), ("Darwin", "macos")):
        monkeypatch.setattr(accel.platform, "system", lambda s=sysname: s)
        assert accel.current_platform() == tag


def test_resolve_deployments_drops_off_platform_on_linux(monkeypatch):
    monkeypatch.setattr(accel, "current_platform", lambda: "linux")
    model = _asr(
        catalog.Deployment("be", "cpu", "int8", "r-win", 1.0, platforms=("windows",)),
        catalog.Deployment("be", "cpu", "int8", "r-all", 1.0),
    )
    plans = accel.resolve_deployments(model, _machine())
    assert [p.artifact for p in plans] == ["r-all"]  # windows-only cpu row dropped on linux


def test_resolve_deployments_keeps_row_on_its_own_platform(monkeypatch):
    monkeypatch.setattr(accel, "current_platform", lambda: "windows")
    model = _asr(
        catalog.Deployment("be", "cpu", "int8", "r-win", 1.0, platforms=("windows",)),
        catalog.Deployment("be", "cpu", "int8", "r-all", 1.0),
    )
    plans = accel.resolve_deployments(model, _machine())
    assert {p.artifact for p in plans} == {"r-win", "r-all"}


def test_resolve_deployments_macos_only_row_filtered_on_linux(monkeypatch):
    # requires_apple_silicon (the MLX lane's per-row gate) died with the MLX
    # backend (slice 4) — the ONLY platform gate left is `platforms`, tested
    # generically above (test_resolve_deployments_drops_off_platform_on_linux
    # / test_resolve_deployments_keeps_row_on_its_own_platform). This pins
    # that a macOS-restricted row (any backend, not just a retired MLX one)
    # still behaves correctly regardless of `apple_silicon`.
    monkeypatch.setattr(accel, "current_platform", lambda: "linux")
    model = _asr(
        catalog.Deployment("be", "cpu", "int8", "r-mac", 1.0, platforms=("macos",)),
        catalog.Deployment("be", "cpu", "int8", "r-all", 1.0),
    )
    assert [p.artifact for p in accel.resolve_deployments(model, _machine(apple=True))] == ["r-all"]


def test_resolve_translate_auto_drops_off_platform(monkeypatch):
    # The translate `auto` branch builds Plans via select_variant and never flows
    # through resolve_deployments, so it needs the up-front filter. Without it the
    # first cpu deployment (r-win) would be picked as the floor and the resolve
    # would return the off-platform ["r-win"] instead of falling back to r-all.
    # A synthetic non-GGUF-LLM backend name (matches the "hunyuan_translate"
    # label test_accel.py/test_planner.py use for the same purpose): this
    # exercises select_variant's generic, cpu-only candidate() path, which
    # native_translate's own GGUF-LLM dispatch (_is_gguf_llm) would bypass.
    monkeypatch.setattr(accel, "current_platform", lambda: "linux")
    model = catalog.TranslateModel("syn", "Syn", ("multi",), (
        catalog.Deployment("hunyuan_translate", "cpu", "int8", "r-win", 1.0, platforms=("windows",)),
        catalog.Deployment("hunyuan_translate", "cpu", "int8", "r-all", 1.0),
    ))
    monkeypatch.setattr(catalog, "translate_model", lambda mid: model if mid == "syn" else None)
    m = _machine(installed=frozenset({"hunyuan_translate"}))
    plans = accel.resolve_translate("syn", "auto", m)
    assert [p.artifact for p in plans] == ["r-all"]


def test_linux_real_card_resolution_unchanged(monkeypatch):
    # Regression: a real all-platforms card resolves exactly as before on linux.
    # whisper-base's tiers are (gpu-vulkan, gpu-metal, cpu); on an NVIDIA-Linux
    # box gpu-vulkan is available (the native probe reports "vulkan" in
    # tc_kinds), gpu-metal is not → vulkan, cpu.
    monkeypatch.setattr(accel, "current_platform", lambda: "linux")
    m = _machine(gpus=_NV_GPUS, tc=("vulkan", "cpu"), installed=frozenset({"native_asr"}))
    plans = accel.resolve("whisper-base", machine=m)
    assert [p.device for p in plans] == ["vulkan", "cpu"]


def _hypothetical_platform_restricted_model():
    # Synthetic card with a windows-only tier over a cross-platform cpu floor
    # — gpu-dml itself died with the ONNX TTS backends (R4; the tier string
    # is gone from TIER_RANK/TIER_DEVICE and _tier_available unconditionally
    # returns False for it now), but the PLATFORM-FILTERING machinery
    # (_platform_ok / models_catalog's per-tier visibility) is generic over
    # any tier string, and this is its only remaining test coverage for a
    # non-cpu platform-restricted row — a synthetic label keeps that alive
    # without resurrecting retired vocabulary. Same compute_type on both
    # tiers, so the multi-quant variants block never triggers.
    return catalog.AsrModel("syn", "Syn", ("multi",), (
        catalog.Deployment("be", "gpu-hypothetical", "q8_0", "r", 1.0, platforms=("windows",)),
        catalog.Deployment("be", "cpu", "q8_0", "r", 1.0),
    ))


def test_models_catalog_hides_off_platform_tier_on_linux(monkeypatch):
    monkeypatch.setattr(accel, "current_platform", lambda: "linux")
    monkeypatch.setattr(catalog, "asr_models", lambda: [_hypothetical_platform_restricted_model()])
    monkeypatch.setattr(accel, "probe", lambda force=False: _machine(installed=frozenset({"be"})))
    reply, _ = asyncio.run(accel._h_models_catalog({}, {"type": "models_catalog", "id": 1}, None))
    tiers = reply["models"][0]["tiers"]
    assert [t["tier"] for t in tiers] == ["cpu"]  # windows-only tier hidden on linux


def test_models_catalog_shows_on_platform_tier_with_availability(monkeypatch):
    monkeypatch.setattr(accel, "current_platform", lambda: "windows")
    monkeypatch.setattr(catalog, "asr_models", lambda: [_hypothetical_platform_restricted_model()])
    monkeypatch.setattr(accel, "probe", lambda force=False: _machine(installed=frozenset({"be"})))
    reply, _ = asyncio.run(accel._h_models_catalog({}, {"type": "models_catalog", "id": 1}, None))
    tiers = {t["tier"]: t for t in reply["models"][0]["tiers"]}
    assert set(tiers) == {"gpu-hypothetical", "cpu"}          # both tiers listed on windows
    assert tiers["gpu-hypothetical"]["available"] is False    # on-platform, but not a real tier
    assert tiers["cpu"]["available"] is True
