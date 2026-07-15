"""Unit tests for planner.py helpers that are too low-level to be covered by
the characterisation suite's Machine x model matrices.

_fit_walk is the size-descending fit-walk nucleus shared by _tc_pick_quant and
_llamacpp_variant_row (see planner.py docstrings): given a {compute_type: size}
map that already has the caller's resident factor baked in, optionally
restrict it to a `downloaded` set (only when that restriction leaves at least
one candidate), then walk it size-descending and return the key of the
largest entry that fits within `budget`. Returns None when nothing fits (or
the map is empty) -- callers apply their own fallback.
"""
import pytest

from sokuji_sidecar import planner


FIT_WALK_MATRIX = [
    # (sized, budget, downloaded, expected, case-id)
    pytest.param({"q4": 10, "q8": 20}, 25, None, "q8",
                 id="largest_fitting_wins"),
    pytest.param({"q4": 10, "q8": 20}, 15, None, "q4",
                 id="skips_too_big_falls_to_next"),
    pytest.param({"q4": 10, "q8": 20}, 5, None, None,
                 id="nothing_fits_returns_none"),
    pytest.param({}, 100, None, None,
                 id="empty_sized_returns_none"),
    pytest.param({"q4": 10, "q8": 20}, 20, None, "q8",
                 id="exact_boundary_fits"),
    pytest.param({"q4": 10, "q8": 20, "q16": 40}, 100, {"q4"}, "q4",
                 id="downloaded_restricts_candidate_set"),
    pytest.param({"q4": 10, "q8": 20, "q16": 40}, 100, set(),
                 "q16", id="empty_downloaded_set_is_no_restriction"),
    pytest.param({"q4": 10, "q8": 20, "q16": 40}, 100, {"nonexistent"},
                 "q16", id="downloaded_with_no_overlap_falls_back_to_full_set"),
    pytest.param({"q4": 10, "q8": 20, "q16": 40}, 100, None,
                 "q16", id="none_downloaded_is_no_restriction"),
]


@pytest.mark.parametrize("sized, budget, downloaded, expected", FIT_WALK_MATRIX)
def test_fit_walk(sized, budget, downloaded, expected):
    assert planner._fit_walk(sized, budget=budget, downloaded=downloaded) == expected
