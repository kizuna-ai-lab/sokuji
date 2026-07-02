import os
from sokuji_sidecar.qwen3_tts import config, template

FIX = os.path.join(os.path.dirname(__file__), "fixtures", "qwen3_tts_config.json")


def test_load_model_config_parses_fixture():
    cfg = config.load_model_config(FIX)
    assert cfg.tts_bos_token_id == 151672 and cfg.tts_eos_token_id == 151673 and cfg.tts_pad_token_id == 151671
    assert cfg.talker.codec_bos_id == 2149 and cfg.talker.codec_eos_token_id == 2150
    assert cfg.talker.codec_language_id["english"] == 2050
    assert cfg.talker.num_code_groups == 16 and cfg.talker.vocab_size == 3072
    assert cfg.speaker_encoder.n_fft == 1024 and cfg.speaker_encoder.num_mels == 128


def test_prompt_templates_verbatim():
    assert template.build_assistant_text("Hi") == "<|im_start|>assistant\nHi<|im_end|>\n<|im_start|>assistant\n"
    assert template.build_ref_text("Ref") == "<|im_start|>assistant\nRef<|im_end|>\n"


def test_language_map():
    assert template.language_name("ja") == "japanese"
    assert template.language_name("ja-JP") == "japanese"      # base-tag normalization
    assert template.language_name("xx") is None and template.language_name("") is None
