"""The profile record works for devices that are not the MicroWizard.

`test_timer.py` covers the MicroWizard's own protocol thoroughly, and it kept
passing unchanged through the conversion — which is the evidence the refactor
preserved behaviour, but not evidence that the record generalises. A machine
that only ever runs one profile has not been shown to be data-driven at all.

So everything here drives synthetic profiles: lanes numbered rather than
lettered, times in milliseconds, timers with no lane masking, banners of a
different shape. None of them correspond to real hardware — a profile that
claims to be a real timer needs one on a desk, not a unit test (issue #89).
"""

import re

from backend.services.timer.devices import ALL_PROFILES, FAKE, MICROWIZARD, by_key
from backend.services.timer.devices.base import (
    Ack,
    Event,
    GateClosed,
    Group,
    HeatPrep,
    LaneResult,
    Matcher,
    RaceStarted,
    TimerProfile,
    lane_letter,
    lane_number,
    milliseconds,
    place_number,
    place_symbol,
    seconds,
)

# ---------------------------------------------------------------------------
# Reading captured groups
# ---------------------------------------------------------------------------


def test_lane_letters_and_numbers_both_reach_lane_one():
    assert lane_letter(b"A") == 1
    assert lane_letter(b"a") == 1
    assert lane_letter(b"F") == 6
    assert lane_number(b"1") == 1
    assert lane_number(b"6") == 6


def test_a_timer_may_report_whole_milliseconds():
    """SuperTimer and its relatives report an integer, not a decimal."""
    assert milliseconds(b"3452") == 3.452
    assert seconds(b"3.452") == 3.452


def test_a_place_may_be_a_symbol_or_a_digit():
    assert place_symbol(b"!") == 1
    assert place_symbol(b'"') == 2
    assert place_symbol(b"&") == 6
    # A device that marks only the winner leaves the rest unreported, which is
    # 0 rather than a guess.
    assert place_symbol(b"") == 0
    assert place_number(b"3") == 3


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------

#: Numbered lanes, milliseconds, no places reported, a `;` terminator.
NUMERIC = TimerProfile(
    name="Numeric Test Timer",
    key="numeric-test",
    delimiter=b";",
    identification=(re.compile(rb"^HELLO$"), re.compile(rb"^v\d+$")),
    matchers=(
        Matcher(re.compile(rb"^GO$"), Event.RACE_STARTED),
        Matcher(re.compile(rb"^SET$"), Event.GATE_CLOSED),
        Matcher(re.compile(rb"^HELLO$"), Event.IGNORE),
        Matcher(
            re.compile(rb"L(\d)T(\d+)"),
            Event.LANE_RESULT,
            lane=Group(1, lane_number),
            time=Group(2, milliseconds),
            repeat=True,
        ),
    ),
)


def test_a_profile_with_numbered_lanes_and_millisecond_times():
    result = NUMERIC.parse_line(b"L2T3452")

    assert result == [LaneResult(lane=2, time_seconds=3.452, place=0)]


def test_a_repeating_matcher_yields_one_event_per_lane():
    result = NUMERIC.parse_line(b"L1T3001 L2T3002 L3T3003")

    assert result == [
        LaneResult(lane=1, time_seconds=3.001, place=0),
        LaneResult(lane=2, time_seconds=3.002, place=0),
        LaneResult(lane=3, time_seconds=3.003, place=0),
    ]


def test_a_profile_without_a_place_group_reports_no_place():
    """Not a tie and not first — unknown, for the manager to derive by time."""
    (result,) = NUMERIC.parse_line(b"L1T3001")

    assert result.place == 0


def test_gate_and_start_events_carry_no_values():
    assert NUMERIC.parse_line(b"GO") == RaceStarted()
    assert NUMERIC.parse_line(b"SET") == GateClosed()


def test_recognised_but_silent_traffic_is_distinguishable_from_noise():
    """An empty list and None are different answers.

    `TimerManager` reads the empty list as "a device is talking and I
    understand it", which is what lets a connection leave CONNECTED, and None
    as "no idea what that was".
    """
    assert NUMERIC.parse_line(b"HELLO") == []
    assert NUMERIC.parse_line(b"who knows") is None
    assert NUMERIC.parse_line(b"") is None
    assert NUMERIC.parse_line(b"   ") is None


def test_the_first_matching_matcher_wins():
    """Order in the tuple is the priority, so a specific pattern goes first."""
    profile = TimerProfile(
        name="Ordered",
        key="ordered",
        matchers=(
            Matcher(re.compile(rb"^X1$"), Event.RACE_STARTED),
            Matcher(re.compile(rb"^X\d$"), Event.GATE_CLOSED),
        ),
    )

    assert profile.parse_line(b"X1") == RaceStarted()
    assert profile.parse_line(b"X2") == GateClosed()


def test_an_unexpected_acknowledgement_is_recognised_rather_than_ignored():
    """It produces no event, but it is traffic we can name."""
    profile = TimerProfile(
        name="Acked",
        key="acked",
        matchers=(Matcher(re.compile(rb"^\*$"), Event.UNEXPECTED),),
    )

    assert profile.parse_line(b"*") == []


# ---------------------------------------------------------------------------
# Acknowledgements
# ---------------------------------------------------------------------------


def test_one_ack_entry_covers_a_family_of_commands():
    profile = TimerProfile(
        name="Masked",
        key="masked",
        acks=(
            Ack(re.compile(rb"^RESET$"), re.compile(rb"^OK$")),
            Ack(re.compile(rb"^M[A-D]$"), re.compile(rb"^\*$")),
        ),
    )

    assert profile.expected_response_for(b"RESET").pattern == rb"^OK$"
    assert profile.expected_response_for(b"MA").pattern == rb"^\*$"
    assert profile.expected_response_for(b"MD").pattern == rb"^\*$"
    assert profile.expected_response_for(b"MZ") is None
    assert profile.expected_response_for(b"WHAT") is None


def test_a_profile_with_no_acks_expects_nothing():
    assert NUMERIC.expected_response_for(b"ANYTHING") is None


# ---------------------------------------------------------------------------
# Preparing a heat
# ---------------------------------------------------------------------------


def test_lanes_not_racing_are_masked_out_by_name():
    profile = TimerProfile(
        name="Four Lane",
        key="four-lane",
        max_lanes=4,
        heat_prep=HeatPrep(unmask=b"MG", mask=b"M", first_lane=b"A", arm=b"GO"),
    )

    # Lanes 1 and 3 racing, so lanes 2 and 4 are masked out.
    assert profile.prepare_heat_commands(0b0101) == [b"MG", b"MB", b"MD", b"GO"]


def test_a_timer_may_number_its_lanes_from_a_different_character():
    profile = TimerProfile(
        name="Numbered Lanes",
        key="numbered-lanes",
        max_lanes=3,
        heat_prep=HeatPrep(mask=b"X", first_lane=b"1"),
    )

    assert profile.prepare_heat_commands(0b001) == [b"X2", b"X3"]


def test_a_timer_that_cannot_mask_lanes_only_arms():
    profile = TimerProfile(
        name="No Masking",
        key="no-masking",
        max_lanes=6,
        heat_prep=HeatPrep(arm=b"R"),
    )

    assert profile.prepare_heat_commands(0b000011) == [b"R"]


def test_a_timer_with_no_heat_preparation_sends_nothing():
    assert NUMERIC.prepare_heat_commands(0b11) == []


def test_masking_stops_at_the_profiles_lane_count():
    """`max_lanes` bounds the commands, not the mask.

    A mask with bits set above the device's lane count is the caller's
    problem; the profile must not invent an `MG` for a lane the timer has
    never heard of.
    """
    profile = TimerProfile(
        name="Two Lane",
        key="two-lane",
        max_lanes=2,
        heat_prep=HeatPrep(mask=b"M", first_lane=b"A"),
    )

    assert profile.prepare_heat_commands(0) == [b"MA", b"MB"]


# ---------------------------------------------------------------------------
# Identification
# ---------------------------------------------------------------------------


def test_only_the_first_identification_pattern_announces_the_device():
    """The rest of a banner is informational.

    Treating a second line as an identification in its own right makes the
    manager re-initialise a device that was merely finishing its greeting.
    """
    assert NUMERIC.is_identified_by(b"HELLO") is True
    assert NUMERIC.is_identified_by(b"v3") is False
    assert NUMERIC.is_identified_by(b"nothing") is False


def test_a_profile_with_no_banner_is_never_identified():
    assert FAKE.is_identified_by(b"anything at all") is False


# ---------------------------------------------------------------------------
# The registry
# ---------------------------------------------------------------------------


def test_the_fake_timer_is_not_something_to_probe_for():
    """It has no protocol. It is chosen, by setting a track's timer type."""
    assert FAKE not in ALL_PROFILES
    assert MICROWIZARD in ALL_PROFILES


def test_every_profile_key_is_unique():
    """A key identifies a stored choice, so a collision silently swaps devices."""
    keys = [profile.key for profile in (*ALL_PROFILES, FAKE)]

    assert len(keys) == len(set(keys))


def test_a_profile_can_be_found_by_key():
    assert by_key("microwizard") is MICROWIZARD
    assert by_key("fake") is FAKE
    assert by_key("nonesuch") is None


def test_every_real_profile_can_identify_itself():
    """A profile with no identification patterns cannot be probed for, so it
    would silently never match once there is a prober to walk this list."""
    for profile in ALL_PROFILES:
        assert profile.identification, f"{profile.key} has no identification"
