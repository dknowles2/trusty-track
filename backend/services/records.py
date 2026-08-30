"""Track records: the fastest cars a track has ever seen.

Races carry the track they ran on, so a track accumulates results across
events — and the best of them is a record worth announcing.

A record is computed on every read rather than stored, for the same reason
the standings are (#17): a corrected time must move the record, and a stored
copy would be the first thing in the app able to disagree with the heats it
came from. The price is that a record lives exactly as long as the race that
set it — deleting the race deletes the record, the same way it deletes the
results themselves.
"""

from dataclasses import dataclass

from sqlalchemy.orm import Session

from backend.db import models


@dataclass(frozen=True)
class TrackRecordEntry:
    """One racer's best time on a track, across every race run on it.

    ``race_id`` is None for a historical record — one entered by hand from
    before Trusty Track was keeping them, with no race in this database
    behind it. ``race_name`` and ``race_date`` are then the labels the
    operator typed, and may be absent.
    """

    time_seconds: float
    racer_name: str
    car_number: int | None
    race_id: int | None
    race_name: str | None
    race_date: str | None


def track_records(
    db: Session,
    track_id: int,
    limit: int = 5,
    exclude_race_id: int | None = None,
) -> list[TrackRecordEntry]:
    """The fastest cars ever recorded on a track, best first.

    One entry per racer — a car's record is its single best run, not its
    three best, or the list would be one good car repeated. Only official
    heats count: a free race heat is an exhibition run (#6). A time of zero
    or less is a DNF marker rather than a result, and a lane whose racer has
    been deleted has no holder, so neither can set a record.

    Deliberately does **not** read ``Racer.excluded_from_standings`` (#548).
    A record is a fact about the *track* — the fastest car it has ever
    seen — not about who was eligible for a trophy that day, and a sibling
    or parent car's time belongs on the board exactly like any other. Don't
    "fix" this by filtering it in; that is the one thing #548 asked to stay
    unfiltered.

    Historical records — entered by hand for events from before Trusty
    Track (`models.HistoricalTrackRecord`) — compete in the same list, as
    typed: a 2019 record standing at 2.89 seconds is beaten by a computed
    2.88, and not before.

    ``exclude_race_id`` leaves one race's results out — the record *as it
    stood before today*, which is what the audience celebration compares
    against. Without the exclusion, a pack's first event would "set the
    record" on heat one and re-break it all morning.
    """
    query = (
        models.official_heats(
            db.query(
                models.HeatLane.time_seconds,
                models.Racer.id,
                models.Racer.first_name,
                models.Racer.last_name,
                models.Racer.car_number,
                models.Race.id,
                models.Race.name,
                models.Race.date_time,
            )
            .join(models.Heat, models.HeatLane.heat_id == models.Heat.id)
            .join(models.Race, models.Heat.race_id == models.Race.id)
            .join(models.Racer, models.HeatLane.racer_id == models.Racer.id)
        )
        .filter(models.Race.track_id == track_id)
        .filter(models.HeatLane.time_seconds > 0)
    )
    if exclude_race_id is not None:
        query = query.filter(models.Race.id != exclude_race_id)
    rows = query.order_by(models.HeatLane.time_seconds, models.Racer.id).all()

    best: dict[int, TrackRecordEntry] = {}
    for time, racer_id, first, last, car, race_id, race_name, race_date in rows:
        if racer_id in best:
            continue
        best[racer_id] = TrackRecordEntry(
            time_seconds=time,
            racer_name=f"{first} {last}".strip(),
            car_number=car,
            race_id=race_id,
            race_name=race_name,
            race_date=race_date,
        )
        # Rows arrive fastest-first, so the first row naming a racer is that
        # racer's best, and once the list is full every racer still to appear
        # is slower than everyone already in it.
        if len(best) == limit:
            break

    historical = [
        TrackRecordEntry(
            time_seconds=row.time_seconds,
            racer_name=row.racer_name,
            car_number=row.car_number,
            race_id=None,
            race_name=row.race_name,
            race_date=row.race_date,
        )
        for row in (
            db.query(models.HistoricalTrackRecord)
            .filter(models.HistoricalTrackRecord.track_id == track_id)
            .order_by(
                models.HistoricalTrackRecord.time_seconds,
                models.HistoricalTrackRecord.id,
            )
            .all()
        )
    ]

    merged = sorted([*best.values(), *historical], key=lambda entry: entry.time_seconds)
    return merged[:limit]


def broken_record(
    times: list[float], baseline: TrackRecordEntry | None
) -> float | None:
    """The heat's winning time, if it strictly beats the standing record.

    ``baseline`` is the record as it stood *before* the race being run —
    ``track_records(..., limit=1, exclude_race_id=...)`` — so a first event
    with no history celebrates nothing, which is honest. Zero-or-less times
    are DNF markers and cannot break anything, and equalling the record is
    not breaking it: a tie on the board is a story, not a headline.
    """
    positive = [t for t in times if t > 0]
    if baseline is None or not positive:
        return None
    fastest = min(positive)
    return fastest if fastest < baseline.time_seconds else None
