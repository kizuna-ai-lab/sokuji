import asyncio, json, os
import pytest
from sokuji_sidecar import native_models as nm
from sokuji_sidecar import native_models
from sokuji_sidecar import server


def test_download_specs_mapping(monkeypatch):
    # download_specs honours the SOKUJI_ASR_REPO override; clear it so the
    # default-repo assertions below are deterministic in any environment.
    monkeypatch.delenv('SOKUJI_ASR_REPO', raising=False)
    from sokuji_sidecar import catalog
    # Empty id is the implicit default → Qwen 2.5 0.5B; the explicit id maps the same.
    # Upstream-sourced (Task 14b): a files-shaped spec naming the exact GGUF file.
    expected_files = [catalog.split_artifact(catalog._gguf_artifact('qwen2.5-0.5b', 'q8_0'))]
    assert nm.download_specs('')['files'] == expected_files
    assert nm.download_specs('qwen2.5-0.5b')['files'] == expected_files
    # The legacy 'qwen' alias was dropped — it now falls through to a bare repo id.
    assert nm.download_specs('qwen')['repos'] == ['qwen']
    assert nm.download_specs('whisper-base')['files'] == \
        [('handy-computer/whisper-base-gguf', 'whisper-base-Q8_0.gguf')]
    assert nm.download_specs('csukuangfj/vits-piper-en_US-amy-low')['repos'] == ['csukuangfj/vits-piper-en_US-amy-low']
    sv = nm.download_specs('sense-voice')
    assert sv['files'] == [('handy-computer/SenseVoiceSmall-gguf', 'SenseVoiceSmall-Q8_0.gguf')]
    assert sv['urls'] == [nm.VAD_URL]
    # Speech-LLM ids map to their handy-computer GGUF (one pinned file each).
    assert nm.download_specs('granite-speech-4.1-2b')['files'] == \
        [('handy-computer/granite-speech-4.1-2b-gguf', 'granite-speech-4.1-2b-Q4_K_M.gguf')]
    assert nm.download_specs('qwen3-asr-1.7b')['files'] == \
        [('handy-computer/Qwen3-ASR-1.7B-gguf', 'Qwen3-ASR-1.7B-Q4_K_M.gguf')]


def test_download_specs_cohere():
    # One pinned GGUF (the repo ships 6 quants). ASR model -> shared VAD appended.
    import sokuji_sidecar.native_models as nm
    spec = native_models.download_specs("cohere-transcribe-03-2026")
    assert spec["repos"] == [] and spec["urls"] == [nm.VAD_URL]
    assert spec["files"] == [("handy-computer/cohere-transcribe-03-2026-gguf",
                              "cohere-transcribe-03-2026-Q4_K_M.gguf")]


def test_download_specs_appends_shared_vad_for_asr_models():
    """The silero VAD is a shared dependency of EVERY ASR model (AsrEngine._init_vad
    loads it for offline + streaming). download_specs must append it for any ASR
    model, not just SenseVoice; non-ASR ids (translation/TTS) must NOT get it."""
    for asr_id in ('sense-voice', 'fun-asr-mlt-nano', 'whisper-base', 'qwen3-asr-1.7b',
                   'voxtral-mini-4b-realtime', 'granite-speech-4.1-2b'):
        assert nm.download_specs(asr_id)['urls'] == [nm.VAD_URL], asr_id
    for non_asr in ('', 'qwen', 'translategemma-4b', 'csukuangfj/vits-piper-en_US-amy-low'):
        assert nm.download_specs(non_asr)['urls'] == [], non_asr
    # single-GGUF specs never need an ignore list
    assert 'ignore' not in nm.download_specs('voxtral-mini-4b-realtime')


def test_delete_model_keeps_shared_vad(monkeypatch, tmp_path):
    """Deleting an ASR model must NOT remove the shared silero VAD — another
    installed ASR model still depends on it."""
    vad = tmp_path / 'silero_vad.onnx'
    vad.write_bytes(b'x' * 16)

    def _no_cache():
        raise RuntimeError('no HF cache in this env')

    monkeypatch.setattr(nm, '_vad_cache_path', lambda: str(vad))
    monkeypatch.setattr('huggingface_hub.scan_cache_dir', _no_cache)
    nm.delete_model('fun-asr-mlt-nano')
    assert vad.exists()  # VAD survives the delete


def test_download_specs_qwen25_ignores_stale_translate_model_env(monkeypatch):
    # Translate specs are now catalog-driven (upstream GGUF file artifacts), not an
    # env-overridable HF id — SOKUJI_TRANSLATE_MODEL no longer has any effect on the
    # resolved artifact, for BOTH the implicit default ('') and the explicit id.
    from sokuji_sidecar import catalog
    monkeypatch.setenv('SOKUJI_TRANSLATE_MODEL', 'acme/custom-translate')
    expected = [catalog.split_artifact(catalog._gguf_artifact('qwen2.5-0.5b', 'q8_0'))]
    assert nm.download_specs('')['files'] == expected
    assert nm.download_specs('qwen2.5-0.5b')['files'] == expected


def test_download_raises_when_no_files_resolved(monkeypatch):
    """A repo whose files cannot be listed must NOT silently report 'ready'.

    Regression: a wrong/unreachable repo id made list_repo_files raise, which the
    old code swallowed -> total=0 -> returned 'ready' instantly (download appeared
    to complete with nothing fetched, then status re-read as absent)."""
    import huggingface_hub

    class _Api:
        def list_repo_files(self, repo):
            raise RuntimeError(f"RepositoryNotFoundError: {repo}")

    monkeypatch.setattr(nm, 'download_specs', lambda m, repo=None: {'repos': ['bogus/repo'], 'urls': []})
    monkeypatch.setattr(huggingface_hub, 'HfApi', _Api)

    sent = []

    async def send(m):
        sent.append(m)

    with pytest.raises(Exception):
        asyncio.run(nm.download('bogus-model', send))


def test_status_handler_shape(monkeypatch):
    monkeypatch.setattr(nm, 'model_status', lambda m, repo=None: 'ready' if m == 'sense-voice' else 'absent')
    st = {'handlers': {}}
    nm.register(st)
    reply, _ = asyncio.run(server.handle_message(
        st, json.dumps({'type': 'model_status', 'id': 1, 'models': ['sense-voice', 'whisper-base']})))
    assert reply == {'type': 'model_status_result', 'id': 1,
                     'statuses': {'sense-voice': 'ready', 'whisper-base': 'absent'}}


@pytest.mark.skipif(not os.environ.get('SOKUJI_RUN_ASR_MODEL'),
                    reason='set SOKUJI_RUN_ASR_MODEL=1 (uses the cached sense-voice repo)')
def test_real_status_of_sense_voice_repo():
    # sense-voice was downloaded by Tier-0; a bogus id must be absent.
    assert nm.model_status('FunAudioLLM/SenseVoiceSmall') == 'ready'
    assert nm.model_status('csukuangfj/this-repo-does-not-exist-xyz') == 'absent'


@pytest.mark.skipif(not os.environ.get('SOKUJI_RUN_ASR_MODEL'),
                    reason='set SOKUJI_RUN_ASR_MODEL=1 (queries HF repo size)')
def test_real_size_of_sense_voice():
    nm._SIZE_CACHE.clear()
    assert nm.model_size('sense-voice') > 100_000_000  # model.int8.onnx alone is >100MB


def test_delete_handler_shape(monkeypatch):
    monkeypatch.setattr(nm, 'delete_model', lambda m, repo=None: 4096)
    st = {'handlers': {}}
    nm.register(st)
    reply, _ = asyncio.run(server.handle_message(
        st, json.dumps({'type': 'model_delete', 'id': 7, 'model': 'whisper-base'})))
    assert reply == {'type': 'model_delete_result', 'id': 7, 'model': 'whisper-base', 'freed': 4096}


def test_delete_model_honors_variant_repo(monkeypatch):
    """delete_model must free the CHOSEN variant's repo, not the model's default —
    otherwise an FP8-only HY-MT download can never be removed (status keeps
    reporting it cached against the FP8 repo)."""
    from sokuji_sidecar import native_models as nm
    seen = {}
    monkeypatch.setattr(nm, "download_specs",
                        lambda model_id, repo=None: (seen.update(repo=repo), {"repos": [repo or "default"], "urls": []})[1])
    monkeypatch.setattr("huggingface_hub.scan_cache_dir", lambda: (_ for _ in ()).throw(RuntimeError("no cache")))
    nm.delete_model("hy-mt2-7b", repo="tencent/Hy-MT2-7B-FP8")
    assert seen["repo"] == "tencent/Hy-MT2-7B-FP8"   # the variant repo, not the bf16 default


def test_h_model_delete_forwards_repo(monkeypatch):
    """The model_delete handler threads the per-card chosen-variant repo through
    to delete_model (mirrors model_status's repo override)."""
    from sokuji_sidecar import native_models as nm
    calls = []
    monkeypatch.setattr(nm, "delete_model",
                        lambda model_id, repo=None: (calls.append((model_id, repo)), 4096)[1])
    st = {'handlers': {}}
    nm.register(st)
    reply, _ = asyncio.run(server.handle_message(
        st, json.dumps({'type': 'model_delete', 'id': 7, 'model': 'hy-mt2-7b',
                        'repo': 'tencent/Hy-MT2-7B-FP8'})))
    assert ('hy-mt2-7b', 'tencent/Hy-MT2-7B-FP8') in calls
    assert reply == {'type': 'model_delete_result', 'id': 7, 'model': 'hy-mt2-7b', 'freed': 4096}


def test_download_is_nonblocking_and_pushes_completion(monkeypatch):
    # download runs as a background task; the handler returns nothing (completion
    # is pushed) so the connection stays free to receive model_cancel.
    async def fake_download(model_id, send, should_cancel=None, repo=None):
        await send({'type': 'model_progress', 'model': model_id, 'downloaded': 1, 'total': 1})
        return 'ready'
    monkeypatch.setattr(nm, 'download', fake_download)

    class FakeWS:
        def __init__(self): self.sent = []
        async def send(self, d): self.sent.append(d)

    async def scenario():
        st = {}
        nm.register(st)
        conn = server.Conn(FakeWS())
        reply, _ = await server.handle_message(
            st, json.dumps({'type': 'model_download', 'id': 1, 'model': 'm'}), None, conn)
        assert reply is None                      # no synchronous ack
        await st['download_tasks']['m']           # let the task finish
        return conn._ws.sent

    sent = [json.loads(s) for s in asyncio.run(scenario())]
    assert {'type': 'model_progress', 'model': 'm', 'downloaded': 1, 'total': 1} in sent
    assert sent[-1] == {'type': 'model_download_done', 'model': 'm', 'status': 'ready'}


def test_model_cancel_stops_download_at_file_boundary(monkeypatch):
    # a multi-file download checks should_cancel between files and stops promptly
    async def fake_download(model_id, send, should_cancel=None, repo=None):
        while True:
            if should_cancel and should_cancel():
                return 'cancelled'
            await send({'type': 'model_progress', 'model': model_id, 'downloaded': 1, 'total': 9})
            await asyncio.sleep(0)
    monkeypatch.setattr(nm, 'download', fake_download)

    class FakeWS:
        def __init__(self): self.sent = []
        async def send(self, d): self.sent.append(d)

    async def scenario():
        st = {}
        nm.register(st)
        conn = server.Conn(FakeWS())
        await server.handle_message(st, json.dumps({'type': 'model_download', 'id': 1, 'model': 'm'}), None, conn)
        task = st['download_tasks']['m']
        await asyncio.sleep(0)                     # stream at least one progress
        reply, _ = await server.handle_message(st, json.dumps({'type': 'model_cancel', 'id': 2, 'model': 'm'}), None, conn)
        assert reply == {'type': 'ok', 'id': 2}
        await task
        # cancel + task bookkeeping is cleaned up
        assert 'm' not in st['cancels'] and 'm' not in st['download_tasks']
        return conn._ws.sent

    sent = [json.loads(s) for s in asyncio.run(scenario())]
    assert any(m['type'] == 'model_progress' for m in sent)
    assert sent[-1] == {'type': 'model_download_done', 'model': 'm', 'status': 'cancelled'}


def test_model_status_rejects_interrupted_download(monkeypatch, tmp_path):
    """Interrupted download (.incomplete with no finalized blob) → 'absent', but a
    stale .incomplete alongside its finalized blob must still read 'ready'."""
    import huggingface_hub, huggingface_hub.constants
    from sokuji_sidecar import native_models
    # a repo-shaped spec (ASR cards are all single-file GGUFs now; piper TTS
    # repos still exercise the blob-scan path)
    mid = "csukuangfj/vits-piper-en_US-amy-low"
    repo = native_models.download_specs(mid)["repos"][0]
    blobs = tmp_path / f"models--{repo.replace('/', '--')}" / "blobs"
    blobs.mkdir(parents=True)
    monkeypatch.setattr(huggingface_hub.constants, "HF_HUB_CACHE", str(tmp_path))
    monkeypatch.setattr(huggingface_hub, "snapshot_download", lambda **k: str(tmp_path))
    (blobs / "abc123").write_text("a finalized blob")
    assert native_models.model_status(mid) == "ready"
    # interrupted: '<sha>.<etag>.incomplete' with its finalized '<sha>' blob MISSING
    (blobs / "def456.a1b2c3.incomplete").write_bytes(b"half-fetched safetensors")
    assert native_models.model_status(mid) == "absent"
    # stale leftover: the finalized blob has since landed → ignore the orphan .incomplete
    (blobs / "def456").write_text("now finalized")
    assert native_models.model_status(mid) == "ready"


def test_download_specs_voxtral_single_gguf():
    spec = nm.download_specs("voxtral-mini-4b-realtime")
    assert spec["files"] == [("handy-computer/Voxtral-Mini-4B-Realtime-2602-gguf",
                              "Voxtral-Mini-4B-Realtime-2602-Q4_K_M.gguf")]
    assert spec["urls"] == [nm.VAD_URL]  # ASR model → shared VAD appended


def test_existing_specs_have_no_ignore_key():
    # The ignore key is additive: every pre-existing model omits it (consumers use .get).
    assert "ignore" not in nm.download_specs("cohere-transcribe-03-2026")
    assert "ignore" not in nm.download_specs("qwen3-asr-1.7b")


def test_hy_mt2_specs_have_no_ignore_key():
    # HY-MT2 now resolves to the mirrored single-file GGUF repo (catalog-driven),
    # not the upstream tencent/ checkpoint that shipped train/ + imgs/ cruft —
    # the mirror carries only the GGUF, so there's nothing left to ignore.
    for mid in ("hy-mt2-1.8b", "hy-mt2-7b"):
        assert "ignore" not in nm.download_specs(mid)


def test_ignored_filter_is_glob_aware():
    # Directory globs match nested files (fnmatch '*' spans '/'); exact filenames
    # match only themselves; non-matches pass through.
    assert nm._ignored("train/deepspeed/train.py", ["train/*", "imgs/*"])
    assert nm._ignored("imgs/overview.png", ["train/*", "imgs/*"])
    assert not nm._ignored("model.safetensors", ["train/*", "imgs/*"])
    assert nm._ignored("tf_model.h5", ["tf_model.h5", "rust_model.ot"])     # exact
    assert not nm._ignored("pytorch_model.bin", ["tf_model.h5", "rust_model.ot"])


def test_download_honors_ignore_list(monkeypatch):
    """The ignore list keeps consolidated.safetensors out of the fetched file set,
    so transformers' model.safetensors is fetched but the 8.86GB duplicate is not."""
    import huggingface_hub
    fetched = []

    class _Api:
        def list_repo_files(self, repo):
            return ["model.safetensors", "consolidated.safetensors", "config.json", "tekken.json"]

    monkeypatch.setattr(nm, "download_specs", lambda m, repo=None: {
        "repos": ["r"], "urls": [], "ignore": ["consolidated.safetensors"]})
    monkeypatch.setattr(huggingface_hub, "HfApi", _Api)
    monkeypatch.setattr(huggingface_hub, "hf_hub_download",
                        lambda repo, fname: fetched.append(fname))

    async def send(_m):
        pass

    status = asyncio.run(nm.download("voxtral-mini-4b-realtime", send))
    assert status == "ready"
    assert "consolidated.safetensors" not in fetched
    assert "model.safetensors" in fetched and "tekken.json" in fetched


def test_download_glob_excludes_nested_dirs(monkeypatch):
    """A directory glob (train/*) keeps nested training files out of the fetch —
    the exact-match filter this replaced would have downloaded them."""
    import huggingface_hub
    from sokuji_sidecar import llama_runtime as rt
    fetched = []

    class _Api:
        def list_repo_files(self, repo):
            return ["model.safetensors", "config.json",
                    "train/train.py", "train/deepspeed/ds.json", "imgs/overview.png"]

    monkeypatch.setattr(nm, "download_specs", lambda m, repo=None: {
        "repos": ["r"], "urls": [], "ignore": ["train/*", "imgs/*"]})
    monkeypatch.setattr(huggingface_hub, "HfApi", _Api)
    monkeypatch.setattr(huggingface_hub, "hf_hub_download",
                        lambda repo, fname: fetched.append(fname))
    # hy-mt2-1.8b is a llamacpp card — pretend every required flavor is already
    # installed so this file-glob test doesn't also exercise (or, worse,
    # actually hit the network for) the llama-binary install path.
    monkeypatch.setattr(rt, "binary_path", lambda flavor: "/x/llama")

    async def send(_m):
        pass

    status = asyncio.run(nm.download("hy-mt2-1.8b", send))
    assert status == "ready"
    assert fetched == ["model.safetensors", "config.json"]   # nested train/ + imgs/ excluded


def test_model_size_excludes_ignored_files(monkeypatch):
    import huggingface_hub

    class _Sib:
        def __init__(self, name, size):
            self.rfilename = name
            self.size = size

    class _Info:
        siblings = [_Sib("model.safetensors", 8_000_000_000),
                    _Sib("consolidated.safetensors", 8_000_000_000),
                    _Sib("config.json", 1000)]

    class _Api:
        def repo_info(self, repo, files_metadata=False):
            return _Info()

    monkeypatch.setattr(nm, "download_specs", lambda m: {
        "repos": ["r"], "urls": [], "ignore": ["consolidated.safetensors"]})
    monkeypatch.setattr(huggingface_hub, "HfApi", _Api)
    nm._SIZE_CACHE.clear()
    # A non-hardcoded id so the live-fallback path (which applies `ignore`) is exercised.
    assert nm.model_size("not-a-hardcoded-model") == 8_000_001_000  # consolidated excluded


def test_download_specs_fun_asr_mlt_nano():
    spec = nm.download_specs('fun-asr-mlt-nano')
    assert spec['files'] == [('handy-computer/Fun-ASR-MLT-Nano-2512-gguf',
                              'Fun-ASR-MLT-Nano-2512-Q6_K.gguf')]
    # AsrEngine._init_vad() loads silero for the offline path too, so a Nano-only
    # offline install must pre-fetch the shared VAD (not rely on a session-time download).
    assert spec['urls'] == [nm.VAD_URL]
def _file_spec(mid, quant):
    """Helper: the expected files-shaped download_specs entry for an LLM translate card."""
    from sokuji_sidecar import catalog
    return [catalog.split_artifact(catalog._gguf_artifact(mid, quant))]


def test_download_specs_qwen_translate_repos():
    from sokuji_sidecar import native_models as nm
    assert nm.download_specs("qwen2.5-0.5b")["files"] == _file_spec("qwen2.5-0.5b", "q8_0")
    assert nm.download_specs("qwen3-0.6b")["files"] == _file_spec("qwen3-0.6b", "q8_0")
    assert nm.download_specs("qwen3.5-0.8b")["files"] == _file_spec("qwen3.5-0.8b", "q4_k_m")
    assert nm.download_specs("qwen3.5-2b")["files"] == _file_spec("qwen3.5-2b", "q4_k_m")


def test_download_specs_new_translate_models():
    from sokuji_sidecar import native_models as nm
    assert nm.download_specs("translategemma-4b")["files"] == \
        _file_spec("translategemma-4b", "q4_k_m")
    h18 = nm.download_specs("hy-mt2-1.8b")
    assert h18["files"] == _file_spec("hy-mt2-1.8b", "q4_k_m")
    assert "ignore" not in h18   # the upstream GGUF file needs no filtering
    h7 = nm.download_specs("hy-mt2-7b")
    assert h7["files"] == _file_spec("hy-mt2-7b", "q4_k_m")
    assert "ignore" not in h7


def test_download_specs_variant_repo_override():
    # A bare 2-segment override repo (no filename) keeps the legacy repos-shaped spec.
    from sokuji_sidecar import native_models as nm
    spec = nm.download_specs("hy-mt2-7b", repo="tencent/Hy-MT2-7B-FP8")
    assert spec["repos"] == ["tencent/Hy-MT2-7B-FP8"]


def test_download_specs_variant_repo_override_file_artifact():
    # The real-world variant override (Task 14b): the renderer's chosen variant
    # repo IS an upstream file artifact (a Deployment.artifact), not a bare repo —
    # e.g. picking the q8_0 sibling of a card whose default is q4_k_m.
    from sokuji_sidecar import native_models as nm
    from sokuji_sidecar import catalog
    alt = catalog._gguf_artifact("hy-mt2-7b", "q8_0")
    spec = nm.download_specs("hy-mt2-7b", repo=alt)
    assert spec == {"repos": [], "urls": [], "files": [catalog.split_artifact(alt)]}


def test_download_fetches_chosen_variant_repo(monkeypatch):
    """download(model, send, repo=...) must fetch files from the CHOSEN variant repo,
    not the model's default — the end-to-end wiring that makes the FP8 quant load."""
    import huggingface_hub
    from sokuji_sidecar import llama_runtime as rt
    fetched = []

    class _Api:
        def list_repo_files(self, repo):
            return [f"{repo}/model.safetensors", "config.json"]

    monkeypatch.setattr(huggingface_hub, "HfApi", _Api)
    monkeypatch.setattr(huggingface_hub, "hf_hub_download",
                        lambda repo, fname: fetched.append((repo, fname)))
    # hy-mt2-7b is a llamacpp card — pretend every required flavor is already
    # installed (see test_download_glob_excludes_nested_dirs for why).
    monkeypatch.setattr(rt, "binary_path", lambda flavor: "/x/llama")

    async def send(_m):
        pass

    status = asyncio.run(nm.download("hy-mt2-7b", send, repo="tencent/Hy-MT2-7B-FP8"))
    assert status == "ready"
    # Every fetched file came from the FP8 repo, NOT the default bf16 tencent/Hy-MT2-7B.
    assert fetched and all(repo == "tencent/Hy-MT2-7B-FP8" for repo, _ in fetched)


def test_h_model_download_passes_repo_through(monkeypatch):
    """The model_download handler reads msg['repo'] and threads it to download(),
    so the renderer's chosen variant repo reaches the fetch."""
    captured = {}

    async def fake_download(model_id, send, should_cancel=None, repo=None):
        captured["repo"] = repo
        await send({"type": "model_progress", "model": model_id, "downloaded": 1, "total": 1})
        return "ready"
    monkeypatch.setattr(nm, "download", fake_download)

    class FakeWS:
        def __init__(self): self.sent = []
        async def send(self, d): self.sent.append(d)

    async def scenario():
        st = {}
        nm.register(st)
        conn = server.Conn(FakeWS())
        await server.handle_message(
            st, json.dumps({"type": "model_download", "id": 1, "model": "hy-mt2-7b",
                            "repo": "tencent/Hy-MT2-7B-FP8"}), None, conn)
        await st["download_tasks"]["hy-mt2-7b"]

    asyncio.run(scenario())
    assert captured["repo"] == "tencent/Hy-MT2-7B-FP8"


def test_download_specs_opus_maps_to_mirrored_repo():
    from sokuji_sidecar import native_models as nm
    from sokuji_sidecar import catalog
    # Opus-MT now resolves directly to our self-hosted CT2 repo, pinned to
    # the 5 files the ct2_opus_translate backend needs (OPUS_FILES).
    zh_en = {"repos": [], "urls": [],
             "files": [("jiangzhuo9357/opus-mt-zh-en-ct2", f) for f in nm.OPUS_FILES]}
    en_jap = {"repos": [], "urls": [],
              "files": [("jiangzhuo9357/opus-mt-en-jap-ct2", f) for f in nm.OPUS_FILES]}
    assert nm.download_specs("opus-mt-zh-en") == zh_en
    assert nm.download_specs("opus-mt-en-jap") == en_jap
    assert "ignore" not in nm.download_specs("opus-mt-zh-en")


def test_opus_files_are_the_ct2_set():
    from sokuji_sidecar import native_models
    assert native_models.OPUS_FILES == [
        "config.json", "model.bin", "shared_vocabulary.json",
        "source.spm", "target.spm"]


def test_download_specs_hymt15():
    from sokuji_sidecar import native_models as nm
    assert nm.download_specs("hy-mt15-1.8b")["files"] == _file_spec("hy-mt15-1.8b", "q4_k_m")
    assert nm.download_specs("hy-mt15-7b")["files"] == _file_spec("hy-mt15-7b", "q4_k_m")
    # clean specs → no ignore key (both sizes)
    assert "ignore" not in nm.download_specs("hy-mt15-1.8b")
    assert "ignore" not in nm.download_specs("hy-mt15-7b")
    # FP8 variant download rides the repo-override path (a bare 2-segment repo,
    # not an upstream file artifact, so it keeps the legacy repos-shaped spec).
    assert nm.download_specs("hy-mt15-7b", repo="tencent/HY-MT1.5-7B-FP8")["repos"] == ["tencent/HY-MT1.5-7B-FP8"]


def test_model_status_repo_override(monkeypatch):
    from sokuji_sidecar import native_models as nm
    seen = {}

    def fake_snapshot(repo_id, local_files_only):
        seen["repo"] = repo_id
        return "/cache"
    monkeypatch.setattr("huggingface_hub.snapshot_download", fake_snapshot)
    # no .incomplete files → ready; we only assert which repo was checked
    monkeypatch.setattr("glob.glob", lambda *a, **k: [])
    nm.model_status("hy-mt2-1.8b", repo="tencent/Hy-MT2-1.8B-FP8")
    assert seen["repo"] == "tencent/Hy-MT2-1.8B-FP8"   # the variant repo, not the bf16 default


def test_h_model_status_applies_repos_map(monkeypatch):
    import asyncio
    from sokuji_sidecar import native_models as nm
    calls = []
    monkeypatch.setattr(nm, "model_status",
                        lambda mid, repo=None: (calls.append((mid, repo)), "ready")[1])
    msg = {"id": 1, "models": ["hy-mt2-1.8b", "sense-voice"],
           "repos": {"hy-mt2-1.8b": "tencent/Hy-MT2-1.8B-FP8"}}
    reply, _ = asyncio.run(nm._h_model_status(None, msg, None))
    assert ("hy-mt2-1.8b", "tencent/Hy-MT2-1.8B-FP8") in calls
    assert ("sense-voice", None) in calls          # no override → default repo
    assert reply["statuses"] == {"hy-mt2-1.8b": "ready", "sense-voice": "ready"}


def test_download_specs_for_tts_moss_nano_has_two_repos_no_vad(monkeypatch):
    from sokuji_sidecar import native_models, accel
    monkeypatch.setattr(accel, "current_platform", lambda: "linux")  # deterministic on any host
    spec = native_models.download_specs("moss-tts-nano")
    assert len(spec["repos"]) == 2
    assert any("MOSS-TTS-Nano-100M-ONNX" in r for r in spec["repos"])
    assert any("MOSS-Audio-Tokenizer-Nano-ONNX" in r for r in spec["repos"])
    assert spec["urls"] == []          # TTS gets no silero VAD


def test_download_specs_for_tts_sherpa_single_repo():
    from sokuji_sidecar import native_models
    spec = native_models.download_specs("piper-en-amy")
    assert spec["repos"] == ["csukuangfj/vits-piper-en_US-amy-low"]
    assert spec["urls"] == []


def test_supertonic_download_ignores_samples_and_images():
    # The Supertonic HF repo ships ~14MB of audio_samples/*.wav + img/*.png
    # the runtime never loads — download_specs must skip them.
    spec = native_models.download_specs("supertonic-3")
    assert "Supertone/supertonic-3" in spec["repos"]
    assert "audio_samples/*" in spec.get("ignore", []) and "img/*" in spec.get("ignore", [])


def test_model_size_hardcoded_returns_without_network(monkeypatch):
    """Catalog model sizes are hardcoded — model_size must return them instantly
    without ever constructing HfApi / hitting the network."""
    import sokuji_sidecar.native_models as nm

    def boom(*a, **k):
        raise AssertionError("HfApi must not be called for a hardcoded model")

    monkeypatch.setattr("huggingface_hub.HfApi", boom)
    nm._SIZE_CACHE.clear()
    assert nm.model_size("sense-voice") == 252684608
    assert nm.model_size("hy-mt2-1.8b") == 1133080448
    assert nm.model_size("csukuangfj/vits-piper-en_US-amy-low") == 81105784


def test_model_size_file_artifact_uses_get_paths_info(monkeypatch):
    """A model_size id that is itself an upstream file artifact ("org/repo/file")
    — e.g. a Deployment.artifact with no est_bytes set — looks up just that one
    file's size via get_paths_info, not the whole repo's siblings."""
    import huggingface_hub
    from sokuji_sidecar import native_models as nm

    class _Path:
        def __init__(self, size):
            self.size = size

    class _Api:
        def get_paths_info(self, repo_id, paths):
            assert repo_id == "unsloth/Qwen3.5-0.8B-GGUF"
            assert paths == ["Qwen3.5-0.8B-Q8_0.gguf"]
            return [_Path(811843840)]

    monkeypatch.setattr(huggingface_hub, "HfApi", _Api)
    nm._SIZE_CACHE.clear()
    assert nm.model_size("unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q8_0.gguf") == 811843840


def test_qwen3_download_specs_point_at_per_size_repos(monkeypatch):
    from sokuji_sidecar import accel
    monkeypatch.setattr(accel, "current_platform", lambda: "linux")  # deterministic on any host
    assert "qwen3-tts-0.6b-onnx" in native_models.download_specs("qwen3-tts-0.6b")["repos"][0]
    assert "qwen3-tts-1.7b-onnx" in native_models.download_specs("qwen3-tts-1.7b")["repos"][0]


def test_download_specs_moss_mlx_on_apple_silicon(monkeypatch):
    import types
    from sokuji_sidecar import native_models as nm, accel
    monkeypatch.setattr(accel, "current_platform", lambda: "macos")
    monkeypatch.setattr(accel, "probe", lambda force=False: types.SimpleNamespace(apple_silicon=True))
    spec = nm.download_specs("moss-tts-nano")
    assert spec["repos"] == ["mlx-community/MOSS-TTS-Nano-100M"]
    assert spec["urls"] == []


def test_download_specs_qwen_mlx_on_apple_silicon(monkeypatch):
    import types
    from sokuji_sidecar import native_models as nm, accel
    monkeypatch.setattr(accel, "current_platform", lambda: "macos")
    monkeypatch.setattr(accel, "probe", lambda force=False: types.SimpleNamespace(apple_silicon=True))
    assert nm.download_specs("qwen3-tts-0.6b")["repos"] == \
        ["mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit"]
    assert nm.download_specs("qwen3-tts-1.7b")["repos"] == \
        ["mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit"]


def test_download_specs_moss_onnx_on_intel_mac(monkeypatch):
    import types
    from sokuji_sidecar import native_models as nm, accel
    # Intel Mac: platform is macos but NOT Apple Silicon → the MLX row isn't the
    # runnable one, so download the ONNX assets (both repos), same as elsewhere.
    monkeypatch.setattr(accel, "current_platform", lambda: "macos")
    monkeypatch.setattr(accel, "probe", lambda force=False: types.SimpleNamespace(apple_silicon=False))
    spec = nm.download_specs("moss-tts-nano")
    assert len(spec["repos"]) == 2
    assert any("MOSS-TTS-Nano-100M-ONNX" in r for r in spec["repos"])


def test_download_specs_moss_onnx_on_linux_without_probing(monkeypatch):
    from sokuji_sidecar import native_models as nm, accel
    monkeypatch.setattr(accel, "current_platform", lambda: "linux")

    def boom(force=False):
        raise AssertionError("probe() must not run on non-macOS (short-circuit)")
    monkeypatch.setattr(accel, "probe", boom)
    spec = nm.download_specs("moss-tts-nano")
    assert len(spec["repos"]) == 2   # ONNX assets; probe was short-circuited


def test_aishell3_download_ignores_unused_large_files():
    spec = native_models.download_specs("csukuangfj/vits-zh-aishell3")
    assert spec["repos"] == ["csukuangfj/vits-zh-aishell3"]
    for pat in ("G_AISHELL.pth", "rule.far", "vits-aishell3.int8.onnx"):
        assert pat in spec.get("ignore", [])


import pytest

from sokuji_sidecar import native_models as nm
from sokuji_sidecar import catalog


def test_translate_specs_come_from_catalog():
    spec = nm.download_specs("translategemma-4b")
    assert spec["files"] == [catalog.split_artifact(catalog._gguf_artifact("translategemma-4b", "q4_k_m"))]
    spec = nm.download_specs("qwen2.5-0.5b")
    assert spec["files"] == [catalog.split_artifact(catalog._gguf_artifact("qwen2.5-0.5b", "q8_0"))]
    spec = nm.download_specs("opus-mt-ja-en")
    assert spec["files"] == [("jiangzhuo9357/opus-mt-ja-en-ct2", f) for f in nm.OPUS_FILES]
    assert "ignore" not in spec  # the pinned file set needs no further filtering


def test_variant_repo_override_still_wins():
    # The override repo is now typically an upstream file artifact (the sibling
    # quant's Deployment.artifact) — split into a files-shaped spec.
    artifact = catalog._gguf_artifact("hy-mt2-7b", "q8_0")
    assert nm.download_specs("hy-mt2-7b", repo=artifact)["files"] == [catalog.split_artifact(artifact)]


def test_needs_llama_binary():
    assert nm._needs_llama_binary("translategemma-4b")
    assert not nm._needs_llama_binary("opus-mt-ja-en")
    assert not nm._needs_llama_binary("sense-voice")


def test_download_installs_cpu_flavor_alongside_default(monkeypatch):
    """Regression: download() used to install only llama_runtime.default_flavor()
    (e.g. 'cuda' on an NVIDIA box), leaving the tiny (~15-17MB) 'cpu' flavor
    never fetched. Picking device=cpu in the UI, or the gpu->cpu fallback
    chain's 'always available' floor, then hard-failed at load time even
    though the GGUF was fully cached. Both required flavors must be installed,
    each counted as its own progress unit."""
    import huggingface_hub
    from sokuji_sidecar import llama_runtime as rt

    monkeypatch.setattr(huggingface_hub, "hf_hub_download", lambda repo, fname: None)
    monkeypatch.setattr(rt, "default_flavor", lambda: "cuda")
    monkeypatch.setattr(rt, "binary_path", lambda flavor: None)  # neither flavor installed
    installed = []
    monkeypatch.setattr(rt, "ensure_binary", lambda flavor, progress=None: installed.append(flavor))

    sent = []

    async def send(m):
        sent.append(m)

    # translategemma-4b is a real llamacpp catalog row (files-shaped spec: one
    # pinned GGUF file, no repo listing / VAD needed).
    status = asyncio.run(nm.download("translategemma-4b", send))
    assert status == "ready"
    assert installed == ["cuda", "cpu"]
    # byte mode: total = GGUF size + 2 nominal flavor units; final pins to total
    expected = 2489909760 + 2 * nm._LLAMA_FLAVOR_EST_BYTES
    assert sent[-1]["total"] == expected
    assert sent[-1]["downloaded"] == expected


def test_status_absent_without_binary(monkeypatch):
    """model_status needs EVERY required llama flavor installed (the machine's
    default flavor AND the tiny cpu floor, see llama_runtime.required_flavors)
    — a card whose GGUF is fully cached but is missing even one flavor must
    still read 'absent', since that flavor's device (e.g. device=cpu in the
    UI) would otherwise hard-fail to load."""
    from sokuji_sidecar import llama_runtime as rt
    import huggingface_hub
    # files present (both the legacy repos-shaped check and the files-shaped
    # GGUF file check the qwen2.5-0.5b card actually uses)...
    monkeypatch.setattr(nm, "_repos_cached", lambda specs: True)
    monkeypatch.setattr(huggingface_hub, "hf_hub_download",
                        lambda repo, fname, local_files_only=True: "/cache/" + fname)
    monkeypatch.setattr(rt, "default_flavor", lambda: "cuda")
    # neither flavor present
    monkeypatch.setattr(rt, "binary_path", lambda flavor: None)
    assert nm.model_status("qwen2.5-0.5b") == "absent"
    # only the default (cuda) flavor present, cpu still missing -> still absent
    monkeypatch.setattr(rt, "binary_path", lambda flavor: "/x/llama" if flavor == "cuda" else None)
    assert nm.model_status("qwen2.5-0.5b") == "absent"
    # both required flavors present -> ready
    monkeypatch.setattr(rt, "binary_path", lambda flavor: "/x/llama")
    assert nm.model_status("qwen2.5-0.5b") == "ready"


def test_status_absent_when_gguf_file_missing(monkeypatch):
    """A files-shaped spec (GGUF/Opus card) reports 'absent' when the pinned
    file isn't cached — hf_hub_download(local_files_only=True) raising must not
    propagate, it must read back as a normal absent status."""
    from sokuji_sidecar import llama_runtime as rt
    import huggingface_hub

    def boom(repo, fname, local_files_only=True):
        raise RuntimeError("not cached")

    monkeypatch.setattr(huggingface_hub, "hf_hub_download", boom)
    monkeypatch.setattr(rt, "binary_path", lambda flavor: "/x/llama")  # binary present
    assert nm.model_status("qwen2.5-0.5b") == "absent"


# ── byte-level download progress (progress bar for single-GGUF cards) ────────


def test_download_reports_byte_progress(monkeypatch, tmp_path):
    """Single-file cards (every ASR/LLM GGUF) must report BYTES, not file
    counts — with total = the catalog's size_bytes — so the renderer's bar
    moves during a multi-GB file instead of sitting at 0/2."""
    import huggingface_hub

    f1 = tmp_path / "a.gguf"
    f1.write_bytes(b"x" * 600)
    f2 = tmp_path / "b.bin"
    f2.write_bytes(b"y" * 400)
    paths = {"a.gguf": str(f1), "b.bin": str(f2)}
    monkeypatch.setattr(nm, "download_specs",
                        lambda mid, repo=None: {"repos": [], "urls": [],
                                                "files": [("org/r", "a.gguf"), ("org/r", "b.bin")]})
    monkeypatch.setattr(nm, "model_size", lambda mid: 1000)
    monkeypatch.setattr(huggingface_hub, "hf_hub_download", lambda r, f: paths[f])

    sent = []
    async def send(m): sent.append(m)
    assert asyncio.run(nm.download("whisper-base", send)) == "ready"
    prog = [(m["downloaded"], m["total"]) for m in sent if m["type"] == "model_progress"]
    assert prog[0] == (600, 1000)      # first file's real bytes, not "1 of 2"
    assert prog[-1] == (1000, 1000)    # completion pinned to exactly total


def test_download_byte_total_includes_shared_vad(monkeypatch, tmp_path):
    """Catalog ASR rows download the GGUF plus the shared silero VAD; the
    byte total must count both (model_size covers the model files only)."""
    import huggingface_hub

    f1 = tmp_path / "a.gguf"
    f1.write_bytes(b"x" * 600)
    monkeypatch.setattr(nm, "download_specs",
                        lambda mid, repo=None: {"repos": [], "urls": [nm.VAD_URL],
                                                "files": [("org/r", "a.gguf")]})
    monkeypatch.setattr(nm, "model_size", lambda mid: 600)
    monkeypatch.setattr(huggingface_hub, "hf_hub_download", lambda r, f: str(f1))
    monkeypatch.setattr(nm, "_download_url", lambda url: None)

    sent = []
    async def send(m): sent.append(m)
    assert asyncio.run(nm.download("whisper-base", send)) == "ready"
    prog = [(m["downloaded"], m["total"]) for m in sent if m["type"] == "model_progress"]
    total = 600 + nm._SILERO_VAD_BYTES
    assert prog[-1] == (total, total)


def test_download_streams_incomplete_blob_growth(monkeypatch, tmp_path):
    """While one big file downloads, the in-flight .incomplete blob size must
    stream as intermediate progress events."""
    import time as _time
    import huggingface_hub

    monkeypatch.setattr(nm, "download_specs",
                        lambda mid, repo=None: {"repos": [], "urls": [],
                                                "files": [("org/r", "big.gguf")]})
    monkeypatch.setattr(nm, "model_size", lambda mid: 1000)
    monkeypatch.setattr(nm, "_PROGRESS_POLL_S", 0.01)
    grow = iter([100, 350, 700] + [700] * 50)
    monkeypatch.setattr(nm, "_incomplete_bytes", lambda repo: next(grow))
    big = tmp_path / "big.gguf"
    big.write_bytes(b"z" * 1000)
    def slow_download(r, f):
        _time.sleep(0.08)
        return str(big)
    monkeypatch.setattr(huggingface_hub, "hf_hub_download", slow_download)

    sent = []
    async def send(m): sent.append(m)
    assert asyncio.run(nm.download("whisper-base", send)) == "ready"
    mids = [m["downloaded"] for m in sent if m["type"] == "model_progress"]
    # at least one mid-file event strictly between 0 and total, before the final
    assert any(0 < v < 1000 for v in mids[:-1]), mids
    assert mids[-1] == 1000


def test_download_falls_back_to_unit_counting_without_size(monkeypatch, tmp_path):
    import huggingface_hub
    f1 = tmp_path / "a"
    f1.write_bytes(b"x")
    monkeypatch.setattr(nm, "download_specs",
                        lambda mid, repo=None: {"repos": [], "urls": [],
                                                "files": [("org/r", "a"), ("org/r", "a")]})
    monkeypatch.setattr(nm, "model_size", lambda mid: None)   # size unknown
    monkeypatch.setattr(huggingface_hub, "hf_hub_download", lambda r, f: str(f1))
    sent = []
    async def send(m): sent.append(m)
    assert asyncio.run(nm.download("mystery-model", send)) == "ready"
    prog = [(m["downloaded"], m["total"]) for m in sent if m["type"] == "model_progress"]
    assert prog == [(1, 2), (2, 2)]    # old per-file behavior preserved


def test_model_status_ready_when_any_ladder_quant_cached(monkeypatch, tmp_path):
    """A multi-quant card is RUNNABLE when ANY rung is cached — load-time
    resolution prefers downloaded quants, so status must not depend on the
    static default rung. Field bug: Fun-ASR (default Q6_K) with only the
    machine-recommended Q8_0 downloaded read 'absent' from every bare
    (no-repo-override) status query, and the renderer's ASR chip showed
    "None" until a variant-aware caller repaired the map."""
    import huggingface_hub
    from sokuji_sidecar import native_models

    cached = {"Fun-ASR-MLT-Nano-2512-Q8_0.gguf"}

    def fake_hf_download(repo, fname, local_files_only=False, **kw):
        if fname in cached:
            return str(tmp_path / fname)
        raise FileNotFoundError(fname)
    monkeypatch.setattr(huggingface_hub, "hf_hub_download", fake_hf_download)
    vad = tmp_path / "silero_vad.onnx"
    vad.write_bytes(b"vad")
    monkeypatch.setattr(native_models, "_vad_cache_path", lambda: str(vad))

    # default rung (Q6_K) absent, Q8_0 cached -> runnable
    assert native_models.model_status("fun-asr-mlt-nano") == "ready"
    # nothing cached -> absent
    cached.clear()
    assert native_models.model_status("fun-asr-mlt-nano") == "absent"


def test_model_status_repo_override_keeps_specific_quant_semantics(monkeypatch, tmp_path):
    """With an explicit repo override (the download button's 'is THIS quant
    downloaded?' question) the any-rung relaxation must NOT apply."""
    import huggingface_hub
    from sokuji_sidecar import native_models

    def fake_hf_download(repo, fname, local_files_only=False, **kw):
        if fname == "Fun-ASR-MLT-Nano-2512-Q8_0.gguf":
            return str(tmp_path / fname)
        raise FileNotFoundError(fname)
    monkeypatch.setattr(huggingface_hub, "hf_hub_download", fake_hf_download)

    q6 = "handy-computer/Fun-ASR-MLT-Nano-2512-gguf/Fun-ASR-MLT-Nano-2512-Q6_K.gguf"
    q8 = "handy-computer/Fun-ASR-MLT-Nano-2512-gguf/Fun-ASR-MLT-Nano-2512-Q8_0.gguf"
    assert native_models.model_status("fun-asr-mlt-nano", repo=q6) == "absent"
    assert native_models.model_status("fun-asr-mlt-nano", repo=q8) == "ready"


def test_model_status_translate_ladder_still_needs_llama_binary(monkeypatch, tmp_path):
    """The any-rung relaxation covers the FILE requirement only: a llamacpp
    card with a cached rung but missing llama-server flavors stays absent."""
    import huggingface_hub
    from sokuji_sidecar import native_models, llama_runtime

    monkeypatch.setattr(huggingface_hub, "hf_hub_download",
                        lambda repo, fname, **kw: str(tmp_path / fname))
    monkeypatch.setattr(llama_runtime, "required_flavors", lambda: ["cpu"])
    monkeypatch.setattr(llama_runtime, "binary_path", lambda f: None)
    assert native_models.model_status("qwen2.5-0.5b") == "absent"
    monkeypatch.setattr(llama_runtime, "binary_path", lambda f: "/x/llama")
    assert native_models.model_status("qwen2.5-0.5b") == "ready"
