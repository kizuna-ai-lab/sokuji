# Vendored from Genie-TTS 2.0.2 (MIT, https://github.com/High-Logic/Genie-TTS),
# original path: genie_tts/G2P/Chinese/CorrectPronunciation.py. Local
# modifications are marked with "SOKUJI:" comments. See gpt_sovits/LICENSE.
import os
import pickle
from typing import List, Dict, Any, Optional, Union

from ... import assets  # SOKUJI: Core.Resources env-driven dirs -> explicit configure()


def _default_cache_path() -> str:
    # SOKUJI: was a module-level constant bound to Chinese_G2P_DIR at import
    # time; assets.chinese_g2p_dir() must be resolved lazily (after
    # configure() has run), not at module-import time.
    return os.path.join(assets.chinese_g2p_dir(), "polyphonic.pickle")


class PolyphonicDictManager:
    _data: Dict[str, Any] = {}

    @classmethod
    def get_data(cls, path: Optional[str] = None) -> Dict[str, Any]:
        if not cls._data:
            # Trusted local asset bundled in the downloaded GenieData/model-card
            # snapshot (not user-supplied input) — pickle.load is safe here.
            with open(path or _default_cache_path(), "rb") as f:
                cls._data = pickle.load(f)
        return cls._data


def correct_pronunciation(word: str, word_pinyin: List[str]) -> Union[List[str], str]:
    """
        根据加载的字典修正发音，作为供外部程序调用的独立接口。
        逻辑：优先查找整词修正，如果没有整词匹配，则遍历每个字符进行单字修正。

        Input:
            word (str): 原始中文字符串，例如 "银行"。
            word_pinyins (List[str]): 当前预测的拼音列表，例如 ['yin2', 'xing2']。

        Output:
            Union[List[str], str]: 修正后的拼音列表或字符串。

        Example:
            # 字典包含整词 {'银行': ['yin2', 'hang2']}
            result = correct_pronunciation("银行", ["yin2", "xing2"])
            # Result: ["yin2", "hang2"]
        """
    pp_dict = PolyphonicDictManager.get_data()
    new_word_pinyin = list(word_pinyin)
    # 1. 尝试整词匹配
    if new_pinyin := pp_dict.get(word):
        return new_pinyin
    # 2. 逐字修正
    for idx, w in enumerate(word):
        if idx >= len(new_word_pinyin):
            break
        if w_pinyin := pp_dict.get(w):
            new_word_pinyin[idx] = w_pinyin[0]
    return new_word_pinyin
