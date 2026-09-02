"""Summarize spike results: browser RESULT logs and CPU JSON files -> per-device tables + medians + CER."""
import glob
import json
import os
import re
import statistics
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
_candidates = [os.path.join(HERE, "clips", "manifest.json"), os.path.join(HERE, "results", "manifest.json"), "manifest.json"]
manifest = next((json.load(open(p)) for p in _candidates if os.path.exists(p)), {})


def norm(s):
    return re.sub(r"[\s\W_]+", "", (s or "").lower())


def cer(hyp, ref):
    h, r = norm(hyp), norm(ref)
    if not r:
        return None
    d = list(range(len(h) + 1))
    for j, rc in enumerate(r, 1):
        prev, d[0] = d[0], j
        for i, hc in enumerate(h, 1):
            cur = min(d[i] + 1, d[i - 1] + 1, prev + (hc != rc))
            prev, d[i] = d[i], cur
    return round(d[len(h)] / len(r), 3)


def browser_rows(path):
    rows, env, load = [], None, None
    for line in open(path, encoding="utf-8", errors="replace"):
        if not line.startswith("RESULT "):
            continue
        obj = json.loads(line[7:])
        if "env" in obj:
            env = obj["env"]
        elif "load" in obj:
            load = obj["load"]
        elif "clip" in obj and "error" not in obj:
            obj["cer"] = cer(obj.get("text"), manifest.get(obj["clip"].split(" ")[0], {}).get("text"))
            rows.append(obj)
        elif "error" in obj or "fatal" in obj:
            print("  !!", obj.get("error") or obj.get("fatal"))
    return env, load, rows


def table(rows, keys):
    print("  " + " ".join(f"{k:>10s}" for k in keys) + "  text")
    for r in rows:
        vals = []
        for k in keys:
            v = r.get(k)
            vals.append(f"{v:>10}" if not isinstance(v, float) else f"{v:>10.3f}")
        print("  " + " ".join(vals) + "  " + (r.get("text") or "")[:48])
    warm = [r for r in rows if "[cold]" not in r["clip"]]
    if warm:
        rtfs = [r["rtf"] for r in warm]
        cers = [r["cer"] for r in warm if r.get("cer") is not None]
        mpt = [r["msPerToken"] for r in warm if r.get("msPerToken")]
        print(f"  => median RTF {statistics.median(rtfs):.3f}  max RTF {max(rtfs):.3f}  mean CER {statistics.mean(cers):.3f}" + (f"  median ms/token {statistics.median(mpt):.1f}" if mpt else ""))


targets = sys.argv[1:] or sorted(glob.glob(os.path.join(HERE, "page-*.log"))) + sorted(glob.glob(os.path.join(HERE, "cpu-*.json")))
for p in targets:
    name = os.path.basename(p)
    print(f"== {name}")
    if p.endswith(".log"):
        env, load, rows = browser_rows(p)
        if env:
            print(f"  env: ep={env.get('ep')} adapter={env.get('adapter')} f16={env.get('shaderF16')} threads={env.get('threads')} ua={env.get('ua', '')[:60]}")
        if load:
            print(f"  load: {load}")
        if rows:
            table(rows, ["clip", "audioSec", "melMs", "encoderMs", "prefillMs", "decodeMs", "genTokens", "msPerToken", "rtf", "cer"])
    else:
        j = json.load(open(p))
        print(f"  {j['dir'].split('/')[-1]} suffix={j['suffix']!r} enc={j['encoder']} threads={j['threads']} ort={j['ort']} load={j['loadSec']}s")
        table(j["results"], ["clip", "audioSec", "melMs", "encoderMs", "decodeMs", "genTokens", "rtf", "cer"])
