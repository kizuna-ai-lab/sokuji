import asyncio, json, os
import pytest
from sokuji_sidecar import native_models as nm
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
