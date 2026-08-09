"""The audit vocabulary, redaction, and how an entry reads.

Pure rules, so no database. The one that matters most is redaction: a mistake
there writes an operator's PIN into a table that exists to be read.
"""

import pytest

from backend.domain import audit


class TestRedaction:
    @pytest.mark.parametrize(
        "name",
        [
            "pin",
            "operator_pin",
            "operatorPin",
            "OPERATOR_PIN",
            "checkin_pin",
            "checkinPin",
        ],
    )
    def test_a_pin_is_never_recorded_under_any_spelling(self, name):
        """Arguments reach this module as Python identifiers from one seam and
        as GraphQL field names from another. A denylist matching one spelling
        let the other straight through."""
        assert audit.redact({name: "1234"}) == {}

    @pytest.mark.parametrize(
        "name",
        ["password", "apiToken", "secret_key", "operator_pin_hash", "credential"],
    )
    def test_other_secret_shaped_names_are_dropped_too(self, name):
        # Dropping a harmless field that matches costs a line of context;
        # keeping a real one costs the credential.
        assert audit.redact({name: "x"}) == {}

    def test_a_data_url_is_dropped_by_name(self):
        assert audit.redact({"dataUrl": "data:image/png;base64,AAAA"}) == {}

    def test_a_data_url_is_dropped_even_under_an_innocent_name(self):
        """The name checks are a list somebody maintains; this one is not."""
        assert audit.redact({"note": "data:image/png;base64," + "A" * 5000}) == {}

    def test_a_very_long_string_is_dropped_rather_than_truncated(self):
        # Its first 120 characters are not a useful note — they are the
        # beginning of something that should not be here.
        assert audit.redact({"note": "y" * (audit.DROP_STRING_OVER + 1)}) == {}

    def test_an_ordinary_string_is_kept(self):
        assert audit.redact({"name": "Pack 42"}) == {"name": "Pack 42"}

    def test_a_long_but_plausible_string_is_shortened(self):
        kept = audit.redact({"name": "z" * 400})

        assert len(kept["name"]) == audit.MAX_DETAIL_CHARS

    def test_numbers_and_booleans_survive(self):
        assert audit.redact({"raceId": 4, "passed": True, "weight": 5.0}) == {
            "raceId": 4,
            "passed": True,
            "weight": 5.0,
        }

    def test_a_list_becomes_a_count(self):
        # A heat's lanes recorded lane by lane is the heat, not a note about it.
        assert audit.redact({"racerIds": [1, 2, 3]}) == {"racerIds_count": 3}

    def test_a_nested_input_is_flattened_one_level(self):
        """Almost every mutation here takes a single input object, so dropping
        nested values whole left most entries with no details at all — the log
        could say "Created a race" and not which race."""
        assert audit.redact({"race": {"name": "Derby", "trackId": 3}}) == {
            "race.name": "Derby",
            "race.trackId": 3,
        }

    def test_a_pin_nested_inside_an_input_is_still_dropped(self):
        """The case that matters: `createInitialConfig` carries its PINs
        *inside* `config`, so a flattener trusting the outer name would undo
        the whole of this module's reason for existing."""
        kept = audit.redact(
            {
                "config": {
                    "groupName": "Pack 42",
                    "operatorPin": "8531",
                    "checkinPin": "1",
                }
            }
        )

        assert kept == {"config.groupName": "Pack 42"}
        assert "8531" not in str(kept)

    def test_a_nested_list_becomes_a_count(self):
        assert audit.redact({"config": {"tracks": [1, 2, 3]}}) == {
            "config.tracks_count": 3
        }

    def test_it_does_not_flatten_two_levels(self):
        """Two levels down is the payload rather than a note about it."""
        kept = audit.redact({"config": {"track": {"name": "Main"}}})

        assert kept == {}

    def test_nothing_is_kept_from_nothing(self):
        assert audit.redact({}) == {}


def _entry(**over):
    defaults = {
        "action": "createRace",
        "role": audit.ActorRole.OPERATOR,
        "at": "2026-08-09T12:00:00Z",
    }
    defaults.update(over)
    return audit.Entry(**defaults)


class TestDescribe:
    def test_a_known_action_reads_as_a_sentence(self):
        assert audit.describe(_entry(action="deleteRound")) == "Deleted a round"

    def test_an_unlisted_action_falls_back_to_its_own_name(self):
        """Rather than a table of 48 entries that goes stale. The fallback has
        to be readable, which is what this pins."""
        assert audit.describe(_entry(action="bulkAutoNumber")) == "Bulk auto number"

    def test_a_refusal_says_so(self):
        # "The tablet at the check-in desk tried to delete a round" is the most
        # interesting line this log can hold.
        entry = _entry(action="deleteRace", outcome=audit.Outcome.REFUSED)

        assert audit.describe(entry) == "Deleted a race — refused"

    def test_a_failure_says_so(self):
        entry = _entry(action="deleteRace", outcome=audit.Outcome.FAILED)

        assert audit.describe(entry) == "Deleted a race — failed"

    def test_a_heat_result_says_how_it_arrived(self):
        """The distinction a dispute turns on."""
        by_timer = _entry(
            action="heatResultRecorded",
            details={"source": audit.ResultSource.TIMER.value},
        )
        by_hand = _entry(
            action="heatResultRecorded",
            details={"source": audit.ResultSource.OPERATOR.value},
        )

        assert audit.describe(by_timer) == "Heat result recorded by the timer"
        assert audit.describe(by_hand) == "Heat result entered by hand"

    def test_a_heat_result_with_no_source_still_reads(self):
        assert (
            audit.describe(_entry(action="heatResultRecorded"))
            == "Heat result recorded"
        )

    def test_it_never_consults_anything_but_the_entry(self):
        """An entry is a claim about a moment that has passed.

        Deleting the round would otherwise change what the log says happened,
        which would make it a second view of the present rather than a record.
        """
        entry = _entry(action="deleteRound", details={"roundId": 4, "name": "Finals"})

        assert "Finals" not in audit.describe(entry)
        assert audit.describe(entry) == "Deleted a round"


class TestNoteworthy:
    @pytest.mark.parametrize(
        "action", ["deleteRace", "deleteRound", "bulkDeleteRacers", "backupRestored"]
    )
    def test_destructive_actions_are_marked(self, action):
        assert audit.is_noteworthy(_entry(action=action))

    def test_an_ordinary_action_is_not(self):
        assert not audit.is_noteworthy(_entry(action="checkInRacer"))

    def test_anything_that_did_not_succeed_is(self):
        # An operator scanning a thousand rows for "what went wrong" should not
        # have to read every one of them.
        assert audit.is_noteworthy(
            _entry(action="checkInRacer", outcome=audit.Outcome.REFUSED)
        )
        assert audit.is_noteworthy(
            _entry(action="checkInRacer", outcome=audit.Outcome.FAILED)
        )
