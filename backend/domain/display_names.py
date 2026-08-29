"""Whimsical default names for audience displays (#495).

Today a screen arrives called `Display 3`. Four of those in a gym are four
rows the operator cannot tell apart without walking to each one — which is
the errand `services/displays.py` was built to remove, and a name nobody can
use as a handle does not remove it. `Brisk Badger`, `Plucky Puffin`,
`Cheerful Chipmunk` — an adjective and an animal, alliterative, so the pair is
easy to say out loud across a noisy room and easy to remember afterwards.

Pure, in the domain layer — no SQLAlchemy, no Strawberry — so it is
`mypy`-strict from the day it is written and testable with no database.

**Derived from the display id, not drawn at random.** The registry
(`services/displays.py`) is deliberately in memory: a display is a browser
tab that is open right now, and a row saying a screen was on a gym wall last
March describes nothing that still exists. A name drawn at random would be
re-invented on every restart, and `Brisk Badger` would become `Plucky Puffin`
halfway through the morning — survivable for `Display 3`, which nobody used
as an identifier, and not survivable for a name the operator has been saying
out loud all day. Seeding the draw from the id fixes that with no storage at
all: the browser keeps its own id in `localStorage`
(`features/observation/displayIdentity.ts`), so the same physical screen gets
the same name across a reload, a restart, and a laptop swap.

The seed is `hashlib.sha256` rather than the builtin `hash()`, which is
salted per process (`PYTHONHASHSEED`) precisely so it is *not* stable across
runs — exactly the property this needs to *not* have.

**Collisions are resolved on the animal, not the whole name.** `Brisk Badger`
and `Bright Badger` are worse than `Display 1` and `Display 2`: the noun is
what gets read at a glance and shouted across the room, so it is the animal
that must be unique within a race, and `taken` — the names already in use —
is checked by the last word of each. The walk must terminate, so once the
pool is exhausted it falls back to a numbered suffix (`Plucky Puffin 2`)
rather than looping; a pool of about forty pairs is ample for a gym with a
handful of screens, and the fallback is for the pathological case rather than
the expected one.
"""

from __future__ import annotations

import hashlib
from collections.abc import Collection

__all__ = ["whimsical_name"]

#: (adjective, animal) pairs, alliterative on purpose — see the module
#: docstring for why the noun is what has to stay memorable. Each animal
#: appears once, since a collision is resolved on the noun.
_PAIRS: tuple[tuple[str, str], ...] = (
    ("Brisk", "Badger"),
    ("Plucky", "Puffin"),
    ("Cheerful", "Chipmunk"),
    ("Bold", "Beaver"),
    ("Clever", "Cricket"),
    ("Daring", "Dolphin"),
    ("Eager", "Eagle"),
    ("Friendly", "Fox"),
    ("Gentle", "Gazelle"),
    ("Happy", "Hedgehog"),
    ("Jolly", "Jaguar"),
    ("Kind", "Koala"),
    ("Lively", "Lynx"),
    ("Merry", "Meerkat"),
    ("Nimble", "Newt"),
    ("Overjoyed", "Otter"),
    ("Peppy", "Penguin"),
    ("Quick", "Quail"),
    ("Radiant", "Raccoon"),
    ("Sunny", "Squirrel"),
    ("Tenacious", "Tiger"),
    ("Vivid", "Vulture"),
    ("Witty", "Walrus"),
    ("Zesty", "Zebra"),
    ("Amiable", "Antelope"),
    ("Breezy", "Bison"),
    ("Curious", "Cougar"),
    ("Dashing", "Deer"),
    ("Energetic", "Elk"),
    ("Feisty", "Ferret"),
    ("Giddy", "Giraffe"),
    ("Hearty", "Heron"),
    ("Inquisitive", "Ibis"),
    ("Jaunty", "Jackrabbit"),
    ("Keen", "Kangaroo"),
    ("Lucky", "Llama"),
    ("Mighty", "Mongoose"),
    ("Noble", "Narwhal"),
    ("Optimistic", "Ocelot"),
    ("Playful", "Panther"),
    ("Rambunctious", "Rabbit"),
    ("Spry", "Skunk"),
    ("Trusty", "Toucan"),
    ("Wily", "Wombat"),
)


def _seed_index(display_id: str) -> int:
    """A deterministic index into `_PAIRS`, stable across process restarts.

    `hash()` would not do — it is salted per process by design, and the whole
    point here is a name that survives one.
    """
    digest = hashlib.sha256(display_id.encode("utf-8")).digest()
    return int.from_bytes(digest[:8], byteorder="big") % len(_PAIRS)


def _animal_of(name: str) -> str:
    """The last word of a display name, lowercased for comparison.

    A hand-typed name like "Gym north" has no animal in it, which is fine: it
    simply never collides with a candidate, the same as any other name that
    is not one of these pairs.
    """
    parts = name.strip().split()
    return parts[-1].lower() if parts else ""


def whimsical_name(display_id: str, taken: Collection[str]) -> str:
    """An adjective-and-animal name, seeded from `display_id`.

    `taken` is the set of names already in use for the race this display
    belongs to. The candidate sequence starts at the id's seeded index and
    walks the pool in order, wrapping once, until it finds an animal nobody
    else is using; if the whole pool is taken it falls back to the seeded
    pair with a numbered suffix, which always terminates.
    """
    taken_animals = {_animal_of(name) for name in taken}
    start = _seed_index(display_id)

    for offset in range(len(_PAIRS)):
        adjective, animal = _PAIRS[(start + offset) % len(_PAIRS)]
        if animal.lower() not in taken_animals:
            return f"{adjective} {animal}"

    # The pool is exhausted (or "taken" is stranger than a real race would
    # produce, e.g. in a test) — fall back to the seeded pair with a rising
    # numeric suffix. This always terminates: each iteration checks one more
    # candidate name that grows a digit longer than the last.
    adjective, animal = _PAIRS[start]
    taken_lower = {name.strip().lower() for name in taken}
    n = 2
    while f"{adjective} {animal} {n}".lower() in taken_lower:
        n += 1
    return f"{adjective} {animal} {n}"
