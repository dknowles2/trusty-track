"""Vocabulary for four timer capabilities GPRM's matrix has and we did not
(issue #553, stage 2). Reverse lane numbering was stage 1; this is the rest,
scoped as the issue itself scopes them:

* **Indicate Timing Started** and **Count Down Clock** — plain datasheet
  claims on `TimerProfile`, GPRM's own words for what a push start signal and
  a device-side clock display mean. Both are claimed by the MicroWizard
  profile, which stands in for the whole FastTrack K/Q family (#553's own
  microwizard.py docstring says why one profile cannot tell a K2F from a
  plain K2).
* **Photo Finish Trigger** — the same shape, claimed by "The Champ" only,
  for its double-sided units.
* **Start light tree** — a bare command field, `TimerProfile.light_tree`,
  set on no profile here. The sequencing state machine GPRM implies is out of
  scope until real protocol evidence exists; see the field's own docstring.

None of the three booleans changes what `TimerManager` does — they are read
straight off the connected profile onto `TimerStatus`, the same shape as
`device_provenance`. There is nothing to feed a real timer recording through:
none of these three is traffic on the wire, so `test_timer_derbynet_profiles.
py`'s matcher-replay style does not apply — the claims are the whole of what
changed, and that is what these tests pin.
"""

from dataclasses import replace
from pathlib import Path

from backend.services.timer.devices import ALL_PROFILES, FAKE, MICROWIZARD, NO_TIMER
from backend.services.timer.devices.derbynet import ADAPTED_FROM_DERBYNET, CHAMP
from backend.services.timer.manager import TimerManager

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
TIMERS_REFERENCE = REPO_ROOT / "docs" / "reference" / "timers.md"

# ---------------------------------------------------------------------------
# The claims themselves
# ---------------------------------------------------------------------------


def test_the_microwizard_claims_timing_started_and_a_countdown_clock():
    assert MICROWIZARD.indicates_timing_started is True
    assert MICROWIZARD.has_countdown_clock is True
    # Not the photo-finish column — that is Champ's, not the FastTrack
    # family's.
    assert MICROWIZARD.has_photo_finish_trigger is False


def test_the_champ_claims_only_a_photo_finish_trigger():
    assert CHAMP.has_photo_finish_trigger is True
    assert CHAMP.indicates_timing_started is False
    assert CHAMP.has_countdown_clock is False


def test_nobody_else_claims_any_of_the_three():
    """The default is False, and every profile but the two above should still
    be sitting on it — a claim is something a profile earns, not something it
    starts with."""
    unclaimed = [p for p in ALL_PROFILES if p not in (MICROWIZARD, CHAMP)]
    assert unclaimed, "the profile list changed shape; update this test's exclusions"
    for profile in unclaimed:
        assert profile.indicates_timing_started is False, profile.key
        assert profile.has_countdown_clock is False, profile.key
        assert profile.has_photo_finish_trigger is False, profile.key


def test_the_fake_and_no_timer_devices_claim_nothing_either():
    for device in (FAKE, NO_TIMER):
        assert device.indicates_timing_started is False
        assert device.has_countdown_clock is False
        assert device.has_photo_finish_trigger is False


def test_no_profile_names_a_light_tree_command_yet():
    """The field exists as vocabulary (#553) — a place to put a command the
    day a datasheet or a recording names one — but nothing here has that
    evidence yet, for any of our profiles including the FastTrack family
    whose own automatic-gate-release command (`LG`) already does double duty
    for an *attached* light tree accessory (see microwizard.py). Claiming a
    *software-sequenced* tree on top of that without protocol evidence would
    be exactly the "field implies support" mistake the issue warns against.
    """
    for profile in (*ALL_PROFILES, FAKE, NO_TIMER):
        assert profile.light_tree == (), profile.key


def test_champ_is_still_double_sided_only_in_its_provenance():
    """The claim is unconditional (there is no way to tell a single-sided
    Champ from a double-sided one over the wire), so the caveat has to live
    in the text an operator actually reads."""
    assert "double-sided" in CHAMP.provenance.lower()


def test_microwizard_names_the_family_caveat_in_its_provenance():
    assert "K2F" in MICROWIZARD.provenance or "K2F" in MICROWIZARD.name


# ---------------------------------------------------------------------------
# Reaching the operator: TimerManager.status()
# ---------------------------------------------------------------------------


def test_the_claims_are_on_the_status_payload():
    """The client has no copy of the profiles (#89) — same reason
    `can_remote_start` is computed and handed over rather than derived."""
    mgr = TimerManager(track_id=1, device=MICROWIZARD)
    status = mgr.status()

    assert status.indicates_timing_started is True
    assert status.has_countdown_clock is True
    assert status.has_photo_finish_trigger is False


def test_the_champ_status_carries_only_the_photo_finish_claim():
    mgr = TimerManager(track_id=1, device=CHAMP)
    status = mgr.status()

    assert status.has_photo_finish_trigger is True
    assert status.indicates_timing_started is False
    assert status.has_countdown_clock is False


def test_a_device_with_no_claims_reports_none():
    mgr = TimerManager(track_id=1, device=FAKE)
    status = mgr.status()

    assert status.indicates_timing_started is False
    assert status.has_countdown_clock is False
    assert status.has_photo_finish_trigger is False


def test_swapping_the_device_changes_the_claims():
    """`set_device` is how a track's model choice takes effect; the claims on
    the very next status read have to follow it, not the profile the manager
    started with."""
    silent = replace(
        MICROWIZARD,
        key="plain-k-series",
        indicates_timing_started=False,
        has_countdown_clock=False,
    )
    mgr = TimerManager(track_id=1, device=CHAMP)

    assert mgr.status().has_photo_finish_trigger is True

    import asyncio

    asyncio.run(mgr.set_device(silent))

    status = mgr.status()
    assert status.has_photo_finish_trigger is False
    assert status.indicates_timing_started is False
    assert status.has_countdown_clock is False


# ---------------------------------------------------------------------------
# Every profile derbynet.py adapted is still accounted for
# ---------------------------------------------------------------------------


def test_every_derbynet_profile_is_covered_by_the_two_capability_tests_above():
    """A profile added to `ADAPTED_FROM_DERBYNET` without being named above
    would silently pass `test_nobody_else_claims_any_of_the_three` — this
    pins the membership those tests assume."""
    assert all(profile in ALL_PROFILES for profile in ADAPTED_FROM_DERBYNET)
    assert CHAMP in ADAPTED_FROM_DERBYNET


# ---------------------------------------------------------------------------
# docs/reference/timers.md's "Other capabilities" table
# ---------------------------------------------------------------------------


def _capabilities_table_rows() -> list[list[str]]:
    """The "Other capabilities" table's body rows, cell text only.

    A hand-rolled split rather than the `markdown` package `test_docs_stay_
    current.py` uses: that guard renders headings to check anchors, and pulling
    it in here for one table would be a lot of machinery for four rows that
    never move.
    """
    text = TIMERS_REFERENCE.read_text()
    section = text.split("## Other capabilities", 1)[1]
    table_start = section.index("| Model |")
    lines = section[table_start:].splitlines()
    # lines[0] is the header, lines[1] the `---` separator.
    body = []
    for line in lines[2:]:
        if not line.startswith("|"):
            break
        body.append([cell.strip() for cell in line.strip("|").split("|")])
    return body


def test_the_docs_table_matches_what_the_profiles_actually_claim():
    """A capability column that only the landing page's own tests hold to
    `ALL_PROFILES` is a claim nothing checks against this reference page — the
    same failure mode #553 itself calls out for the landing page's timer
    table. This is that guard for `docs/reference/timers.md` instead, since
    the landing page's list is deliberately untouched by this issue."""
    rows = _capabilities_table_rows()
    assert rows, "the table's heading or layout changed; update the parser above"

    doc_yes_counts = [0, 0, 0]  # timing started, countdown clock, photo finish
    for _model, *cells in rows:
        for i, cell in enumerate(cells):
            if cell.startswith("Yes"):
                doc_yes_counts[i] += 1

    actual_yes_counts = [
        sum(1 for p in ALL_PROFILES if p.indicates_timing_started),
        sum(1 for p in ALL_PROFILES if p.has_countdown_clock),
        sum(1 for p in ALL_PROFILES if p.has_photo_finish_trigger),
    ]
    assert doc_yes_counts == actual_yes_counts
