"""Whimsical default names for audience displays (#495).

Pure and in the domain layer — see `backend/domain/display_names.py`. No
database, no registry; these tests are about the function alone.
"""

from backend.domain.display_names import _PAIRS, _seed_index, whimsical_name


class TestDerivedFromTheId:
    def test_the_same_id_names_the_same_animal(self):
        # The whole design decision the module exists for: a name drawn at
        # random would be re-invented on every restart, which is survivable
        # for "Display 3" and not for a name the operator has been saying out
        # loud all morning.
        first = whimsical_name("abc-123", taken=set())
        second = whimsical_name("abc-123", taken=set())

        assert first == second

    def test_the_same_id_names_the_same_animal_after_the_registry_is_cleared(self):
        # "Cleared" here just means called again with no `taken` — the
        # registry itself holds nothing that could make this differ, which is
        # the property that matters.
        before = whimsical_name("laptop-at-the-scale", taken={"Some Other Name"})
        after = whimsical_name("laptop-at-the-scale", taken=set())

        assert before.split()[-1] == after.split()[-1]

    def test_different_ids_usually_name_different_animals(self):
        # Not a guarantee — two ids could collide on the same seeded index —
        # but with over 40 candidates a handful of arbitrary ids landing on
        # the same one every time would say the hash is not doing its job.
        names = {whimsical_name(f"display-{i}", taken=set()) for i in range(8)}

        assert len(names) > 1

    def test_the_name_is_never_empty(self):
        for display_id in ("", "x", "a-very-long-uuid-like-identifier-4f9c"):
            assert whimsical_name(display_id, taken=set()).strip()

    def test_the_name_is_an_adjective_and_an_animal(self):
        name = whimsical_name("gym-north", taken=set())

        assert len(name.split()) == 2


class TestCollisions:
    def test_animals_are_unique_within_a_race(self):
        # The noun is what gets read at a glance and shouted across a noisy
        # room, so it — not the whole name — must not repeat.
        taken: set[str] = set()
        names = []
        for i in range(6):
            name = whimsical_name(f"screen-{i}", taken=taken)
            names.append(name)
            taken.add(name)

        animals = [name.split()[-1] for name in names]
        assert len(animals) == len(set(animals))

    def test_a_taken_animal_is_skipped_even_if_the_full_name_differs(self):
        # Resolved on the animal, not the string: two different adjectives
        # in front of the same noun are still a collision.
        adjective, animal = _PAIRS[0]
        taken = {f"Some Other {animal}"}

        name = whimsical_name(adjective.lower() + "-seed", taken=taken)

        assert name.split()[-1] != animal

    def test_a_hand_typed_name_never_collides(self):
        # "Gym north" has no animal in it, so it must never be treated as
        # occupying one — it simply cannot match any candidate.
        name = whimsical_name("some-id", taken={"Gym north", "By the doors"})

        assert name not in ("Gym north", "By the doors")


class TestExhaustion:
    def test_an_exhausted_pool_falls_back_to_a_numbered_suffix(self):
        every_animal = {animal for _, animal in _PAIRS}

        name = whimsical_name("whatever-id", taken=every_animal)

        parts = name.split()
        assert parts[-1].isdigit()
        assert int(parts[-1]) >= 2

    def test_the_fallback_terminates_even_when_its_own_suffixes_are_taken(self):
        display_id = "whichever-id-lands-anywhere"
        adjective, animal = _PAIRS[_seed_index(display_id)]
        every_animal = {a for _, a in _PAIRS}
        # Also occupy the first several numbered fallbacks for the seeded
        # pair, to make sure the walk keeps going rather than looping.
        taken = every_animal | {f"{adjective} {animal} {n}" for n in range(2, 5)}

        name = whimsical_name(display_id, taken=taken)

        assert name == f"{adjective} {animal} 5"

    def test_the_fallback_is_never_empty(self):
        every_animal = {animal for _, animal in _PAIRS}

        assert whimsical_name("x", taken=every_animal).strip()
