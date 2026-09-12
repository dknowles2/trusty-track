"""Reachability check for #905: `updateInitialConfig` writes the organization
and each track independently, so a failure part-way leaves earlier writes
applied. [#904](https://github.com/dknowles2/trusty-track/pull/904) closed the
one diagnosed case — a lane shrink stranding a round — by checking every
track's shrink *before* anything is written. This file establishes whether
anything else can still get through, now that guard runs first.

Every numeric field a track carries (`laneCount`, `scaleRatio`) is checked
client-side before submission — `firstProblem` in `frontend/src/features/
settings/sections.ts` blocks a lane count outside 1..8 the same way the
server's own `schemas.TrackBase` does, and `SystemSettings.tsx` coerces a
non-positive `scaleRatio` to the default before it is ever sent — and every
lane colour comes from a native `<input type="color">`, which cannot produce
a value `is_valid_lane_color` would reject. Those paths are genuinely
client-prevented.

**Custom terminology is not.** `_apply_terminology` calls
`domain.terminology.reject_blank_word`, which refuses a *stripped-empty*
string — but the settings page's own six word inputs are plain
`<input required>` (`SystemSettings.tsx`), and HTML5's `required` only
refuses a value with zero length. A value of a single space passes it, and
nothing client-side (`sections.ts`'s `firstProblem` checks only the
organization name and each track, never the terminology words) catches it
before the mutation. That word check runs *after* `crud.update_organization`
has already committed a renamed organization or a flipped `debug_mode` — so
renaming the organization (or flipping the debug flag) in the same save as a
whitespace-only terminology word leaves the rename applied and the
terminology, theme, PIN, name-display and *every track* change in the same
submission silently discarded.

**A track's own Pydantic validators (`laneCount`, `scaleRatio`, a lane
colour) get the identical ahead-of-write treatment for the identical
reason** ([#1023](https://github.com/dknowles2/trusty-track/issues/1023)),
even though the ordinary settings page never reaches them (see above): a
hand-built request naming several tracks, where an early one is fine and a
later one carries a bad `laneCount`, must not leave the organization rename
or the earlier tracks committed while the later one is refused. Every
track's `TrackCreate`/`TrackBase` is now built — and so validated — in one
pass before the organization or any track is written, the same shape the
lane-shrink guard already uses.
"""

from backend.db import crud, models, schemas


def build(db):
    org = crud.create_organization(db, schemas.OrganizationCreate(name="Pack 905"))
    track = crud.create_track(db, schemas.TrackCreate(name="Track 905", lane_count=4))
    return org, track


def save_settings(client, **config_overrides):
    config = {
        "organizationName": "Pack 905",
        "tracks": [
            {
                "id": None,
                "name": "Track 905",
                "laneCount": 4,
                "timerType": "FAKE",
            }
        ],
    }
    config.update(config_overrides)
    resp = client.post(
        "/graphql",
        json={
            "query": """
            mutation Save($config: InitialConfigInput!) {
              updateInitialConfig(config: $config) {
                organizationName
                debugMode
                tracks { id name laneCount }
              }
            }
            """,
            "variables": {"config": config},
        },
    )
    assert resp.status_code == 200
    return resp.json()


def test_a_whitespace_only_terminology_word_leaves_the_rename_applied(
    client, db
) -> None:
    """The mechanical case: rename the organization and, in the same save,
    supply a terminology word that is whitespace only. `reject_blank_word`
    refuses it, but only after the rename already committed independently.

    This should fail today (the whole submission looks refused, but the
    rename silently survives it) and pass once `updateInitialConfig`
    validates before writing anything, the same way the lane-shrink guard
    does.
    """
    org, track = build(db)

    body = save_settings(
        client,
        organizationName="Pack 905 Renamed",
        organizationSingular="Troop",
        organizationPlural="Troops",
        racingGroupSingular=" ",  # whitespace only — passes HTML `required`
        racingGroupPlural="Dens",
        vehicleSingular="Car",
        vehiclePlural="Cars",
        tracks=[
            {
                "id": track.id,
                "name": "Track 905 Renamed",
                "laneCount": 3,
                "timerType": "FAKE",
            }
        ],
    )

    assert "errors" in body, "expected the blank word to be refused"

    db.expire_all()
    reloaded = db.query(models.Organization).filter_by(id=org.id).first()
    reloaded_track = db.query(models.Track).filter_by(id=track.id).first()

    # A refused save must refuse *everything* in it — the organization
    # rename must not survive a submission the server reported as failed,
    # any more than the track change (which never even ran) does.
    assert reloaded.name == "Pack 905", (
        "the organization rename was applied even though the save as a "
        "whole was refused"
    )
    assert reloaded_track.name == "Track 905"
    assert reloaded_track.lane_count == 4


def test_a_bad_lane_count_on_a_later_track_leaves_earlier_writes_untouched(
    client, db
) -> None:
    """#1023: two tracks, the first shrinking legitimately and the second
    carrying an out-of-range `laneCount`. Before the schema objects were all
    built ahead of any write, the rename and the first track's shrink would
    have committed before the second track's `TrackBase` construction ever
    raised.
    """
    org, track = build(db)
    second_track = crud.create_track(
        db, schemas.TrackCreate(name="Track 905 Second", lane_count=4)
    )

    body = save_settings(
        client,
        organizationName="Pack 905 Renamed",
        tracks=[
            {
                "id": track.id,
                "name": "Track 905",
                "laneCount": 3,
                "timerType": "FAKE",
            },
            {
                "id": second_track.id,
                "name": "Track 905 Second",
                "laneCount": 0,
                "timerType": "FAKE",
            },
        ],
    )

    assert "errors" in body, "expected the bad lane count to be refused"
    # The sentence the validator wrote, not Pydantic's own wrapper — see
    # `test_tracks.py::TestLaneCountBounds` for the direct check of this.
    assert "lane count must be between 1 and 8" in str(body["errors"]).lower()

    db.expire_all()
    reloaded_org = db.query(models.Organization).filter_by(id=org.id).first()
    reloaded_first = db.query(models.Track).filter_by(id=track.id).first()
    reloaded_second = db.query(models.Track).filter_by(id=second_track.id).first()

    assert reloaded_org.name == "Pack 905"
    assert reloaded_first.lane_count == 4
    assert reloaded_second.lane_count == 4
