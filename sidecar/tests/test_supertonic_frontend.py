from sokuji_sidecar.supertonic_frontend import preprocess_text, apply_indexer

AVAIL = {"en", "ko", "ja", "de", "es", "fr", "it", "ru"}


def test_preprocess_wraps_supported_lang_and_normalizes():
    assert preprocess_text("Hello  world", "en", AVAIL) == "<en>Hello world.</en>"


def test_preprocess_unsupported_lang_falls_back_to_na():
    assert preprocess_text("Hola", "xx", AVAIL) == "<na>Hola.</na>"


def test_apply_indexer_maps_charcodes_and_drops_unsupported():
    idx = [-1] * 128
    idx[ord("A")] = 5
    assert apply_indexer("A", idx) == [5]
    assert apply_indexer("B", idx) == [0]


def test_preprocess_converts_smart_quotes():
    # curly quotes -> ASCII "; trailing word forces a clean terminal '.'
    assert preprocess_text("“Hi” there", "en", AVAIL) == "<en>\"Hi\" there.</en>"


def test_preprocess_cjk_terminal_recognized():
    # 】 (right lenticular bracket) is terminal punctuation -> no '.' appended
    assert preprocess_text("Note】", "en", AVAIL) == "<en>Note】</en>"
