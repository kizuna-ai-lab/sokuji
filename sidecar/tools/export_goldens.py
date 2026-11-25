"""Exports the golden vectors the TypeScript engine (electron/engine/) is held to, from the Python sidecar as it is.

    python sidecar/tools/export_goldens.py --out electron/engine/test/golden [--hf-cache PATH]

Writes eight files, each {"generator", "sidecar_commit", "cases"}: catalog, characterization, planner, gguf, prompts,
dsp_asr, dsp_tts and specs (see docs/superpowers/plans/2026-11-23-engine-ts-port.md, Task 1). Every run over the same
sidecar writes the same bytes: the model cache is an empty scratch directory, nothing is downloaded, the bench cache is
empty, and the planner never reaches the native library (the characterisation suite's own pins). With --hf-cache, a
ninth file, status.json, records model_status() of every card against that cache.

A one-off: it goes with the sidecar.
"""
import argparse
import base64
import contextlib
import dataclasses
import io
import json
import math
import os
import struct
import subprocess
import sys
import tempfile

SIDECAR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
TESTS = os.path.join(SIDECAR, "tests")
OVERRIDES = ("auto", "cpu", "gpu-vulkan", "gpu-metal")
TINY_BUDGET = 1_000_000


def _isolate(hf_cache):
    """The environment every run sees: a scratch model cache (or the one asked for), no network, no bench cache."""
    scratch = tempfile.mkdtemp(prefix="sokuji-goldens-")
    home = hf_cache or os.path.join(scratch, "hf")
    os.makedirs(home, exist_ok=True)
    os.environ["HF_HOME"] = home
    os.environ.pop("HF_HUB_CACHE", None)
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["SOKUJI_BENCH_DIR"] = os.path.join(scratch, "bench")
    for path in (SIDECAR, TESTS):
        if path not in sys.path:
            sys.path.insert(0, path)
    return scratch


def jsonable(value):
    """Plain JSON: dataclasses as dicts, sets sorted, tuples as lists, bytes as base64."""
    if dataclasses.is_dataclass(value) and not isinstance(value, type):
        return {f.name: jsonable(getattr(value, f.name)) for f in dataclasses.fields(value)}
    if isinstance(value, dict):
        return {str(k): jsonable(v) for k, v in value.items()}
    if isinstance(value, (set, frozenset)):
        return sorted((jsonable(v) for v in value), key=lambda v: json.dumps(v, sort_keys=True))
    if isinstance(value, (list, tuple)):
        return [jsonable(v) for v in value]
    if isinstance(value, bytes):
        return {"base64": base64.b64encode(value).decode()}
    if isinstance(value, float) and not math.isfinite(value):
        return {"float": repr(value)}
    if callable(value):
        return {"callable": getattr(value, "__name__", type(value).__name__)}
    if hasattr(value, "tolist"):                      # numpy scalars and arrays
        return jsonable(value.tolist())
    return value


def _sidecar_commit():
    try:
        out = subprocess.run(["git", "log", "-1", "--format=%H", "--", "sokuji_sidecar"], cwd=SIDECAR,
                             capture_output=True, text=True, check=True)
        return out.stdout.strip() or "unknown"
    except (OSError, subprocess.CalledProcessError):
        return "unknown"


def _write(out, name, cases, commit, **extra):
    doc = {"generator": "export_goldens.py", "sidecar_commit": commit, "cases": cases, **extra}
    with open(os.path.join(out, f"{name}.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(jsonable(doc), f, sort_keys=True, indent=2, ensure_ascii=False)
        f.write("\n")


def _error(e):
    return {"error": type(e).__name__, "message": str(e)}


# ── catalog.json ────────────────────────────────────────────────────────────


def catalog_cases():
    from sokuji_sidecar import catalog
    cases = []
    for kind, cards in (("asr", catalog.asr_models()), ("translate", catalog.translate_models()), ("tts", catalog.tts_models())):
        for card in cards:
            case = {
                "kind": kind,
                "id": card.id,
                "card": dataclasses.asdict(card),
                "split_artifact": [{"artifact": d.artifact, "result": list(catalog.split_artifact(d.artifact))} for d in card.deployments],
            }
            if kind == "tts":
                case["voice_capability"] = catalog.voice_capability(card)
                case["license_dict"] = catalog.license_dict(card)
            cases.append(case)
    return cases


# ── characterization.json ───────────────────────────────────────────────────


def _machines():
    import test_characterization as tc
    return {"CPU_ONLY": tc.CPU_ONLY, "CUDA_12GB": tc.CUDA_12GB, "CUDA_24GB": tc.CUDA_24GB, "APPLE_SILICON": tc.APPLE_SILICON}


def _platform(name):
    return "macos" if name == "APPLE_SILICON" else "linux"


def _pin_accel():
    """The characterisation suite's autouse fixture, for the whole run."""
    from sokuji_sidecar import accel, native

    def never(*_a, **_k):
        raise AssertionError("native reached with devices=()")

    accel._downloaded_quants = lambda model: set()
    accel.bench_load = lambda: {}
    accel.compute_op_coverage = never
    native.module = never


def _quants(card):
    """The card's distinct compute types, in deployment order."""
    seen = []
    for d in card.deployments:
        if d.compute_type not in seen:
            seen.append(d.compute_type)
    return seen


def characterization_cases():
    from sokuji_sidecar import accel, catalog, planner
    _pin_accel()
    cases = []
    for name, machine in _machines().items():
        accel.current_platform = (lambda p: (lambda: p))(_platform(name))
        for fn, cards, resolve in (
            ("resolve", catalog.asr_models(), accel.resolve),
            ("resolve_translate", catalog.translate_models(), accel.resolve_translate),
            ("resolve_tts", catalog.tts_models(), accel.resolve_tts),
        ):
            for card in cards:
                for override in OVERRIDES:
                    try:
                        result = [dataclasses.asdict(p) for p in resolve(card.id, override, machine=machine)]
                    except Exception as e:  # noqa: BLE001 — every failure is part of the contract
                        result = _error(e)
                    cases.append({"fn": fn, "machine": name, "model": card.id, "override": override, "result": result})
        budgets = [accel._quant_budget_bytes(machine), TINY_BUDGET]
        for card in catalog.asr_models():
            quants = _quants(card)
            if len(quants) < 2:
                continue
            for pin in [None, *quants[:2]]:
                for budget in budgets:
                    try:
                        result = accel._tc_pick_quant(card, machine, pin, budget, downloaded=set())
                    except Exception as e:  # noqa: BLE001
                        result = _error(e)
                    cases.append({"fn": "_tc_pick_quant", "machine": name, "model": card.id, "pin": pin, "budget": budget, "result": result})
        for card in catalog.translate_models():
            for pin in [None, *_quants(card)[:2]]:
                for budget in budgets:
                    for fn, call in (
                        ("select_variant", lambda: accel.select_variant(card, machine, 0, pin, budget_bytes=budget, downloaded=set())),
                        ("_llamacpp_variant_row", lambda: accel._llamacpp_variant_row(card, machine, pin, 0, budget, downloaded=set())),
                    ):
                        if fn == "_llamacpp_variant_row" and not planner._is_gguf_llm(card):
                            continue
                        try:
                            result = dataclasses.asdict(call())
                        except Exception as e:  # noqa: BLE001
                            result = _error(e)
                        cases.append({"fn": fn, "machine": name, "model": card.id, "pin": pin, "budget": budget, "reserved": 0, "result": result})
    return cases


def characterization_machines():
    from sokuji_sidecar import accel
    return {name: {"machine": m, "platform": _platform(name), "quant_budget": accel._quant_budget_bytes(m)} for name, m in _machines().items()}


# ── planner.json ────────────────────────────────────────────────────────────


class _Collector:
    def __init__(self):
        self.items = []

    def pytest_collection_modifyitems(self, items):
        self.items.extend(items)


def planner_cases():
    """Every table-driven case of tests/test_planner.py: its inputs and the output that suite asserts."""
    import pytest
    collector = _Collector()
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        code = pytest.main(["--collect-only", "-q", "-p", "no:cacheprovider", os.path.join(TESTS, "test_planner.py")], plugins=[collector])
    if code != 0:
        raise SystemExit(f"collecting tests/test_planner.py failed ({code})")
    return [{"test": item.originalname, "id": item.callspec.id, "params": item.callspec.params}
            for item in collector.items if hasattr(item, "callspec")]


# ── gguf.json ───────────────────────────────────────────────────────────────


def _gguf_files():
    """The synthetic files tests/test_gguf_header.py writes, and cuts of them."""
    def s(x):
        b = x.encode()
        return struct.pack("<Q", len(b)) + b

    def toy(version, arch="qwen3", tensors=(("token_embd.weight", 8), ("blk.0.attn_q.weight", 12), ("blk.0.norm.weight", 0), ("output.weight", 30))):
        out = bytearray(b"GGUF" + struct.pack("<I", version) + struct.pack("<Q", len(tensors)) + struct.pack("<Q", 2))
        out += s("general.architecture") + struct.pack("<I", 8) + s(arch)
        out += s("tokenizer.ggml.tokens") + struct.pack("<I", 9) + struct.pack("<I", 8) + struct.pack("<Q", 2) + s("a") + s("b")
        for name, ty in tensors:
            out += s(name) + struct.pack("<I", 2) + struct.pack("<QQ", 4, 4) + struct.pack("<I", ty) + struct.pack("<Q", 0)
        return bytes(out)

    v3 = toy(3)
    bad_len = bytearray(b"GGUF" + struct.pack("<I", 3) + struct.pack("<Q", 0) + struct.pack("<Q", 1))
    bad_len += s("general.architecture") + struct.pack("<I", 8) + struct.pack("<Q", 10_000) + b"short"
    files = [
        ("toy-v3", v3),
        ("toy-v2", toy(2)),
        ("toy-v1", toy(1)),
        ("toy-unknown-dtype", toy(3, tensors=(("a.weight", 0), ("b.weight", 250)))),
        ("toy-no-tensors", toy(3, tensors=())),
        ("not-gguf", b"NOPE" + b"\0" * 64),
        ("bare-magic", b"GGUF"),
        ("bad-string-length", bytes(bad_len)),
        ("unknown-kv-type", b"GGUF" + struct.pack("<I", 3) + struct.pack("<Q", 0) + struct.pack("<Q", 1) + s("x") + struct.pack("<I", 77)),
    ]
    files += [(f"toy-v3-cut-{n}", v3[:n]) for n in (5, 8, 16, 24, 30, 40, 60, 90, 120, len(v3) - 1)]
    return files


def gguf_cases(scratch):
    from sokuji_sidecar import gguf_header
    cases = []
    folder = os.path.join(scratch, "gguf")
    os.makedirs(folder, exist_ok=True)
    for name, data in _gguf_files():
        path = os.path.join(folder, f"{name}.gguf")
        with open(path, "wb") as f:
            f.write(data)
        try:
            h = gguf_header.read_header(path)
            result = {"architecture": h.architecture, "tensor_types": sorted(h.tensor_types), "n_tensors": h.n_tensors}
        except gguf_header.GgufError as e:
            # The file's path is the reader's prefix; the TypeScript test puts its own path where <path> stands.
            result = {"error": "GgufError", "message": str(e).replace(path, "<path>")}
        cases.append({"name": name, "bytes": base64.b64encode(data).decode(), "result": result})
    return cases


# ── prompts.json ────────────────────────────────────────────────────────────


def prompts_cases():
    from sokuji_sidecar import planner, translate_backend as tb
    configs = {"plain": planner.PlanConfig(), "no_thinking": planner.PlanConfig(disable_thinking=True, append_no_think=True)}
    cases = []
    for strategy in ("qwen", "hunyuan", "gemma"):
        for config_name, config in configs.items():
            for text in ("Hello.", "こんにちは。", ""):
                for system_prompt in ("", "Be formal."):
                    for src, tgt in (("en", "ja"), ("ja", "en"), ("zh", "fr")):
                        for wrap in (True, False):
                            mode, payload, prefill = tb.STRATEGIES[strategy].build(text, system_prompt, src, tgt, wrap, config)
                            cases.append({"fn": "build", "strategy": strategy, "config": config_name, "text": text,
                                          "system_prompt": system_prompt, "src": src, "tgt": tgt, "wrap": wrap,
                                          "result": {"mode": mode, "payload": payload, "prefill": prefill}})
        cases.append({"fn": "max_tokens", "strategy": strategy, "result": tb.STRATEGIES[strategy].max_tokens})
    for text in ("<think>reasoning</think>  hello", "plain", "The weather today is nice.</transcript>", "<transcript>hi</transcript>",
                 "<think>x</think> Hello</transcript>", "  <TRANSCRIPT>Mixed</Transcript>  ", "a</think>b</think>c", ""):
        cases.append({"fn": "_clean_output", "text": text, "result": tb._clean_output(text)})
    messages = [{"role": "system", "content": "Translate."}, {"role": "user", "content": "<transcript>Hi</transcript>"}]
    for msgs, prefill in ((messages, None), (messages, "<think>\n\n</think>\n\n"), ([{"role": "user", "content": "x"}], "")):
        cases.append({"fn": "_chatml_fallback", "messages": msgs, "prefill": prefill, "result": tb._chatml_fallback(msgs, prefill)})
    cases.append({"fn": "_GEMMA_LANG_NAME", "result": tb._GEMMA_LANG_NAME})
    return cases


# ── dsp_asr.json / dsp_tts.json ─────────────────────────────────────────────

RATES = (16000, 22050, 24000, 44100, 48000)


def dsp_asr_cases():
    import numpy as np
    from sokuji_sidecar import asr_engine
    cases = []
    for rate in RATES:
        t = np.arange(int(rate * 0.02)) / rate
        tone = np.round(np.sin(2 * np.pi * 1000 * t) * 12000).astype(np.int16)
        out = asr_engine._downsample_int16_to_f32_16k(tone.tobytes(), rate)
        cases.append({"src_rate": rate, "input": tone.tolist(), "output": [float(v) for v in out]})
    cases.append({"src_rate": 24000, "input": [], "output": []})
    return cases


def dsp_tts_cases():
    import numpy as np
    from sokuji_sidecar import tts_engine
    cases = []
    for rate in RATES:
        t = np.arange(int(rate * 0.02)) / rate
        left = (np.sin(2 * np.pi * 1000 * t) * 0.5).astype(np.float32)
        right = (np.sin(2 * np.pi * 500 * t) * 0.25).astype(np.float32)
        for channels, samples in ((1, left), (2, np.stack([left, right], axis=1))):
            pcm = tts_engine._to_int16_24k_mono(samples, rate)
            cases.append({"src_rate": rate, "channels": channels, "input": samples.reshape(-1).tolist(),
                          "output": np.frombuffer(pcm, dtype=np.int16).tolist()})
    return cases


# ── specs.json / status.json ────────────────────────────────────────────────


def _card_ids():
    from sokuji_sidecar import catalog
    return [m.id for m in catalog.asr_models()] + [m.id for m in catalog.translate_models()] + [m.id for m in catalog.tts_models()]


def specs_cases():
    from sokuji_sidecar import native_models
    return [{"id": cid, "download_specs": native_models.download_specs(cid), "model_size": native_models.model_size(cid)} for cid in _card_ids()]


def status_cases():
    from sokuji_sidecar import native_models
    return [{"id": cid, "model_status": native_models.model_status(cid)} for cid in _card_ids()]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--out", required=True, help="directory to write the golden files into")
    parser.add_argument("--hf-cache", help="a Hugging Face cache (HF_HOME) to record model_status() against, as status.json")
    args = parser.parse_args(argv)
    scratch = _isolate(os.path.abspath(args.hf_cache) if args.hf_cache else None)
    out = os.path.abspath(args.out)
    os.makedirs(out, exist_ok=True)
    commit = _sidecar_commit()
    _write(out, "catalog", catalog_cases(), commit)
    _write(out, "planner", planner_cases(), commit)
    _write(out, "characterization", characterization_cases(), commit, machines=characterization_machines())
    _write(out, "gguf", gguf_cases(scratch), commit)
    _write(out, "prompts", prompts_cases(), commit)
    _write(out, "dsp_asr", dsp_asr_cases(), commit)
    _write(out, "dsp_tts", dsp_tts_cases(), commit)
    _write(out, "specs", specs_cases(), commit)
    if args.hf_cache:
        _write(out, "status", status_cases(), commit)


if __name__ == "__main__":
    main()
