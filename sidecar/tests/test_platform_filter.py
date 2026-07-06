import asyncio

from sokuji_sidecar import accel, catalog


# Machine shape mirrors tests/test_accel.py (post-P2): NVIDIA presence comes
# from `gpus` device descriptions via accel.has_nvidia (the old `nvidia` field
# and accel.Gpu class were removed in P2). `gpus` items are (kind, description,
# mem_total) tuples; `tc_kinds` lists the accelerator kinds the probe reported.
def _machine(*, apple=False, gpus=(), tc=(), installed=frozenset({"be"})):
    return accel.Machine(os="Linux", arch="x86_64", cpu_cores=8,
                         apple_silicon=apple, dml_adapters=(), installed=installed,
                         fingerprint="pf-test", tc_kinds=tc, gpus=gpus)


# An NVIDIA GPU as the tc probe reports it on the dev 4070 box; makes
# has_nvidia() True → the gpu-vulkan tier is available.
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


def test_resolve_deployments_apple_silicon_gate(monkeypatch):
    monkeypatch.setattr(accel, "current_platform", lambda: "macos")
    model = _asr(
        catalog.Deployment("be", "cpu", "int8", "r-mlx", 1.0, requires_apple_silicon=True),
        catalog.Deployment("be", "cpu", "int8", "r-all", 1.0),
    )
    # Intel mac (no Apple Silicon): the AS-only row is dropped.
    assert [p.artifact for p in accel.resolve_deployments(model, _machine(apple=False))] == ["r-all"]
    # Apple Silicon: the AS-only row survives.
    assert {p.artifact for p in accel.resolve_deployments(model, _machine(apple=True))} == {"r-mlx", "r-all"}


def test_resolve_translate_auto_drops_off_platform(monkeypatch):
    # The translate `auto` branch builds Plans via select_variant and never flows
    # through resolve_deployments, so it needs the up-front filter. Without it the
    # first cpu deployment (r-win) would be picked as the floor and the whole
    # resolve would raise NoUsablePlan instead of falling back to r-all.
    monkeypatch.setattr(accel, "current_platform", lambda: "linux")
    model = catalog.TranslateModel("syn", "Syn", ("multi",), (
        catalog.Deployment("ct2_opus_translate", "cpu", "int8", "r-win", 1.0, platforms=("windows",)),
        catalog.Deployment("ct2_opus_translate", "cpu", "int8", "r-all", 1.0),
    ))
    monkeypatch.setattr(catalog, "translate_model", lambda mid: model if mid == "syn" else None)
    m = _machine(installed=frozenset({"ct2_opus_translate"}))
    plans = accel.resolve_translate("syn", "auto", m)
    assert [p.artifact for p in plans] == ["r-all"]


def test_linux_real_card_resolution_unchanged(monkeypatch):
    # Regression: a real all-platforms card resolves exactly as before on linux.
    # whisper-base's tiers are (gpu-vulkan, gpu-metal, cpu); on an NVIDIA-Linux
    # box gpu-vulkan is available (has_nvidia), gpu-metal is not → vulkan, cpu.
    monkeypatch.setattr(accel, "current_platform", lambda: "linux")
    m = _machine(gpus=_NV_GPUS, installed=frozenset({"transcribe_cpp"}))
    plans = accel.resolve("whisper-base", machine=m)
    assert [p.device for p in plans] == ["vulkan", "cpu"]


def _dml_model():
    # Synthetic card with a windows-only gpu-dml tier over a cross-platform cpu
    # floor (the P5 shape). Same compute_type on both tiers, so the multi-quant
    # variants block never triggers — the test isolates tier visibility.
    return catalog.AsrModel("syn", "Syn", ("multi",), (
        catalog.Deployment("moss_onnx", "gpu-dml", "q8_0", "r", 1.0, platforms=("windows",)),
        catalog.Deployment("moss_onnx", "cpu", "q8_0", "r", 1.0),
    ))


def test_models_catalog_hides_off_platform_tier_on_linux(monkeypatch):
    monkeypatch.setattr(accel, "current_platform", lambda: "linux")
    monkeypatch.setattr(catalog, "asr_models", lambda: [_dml_model()])
    monkeypatch.setattr(accel, "probe", lambda force=False: _machine(installed=frozenset({"moss_onnx"})))
    reply, _ = asyncio.run(accel._h_models_catalog({}, {"type": "models_catalog", "id": 1}, None))
    tiers = reply["models"][0]["tiers"]
    assert [t["tier"] for t in tiers] == ["cpu"]  # windows-only gpu-dml tier hidden on linux


def test_models_catalog_shows_on_platform_tier_with_availability(monkeypatch):
    monkeypatch.setattr(accel, "current_platform", lambda: "windows")
    monkeypatch.setattr(catalog, "asr_models", lambda: [_dml_model()])
    monkeypatch.setattr(accel, "probe", lambda force=False: _machine(installed=frozenset({"moss_onnx"})))
    reply, _ = asyncio.run(accel._h_models_catalog({}, {"type": "models_catalog", "id": 1}, None))
    tiers = {t["tier"]: t for t in reply["models"][0]["tiers"]}
    assert set(tiers) == {"gpu-dml", "cpu"}          # both tiers listed on windows
    assert tiers["gpu-dml"]["available"] is False    # on-platform, but this machine has no DML adapter
    assert tiers["cpu"]["available"] is True
