#!/usr/bin/env python3
"""Score Soniox transcripts (transcribe.mjs --json) per playback window against the known Chinese script.
Usage: python3 score.py tokens.json reference-zh.txt [--clips 4,18,32] [--len 9]
Per file and window: zh characters recognised, of which matched in order against the reference loop (LCS),
and non-zh tokens (leaked far end)."""
import json, re, sys
args = sys.argv[1:]
def opt(name, dflt):
    if name in args:
        i = args.index(name); v = args[i + 1]; del args[i:i + 2]; return v
    return dflt
clips = [float(x) for x in opt('--clips', '4,18,32').split(',')]
clen = float(opt('--len', '9'))
if len(args) < 2:
    sys.exit(__doc__)
data = json.load(open(args[0], encoding='utf-8'))
ref = re.sub(r'[^一-鿿]', '', open(args[1], encoding='utf-8').read())
han = re.compile(r'[一-鿿]')
def lcs(a, b):
    prev = [0] * (len(b) + 1)
    for ch in a:
        cur = [0]
        for j, bj in enumerate(b, 1):
            cur.append(prev[j - 1] + 1 if ch == bj else max(prev[j], cur[j - 1]))
        prev = cur
    return prev[-1]
windows = [(f'clip{i+1} {t:.0f}-{t+clen:.0f}s', t, t + clen) for i, t in enumerate(clips)]
gaps = []
for i in range(len(clips) - 1):
    gaps.append((f'gap{i+1} {clips[i]+clen:.0f}-{clips[i+1]:.0f}s', clips[i] + clen, clips[i + 1]))
for path, rec in data.items():
    toks = rec.get('tokens') or []
    print(f'== {path}')
    tot_zh = tot_match = 0
    for name, t0, t1 in windows + gaps:
        inside = [t for t in toks if t.get('start_ms') is not None and t0 * 1000 <= t['start_ms'] < t1 * 1000]
        zh = ''.join(han.findall(''.join(t['text'] for t in inside if (t.get('language') or 'zh') == 'zh')))
        other = ''.join(t['text'] for t in inside if t.get('language') and t['language'] != 'zh').strip()
        m = lcs(zh, ref * 3) if zh else 0
        if name.startswith('clip'):
            tot_zh += len(zh); tot_match += m
        print(f'  {name:16s} zh chars {len(zh):3d}  matched {m:3d}  other: {other[:60]!r}')
    print(f'  playback windows total: zh {tot_zh}, matched {tot_match}')
