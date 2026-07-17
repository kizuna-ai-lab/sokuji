# Vendored from Genie-TTS 2.0.2 (MIT, https://github.com/High-Logic/Genie-TTS),
# original path: genie_tts/G2P/Chinese/ChineseG2P.py. Local modifications are
# marked with "SOKUJI:" comments. See gpt_sovits/LICENSE.
import os
import re
from typing import List, Tuple, Dict
import logging

from pypinyin.contrib.tone_convert import to_finals_tone3, to_initials
# SOKUJI: jieba_fast -> pure-python jieba (identical API)
import jieba
import jieba.posseg as psg
from g2pM import G2pM

from ... import assets  # SOKUJI: Core.Resources env-driven dirs -> explicit configure()
from ..symbols_v2 import symbols_v2, symbol_to_id_v2
from .ToneSandhi import ToneSandhi
from .Normalization.text_normlization import TextNormalizer
from .CorrectPronunciation import correct_pronunciation
from .Erhua import ErhuaProcessor

jieba.setLogLevel(logging.ERROR)  # SOKUJI: jieba_fast -> pure-python jieba (identical API)

PUNCTUATION = ["!", "?", "…", ",", ".", "-"]
PUNCTUATION_REPLACEMENTS = {
    "：": ",", "；": ",", "，": ",", "。": ".", "！": "!",
    "？": "?", "\n": ".", "·": ",", "、": ",", "$": ".",
    "/": ",", "—": "-", "~": "…", "～": "…",
}
SPECIAL_REPLACEMENTS = {"...": "…"}  # 特殊的多字符替换


class ChineseG2P:
    def __init__(self):
        # --- 资源加载 ---
        self.g2pm: G2pM = G2pM()
        self.tone_modifier: ToneSandhi = ToneSandhi()
        self.erhua_processor: ErhuaProcessor = ErhuaProcessor()
        self.text_normalizer: TextNormalizer = TextNormalizer()
        self.pinyin_to_symbol_map: Dict[str, str] = {}

        # 预编译正则
        # 1. 匹配替换表中的字符
        self.pattern_punct_map = re.compile("|".join(re.escape(p) for p in PUNCTUATION_REPLACEMENTS.keys()))
        # 2. 过滤非中文字符和允许的标点
        allowed_chars = "".join(re.escape(p) for p in PUNCTUATION)
        self.pattern_filter = re.compile(r"[^\u4e00-\u9fa5" + allowed_chars + r"]+")
        # 3. 句内分割 (Lookbehind)
        self.pattern_split = re.compile(r"(?<=[{0}])\s*".format(allowed_chars))
        # 4. 连续标点去重
        self.pattern_consecutive = re.compile(f"([{allowed_chars}])\\1+")
        # 5. 英文单词移除
        self.pattern_eng = re.compile(r"[a-zA-Z]+")

        # --- 拼音映射查找表 (用于 _pinyin_to_opencpop_phones) ---
        self.v_rep_map = {"uei": "ui", "iou": "iu", "uen": "un"}
        self.pinyin_rep_map = {"ing": "ying", "i": "yi", "in": "yin", "u": "wu"}
        self.single_rep_map = {"v": "yu", "e": "e", "i": "y", "u": "w"}

        self.load_opencpop_dict()

    def load_opencpop_dict(self):
        # 加载 Opencpop 映射表
        map_path = os.path.join(assets.chinese_g2p_dir(), "opencpop-strict.txt")
        with open(map_path, 'r', encoding='utf-8') as f:
            for line in f:
                parts = line.strip().split("\t")
                if len(parts) >= 2:
                    self.pinyin_to_symbol_map[parts[0]] = parts[1]

    def _replace_punctuation(self, text: str) -> str:
        """处理特定字符替换和非标准标点清洗"""
        # text = text.replace("嗯", "恩").replace("呣", "母")
        for k, v in SPECIAL_REPLACEMENTS.items():
            text = text.replace(k, v)
        text = self.pattern_punct_map.sub(lambda x: PUNCTUATION_REPLACEMENTS[x.group()], text)
        text = self.pattern_filter.sub("", text)
        return text

    def normalize_text(self, text: str) -> str:
        """执行完整的文本归一化流程"""
        # 1. TextNormalizer 转换 (如数字转汉字)
        sentences = self.text_normalizer.normalize(text)
        # 2. 标点映射与清洗
        dest_parts = [self._replace_punctuation(s) for s in sentences]
        dest_text = "".join(dest_parts)
        # 3. 避免重复标点
        dest_text = self.pattern_consecutive.sub(r"\1", dest_text)
        return dest_text

    def _pinyin_to_opencpop_phones(self, c: str, v: str) -> List[str]:
        """将声母韵母转换为 Opencpop 格式的音素"""
        # 提取声调
        v_without_tone = v[:-1]
        tone = v[-1]
        if c:
            # 多音节逻辑
            final = self.v_rep_map.get(v_without_tone, v_without_tone)
            pinyin_key = c + final
        else:
            # 零声母/单音节逻辑
            temp_key = c + v_without_tone  # c is empty string here usually
            if temp_key in self.pinyin_rep_map:
                pinyin_key = self.pinyin_rep_map[temp_key]
            else:
                # 处理首字母变化
                if temp_key and temp_key[0] in self.single_rep_map:
                    pinyin_key = self.single_rep_map[temp_key[0]] + temp_key[1:]
                else:
                    pinyin_key = temp_key
        # 查表获取音素
        phone_str = self.pinyin_to_symbol_map[pinyin_key]
        new_c, new_v = phone_str.split(" ")
        new_v = new_v + tone
        return [new_c, new_v]

    def g2p(self, text: str) -> Tuple[List[str], List[int]]:
        """生成音素列表和 Word-to-Phone 映射"""
        sentences = [i for i in self.pattern_split.split(text) if i.strip() != ""]
        all_phones = []
        all_word2ph = []
        for seg in sentences:
            # 移除英文
            seg = self.pattern_eng.sub("", seg)
            # 分词
            seg_cut = psg.lcut(seg)
            seg_cut = self.tone_modifier.pre_merge_for_modify(seg_cut)
            initials = []
            finals = []
            # G2PM 整句推理
            pinyins = self.g2pm(seg, char_split=True)
            pinyins = [p.replace("u:", "v") for p in pinyins]
            pre_word_length = 0
            for word, pos in seg_cut:
                now_word_length = pre_word_length + len(word)
                if pos == "eng":
                    pre_word_length = now_word_length
                    continue
                word_pinyins = pinyins[pre_word_length:now_word_length]
                # 多音字修正
                word_pinyins = correct_pronunciation(word, word_pinyins)
                sub_initials = []
                sub_finals = []
                for pinyin in word_pinyins:
                    if pinyin[0].isalpha():
                        sub_initials.append(to_initials(pinyin))
                        sub_finals.append(to_finals_tone3(pinyin, neutral_tone_with_five=True))
                    else:
                        # 处理非字母（如标点）
                        sub_initials.append(pinyin)
                        sub_finals.append(pinyin)
                pre_word_length = now_word_length
                # 变调处理
                sub_finals = self.tone_modifier.modified_tone(word, pos, sub_finals)
                # 儿化处理
                sub_initials, sub_finals = self.erhua_processor.merge_erhua(sub_initials, sub_finals, word, pos)
                initials.extend(sub_initials)
                finals.extend(sub_finals)

            for c, v in zip(initials, finals):
                if c == v:
                    # 标点符号逻辑
                    all_phones.append(c)
                    all_word2ph.append(1)
                else:
                    # 正常拼音转换逻辑
                    try:
                        phone_pair = self._pinyin_to_opencpop_phones(c, v)
                        all_phones.extend(phone_pair)
                        all_word2ph.append(len(phone_pair))
                    except KeyError:
                        # 遇到未知的拼音组合，记录错误或跳过
                        continue

        return all_phones, all_word2ph

    def process(self, text: str) -> Tuple[str, List[str], List[int], List[int]]:
        normalized_text = self.normalize_text(text)
        # print(normalized_text)
        phones, word2ph = self.g2p(normalized_text)
        phones = [ph for ph in phones if ph in symbols_v2]
        phones_ids = [symbol_to_id_v2[ph] for ph in phones]
        return normalized_text, phones, phones_ids, word2ph


processor: ChineseG2P = ChineseG2P()


def chinese_to_phones(text: str) -> Tuple[str, List[str], List[int], List[int]]:
    return processor.process(text)
