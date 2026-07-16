import struct

import numpy as np

MODEL_STEMS = {
    "mimiEncoder": "mimi_encoder_int8.onnx",
    "textConditioner": "text_conditioner_int8.onnx",
    "flowLmMain": "flow_lm_main_int8.onnx",
    "flowLmFlow": "flow_lm_flow_int8.onnx",
    "mimiDecoder": "mimi_decoder_int8.onnx",
}
TOKENIZER_FILE = "tokenizer.model"
METADATA_FILE = "bundle.json"
BOS_FILE = "bos_before_voice.npy"
VOICES_FILE = "voices.bin"

SAMPLE_RATE = 24000
SAMPLES_PER_FRAME = 1920
LATENT_DIM = 32
EOS_LOGIT_THRESHOLD = -4.0
DECODER_CHUNK_FRAMES = 12
DEFAULT_LSD_STEPS = 1
DEFAULT_MAX_FRAMES = 500

def parse_npy_float32(path: str) -> np.ndarray:
    return np.load(path).astype(np.float32).reshape(-1)


_PTVB_MAGIC = b"PTVB1"
_PTVB_DTYPES = {0: np.float32, 1: np.int64, 2: np.bool_}


def parse_voices_bin(path: str) -> dict[str, dict[str, np.ndarray]]:
    """Parse the PTVB1 predefined-voice container: per voice, the flow-LM
    KV-cache tensors a reference-clip encode would otherwise produce, keyed
    "module.path/tensor_key". Format writer: the upstream Space's
    scripts/export_voice_bins.py. Raises ValueError rather than returning a
    partial dict — a silently-empty parse would read as "no voices"."""
    data = open(path, "rb").read()
    if data[:5] != _PTVB_MAGIC:
        raise ValueError(f"not a PTVB1 file: {path}")
    off = 5
    (n_voices,) = struct.unpack_from("<I", data, off); off += 4
    voices: dict[str, dict[str, np.ndarray]] = {}
    for _ in range(n_voices):
        (name_len,) = struct.unpack_from("<H", data, off); off += 2
        name = data[off:off + name_len].decode("utf-8"); off += name_len
        (n_tensors,) = struct.unpack_from("<H", data, off); off += 2
        tensors: dict[str, np.ndarray] = {}
        for _ in range(n_tensors):
            (key_len,) = struct.unpack_from("<H", data, off); off += 2
            key = data[off:off + key_len].decode("utf-8"); off += key_len
            dtype_code = data[off]; off += 1
            ndim = data[off]; off += 1
            shape = struct.unpack_from("<" + "I" * ndim, data, off); off += 4 * ndim
            (nbytes,) = struct.unpack_from("<I", data, off); off += 4
            dt = _PTVB_DTYPES.get(dtype_code)
            if dt is None:
                raise ValueError(
                    f"unsupported voices.bin dtype code {dtype_code} for {name}/{key}")
            count = nbytes // np.dtype(dt).itemsize
            arr = np.frombuffer(data, dtype=dt, count=count, offset=off)
            tensors[key] = arr.reshape(shape).copy()
            off += nbytes
        voices[name] = tensors
    return voices
