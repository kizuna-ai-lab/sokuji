import asyncio, json, os
import pytest
from sokuji_sidecar import native_models as nm
from sokuji_sidecar import native_models
from sokuji_sidecar import server


def test_download_specs_mapping(monkeypatch):
    # download_specs honours SOKUJI_ASR_REPO / SOKUJI_TRANSLATE_MODEL overrides; clear
    # them so the default-repo assertions below are deterministic in any environment.
    monkeypatch.delenv('SOKUJI_ASR_REPO', raising=False)
    monkeypatch.delenv('SOKUJI_TRANSLATE_MODEL', raising=False)
    # Empty id is the implicit default → Qwen 2.5 0.5B; the explicit id maps the same.
    assert nm.download_specs('')['repos'] == [nm.QWEN_REPO]
    assert nm.download_specs('qwen2.5-0.5b')['repos'] == [nm.QWEN_REPO]
    # The legacy 'qwen' alias was dropped — it now falls through to a bare repo id.
    assert nm.download_specs('qwen')['repos'] == ['qwen']
    assert nm.download_specs('whisper-tiny')['repos'] == ['Systran/faster-whisper-tiny']
    assert nm.download_specs('csukuangfj/vits-piper-en_US-amy-low')['repos'] == ['csukuangfj/vits-piper-en_US-amy-low']
    sv = nm.download_specs('sense-voice')
    assert sv['repos'] == [nm.SENSE_VOICE_REPO] and sv['urls'] == [nm.VAD_URL]
    assert sv['repos'] == ['FunAudioLLM/SenseVoiceSmall']
    # Granite speech-LLM ids must map to their ibm-granite/ HF repo, not the bare id.
    assert nm.download_specs('granite-speech-4.1-2b')['repos'] == ['ibm-granite/granite-speech-4.1-2b']
    assert nm.download_specs('granite-speech-4.1-2b-plus')['repos'] == ['ibm-granite/granite-speech-4.1-2b-plus']
    # Qwen3-ASR must map to the bezzam/ HF repo, not the bare catalog id.
    assert nm.download_specs('qwen3-asr-1.7b')['repos'] == ['bezzam/Qwen3-ASR-1.7B']
    # Cohere Transcribe maps to the non-gated AEmotionStudio mirror (byte-identical to CohereLabs).
    assert nm.download_specs('cohere-transcribe-03-2026')['repos'] == ['AEmotionStudio/cohere-transcribe-03-2026-models']


def test_download_specs_cohere():
    # Cohere is an ASR-catalog model, so the shared silero VAD is appended.
    assert native_models.download_specs("cohere-transcribe-03-2026") == \
        {"repos": ["AEmotionStudio/cohere-transcribe-03-2026-models"], "urls": [nm.VAD_URL]}


def test_download_specs_appends_shared_vad_for_asr_models():
    """The silero VAD is a shared dependency of EVERY ASR model (AsrEngine._init_vad
    loads it for offline + streaming). download_specs must append it for any ASR
    model, not just SenseVoice; non-ASR ids (translation/TTS) must NOT get it."""
    for asr_id in ('sense-voice', 'fun-asr-mlt-nano', 'whisper-tiny', 'qwen3-asr-1.7b',
                   'voxtral-mini-4b-realtime', 'granite-speech-4.1-2b'):
        assert nm.download_specs(asr_id)['urls'] == [nm.VAD_URL], asr_id
    for non_asr in ('', 'qwen', 'translategemma-4b', 'csukuangfj/vits-piper-en_US-amy-low'):
        assert nm.download_specs(non_asr)['urls'] == [], non_asr
    # voxtral keeps its ignore list alongside the appended VAD url.
    assert nm.download_specs('voxtral-mini-4b-realtime').get('ignore') == ['consolidated.safetensors']


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


def test_download_specs_qwen25_honours_translate_model_env(monkeypatch):
    # SOKUJI_TRANSLATE_MODEL overrides the default Qwen 2.5 repo for BOTH the implicit
    # default ('') and the explicit id, so download matches what the catalog/runtime loads.
    monkeypatch.setenv('SOKUJI_TRANSLATE_MODEL', 'acme/custom-translate')
    assert nm.download_specs('')['repos'] == ['acme/custom-translate']
    assert nm.download_specs('qwen2.5-0.5b')['repos'] == ['acme/custom-translate']


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
        st, json.dumps({'type': 'model_status', 'id': 1, 'models': ['sense-voice', 'whisper-tiny']})))
    assert reply == {'type': 'model_status_result', 'id': 1,
                     'statuses': {'sense-voice': 'ready', 'whisper-tiny': 'absent'}}


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
        st, json.dumps({'type': 'model_delete', 'id': 7, 'model': 'whisper-tiny'})))
    assert reply == {'type': 'model_delete_result', 'id': 7, 'model': 'whisper-tiny', 'freed': 4096}


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
    repo = native_models.download_specs("cohere-transcribe-03-2026")["repos"][0]
    blobs = tmp_path / f"models--{repo.replace('/', '--')}" / "blobs"
    blobs.mkdir(parents=True)
    monkeypatch.setattr(huggingface_hub.constants, "HF_HUB_CACHE", str(tmp_path))
    monkeypatch.setattr(huggingface_hub, "snapshot_download", lambda **k: str(tmp_path))
    (blobs / "abc123").write_text("a finalized blob")
    assert native_models.model_status("cohere-transcribe-03-2026") == "ready"
    # interrupted: '<sha>.<etag>.incomplete' with its finalized '<sha>' blob MISSING
    (blobs / "def456.a1b2c3.incomplete").write_bytes(b"half-fetched safetensors")
    assert native_models.model_status("cohere-transcribe-03-2026") == "absent"
    # stale leftover: the finalized blob has since landed → ignore the orphan .incomplete
    (blobs / "def456").write_text("now finalized")
    assert native_models.model_status("cohere-transcribe-03-2026") == "ready"


def test_download_specs_voxtral_skips_consolidated():
    spec = nm.download_specs("voxtral-mini-4b-realtime")
    assert spec["repos"] == ["mistralai/Voxtral-Mini-4B-Realtime-2602"]
    assert spec["urls"] == [nm.VAD_URL]  # ASR model → shared VAD appended
    assert spec["ignore"] == ["consolidated.safetensors"]


def test_existing_specs_have_no_ignore_key():
    # The ignore key is additive: every pre-existing model omits it (consumers use .get).
    assert "ignore" not in nm.download_specs("cohere-transcribe-03-2026")
    assert "ignore" not in nm.download_specs("qwen3-asr-1.7b")


def test_hy_mt2_ignores_train_and_imgs_dirs():
    # HY-MT2 repos ship training scripts (train/) + README images (imgs/) the
    # CausalLM never loads; both are directory globs.
    for mid in ("hy-mt2-1.8b", "hy-mt2-7b"):
        assert nm.download_specs(mid)["ignore"] == ["train/*", "imgs/*"]


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


def test_download_specs_fun_asr_mlt_nano(monkeypatch):
    monkeypatch.delenv('SOKUJI_FUNASR_NANO_REPO', raising=False)
    spec = nm.download_specs('fun-asr-mlt-nano')
    assert spec['repos'] == ['FunAudioLLM/Fun-ASR-MLT-Nano-2512']
    # AsrEngine._init_vad() loads silero for the offline path too, so a Nano-only
    # offline install must pre-fetch the shared VAD (not rely on a session-time download).
    assert spec['urls'] == [nm.VAD_URL]
def test_download_specs_qwen_translate_repos():
    from sokuji_sidecar import native_models as nm
    assert nm.download_specs("qwen2.5-0.5b")["repos"] == ["Qwen/Qwen2.5-0.5B-Instruct"]
    assert nm.download_specs("qwen3-0.6b")["repos"] == ["Qwen/Qwen3-0.6B"]
    assert nm.download_specs("qwen3.5-0.8b")["repos"] == ["Qwen/Qwen3.5-0.8B"]
    assert nm.download_specs("qwen3.5-2b")["repos"] == ["Qwen/Qwen3.5-2B"]


def test_download_specs_new_translate_models():
    from sokuji_sidecar import native_models as nm
    assert nm.download_specs("translategemma-4b")["repos"] == ["google/translategemma-4b-it"]
    h18 = nm.download_specs("hy-mt2-1.8b")
    assert h18["repos"] == ["tencent/Hy-MT2-1.8B"]
    assert h18["ignore"] == ["train/*", "imgs/*"]
    h7 = nm.download_specs("hy-mt2-7b")
    assert h7["repos"] == ["tencent/Hy-MT2-7B"]
    assert h7["ignore"] == ["train/*", "imgs/*"]


def test_download_specs_variant_repo_override():
    from sokuji_sidecar import native_models as nm
    spec = nm.download_specs("hy-mt2-7b", repo="tencent/Hy-MT2-7B-FP8")
    assert spec["repos"] == ["tencent/Hy-MT2-7B-FP8"]


def test_download_fetches_chosen_variant_repo(monkeypatch):
    """download(model, send, repo=...) must fetch files from the CHOSEN variant repo,
    not the model's default — the end-to-end wiring that makes the FP8 quant load."""
    import huggingface_hub
    fetched = []

    class _Api:
        def list_repo_files(self, repo):
            return [f"{repo}/model.safetensors", "config.json"]

    monkeypatch.setattr(huggingface_hub, "HfApi", _Api)
    monkeypatch.setattr(huggingface_hub, "hf_hub_download",
                        lambda repo, fname: fetched.append((repo, fname)))

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


def test_download_specs_opus_maps_to_helsinki_repo():
    from sokuji_sidecar import native_models as nm
    _ignore = ["tf_model.h5", "rust_model.ot", "flax_model.msgpack"]
    assert nm.download_specs("opus-mt-zh-en") == {
        "repos": ["Helsinki-NLP/opus-mt-zh-en"], "urls": [], "ignore": _ignore}
    assert nm.download_specs("opus-mt-en-jap") == {
        "repos": ["Helsinki-NLP/opus-mt-en-jap"], "urls": [], "ignore": _ignore}
    # The non-PyTorch framework weights are excluded from the download file list.
    for f in _ignore:
        assert f in nm.download_specs("opus-mt-zh-en")["ignore"]


def test_download_specs_hymt15():
    from sokuji_sidecar import native_models as nm
    assert nm.download_specs("hy-mt15-1.8b") == {"repos": ["tencent/HY-MT1.5-1.8B"], "urls": []}
    assert nm.download_specs("hy-mt15-7b") == {"repos": ["tencent/HY-MT1.5-7B"], "urls": []}
    # clean repos → no ignore key (both sizes)
    assert "ignore" not in nm.download_specs("hy-mt15-1.8b")
    assert "ignore" not in nm.download_specs("hy-mt15-7b")
    # FP8 variant download rides the repo-override path
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


def test_download_specs_for_tts_moss_nano_has_two_repos_no_vad():
    from sokuji_sidecar import native_models
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
    assert nm.model_size("sense-voice") == 944624033
    assert nm.model_size("hy-mt2-1.8b") == 4086810533
    assert nm.model_size("csukuangfj/vits-piper-en_US-amy-low") == 81105784


def test_qwen3_download_specs_point_at_per_size_repos():
    assert "qwen3-tts-0.6b-onnx" in native_models.download_specs("qwen3-tts-0.6b")["repos"][0]
    assert "qwen3-tts-1.7b-onnx" in native_models.download_specs("qwen3-tts-1.7b")["repos"][0]


def test_aishell3_download_ignores_unused_large_files():
    spec = native_models.download_specs("csukuangfj/vits-zh-aishell3")
    assert spec["repos"] == ["csukuangfj/vits-zh-aishell3"]
    for pat in ("G_AISHELL.pth", "rule.far", "vits-aishell3.int8.onnx"):
        assert pat in spec.get("ignore", [])
