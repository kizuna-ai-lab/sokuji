import sentencepiece as spm


class PocketTokenizer:
    def __init__(self, model_path: str):
        self._sp = spm.SentencePieceProcessor()
        self._sp.Load(model_path)

    def encode_ids(self, text: str) -> list[int]:
        return self._sp.EncodeAsIds(text)
