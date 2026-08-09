"""What happened, who did it, and when.

An operator finishes an event and finds a time they do not recognise, or a
round that is not the one they built. Until now nothing in the app could answer
"what changed and when" — the database holds the current state and no history
of how it got there, so the only record was whoever happened to be watching.

Pure: the vocabulary, what is safe to keep, and how an entry reads. The rows
and the seams that write them live in ``db`` and ``api``.

Three rules shape everything here.

**An entry is self-contained.** The sentence a timeline shows is rendered from
what the entry itself stored, never by looking the ids back up. That is the
opposite of how the rest of this app works — standings, awards and recipients
are all computed on demand precisely so they cannot disagree with the race —
and it is right for exactly the same reason: an audit entry is a claim about a
moment that has passed. If deleting a racer changed what the log says happened,
the log would be a second view of the present rather than a record of the past.

**Arguments are chosen, never swept up.** Mutation inputs carry things that must
not be written down: ``createInitialConfig`` takes the operator and check-in
PINs as plaintext, and ``uploadImage`` takes a base64 data URL that is megabytes
long. A log that recorded whatever it was handed would put both in the database
— one a credential, the other a reason the table stops fitting on an SD card.
So the details of an entry are an allow-list of small scalars.

**A refusal is worth more than a success.** The role policy (#15) turns away
mutations a device is not allowed to run, and "the tablet at the check-in desk
tried to delete a round" is the single most interesting line this log can hold.
Refusals are recorded with the same weight as anything else.
"""

from __future__ import annotations

from dataclasses import dataclass, field, fields, is_dataclass
from enum import Enum
from typing import Any

#: Values that may be kept in an entry's details.
#:
#: Scalars only, and short ones. A dict or a list here would be a mutation input
#: smuggled in whole, which is what the allow-list exists to prevent.
Detail = str | int | float | bool | None


class ActorRole(str, Enum):
    """Who acted, in the only terms this app has.

    There are no user accounts here — a role comes from a shared PIN, so two
    volunteers who both know the operator PIN are genuinely indistinguishable
    and the log must not pretend otherwise. The source address is what
    separates the laptop at the front from the tablet at the desk.

    ``SYSTEM`` is the app acting without a request behind it: the timer
    recording a heat it has just run, and the pruning this module's rows are
    subject to. It is not a role anybody can hold.
    """

    VIEWER = "VIEWER"
    CHECKIN = "CHECKIN"
    OPERATOR = "OPERATOR"
    SYSTEM = "SYSTEM"


class Outcome(str, Enum):
    """Whether the operation the entry describes actually happened."""

    OK = "OK"
    #: Turned away by the role policy before it ran.
    REFUSED = "REFUSED"
    #: Reached the resolver and raised.
    FAILED = "FAILED"


class ResultSource(str, Enum):
    """How a heat result reached the database.

    The distinction a dispute turns on, and the reason this module exists at
    all: results arrive by two routes and only one of them is a mutation. The
    timer writes through its own session outside any request (#9), so a log
    built only on the GraphQL seam records every *correction* to a time and
    never the time it corrected.
    """

    #: The device timed the heat and reported it.
    TIMER = "TIMER"
    #: A person typed it in — Edit, Override, or a skipped heat.
    OPERATOR = "OPERATOR"


#: Fragments of an argument name that make its value unrecordable.
#:
#: Matched against the name with underscores removed and case folded, so
#: ``operator_pin``, ``operatorPin`` and ``OPERATOR_PIN`` are one rule rather
#: than three. That normalisation is not tidiness: mutation arguments reach
#: this module as Python identifiers from one seam and as GraphQL field names
#: from another, and a denylist that matched only ``data_url`` let ``dataUrl``
#: straight through — found by smoke-testing this function rather than by
#: reading it, which is why the check is on a *fragment* of the name now.
#:
#: PINs are why this is not advisory. ``InitialConfigInput`` carries them in
#: plaintext on their way to being hashed, so a log that stored its arguments
#: would hold the very credential it exists to attribute actions to. Dropping a
#: harmless field that happens to match — ``checkinPinSet`` is a boolean and no
#: secret — costs a line of context. Keeping a real one costs the credential.
SENSITIVE_NAME_FRAGMENTS = frozenset(
    {"pin", "password", "secret", "token", "hash", "credential"}
)

#: Argument names whose values are large rather than secret.
BULKY_NAME_FRAGMENTS = frozenset({"dataurl", "csvdata", "imageurl", "image", "csv"})

#: The longest a single recorded string may be.
#:
#: Long enough for any name, car name or track name somebody would actually
#: type, short enough that a pasted essay in a field cannot make one row large.
MAX_DETAIL_CHARS = 120

#: Beyond this a string is dropped rather than truncated.
#:
#: A value this long is a document somebody pasted or a payload that slipped
#: past the name checks, and its first 120 characters are not a useful note —
#: they are the beginning of something that should not be here.
DROP_STRING_OVER = 2_000


def _normalised(name: str) -> str:
    return name.replace("_", "").lower()


def is_sensitive(name: str) -> bool:
    """Whether an argument's *name* alone disqualifies its value."""
    normalised = _normalised(name)
    return any(fragment in normalised for fragment in SENSITIVE_NAME_FRAGMENTS)


def redact(arguments: dict[str, Any]) -> dict[str, Detail]:
    """The part of a mutation's arguments worth keeping, and safe to keep.

    Short scalars survive. Everything else — nested inputs, lists of lanes,
    data URLs — is reduced to a count or dropped, because what makes this log
    useful is *which* operation ran against *what*, and a lane-by-lane copy of
    a heat is the heat rather than a note about it.

    Three defences rather than one, because a denylist of names is exactly the
    kind of guard that is correct on the day it is written and silently wrong
    after the next input type is added: the name fragments above, a check on
    the value itself for anything that looks like an embedded document, and a
    hard length beyond which a string is dropped rather than shortened.
    """
    kept: dict[str, Detail] = {}
    for name, value in arguments.items():
        if is_sensitive(name):
            continue
        normalised = _normalised(name)
        if any(fragment in normalised for fragment in BULKY_NAME_FRAGMENTS):
            continue

        if isinstance(value, (bool, int, float)):
            kept[name] = value
        elif isinstance(value, str):
            # Regardless of its name: an argument nobody thought to list is
            # still not going in the database if it is a data URL.
            if value.startswith("data:") or len(value) > DROP_STRING_OVER:
                continue
            kept[name] = value[:MAX_DETAIL_CHARS]
        elif isinstance(value, (list, tuple)):
            # How many, not which. A list here is a bulk operation's racer ids
            # or a heat's lanes; the count is the interesting part and the
            # contents would dwarf the entry.
            kept[f"{name}_count"] = len(value)
        else:
            kept.update(_flattened(name, value))
    return kept


def _fields_of(value: Any) -> dict[str, Any] | None:
    """One level of an object's own fields, if it has any worth reading.

    Deliberately structural rather than typed against any framework: an input
    object is a plain object with attributes as far as this module is
    concerned, and `domain/` stays importable without the API layer.
    """
    if is_dataclass(value) and not isinstance(value, type):
        return {f.name: getattr(value, f.name, None) for f in fields(value)}
    if isinstance(value, dict):
        return value
    return None


def _flattened(prefix: str, value: Any) -> dict[str, Detail]:
    """The scalar leaves of a nested input, one level down.

    Without this the log could say "Created a race" and not *which* race:
    almost every mutation here takes a single input object, so dropping nested
    values whole left the majority of entries with no details at all.

    One level, and no deeper. Two levels is `InitialConfigInput.tracks`, which
    is a list of objects and belongs as a count; anything past that is the
    payload rather than a note about it.

    Every leaf goes through the same name checks as a top-level argument, which
    is the point that matters: `createInitialConfig` takes its PINs *inside*
    `config`, so a flattener that trusted the outer name would undo the whole
    of this module's reason for existing.
    """
    contents = _fields_of(value)
    if contents is None:
        return {}

    kept: dict[str, Detail] = {}
    for leaf, leaf_value in contents.items():
        if is_sensitive(leaf) or any(
            fragment in _normalised(leaf) for fragment in BULKY_NAME_FRAGMENTS
        ):
            continue
        label = f"{prefix}.{leaf}"
        if isinstance(leaf_value, (bool, int, float)):
            kept[label] = leaf_value
        elif isinstance(leaf_value, str):
            if leaf_value.startswith("data:") or len(leaf_value) > DROP_STRING_OVER:
                continue
            kept[label] = leaf_value[:MAX_DETAIL_CHARS]
        elif isinstance(leaf_value, (list, tuple)):
            kept[f"{label}_count"] = len(leaf_value)
    return kept


@dataclass(frozen=True)
class Entry:
    """One thing that happened, as it will be stored and rendered.

    ``at`` is supplied by the caller rather than taken from the clock here, so
    this module stays pure and a test can pin a timestamp.
    """

    action: str
    role: ActorRole
    at: str
    outcome: Outcome = Outcome.OK
    source_ip: str | None = None
    race_id: int | None = None
    details: dict[str, Detail] = field(default_factory=dict)


#: How an action reads in a timeline, where the field name is not plain English.
#:
#: Only the ones that need it. An unlisted action falls back to its own name
#: split into words, which is right far more often than a table of 48 entries
#: would stay correct — and `test_audit.py` pins that the fallback is readable
#: rather than pinning a translation for every mutation in the schema.
ACTION_PHRASES: dict[str, str] = {
    "createRace": "Created a race",
    "createRacer": "Added a racer",
    "updateRacer": "Changed a racer",
    "deleteRacer": "Deleted a racer",
    "createDen": "Added a den",
    "updateDen": "Changed a den",
    "deleteDen": "Deleted a den",
    "createTrack": "Added a track",
    "updateTrack": "Changed a track",
    "deleteTrack": "Deleted a track",
    "createRound": "Added a round",
    "createAward": "Added an award",
    "updateAward": "Changed an award",
    "deleteAward": "Deleted an award",
    "prepareHeat": "Armed a heat",
    "abortHeat": "Aborted a heat",
    "deleteRace": "Deleted a race",
    "updateRace": "Changed race settings",
    "bulkDeleteRacers": "Deleted racers in bulk",
    "bulkCheckIn": "Checked in racers in bulk",
    "checkInRacer": "Checked in a racer",
    "createRoundWizard": "Built a schedule",
    "regenerateRound": "Regenerated a round",
    "deleteRound": "Deleted a round",
    "deleteHeat": "Deleted a heat",
    "advanceRound": "Advanced a championship round",
    "updateHeatResult": "Entered a heat result by hand",
    "reorderHeats": "Reordered heats",
    "setLaneOutages": "Changed which lanes are in service",
    "createInitialConfig": "Set the system up",
    "updateInitialConfig": "Changed system settings",
    "createPracticeRace": "Created a practice race",
    "populateRace": "Added test data",
    # Not mutations — the two seams a mutation-only log would miss.
    "heatResultRecorded": "Heat result recorded",
    "backupDownloaded": "Downloaded a backup",
    "backupRestored": "Restored from a backup",
}


def _spaced(action: str) -> str:
    """`bulkAutoNumber` → `Bulk auto number`."""
    out: list[str] = []
    for index, character in enumerate(action):
        if character.isupper() and index:
            out.append(" ")
            out.append(character.lower())
        else:
            out.append(character)
    spaced = "".join(out)
    return spaced[:1].upper() + spaced[1:]


def describe(entry: Entry) -> str:
    """The sentence a timeline shows, from the entry and nothing else.

    Deliberately not a lookup against the race. A round deleted last March
    cannot be named by asking the database what round 4 is called today, and an
    entry that changed its story when the data moved underneath it would be
    worse than no entry at all.
    """
    phrase = ACTION_PHRASES.get(entry.action) or _spaced(entry.action)

    if entry.action == "heatResultRecorded":
        source = entry.details.get("source")
        if source == ResultSource.TIMER.value:
            phrase = "Heat result recorded by the timer"
        elif source == ResultSource.OPERATOR.value:
            phrase = "Heat result entered by hand"

    if entry.outcome is Outcome.REFUSED:
        return f"{phrase} — refused"
    if entry.outcome is Outcome.FAILED:
        return f"{phrase} — failed"
    return phrase


def is_noteworthy(entry: Entry) -> bool:
    """Whether an entry deserves attention rather than merely a line.

    Destructive or wide-reaching things, and anything that did not succeed. The
    timeline marks these so an operator scanning a thousand rows for "what went
    wrong" is not reading every one of them.
    """
    if entry.outcome is not Outcome.OK:
        return True
    return entry.action in {
        "deleteRace",
        "deleteRound",
        "deleteHeat",
        "bulkDeleteRacers",
        "regenerateRound",
        "backupRestored",
        "setLaneOutages",
        "updateInitialConfig",
    }
