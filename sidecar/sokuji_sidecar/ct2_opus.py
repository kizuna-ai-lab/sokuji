"""Opus-MT translation via CTranslate2 (int8, CPU).

Replaces the former marian_onnx numpy decode loop (~11x slower; also had the
ignored-bad_words_ids empty-output bug). Model dirs mirror the
gaudi/opus-mt-*-ctranslate2 layout: config.json, model.bin,
shared_vocabulary.json, source.spm, target.spm.

These conversions ship add_source_eos=false, so the source token sequence
must end with an explicit </s> — omitting it degenerates into repetition
loops. Source length is capped at 510 pieces (+eos) to stay under Marian's
512 positional-embedding limit."""
import os

_SRC_MAX_PIECES = 510


class Ct2OpusSession:
    def __init__(self, model_dir: str):
        import ctranslate2
        import sentencepiece
        self._translator = ctranslate2.Translator(
            model_dir, device="cpu", compute_type="int8", inter_threads=1)
        self._src = sentencepiece.SentencePieceProcessor(
            model_file=os.path.join(model_dir, "source.spm"))
        self._tgt = sentencepiece.SentencePieceProcessor(
            model_file=os.path.join(model_dir, "target.spm"))

    def translate(self, text: str, max_new_tokens: int = 512) -> tuple[str, int]:
        pieces = self._src.encode(text, out_type=str)[:_SRC_MAX_PIECES] + ["</s>"]
        result = self._translator.translate_batch(
            [pieces], beam_size=1, max_decoding_length=max_new_tokens)
        hyp = result[0].hypotheses[0]
        return self._tgt.decode(hyp).strip(), len(hyp)
