# Vendored from Genie-TTS 2.0.2 (MIT, https://github.com/High-Logic/Genie-TTS),
# original path: genie_tts/Utils/TextSplitter.py. Local modifications are
# marked with "SOKUJI:" comments. See gpt_sovits/LICENSE.
import re
from typing import List, Set, Pattern, Tuple


class TextSplitter:
    def __init__(self, max_len: int = 40, min_len: int = 5):
        """
        初始化文本切分器。

        :param max_len: 软限制最大长度 (Effective Length)。超过此长度遇到分隔符时会切分。
        :param min_len: 硬限制最小长度 (Effective Length)。小于此长度遇到终止符也不会切分。
        """
        self.max_len: int = max_len
        self.min_len: int = min_len
        # SOKUJI: upstream TextSplitter only exposes a one-shot split(text).
        # feed()/flush() below add a streaming wrapper (needed by the sidecar's
        # incremental synthesis loop) on top of the unchanged split()/
        # _flush_buffer() logic; _pending holds text not yet resolved into a
        # complete sentence.
        self._pending: str = ""

        # 1. 定义基础字符集合
        # 只要标点块中包含这些字符，就视为 Ending (终止符)
        self.end_chars: Set[str] = {
            '。', '！', '？', '…',
            '!', '?', '.'
        }

        # 2. 定义标点符号全集 (用于正则匹配和长度计算过滤)
        self.all_puncts_chars: Set[str] = self.end_chars | {
            '，', '、', '；', '：', '——',
            ',', ';', ':',
            '“', '”', '‘', '’', '"', "'",
        }

        # 3. 编译正则表达式
        # 使用非捕获组 (?:) 配合 + 号，实现贪婪匹配连续标点
        # sort + escape 确保正则安全且优先匹配长标点
        sorted_puncts: List[str] = sorted(list(self.all_puncts_chars), key=len, reverse=True)
        escaped_puncts: List[str] = [re.escape(p) for p in sorted_puncts]
        self.pattern: Pattern = re.compile(f"((?:{'|'.join(escaped_puncts)})+)")

    @staticmethod
    def get_char_width(char: str) -> int:
        """计算单字符宽度：ASCII算1，其他（中日韩）算2"""
        return 1 if ord(char) < 128 else 2

    def get_effective_len(self, text: str) -> int:
        """
        计算字符串的有效长度。
        逻辑：跳过标点符号，仅计算内容字符。
        例如："你好......" -> 有效长度为 4 (你好)，而不是 10。
        """
        length = 0
        for char in text:
            # 如果是标点符号集合里的字符，不计入长度
            if char in self.all_puncts_chars:
                continue
            length += self.get_char_width(char)
        return length

    def is_terminator_block(self, block: str) -> bool:
        """
        判断一个标点块是否起到结束句子的作用。
        只要块中包含任意一个结束字符（如句号），则视为结束块。
        """
        for char in block:
            if char in self.end_chars:
                return True
        return False

    def split(self, text: str) -> List[str]:
        """核心切分逻辑"""
        if not text:
            return []

        # SOKUJI: loop body factored out into _split_partial() so feed()/flush()
        # below can reuse it; behavior is unchanged (same segments/thresholds).
        sentences, current_buffer = self._split_partial(text)

        # 处理残留缓冲区
        if current_buffer:
            self._flush_buffer(sentences, current_buffer)

        return sentences

    def _split_partial(self, text: str) -> Tuple[List[str], str]:
        """
        SOKUJI: added — same segmentation loop as split(), but returns the
        trailing incomplete buffer instead of flushing it, so a caller can
        keep accumulating text across multiple calls (see feed()).
        """
        text = text.replace('\n', '')

        # 正则切分，segments 格式如: ['你好', '......', '我是谁', '？！', '']
        segments: List[str] = self.pattern.split(text)

        sentences: List[str] = []
        current_buffer: str = ""

        for segment in segments:
            if not segment:
                continue

            # 判断当前片段是否是标点块（通过首字符判断即可，正则保证了一致性）
            is_punct_block = segment[0] in self.all_puncts_chars

            if is_punct_block:
                current_buffer += segment

                # 计算缓冲区内容的【有效长度】
                eff_len = self.get_effective_len(current_buffer)

                # 判断逻辑
                if self.is_terminator_block(segment):
                    # Case B: 结束符号 -> 检查 min_len
                    if eff_len >= self.min_len:
                        sentences.append(current_buffer.strip())
                        current_buffer = ""
                    # else: 有效长度太短，合并到下一句
                else:
                    # Case A-B: 分隔符号 -> 检查 max_len
                    if eff_len >= self.max_len:
                        sentences.append(current_buffer.strip())
                        current_buffer = ""
                    # else: 没到最大长度，继续累积
            else:
                # 纯文本
                current_buffer += segment

        return sentences, current_buffer

    def _flush_buffer(self, sentences: List[str], buffer: str):
        candidate = buffer.strip()
        if not candidate:
            return
        eff_len = self.get_effective_len(candidate)
        if eff_len > 0:
            sentences.append(candidate)
        elif sentences:
            sentences[-1] += candidate

    # SOKUJI: streaming API added for the sidecar's incremental synthesis
    # loop — upstream genie_tts only calls split() on a complete text. feed()
    # accumulates chunks and returns whichever sentences became complete;
    # flush() forces out whatever remains (e.g. at end-of-stream), bypassing
    # the min_len threshold since no more text is coming.
    def feed(self, chunk: str) -> List[str]:
        """Feed a streamed text chunk; returns newly completed sentences."""
        if not chunk:
            return []
        self._pending += chunk
        sentences, remainder = self._split_partial(self._pending)
        self._pending = remainder
        return sentences

    def flush(self) -> List[str]:
        """Force out whatever text remains buffered and reset state."""
        remainder = self._pending
        self._pending = ""
        candidate = remainder.strip()
        if not candidate:
            return []
        return [candidate]
