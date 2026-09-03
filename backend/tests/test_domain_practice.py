"""The pure naming rule that says which race is *the* practice race (#588).

Pure, so these run without a database — the same reason
`test_domain_name_display.py` exists. The database wiring
(`crud.existing_practice_race`, the `createPracticeRace`/`practiceRace`
GraphQL seam) is covered in `test_practice_race.py`.
"""

from backend.domain.practice import (
    PRACTICE_RACE_NAME,
    is_practice_race_name,
    next_practice_name,
)


class TestIsPracticeRaceName:
    def test_the_bare_name_matches(self) -> None:
        assert is_practice_race_name(PRACTICE_RACE_NAME)

    def test_a_counted_up_name_matches(self) -> None:
        assert is_practice_race_name(f"{PRACTICE_RACE_NAME} 2")
        assert is_practice_race_name(f"{PRACTICE_RACE_NAME} 17")

    def test_an_unrelated_name_does_not_match(self) -> None:
        assert not is_practice_race_name("2026 Pinewood Derby")

    def test_a_name_merely_sharing_the_stem_does_not_match(self) -> None:
        """`races.name` is free text; an operator's own race must not be
        mistaken for a rehearsal just because it starts the same way."""
        assert not is_practice_race_name(f"{PRACTICE_RACE_NAME} for Pack 42")

    def test_a_non_numeric_suffix_does_not_match(self) -> None:
        assert not is_practice_race_name(f"{PRACTICE_RACE_NAME} Two")

    def test_trailing_whitespace_does_not_match(self) -> None:
        assert not is_practice_race_name(f"{PRACTICE_RACE_NAME} ")


class TestNextPracticeName:
    def test_the_first_one_is_the_bare_name(self) -> None:
        assert next_practice_name([]) == PRACTICE_RACE_NAME

    def test_the_second_one_counts_up(self) -> None:
        assert next_practice_name([PRACTICE_RACE_NAME]) == f"{PRACTICE_RACE_NAME} 2"

    def test_it_skips_every_taken_number(self) -> None:
        taken = [
            PRACTICE_RACE_NAME,
            f"{PRACTICE_RACE_NAME} 2",
            f"{PRACTICE_RACE_NAME} 3",
        ]
        assert next_practice_name(taken) == f"{PRACTICE_RACE_NAME} 4"

    def test_it_does_not_reuse_a_gap(self) -> None:
        taken = [PRACTICE_RACE_NAME, f"{PRACTICE_RACE_NAME} 3"]
        assert next_practice_name(taken) == f"{PRACTICE_RACE_NAME} 2"

    def test_a_similarly_named_race_does_not_block_the_bare_name(self) -> None:
        taken = [f"{PRACTICE_RACE_NAME} for Pack 42"]
        assert next_practice_name(taken) == PRACTICE_RACE_NAME
