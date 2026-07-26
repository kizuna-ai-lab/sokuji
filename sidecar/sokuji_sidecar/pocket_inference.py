import numpy as np
import onnxruntime as ort
from . import pocket_bundle as pb

_DT = {"float32": np.float32, "int64": np.int64, "bool": np.bool_}


def _meta(meta, key, default):
    """dict.get that also falls back when the key is present but null —
    matches the TS source's `meta.x ?? default` (not Python's missing-key-only get)."""
    v = meta.get(key)
    return default if v is None else v


def load_sessions(model_dir: str, threads: int = 2) -> dict:
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = threads
    opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    opts.log_severity_level = 3
    sessions = {}
    for sid, stem in pb.MODEL_STEMS.items():
        sessions[sid] = ort.InferenceSession(
            f"{model_dir}/{stem}", sess_options=opts, providers=["CPUExecutionProvider"])
    return sessions


def _filled(shape, dtype, fill):
    if dtype == "int64":
        return np.zeros(shape, dtype=np.int64)
    if dtype == "bool":
        return np.zeros(shape, dtype=np.bool_)
    a = np.zeros(shape, dtype=np.float32)
    if fill == "nan":
        a[...] = np.nan
    elif fill == "ones":
        a[...] = 1.0
    return a


def init_state_from_manifest(manifest: list[dict]) -> dict:
    return {e["input_name"]: _filled(e["shape"], e["dtype"], e.get("fill")) for e in manifest}


def update_state_from_outputs(state: dict, result: dict, manifest: list[dict]) -> None:
    for e in manifest:
        if e["output_name"] in result:
            state[e["input_name"]] = result[e["output_name"]]


def group_voice_record_by_module(record: dict) -> dict:
    """{"module.path/key": tensor} -> {"module.path": {"key": tensor}}, split on
    the FIRST slash (module paths contain dots, keys may not contain slashes —
    but mirror the reference impl and split once anyway)."""
    grouped: dict[str, dict] = {}
    for key, value in record.items():
        slash = key.find("/")
        if slash == -1:
            continue
        grouped.setdefault(key[:slash], {})[key[slash + 1:]] = value
    return grouped


def derive_step(module_state: dict) -> np.ndarray:
    """The manifest wants a `step` counter the voice file doesn't store under
    that name (it stores `offset`). Port of the reference deriveStep: step ->
    offset (only when end_offset is absent) -> len(current_end) -> 0."""
    if "step" in module_state:
        return np.asarray([int(np.asarray(module_state["step"]).reshape(-1)[0])], np.int64)
    if "offset" in module_state and "end_offset" not in module_state:
        return np.asarray([int(np.asarray(module_state["offset"]).reshape(-1)[0])], np.int64)
    if "current_end" in module_state:
        return np.asarray([int(np.asarray(module_state["current_end"]).shape[0])], np.int64)
    return np.zeros(1, np.int64)


def adapt_tensor(source: np.ndarray, entry: dict) -> np.ndarray:
    """Fit a voices.bin tensor into a manifest state slot (port of the reference
    adaptTypedArray): exact shape -> cast; same element count -> reshape; rank
    mismatch -> manifest default; otherwise embed as a per-axis prefix and leave
    the manifest fill in the tail. The predefined-voice KV cache is a 126-frame
    prefix of the 1000-frame state buffer — the prefix branch is the one that
    carries voice identity."""
    dt = _DT[entry["dtype"]]
    target_shape = tuple(entry["shape"])
    src = np.asarray(source)
    if src.shape == target_shape:
        return src.astype(dt, copy=True)
    if src.size == int(np.prod(target_shape)):
        return src.astype(dt).reshape(target_shape)
    target = _filled(list(target_shape), entry["dtype"], entry.get("fill"))
    if src.ndim != len(target_shape):
        return target
    sl = tuple(slice(0, min(s, t)) for s, t in zip(src.shape, target_shape))
    target[sl] = src[sl].astype(dt)
    return target


def state_from_voice_record(meta: dict, record: dict) -> dict:
    """Build a flow-LM state dict from a parsed predefined-voice record,
    skipping the mimi encoder + prefill a reference clip would need. Slots the
    record doesn't cover keep their manifest defaults (current_end has no
    stored counterpart); `step` is derived when absent."""
    grouped = group_voice_record_by_module(record)
    state = init_state_from_manifest(meta["flow_lm_state_manifest"])
    for entry in meta["flow_lm_state_manifest"]:
        module_state = grouped.get(entry["module"], {})
        source = module_state.get(entry["key"])
        if source is None and entry["key"] == "step":
            source = derive_step(module_state)
        if source is None:
            continue
        state[entry["input_name"]] = adapt_tensor(source, entry)
    return state


def resample_to_24k(samples: np.ndarray, src_rate: int) -> np.ndarray:
    if len(samples) == 0:
        return np.zeros(0, dtype=np.float32)
    if src_rate == pb.SAMPLE_RATE:
        return samples.astype(np.float32, copy=False)
    ratio = pb.SAMPLE_RATE / src_rate
    n = round(len(samples) * ratio)
    pos = np.arange(n) / ratio
    i0 = np.floor(pos).astype(np.int64)
    frac = (pos - i0).astype(np.float32)
    a = samples[np.clip(i0, 0, len(samples) - 1)]
    b = samples[np.clip(i0 + 1, 0, len(samples) - 1)]
    return (a + (b - a) * frac).astype(np.float32)


def _run(session, feeds: dict) -> dict:
    names = [o.name for o in session.get_outputs()]
    out = session.run(names, feeds)
    return dict(zip(names, out))


def encode_reference(sessions, samples24k: np.ndarray) -> np.ndarray:
    audio = samples24k.reshape(1, 1, -1).astype(np.float32)
    res = _run(sessions["mimiEncoder"], {"audio": audio})
    return res[sessions["mimiEncoder"].get_outputs()[0].name]


def build_voice_conditioned_state(sessions, meta, voice_emb, bos) -> dict:
    latent_dim = _meta(meta, "latent_dim", pb.LATENT_DIM)
    flow_state = init_state_from_manifest(meta["flow_lm_state_manifest"])
    empty_seq = np.zeros((1, 0, latent_dim), dtype=np.float32)
    voice_text_emb = voice_emb
    if meta.get("insert_bos_before_voice") and bos is not None:
        cond_dim = voice_emb.shape[2]
        t = voice_emb.shape[1]
        merged = np.empty((1, t + 1, cond_dim), dtype=np.float32)
        merged[0, 0, :] = bos[:cond_dim]
        merged[0, 1:, :] = voice_emb[0]
        voice_text_emb = merged
    feeds = {"sequence": empty_seq, "text_embeddings": voice_text_emb, **flow_state}
    res = _run(sessions["flowLmMain"], feeds)
    update_state_from_outputs(flow_state, res, meta["flow_lm_state_manifest"])
    return flow_state


def generate(sessions, meta, text_embeddings, flow_state_in, *, lsd_steps=1,
             max_frames=500, rng=None) -> np.ndarray:
    rng = rng or np.random.default_rng()
    latent_dim = _meta(meta, "latent_dim", pb.LATENT_DIM)
    cond_dim = _meta(meta, "conditioning_dim",
                     text_embeddings.shape[2] if text_embeddings.ndim == 3 else 1024)
    frames_after_eos = _meta(meta, "model_recommended_frames_after_eos", 1)
    std = float(np.sqrt(0.7))
    dt = 1.0 / lsd_steps
    st = [(np.array([[s / lsd_steps]], np.float32), np.array([[s / lsd_steps + dt]], np.float32))
          for s in range(lsd_steps)]

    mimi_state = init_state_from_manifest(meta["mimi_state_manifest"])
    flow_state = dict(flow_state_in)
    empty_seq = np.zeros((1, 0, latent_dim), np.float32)
    empty_text = np.zeros((1, 0, cond_dim), np.float32)

    cond_res = _run(sessions["flowLmMain"],
                    {"sequence": empty_seq, "text_embeddings": text_embeddings, **flow_state})
    update_state_from_outputs(flow_state, cond_res, meta["flow_lm_state_manifest"])

    pcm_chunks, chunk_latents = [], []
    decoded = 0
    first_audio = True
    current = np.full((1, 1, latent_dim), np.nan, np.float32)
    eos_step = None

    for step in range(max_frames):
        ar = _run(sessions["flowLmMain"],
                  {"sequence": current, "text_embeddings": empty_text, **flow_state})
        conditioning = ar["conditioning"]
        eos_logit = float(ar["eos_logit"].reshape(-1)[0])
        if eos_logit > pb.EOS_LOGIT_THRESHOLD and eos_step is None:
            eos_step = step
        should_stop = eos_step is not None and step >= eos_step + frames_after_eos

        latent = (rng.standard_normal(latent_dim).astype(np.float32) * std)
        for s_t, t_t in st:
            fr = _run(sessions["flowLmFlow"],
                      {"c": conditioning, "s": s_t, "t": t_t, "x": latent.reshape(1, latent_dim)})
            latent = latent + fr["flow_dir"].reshape(-1) * dt

        chunk_latents.append(latent.copy())
        current = latent.reshape(1, 1, latent_dim).astype(np.float32)
        update_state_from_outputs(flow_state, ar, meta["flow_lm_state_manifest"])

        pending = len(chunk_latents) - decoded
        size = 0
        if should_stop:
            size = pending
        elif first_audio and pending >= 3:
            size = 3
        elif pending >= pb.DECODER_CHUNK_FRAMES:
            size = pb.DECODER_CHUNK_FRAMES

        if size > 0:
            block = np.stack(chunk_latents[decoded:decoded + size]).reshape(
                1, size, latent_dim).astype(np.float32)
            dec = _run(sessions["mimiDecoder"], {"latent": block, **mimi_state})
            update_state_from_outputs(mimi_state, dec, meta["mimi_state_manifest"])
            pcm = dec[sessions["mimiDecoder"].get_outputs()[0].name].reshape(-1).astype(np.float32)
            pcm_chunks.append(pcm)
            decoded += size
            first_audio = False

        if should_stop:
            break

    return np.concatenate(pcm_chunks) if pcm_chunks else np.zeros(0, np.float32)
