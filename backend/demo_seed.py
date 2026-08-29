"""Making the app's invented data repeatable, when something needs it to be.

Two features make things up: the fake timer invents a time per lane, and
``populateRace`` invents a roster of racers, photographs and racing groups. Both are
meant to be random — that is what makes a rehearsal feel like an event rather
than a fixture.

The documentation screenshots are the exception. They race on the fake timer
against a populated roster, so with fresh randomness every image differed on
every run: a change to one page rewrote roughly fifty binary files, and two
branches touching the documentation conflicted on all fifty. None of that
churn shows up as anything in a diff, so it read as noise rather than as a
problem with a cause.

Setting ``TRUSTYTRACK_DEMO_SEED`` makes both repeat. It is deliberately opt-in
and off everywhere but the screenshot run: left on in ordinary use, re-running
the same heat would report the identical time to three decimal places, and a
practice race would introduce the operator to the same thirty children every
evening — which reads as the app being broken rather than as the data being
invented.

Keyed, not sequential
---------------------

``generator`` is keyed rather than handed out from one running sequence. A
single module-level generator would deal its numbers in whatever order the
heats and races happened to be created, so a spec regenerated on its own would
get different values from the same spec regenerated alongside the others — and
the screenshots would churn again, for a reason invisible in the diff. Keying
each draw on the thing it is for makes an answer independent of what came
before it.

Ordered inputs
--------------

A seeded shuffle is only as repeatable as the order of what it shuffles. A
query without ``ORDER BY`` promises no order at all — SQLite usually returns
rowid order, until a plan change or a page reorganisation quietly does not —
so every query whose rows feed a draw from this module carries an explicit
``order_by``, and a set is ``sorted`` before it becomes a participant list.
The failure this prevents is the worst kind: same seed, same key, different
answer, on somebody else's machine.
"""

import os
import random
from types import ModuleType

#: The environment variable. Any value will do; only its constancy matters.
SEED_VARIABLE = "TRUSTYTRACK_DEMO_SEED"

#: A seeded `random.Random`, or the `random` module itself. They share the
#: interface every caller here uses — `random`'s module-level functions are
#: the methods of a hidden global instance.
Generator = random.Random | ModuleType


def rng(key: str) -> random.Random | None:
    """A seeded generator for ``key``, or ``None`` when nothing asked for one.

    For callers that already take an injectable ``random.Random`` and build
    their own when handed nothing — `domain.scheduling.generate_ppc` is the
    one that matters, since the schedule decides who is in which lane and so
    every screenshot downstream of it.
    """
    seed = os.environ.get(SEED_VARIABLE)
    return random.Random(f"{seed}:{key}") if seed else None


def generator(key: str) -> Generator:
    """A source of randomness for ``key``.

    Seeded and therefore repeatable when ``TRUSTYTRACK_DEMO_SEED`` is set;
    the ordinary global generator when it is not, which is every real install.

    ``key`` should name the thing being invented — a heat, or a race's roster —
    specifically enough that two of them do not come out identical, and stably
    enough that the same thing gets the same answer on a later run. A database
    id is usually the wrong choice: it depends on how much else was created
    first.
    """
    return rng(key) or random
