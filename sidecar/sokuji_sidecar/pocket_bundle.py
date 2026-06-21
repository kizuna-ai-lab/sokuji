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

SAMPLE_RATE = 24000
SAMPLES_PER_FRAME = 1920
LATENT_DIM = 32
EOS_LOGIT_THRESHOLD = -4.0
DECODER_CHUNK_FRAMES = 12
DEFAULT_LSD_STEPS = 1
DEFAULT_MAX_FRAMES = 500

HF_REPO = "KevinAHM/pocket-tts-web"
HF_SUBFOLDER = "onnx/english_2026-04"


def resolve_bundle_dir(local_dir: str | None = None) -> str:
    """Dev/tests: pass local_dir. Real path: snapshot_download the english bundle."""
    if local_dir:
        return local_dir
    from huggingface_hub import snapshot_download  # HF_HOME set by the caller (env)
    root = snapshot_download(
        repo_id=HF_REPO, repo_type="space",
        allow_patterns=[f"{HF_SUBFOLDER}/*"],
    )
    return f"{root}/{HF_SUBFOLDER}"


def parse_npy_float32(path: str) -> np.ndarray:
    return np.load(path).astype(np.float32).reshape(-1)
