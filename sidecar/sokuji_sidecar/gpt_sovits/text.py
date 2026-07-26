# Vendored from Genie-TTS 2.0.2 (MIT, https://github.com/High-Logic/Genie-TTS),
# original path: genie_tts/GetPhonesAndBert.py. Local modifications are
# marked with "SOKUJI:" comments. See gpt_sovits/LICENSE.
import numpy as np
from typing import Optional, Tuple

# SOKUJI: upstream Utils/Constants.py (genie_tts/Utils/Constants.py:1) isn't
# otherwise vendored — the one constant it defines is inlined here.
BERT_FEATURE_DIM = 1024


def get_phones_and_bert(
        text: str,
        language: str,
        roberta: Optional[Tuple[object, object]] = None,
) -> Tuple[np.ndarray, np.ndarray]:
    """
    SOKUJI: signature changed from upstream — `roberta` replaces the global
    `model_manager.load_roberta_model()` coupling (genie_tts.ModelManager).
    Pass a (onnxruntime.InferenceSession, tokenizers.Tokenizer) pair to get
    real BERT features for Chinese text; None (the default) falls back to
    zeros, exactly as upstream does when the RoBERTa model isn't loaded.
    """
    if language.lower() == 'english':
        from .g2p.english.EnglishG2P import english_to_phones
        phones = english_to_phones(text)
        text_bert = np.zeros((len(phones), BERT_FEATURE_DIM), dtype=np.float32)
    elif language.lower() == 'chinese':
        from .g2p.chinese.ChineseG2P import chinese_to_phones
        text_clean, _, phones, word2ph = chinese_to_phones(text)
        if roberta is not None:
            roberta_model, roberta_tokenizer = roberta
            encoded = roberta_tokenizer.encode(text_clean)
            input_ids = np.array([encoded.ids], dtype=np.int64)
            attention_mask = np.array([encoded.attention_mask], dtype=np.int64)
            ort_inputs = {
                'input_ids': input_ids,
                'attention_mask': attention_mask,
                'repeats': np.array(word2ph, dtype=np.int64),
            }
            outputs = roberta_model.run(None, ort_inputs)
            text_bert = outputs[0].astype(np.float32)
        else:
            text_bert = np.zeros((len(phones), BERT_FEATURE_DIM), dtype=np.float32)
    else:
        from .g2p.japanese.JapaneseG2P import japanese_to_phones
        phones = japanese_to_phones(text)
        text_bert = np.zeros((len(phones), BERT_FEATURE_DIM), dtype=np.float32)

    phones_seq = np.array([phones], dtype=np.int64)
    return phones_seq, text_bert
