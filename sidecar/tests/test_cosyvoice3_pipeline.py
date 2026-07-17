import numpy as np

from sokuji_sidecar.cosyvoice3 import pipeline


class _Recorder:
    """Fake session recording feeds; returns canned outputs."""
    def __init__(self, fn):
        self.fn, self.calls = fn, []

    def run(self, _names, feeds):
        self.calls.append(feeds)
        return self.fn(feeds)


class _FakeTok:
    def encode(self, text, add_special_tokens=False):
        class E: ids = [max(1, ord(c) % 100) for c in text]
        return E()


def _fake_sessions(script):
    """script: list of token ids the fake llm_decoder emits per step."""
    state = {"step": -1}
    hid = np.zeros((1, 1, 896), np.float32)

    def decoder(feeds):
        state["step"] += 1
        logits = np.full((1, 6761), -100.0, np.float32)
        logits[0, script[min(state["step"], len(script) - 1)]] = 100.0
        return [logits]

    S = 4  # prompt speech tokens
    return {
        "text_embedding": _Recorder(lambda f: [np.zeros((1, f["input_ids"].shape[1], 896), np.float32)]),
        "speech_embedding": _Recorder(lambda f: [np.zeros((1, f["token"].shape[1], 896), np.float32)]),
        "llm_initial": _Recorder(lambda f: [np.zeros((1, f["inputs_embeds"].shape[1], 896), np.float32),
                                            np.zeros((48, 1, 2, f["inputs_embeds"].shape[1], 64), np.float32)]),
        "llm_decode": _Recorder(lambda f: [hid, np.zeros((48, 1, 2, f["past_key_values"].shape[3] + 1, 64), np.float32)]),
        "llm_decoder": _Recorder(decoder),
        "speech_tokenizer": _Recorder(lambda f: [np.arange(S, dtype=np.int32).reshape(1, S)]),
        "campplus": _Recorder(lambda f: [np.zeros((1, 192), np.float32)]),
        "flow_token_embedding": _Recorder(lambda f: [np.zeros((1, f["token"].shape[1], 80), np.float32)]),
        "flow_pre_lookahead": _Recorder(lambda f: [np.zeros((1, 2 * f["token_embedded"].shape[1], 80), np.float32)]),
        "flow_spk_projection": _Recorder(lambda f: [np.zeros((1, 80), np.float32)]),
        "flow_estimator": _Recorder(lambda f: [np.ones_like(f["x"])]),
        "hift_f0": _Recorder(lambda f: [np.full((1, f["mel"].shape[2]), 100.0, np.float32)]),
        "hift_source": _Recorder(lambda f: [np.zeros((1, 1, f["f0"].shape[2] * 480), np.float32)]),
        "hift_decoder": _Recorder(lambda f: [np.ones((1, 9, f["source_stft"].shape[2]), np.float32) * 0.1,
                                             np.zeros((1, 9, f["source_stft"].shape[2]), np.float32)]),
    }


def _prompt(sessions):
    tok = _FakeTok()
    audio = np.zeros(24000, dtype=np.float32)
    return pipeline.process_prompt(sessions, tok, audio, 24000, "ref text")


def test_prompt_mel_frames_are_twice_tokens():
    sessions = _fake_sessions([6562])
    p = _prompt(sessions)
    assert p.mel.shape[0] == 2 * p.speech_tokens.shape[1]


def test_llm_stops_on_any_reserved_id_and_never_emits_it():
    # script: 3 speech tokens then reserved id 6725 (NOT 6562). tts_text is a
    # single character so len(tts_ids)==1 under the char-level _FakeTok,
    # keeping min_len=MIN_TOKEN_TEXT_RATIO*1=2 small enough that the stop-range
    # mask (active only while i<min_len) has already lifted by the time the
    # reserved id appears at loop index 3 -- otherwise a longer tts_text would
    # inflate min_len past 3 under this char-per-token fake tokenizer and mask
    # away the very id this test exists to check.
    sessions = _fake_sessions([10, 11, 12, 6725])
    p = _prompt(sessions)
    audio = pipeline.synthesize(sessions, _FakeTok(), "a", p,
                                np.random.default_rng(0))
    # flow got prompt tokens + exactly the 3 emitted ids
    flow_feed = sessions["flow_token_embedding"].calls[-1]["token"]
    assert flow_feed.shape[1] == p.speech_tokens.shape[1] + 3
    assert flow_feed.max() < 6561


def test_silent_run_dropped_from_flow_but_llm_continues():
    # 8 distinct SILENT_TOKENS members (not one repeated id): ras_sampling's
    # repetition-ban (win_size=10, tau_r=0.1 -> bans on a SINGLE prior
    # occurrence, see test_cosyvoice3_sampling.py::test_repetition_triggers_resample)
    # would otherwise ban the 2nd+ attempt at the same fixed peak id and
    # scatter the resample uniformly over the ~6560-entry vocabulary, so a
    # script that repeats one id can never actually emit that id 8 times in a
    # row. Using 8 different SILENT_TOKENS ids sidesteps the ban (each is a
    # first-time occurrence) while still exercising MAX_CONSECUTIVE_SILENT,
    # which counts category membership, not exact-id equality -- matching how
    # a real model's silence run would let RAS rotate among several
    # silence/breath ids while staying classified as silent throughout.
    silents = [1, 2, 28, 29, 55, 248, 494, 2241]
    script = [10] + silents + [11, 6562]
    sessions = _fake_sessions(script)
    p = _prompt(sessions)
    # tts_text is a single character (see note above) so min_len stays small
    # enough that the stop id at script index 10 isn't still under the mask.
    pipeline.synthesize(sessions, _FakeTok(), "a", p,
                        np.random.default_rng(0))
    flow_feed = sessions["flow_token_embedding"].calls[-1]["token"]
    # 10 emitted tokens minus (8-5)=3 dropped silents
    assert flow_feed.shape[1] == p.speech_tokens.shape[1] + 10 - 3


def test_estimator_gets_cfg_rows():
    sessions = _fake_sessions([10, 6562])
    p = _prompt(sessions)
    pipeline.synthesize(sessions, _FakeTok(), "abcd", p, np.random.default_rng(0))
    feeds = sessions["flow_estimator"].calls
    assert len(feeds) == pipeline.N_TIMESTEPS
    f = feeds[0]
    assert f["x"].shape[0] == 2
    assert np.allclose(f["mu"][1], 0) and np.allclose(f["cond"][1], 0) \
        and np.allclose(f["spks"][1], 0)


def test_speed_scales_mel_length():
    sessions = _fake_sessions([10, 11, 12, 13, 6562])
    p = _prompt(sessions)
    a1 = pipeline.synthesize(sessions, _FakeTok(), "abcd", p, np.random.default_rng(0), speed=1.0)
    sessions2 = _fake_sessions([10, 11, 12, 13, 6562])
    p2 = _prompt(sessions2)
    a2 = pipeline.synthesize(sessions2, _FakeTok(), "abcd", p2, np.random.default_rng(0), speed=2.0)
    assert abs(len(a1) / 2 - len(a2)) <= 960   # 2x speed halves duration (±2 frames)


def test_empty_text_returns_empty_audio():
    sessions = _fake_sessions([6562])
    p = _prompt(sessions)
    out = pipeline.synthesize(sessions, _FakeTok(), "   ", p, np.random.default_rng(0))
    assert out.size == 0
