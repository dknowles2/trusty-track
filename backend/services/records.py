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
    """One racer's best time on a track, across every race run on it."""

    time_seconds: float
    racer_name: str
    car_number: int | None
    race_id: int
    race_name: str
    race_date: str | None


def track_records(db: Session, track_id: int, limit: int = 5) -> list[TrackRecordEntry]:
    """The fastest cars ever recorded on a track, best first.

    One entry per racer — a car's record is its single best run, not its
    three best, or the list would be one good car repeated. Only official
    heats count: a free race heat is an exhibition run (#6). A time of zero
    or less is a DNF marker rather than a result, and a lane whose racer has
    been deleted has no holder, so neither can set a record.
    """
    rows = (
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
        .order_by(models.HeatLane.time_seconds, models.Racer.id)
        .all()
    )

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
    return list(best.values())
