#!/usr/bin/env python3
"""Dynamize the Qwen3-TTS 12.5Hz codec vocoder graph (tokenizer12hz_decode.onnx).

WHY THIS EXISTS (the fixed-1024 export pathology)
-------------------------------------------------
The upstream ONNX export of the codec decoder bakes a fixed padded length of
1024 codec frames (~82 s of 24 kHz audio) into the graph. Every causal conv /
ConvNeXt block in the decoder is wrapped in an F.pad whose *target length* was
traced as a Python int at export time and therefore froze into a scalar
`Constant -> Sub(target, Gather(Shape(x), 2)) -> ... -> Pad` chain. The result:
regardless of the actual input length, the graph zero-pads the sequence up to
1024 frames right at `pre_conv`, runs the pre_transformer and the whole
ConvTranspose upsampling stack (x1920 samples/frame) over the padded length,
and emits a fixed [1, 1965525] waveform. A 5 s utterance decodes ~82 s worth
of tensor work (~12x wasted compute, ~1.3 s wall on GB10 CUDA per call).

WHAT THIS SCRIPT DOES
---------------------
There are exactly 29 such pad-target constants, one per padded conv:

    stage                         const     = a*N + b  (N = 1024 at export)
    pre_conv                      1024        1*N + 0
    upsample.0.1 dwconv           2048        2*N + 0
    upsample.1.1 dwconv           4096        4*N + 0
    decoder.0                     4096        4*N + 0
    decoder.1 block convs (x6)    32760      32*N - 8     = 8*(4N-1)
    decoder.2 block convs (x6)    163795    160*N - 45    = 5*(32N-9)
    decoder.3 block convs (x6)    655176    640*N - 184   = 4*(160N-46)
    decoder.4 convs + decoder.6   1965525  1920*N - 555   = 3*(640N-185)

Every target is *exactly affine* in the base padded frame count N because the
whole decoder is a chain of length-affine ops (ConvTranspose:
L_out = stride*(L_in - 1) + k, then edge trim). So instead of a frozen N=1024
we compute N at runtime from the input:

    L      = Shape(audio_codes)[1]                  # actual codec frames
    N      = (floor(L / round) + 1) * round         # bucket, default round=64

and replace each frozen constant with `a*N + b`, with (a, b) derived
programmatically from the frozen value (a = ceil(V/1024), b = V - 1024*a; the
offsets all lie in (-1024, 0]). The Subs then compute non-negative pad
amounts, all downstream Slice ends clamp naturally, and compute scales with
the actual input length. Note the strict bump to the *next* multiple of
`round` (N >= L+1): the exported graph never trims its tail, so the final
conv output must satisfy 1920*N - 555 >= 1920*L to keep all valid samples
(the original export itself silently truncates the last 555 samples of a
full 1024-frame input).

The valid prefix `audio_values[:, :lengths[0]]` is bit-identical to the
original graph's output because all padding is zeros on the right of a
causal/masked pipeline, exactly as in the original -- only the amount of
right-padding shrinks.

Optionally `--static N` bakes a fixed bucket instead (fallback / bucketed
deployments): same rewiring, but with constants folded to the given N.

Usage:
    python dynamize-qwen3-tts-codec.py \
        --src ~/.config/Sokuji/hf-cache/.../snapshots/<rev>   # dir or .onnx \
        --out /path/to/tokenizer12hz_decode_dyn.onnx \
        [--round 64] [--static N]
"""

import argparse
import glob
import os
import sys

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper

MODEL_BASENAME = "tokenizer12hz_decode.onnx"
PREFIX = "dynpad"  # namespace for everything we add to the graph


def resolve_src(src: str) -> str:
    """Accept a model file, a snapshot dir, or a dir containing onnx/."""
    if os.path.isfile(src):
        return src
    for cand in (
        os.path.join(src, MODEL_BASENAME),
        os.path.join(src, "onnx", MODEL_BASENAME),
    ):
        if os.path.isfile(cand):
            return cand
    hits = sorted(glob.glob(os.path.join(src, "**", MODEL_BASENAME), recursive=True))
    if hits:
        return hits[0]
    raise FileNotFoundError(f"{MODEL_BASENAME} not found under {src}")


def scalar_const_value(graph, prod, init_map, name):
    """Return the numpy value of `name` if it is a 1-element Constant/initializer."""
    tensor = None
    if name in init_map:
        tensor = init_map[name]
    else:
        node = prod.get(name)
        if node is not None and node.op_type == "Constant":
            for attr in node.attribute:
                if attr.name == "value":
                    tensor = attr.t
    if tensor is None:
        return None
    try:
        arr = numpy_helper.to_array(tensor)
    except Exception:
        return None
    if arr.size != 1 or arr.dtype.kind not in "iu":
        return None
    return arr


def find_pad_target_subs(graph, prod, init_map):
    """Locate the frozen-length Sub nodes: Sub(scalar_const, Gather(Shape(x), 2)).

    Returns (matches, base) where matches is [(sub_node, frozen_value)] and
    base is the export-time padded frame count (the smallest frozen value,
    1024 in the known export).
    """
    matches = []
    for node in graph.node:
        if node.op_type != "Sub" or len(node.input) != 2:
            continue
        val = scalar_const_value(graph, prod, init_map, node.input[0])
        if val is None:
            continue
        gather = prod.get(node.input[1])
        if gather is None or gather.op_type != "Gather":
            continue
        shape_node = prod.get(gather.input[0])
        if shape_node is None or shape_node.op_type != "Shape":
            continue
        v = int(val.reshape(-1)[0])
        # Excludes the F.pad plumbing Subs (const=6 = 2*rank of the pads
        # array); every genuine length target is >= the base frame count.
        if v < 512:
            continue
        matches.append((node, v))
    if not matches:
        raise RuntimeError("no frozen pad-target Sub(const, Gather(Shape)) nodes found")
    base = min(v for _, v in matches)
    return matches, base


def affine_coeffs(value: int, base: int):
    """Decompose a frozen stage target as a*base + b with b in (-base, 0]."""
    a = -(-value // base)  # ceil division
    b = value - base * a
    assert -base < b <= 0, (value, base, a, b)
    return a, b


def int_scalar(name: str, value: int):
    return numpy_helper.from_array(np.array(value, dtype=np.int64), name=name)


def build_patch(model, round_to: int, static_n: int | None):
    graph = model.graph
    prod = {out: n for n in graph.node for out in n.output}
    init_map = {i.name: i for i in graph.initializer}

    matches, base = find_pad_target_subs(graph, prod, init_map)
    input_name = graph.input[0].name  # audio_codes [batch, codes_length, 16]

    new_nodes = []
    new_inits = []

    if static_n is None:
        # N = (floor(L / round) + 1) * round, computed from Shape(audio_codes).
        # Strictly greater than L so the untrimmed tail (555 samples) never
        # eats into valid output.
        new_inits += [
            int_scalar(f"{PREFIX}_round", round_to),
            int_scalar(f"{PREFIX}_one", 1),
            int_scalar(f"{PREFIX}_axis1", 1),
        ]
        new_nodes += [
            helper.make_node("Shape", [input_name], [f"{PREFIX}_shape"],
                             name=f"{PREFIX}_Shape"),
            helper.make_node("Gather", [f"{PREFIX}_shape", f"{PREFIX}_axis1"],
                             [f"{PREFIX}_len"], name=f"{PREFIX}_Gather", axis=0),
            helper.make_node("Div", [f"{PREFIX}_len", f"{PREFIX}_round"],
                             [f"{PREFIX}_q"], name=f"{PREFIX}_Div"),
            helper.make_node("Add", [f"{PREFIX}_q", f"{PREFIX}_one"],
                             [f"{PREFIX}_q1"], name=f"{PREFIX}_Add"),
            helper.make_node("Mul", [f"{PREFIX}_q1", f"{PREFIX}_round"],
                             [f"{PREFIX}_N"], name=f"{PREFIX}_Mul"),
        ]
        n_name = f"{PREFIX}_N"

    # One computed target per unique (a, b); every matched Sub is rewired to it.
    made = {}
    for sub_node, value in matches:
        a, b = affine_coeffs(value, base)
        key = (a, b)
        if key not in made:
            if static_n is not None:
                target = f"{PREFIX}_target_{a}_{b}"
                new_inits.append(int_scalar(target, a * static_n + b))
            else:
                mul_out = f"{PREFIX}_aN_{a}"
                if a == 1:
                    mul_out = n_name
                elif not any(n.output[0] == mul_out for n in new_nodes):
                    new_inits.append(int_scalar(f"{PREFIX}_a_{a}", a))
                    new_nodes.append(helper.make_node(
                        "Mul", [n_name, f"{PREFIX}_a_{a}"], [mul_out],
                        name=f"{PREFIX}_Mul_a{a}"))
                if b == 0:
                    target = mul_out
                else:
                    target = f"{PREFIX}_target_{a}_{b}"
                    new_inits.append(int_scalar(f"{PREFIX}_b_{a}_{b}", b))
                    new_nodes.append(helper.make_node(
                        "Add", [mul_out, f"{PREFIX}_b_{a}_{b}"], [target],
                        name=f"{PREFIX}_Add_a{a}b{b}"))
            made[key] = target
        sub_node.input[0] = made[key]

    # Prepend so the computed targets are defined before all consumers.
    graph.initializer.extend(new_inits)
    old_nodes = list(graph.node)
    del graph.node[:]
    graph.node.extend(new_nodes + old_nodes)

    return sorted({(v, *affine_coeffs(v, base)) for _, v in matches}), base


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    ap.add_argument("--src", required=True,
                    help="tokenizer12hz_decode.onnx, its dir, or a snapshot dir")
    ap.add_argument("--out", required=True, help="output .onnx path")
    ap.add_argument("--round", type=int, default=64, dest="round_to",
                    help="pad bucket granularity in frames (default 64)")
    ap.add_argument("--static", type=int, default=None, metavar="N",
                    help="bake a fixed padded length N instead of a dynamic one "
                         "(fallback for bucketed static deployments)")
    args = ap.parse_args()

    src = resolve_src(args.src)
    print(f"loading {src}", file=sys.stderr)
    model = onnx.load(src)  # self-contained fp32, <2GB

    stages, base = build_patch(model, args.round_to, args.static)
    mode = f"static N={args.static}" if args.static is not None else \
           f"dynamic N=(floor(L/{args.round_to})+1)*{args.round_to}"
    print(f"patched {len(stages)} unique stage targets (base={base}, {mode}):",
          file=sys.stderr)
    for value, a, b in stages:
        print(f"  {value:>9} = {a}*N{b:+d}", file=sys.stderr)

    onnx.checker.check_model(model, full_check=False)
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    onnx.save(model, args.out)
    print(f"wrote {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
