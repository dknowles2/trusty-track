"""Which race is *the* practice race (#201, #588).

`Race.name` is the only signal — see CLAUDE.md's "The practice race" for why
there is deliberately no stored flag. `crud.create_practice_race` names the
first rehearsal exactly `PRACTICE_RACE_NAME` and counts a later one up
(`"Practice Race 2"`, `"Practice Race 3"`, ...) rather than reusing a gap, so
recognising "a practice race" from a bare name has to match exactly that
shape and nothing looser: a race an operator happened to name similarly
(``"Practice Race for Pack 42"``) is theirs, not a rehearsal to hand back.

Resuming rather than duplicating (#588) needed this question askable in two
places: the mutation, to decide whether to build a new race at all, and
`Query.practiceRace`, which the Home page reads to decide whether its button
should say "Resume practice race" instead of "Try a practice race". A rule
answered twice is a rule free to disagree (#48's lesson, by a new route), so
the backend answers it once here and the frontend reads the result rather
than re-deriving it from the race list. This module holds only the pure
naming rule, importable with no database so it can be pinned with no
fixtures; `crud.existing_practice_race` is where the query lives.
"""

from collections.abc import Iterable

#: The stem every practice race is named from. It has to be recognisable at a
#: glance on the Home page — the whole point is that nobody confuses it with
#: the real event.
PRACTICE_RACE_NAME = "Practice Race"


def is_practice_race_name(name: str) -> bool:
    """Whether `name` is one this module's own naming scheme produced.

    Exactly `PRACTICE_RACE_NAME`, or `PRACTICE_RACE_NAME` plus a space and a
    positive integer — the two shapes `next_practice_name` hands out. Nothing
    looser: `races.name` is free text, and an operator's own race sharing the
    stem as a prefix (`"Practice Race for Pack 42"`) must not be mistaken for
    a rehearsal.
    """
    if name == PRACTICE_RACE_NAME:
        return True
    prefix = f"{PRACTICE_RACE_NAME} "
    if not name.startswith(prefix):
        return False
    suffix = name[len(prefix) :]
    return suffix.isdigit()


def next_practice_name(taken: Iterable[str]) -> str:
    """A free name, since `races.name` is unique.

    Counts up rather than stamping a timestamp: an operator rehearsing twice
    should see "Practice Race" and "Practice Race 2", not two names with
    seconds in them. `taken` is every race name already in use — the caller's
    query, kept out of this module so the rule stays importable with no
    database.
    """
    taken_set = set(taken)
    if PRACTICE_RACE_NAME not in taken_set:
        return PRACTICE_RACE_NAME
    suffix = 2
    while f"{PRACTICE_RACE_NAME} {suffix}" in taken_set:
        suffix += 1
    return f"{PRACTICE_RACE_NAME} {suffix}"
