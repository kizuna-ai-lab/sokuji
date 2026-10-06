"""Per-card voice requirement, preset names and default preset (spec stage 2.3): a card may
override its family's rule, list the presets the native layer cannot enumerate, and name the
one the sidecar applies right after load. The fourteen existing cards keep their behaviour."""
import asyncio

import pytest

from sokuji_sidecar import accel, catalog, planner, tts_voices
from _tts_cards import CPU_MACHINE

# The cards that predate per-card voice fields; each keeps its family's rule.
_EXISTING = ("moss-tts-nano", "supertonic-3", "qwen3-tts-0.6b", "qwen3-tts-1.7b",
             "omnivoice-0.6b", "pocket-tts-en", "pocket-tts-de", "pocket-tts-es",
             "pocket-tts-it", "pocket-tts-pt", "voxcpm1-0.5b", "voxcpm2",
             "irodori-tts-v4-small", "index-tts2.5")


def _preset_card(**overrides):
    """A qwen3_tts card that does not clone, speaks one of two presets, and applies one at
    load -- the shape of a CustomVoice checkpoint, under a made-up id."""
    kw = dict(order=99, named_voices=True, voice_required=False,
              presets=("aiden", "vivian"), default_preset="vivian")
    kw.update(overrides)
    return catalog._tts_gguf_row("preset-test", "Preset Test", ("en",), "qwen3_tts",
                                 "Preset-Test-GGUF", {"q8_0": ("preset-q8_0.gguf", 100)},
                                 default_quant="q8_0", **kw)


def _clone_card():
    """A moss_tts_nano card (a family that speaks bare) whose card requires a clip anyway."""
    return catalog._tts_gguf_row("clone-test", "Clone Test", ("en",), "moss_tts_nano",
                                 "Clone-Test-GGUF", {"q8_0": ("clone-q8_0.gguf", 100)},
                                 default_quant="q8_0", order=99, clones=True, voice_required=True)


def test_a_card_overrides_its_familys_voice_rule():
    card = _preset_card()
    assert card.family in catalog.VOICE_REQUIRED_FAMILIES
    assert card.voice_required is False
    assert card.presets == ("aiden", "vivian") and card.default_preset == "vivian"
    assert catalog.voice_capability(card) == {"builtin": "named", "custom": "none",
                                              "required": False}
    clone = _clone_card()
    assert clone.family not in catalog.VOICE_REQUIRED_FAMILIES
    assert catalog.voice_capability(clone) == {"builtin": "none", "custom": "clip",
                                               "required": True}


def test_voice_required_defaults_to_the_familys_rule():
    for family, required in (("qwen3_tts", True), ("index_tts2", True),
                             ("moss_tts_nano", False), ("irodori_tts", False)):
        card = catalog._tts_gguf_row("d", "D", ("en",), family, "D-GGUF",
                                     {"q8_0": ("d-q8_0.gguf", 1)}, default_quant="q8_0", order=99)
        assert card.voice_required is required, family
        assert card.presets == () and card.default_preset == "", family


def test_the_fourteen_existing_cards_keep_their_voice_behaviour():
    for mid in _EXISTING:
        m = catalog.tts_model(mid)
        assert m.voice_required is (m.family in catalog.VOICE_REQUIRED_FAMILIES), mid
        assert m.presets == () and m.default_preset == "", mid
        cfg = planner._plan_config(m)
        assert (cfg.voice_required, cfg.tts_presets, cfg.tts_default_preset) == \
            (m.voice_required, (), ""), mid
    for mid, required in (("qwen3-tts-0.6b", True), ("index-tts2.5", True),
                          ("moss-tts-nano", False), ("pocket-tts-en", False)):
        plans = planner.resolve_tts(mid, machine=CPU_MACHINE, platform="linux", cache={})
        assert plans and all(p.config.voice_required is required for p in plans), mid


def test_a_cards_preset_rules_are_checked_when_the_catalog_loads():
    with pytest.raises(ValueError, match="'nova'"):
        _preset_card(default_preset="nova")           # not one of its presets
    with pytest.raises(ValueError, match="named_voices"):
        _preset_card(named_voices=False)              # presets the picker would never show
    with pytest.raises(ValueError, match="voice_required"):
        _preset_card(voice_required=None)             # qwen3_tts's rule says required, yet a
                                                      # default preset makes it speak at load


def test_a_default_preset_needs_the_cards_own_presets():
    with pytest.raises(ValueError, match="default_preset 'vivian' needs"):
        _preset_card(presets=())                      # nothing for the backend to check it against


@pytest.mark.parametrize("family", ["supertonic", "pocket_tts"])
def test_a_family_the_native_layer_lists_carries_no_presets_of_its_own(family):
    with pytest.raises(ValueError, match=f"{family}'s presets"):
        catalog._tts_gguf_row("native-listed", "Native Listed", ("en",), family, "N-GGUF",
                              {"q8_0": ("n-q8_0.gguf", 1)}, default_quant="q8_0", order=99,
                              named_voices=True, presets=("F1",))


def test_plan_config_carries_the_cards_voice_fields():
    cfg = planner._plan_config(_preset_card())
    assert (cfg.tts_family, cfg.voice_required, cfg.tts_presets, cfg.tts_default_preset) == \
        ("qwen3_tts", False, ("aiden", "vivian"), "vivian")
    assert planner._plan_config(_clone_card()).voice_required is True


def test_plan_config_carries_whether_the_card_clones():
    assert planner._plan_config(_preset_card()).tts_clones is False   # clones defaults to False
    assert planner._plan_config(_clone_card()).tts_clones is True
    assert planner.PlanConfig().tts_clones is True    # a bare PlanConfig restricts nothing


def test_the_wire_reports_the_cards_own_voice_requirement(monkeypatch):
    monkeypatch.setattr(catalog, "TTS_MODELS", catalog.TTS_MODELS + [_preset_card(), _clone_card()])
    monkeypatch.setattr(accel, "probe", lambda force=False: CPU_MACHINE)
    monkeypatch.setattr(accel, "bench_load", lambda: {})
    monkeypatch.setattr(accel, "_downloaded_quants", lambda model: set())
    reply, _ = asyncio.run(accel._h_models_catalog(
        {}, {"kind": "tts", "id": 1, "models": ["preset-test", "clone-test", "index-tts2.5"]}, None))
    voice = {m["id"]: m["voice"] for m in reply["models"]}
    assert voice["preset-test"] == {"builtin": "named", "custom": "none", "required": False}
    assert voice["clone-test"]["required"] is True
    assert voice["index-tts2.5"]["required"] is True


def test_the_load_free_voice_listing_offers_the_cards_presets(monkeypatch):
    monkeypatch.setattr(catalog, "TTS_MODELS", catalog.TTS_MODELS + [_preset_card()])

    def no_hub(repo, subdir):
        raise AssertionError("a card's own presets need no snapshot")

    monkeypatch.setattr(tts_voices, "_scoped_snapshot_dir", no_hub)
    assert tts_voices.list_builtin_voices("preset-test", None) == ["aiden", "vivian"]
