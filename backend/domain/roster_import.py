"""What an import of somebody else's roster hands back, whoever wrote it.

A pack switching to Trusty Track arrives with years of rosters, car numbers
and den assignments in another program's database — GrandPrix Race Manager
(#618), DerbyNet (#661) — and the only door in used to be the CSV importer,
which means exporting tables by hand and reshaping columns to fit.

Every such importer has the same two halves: reading *that* program's file,
and turning what it found into racing groups and racers. The second half is
the same job for all of them, so this module is the vocabulary they share.
A parser produces a `ParsedRoster`; a later stage's preview screen renders
one; the mutation that writes it needs to know nothing about where it came
from. That is the seam a second importer plugs into — add a parser that
returns this type, and the preview, the confirmation and the write path are
already there.

Two things about the shape, both learned from the CSV path:

- **A problem is a sentence, not a code.** `csvMapping.ts`'s `validate`
  reports what is wrong with an import in the order the operator would find
  it — a duplicate car number, an unreadable yes/no — because the backend's
  answer to a row it cannot use is to skip it and return a count, and a file
  that imports zero racers says only "Successfully imported 0". Here the
  file is parsed server-side, so the same sentences are produced here, ready
  for a preview to show.
- **Only a problem with the whole import blocks it.** A row problem is a
  warning: that racer is skipped or that field left blank, and the rest go in.
  `blocking` is the one-field version of `csvMapping.ts`'s `line === 0`.

Pure: no database, no file. The messages take the resolved vehicle word as a
parameter rather than saying "Car" outright (#551), defaulting to the built-in
Scouting one exactly as `csvMapping.validate` does.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass


class RosterImportError(ValueError):
    """The file is not something this importer can read at all.

    Distinct from a `Problem`: a problem is about one racer in a file that is
    otherwise fine, and the import can go ahead around it. This is raised
    when there is no roster to find — the wrong kind of file, a database
    without the tables the format promises — and the message is the sentence
    the operator should see.
    """


@dataclass(frozen=True)
class ImportedGroup:
    """A racing group as the other program had it.

    `division` is Trusty Track's free-text category (#496 stage 2) — a Cub
    Scout rank, a school grade — and is deliberately plain text here: GPRM and
    DerbyNet both carry a `Rank` beside their groups, and re-deriving an enum
    from it is what #496 spent a stage removing.
    """

    name: str
    division: str | None = None


@dataclass(frozen=True)
class ImportedRacer:
    """A racer as the other program had them, in Trusty Track's own terms.

    Field names mirror `schemas.RacerCreate` so the write path is a plain
    copy. `group` names an `ImportedGroup` by `name`, not by the other
    program's id — the id means nothing once the row is in this database.
    `source_id` is the other program's own id, kept only so a problem can
    say which racer it is about when the name is the thing that is missing.
    """

    first_name: str
    last_name: str
    car_number: int | None = None
    car_name: str | None = None
    car_weight: float | None = None
    passed_inspection: bool = False
    group: str | None = None
    excluded_from_standings: bool = False
    source_id: str | None = None


@dataclass(frozen=True)
class ImportProblem:
    """One sentence about what will not import as the operator might expect."""

    message: str
    blocking: bool = False
    source_id: str | None = None


@dataclass(frozen=True)
class ParsedRoster:
    """Everything a parser found, plus what it could not use."""

    groups: tuple[ImportedGroup, ...] = ()
    racers: tuple[ImportedRacer, ...] = ()
    problems: tuple[ImportProblem, ...] = ()

    @property
    def can_import(self) -> bool:
        """Whether the import can go ahead. Row problems are warnings."""
        return not any(problem.blocking for problem in self.problems)


def _racer_label(racer: ImportedRacer) -> str:
    name = f"{racer.first_name} {racer.last_name}".strip()
    if name:
        return name
    if racer.source_id is not None:
        return f"racer #{racer.source_id}"
    return "an unnamed racer"


def duplicate_number_problems(
    racers: Iterable[ImportedRacer], vehicle_word: str = "Car"
) -> list[ImportProblem]:
    """The duplicate-car-number rule the CSV preview already applies (#60).

    A number used twice *within* the import is reported against the second
    holder, naming the first, so the operator can tell which of the two to
    renumber. An unnumbered racer holds no number and so never collides.
    Nothing here compares against the roster already in the race — that needs
    a database, and belongs to the mutation that writes the result.
    """
    problems: list[ImportProblem] = []
    first_holder: dict[int, ImportedRacer] = {}
    for racer in racers:
        if racer.car_number is None:
            continue
        holder = first_holder.get(racer.car_number)
        if holder is None:
            first_holder[racer.car_number] = racer
            continue
        problems.append(
            ImportProblem(
                message=(
                    f"{vehicle_word} number {racer.car_number} is already used by "
                    f"{_racer_label(holder)}."
                ),
                source_id=racer.source_id,
            )
        )
    return problems


def existing_number_problems(
    racers: Iterable[ImportedRacer],
    existing_holders: Mapping[int, str],
    vehicle_word: str = "Car",
) -> list[ImportProblem]:
    """A number that collides with a racer already on *this race's* roster.

    `duplicate_number_problems` above is the in-file rule and needs no
    database; this is the half that does, which is why it takes
    `existing_holders` (`{car_number: "First Last"}`) as data rather than a
    session — the caller queries the race's own racers and hands the answer
    in, the same split every other rule/I-O boundary in this codebase draws.

    Only the *first* file holder of a number is checked against
    `existing_holders`. A later file holder sharing that number is already
    reported by `duplicate_number_problems`, against the first — reporting it
    again here would say the same thing twice for one collision.
    """
    problems: list[ImportProblem] = []
    seen: set[int] = set()
    for racer in racers:
        if racer.car_number is None or racer.car_number in seen:
            continue
        seen.add(racer.car_number)
        holder = existing_holders.get(racer.car_number)
        if holder is not None:
            problems.append(
                ImportProblem(
                    message=(
                        f"{vehicle_word} number {racer.car_number} is already used "
                        f"by {holder}, already on the roster."
                    ),
                    source_id=racer.source_id,
                )
            )
    return problems
