import asyncio, json, os
import pytest
from sokuji_sidecar import native_models as nm
from sokuji_sidecar import native_models
from sokuji_sidecar import server


def test_download_specs_mapping():
    assert nm.download_specs('')['repos'] == [nm.QWEN_REPO]
    assert nm.download_specs('qwen')['repos'] == [nm.QWEN_REPO]
    assert nm.download_specs('whisper-tiny')['repos'] == ['Systran/faster-whisper-tiny']
    assert nm.download_specs('csukuangfj/vits-piper-en_US-amy-low')['repos'] == ['csukuangfj/vits-piper-en_US-amy-low']
    sv = nm.download_specs('sense-voice')
    assert sv['repos'] == [nm.SENSE_VOICE_REPO] and len(sv['urls']) == 1
    opus = nm.download_specs('Xenova/opus-mt-zh-en')
    assert opus['repos'] == ['Xenova/opus-mt-zh-en', 'Helsinki-NLP/opus-mt-zh-en']
    # Granite speech-LLM ids must map to their ibm-granite/ HF repo, not the bare id.
    assert nm.download_specs('granite-speech-4.1-2b')['repos'] == ['ibm-granite/granite-speech-4.1-2b']
    assert nm.download_specs('granite-speech-4.1-2b-plus')['repos'] == ['ibm-granite/granite-speech-4.1-2b-plus']
    # Qwen3-ASR must map to the bezzam/ HF repo, not the bare catalog id.
    assert nm.download_specs('qwen3-asr-1.7b')['repos'] == ['bezzam/Qwen3-ASR-1.7B']
    # Cohere Transcribe must map to the CohereLabs/ HF repo.
    assert nm.download_specs('cohere-transcribe-03-2026')['repos'] == ['CohereLabs/cohere-transcribe-03-2026']


def test_download_specs_cohere():
    assert native_models.download_specs("cohere-transcribe-03-2026") == \
        {"repos": ["CohereLabs/cohere-transcribe-03-2026"], "urls": []}


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
def test_real_status_of_cached_model():
    # sense-voice was downloaded by Tier-0; a bogus id must be absent.
    assert nm.model_status('csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17') == 'ready'
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
