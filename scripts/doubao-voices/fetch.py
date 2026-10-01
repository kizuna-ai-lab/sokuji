"""Pull Doubao's public TTS voice list (ListSpeakers) as a raw dump for build.ts.

Maintainer-only (#577 catalog spec §1.1). Needs an account AK/SK allowed
speech_saas_prod:ListSpeakers — a sub-user's — and Volcengine's SDK in a
throwaway venv; neither the SDK nor any key belongs in the repo:

    python3 -m venv /tmp/volc && /tmp/volc/bin/pip install volcengine-python-sdk
    VOLC_AK=... VOLC_SK=... /tmp/volc/bin/python scripts/doubao-voices/fetch.py /tmp/speakers.json
"""
import json
import os
import sys

import volcenginesdkcore
import volcenginesdkspeechsaasprod as m
from volcenginesdkcore.rest import ApiException

if len(sys.argv) != 2:
    sys.exit('usage: fetch.py <out.json>')
ak, sk = os.environ.get('VOLC_AK'), os.environ.get('VOLC_SK')
if not ak or not sk:
    sys.exit('VOLC_AK and VOLC_SK are required')

cfg = volcenginesdkcore.Configuration()
cfg.ak, cfg.sk, cfg.region = ak, sk, 'cn-beijing'
volcenginesdkcore.Configuration.set_default(cfg)
api = m.SPEECHSAASPRODApi()

speakers, page = [], 1
while True:
    try:
        # Page alone: passing Limit is answered 400 InvalidParameter (2026-10-02); pages hold 10.
        r = api.list_speakers(m.ListSpeakersRequest(page=page))
    except ApiException as e:
        sys.exit(f'ListSpeakers failed on page {page}: {e.status} {e.body}')
    batch = [s.to_dict() for s in (r.speakers or [])]
    speakers += batch
    if not batch or len(speakers) >= (r.total or 0):
        break
    page += 1

with open(sys.argv[1], 'w') as f:
    json.dump(speakers, f, ensure_ascii=False, indent=1)
print(f'{len(speakers)} entries -> {sys.argv[1]}')
