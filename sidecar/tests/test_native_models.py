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
    assert nm.download_specs('')['repos'] == [nm.QWEN_REPO]
    assert nm.download_specs('qwen')['repos'] == [nm.QWEN_REPO]
    assert nm.download_specs('whisper-tiny')['repos'] == ['Systran/faster-whisper-tiny']
    assert nm.download_specs('csukuangfj/vits-piper-en_US-amy-low')['repos'] == ['csukuangfj/vits-piper-en_US-amy-low']
    sv = nm.download_specs('sense-voice')
    assert sv['repos'] == [nm.SENSE_VOICE_REPO] and len(sv['urls']) == 1
    assert sv['repos'] == ['FunAudioLLM/SenseVoiceSmall']
    opus = nm.download_specs('Xenova/opus-mt-zh-en')
    assert opus['repos'] == ['Xenova/opus-mt-zh-en', 'Helsinki-NLP/opus-mt-zh-en']
    # Granite speech-LLM ids must map to their ibm-granite/ HF repo, not the bare id.
    assert nm.download_specs('granite-speech-4.1-2b')['repos'] == ['ibm-granite/granite-speech-4.1-2b']
    assert nm.download_specs('granite-speech-4.1-2b-plus')['repos'] == ['ibm-granite/granite-speech-4.1-2b-plus']
    # Qwen3-ASR must map to the bezzam/ HF repo, not the bare catalog id.
    assert nm.download_specs('qwen3-asr-1.7b')['repos'] == ['bezzam/Qwen3-ASR-1.7B']
    # Cohere Transcribe maps to the non-gated AEmotionStudio mirror (byte-identical to CohereLabs).
    assert nm.download_specs('cohere-transcribe-03-2026')['repos'] == ['AEmotionStudio/cohere-transcribe-03-2026-models']


def test_download_specs_cohere():
    assert native_models.download_specs("cohere-transcribe-03-2026") == \
        {"repos": ["AEmotionStudio/cohere-transcribe-03-2026-models"], "urls": []}


def test_download_raises_when_no_files_resolved(monkeypatch):
    """A repo whose files cannot be listed must NOT silently report 'ready'.

    Regression: a wrong/unreachable repo id made list_repo_files raise, which the
    old code swallowed -> total=0 -> returned 'ready' instantly (download appeared
    to complete with nothing fetched, then status re-read as absent)."""
    import huggingface_hub

    class _Api:
        def list_repo_files(self, repo):
            raise RuntimeError(f"RepositoryNotFoundError: {repo}")

    monkeypatch.setattr(nm, 'download_specs', lambda m: {'repos': ['bogus/repo'], 'urls': []})
    monkeypatch.setattr(huggingface_hub, 'HfApi', _Api)

    sent = []

    async def send(m):
        sent.append(m)

    with pytest.raises(Exception):
        asyncio.run(nm.download('bogus-model', send))


def test_status_handler_shape(monkeypatch):
    monkeypatch.setattr(nm, 'model_status', lambda m: 'ready' if m == 'sense-voice' else 'absent')
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


def test_sizes_handler_shape(monkeypatch):
    monkeypatch.setattr(nm, 'model_size', lambda m: 12345 if m == 'sense-voice' else 0)
    st = {'handlers': {}}
    nm.register(st)
    reply, _ = asyncio.run(server.handle_message(
        st, json.dumps({'type': 'model_sizes', 'id': 1, 'models': ['sense-voice', 'whisper-tiny']})))
    assert reply == {'type': 'model_sizes_result', 'id': 1,
                     'sizes': {'sense-voice': 12345, 'whisper-tiny': 0}}


@pytest.mark.skipif(not os.environ.get('SOKUJI_RUN_ASR_MODEL'),
                    reason='set SOKUJI_RUN_ASR_MODEL=1 (queries HF repo size)')
def test_real_size_of_sense_voice():
    nm._SIZE_CACHE.clear()
    assert nm.model_size('sense-voice') > 100_000_000  # model.int8.onnx alone is >100MB


def test_delete_handler_shape(monkeypatch):
    monkeypatch.setattr(nm, 'delete_model', lambda m: 4096)
    st = {'handlers': {}}
    nm.register(st)
    reply, _ = asyncio.run(server.handle_message(
        st, json.dumps({'type': 'model_delete', 'id': 7, 'model': 'whisper-tiny'})))
    assert reply == {'type': 'model_delete_result', 'id': 7, 'model': 'whisper-tiny', 'freed': 4096}


def test_download_is_nonblocking_and_pushes_completion(monkeypatch):
    # download runs as a background task; the handler returns nothing (completion
    # is pushed) so the connection stays free to receive model_cancel.
    async def fake_download(model_id, send, should_cancel=None):
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
    async def fake_download(model_id, send, should_cancel=None):
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
    assert spec["urls"] == []
    assert spec["ignore"] == ["consolidated.safetensors"]


def test_existing_specs_have_no_ignore_key():
    # The ignore key is additive: every pre-existing model omits it (consumers use .get).
    assert "ignore" not in nm.download_specs("cohere-transcribe-03-2026")
    assert "ignore" not in nm.download_specs("qwen3-asr-1.7b")


def test_download_honors_ignore_list(monkeypatch):
    """The ignore list keeps consolidated.safetensors out of the fetched file set,
    so transformers' model.safetensors is fetched but the 8.86GB duplicate is not."""
    import huggingface_hub
    fetched = []

    class _Api:
        def list_repo_files(self, repo):
            return ["model.safetensors", "consolidated.safetensors", "config.json", "tekken.json"]

    monkeypatch.setattr(nm, "download_specs", lambda m: {
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
    assert nm.model_size("voxtral-mini-4b-realtime") == 8_000_001_000  # consolidated excluded
