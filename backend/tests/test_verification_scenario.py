import uuid

from backend.db import crud, schemas


def get_unique_name(prefix: str) -> str:
    return f"{prefix} {uuid.uuid4()}"


def test_verification_scenario(db):
    """
    Replicates setup_verification.py logic in a test.
    1. Initialize config
    2. Create two races
    """
    # 1. Initialize system
    if not crud.get_tracks(db):
        config = schemas.InitialConfigCreate(
            group_name="Scouts Test Verification",
            tracks=[
                schemas.TrackCreate(name="Main Track", lane_count=4, timer_type="FAKE")
            ],
        )
        crud.create_initial_config(db, config)

    tracks = crud.get_tracks(db)
    track_id = tracks[0].id

    # Ensure we can get a group ID
    group_name = get_unique_name("Verification Group")
    group = crud.create_group(db, schemas.GroupCreate(name=group_name))
    group_id = group.id

    # 2. Create Race A
    race_a_name = get_unique_name("Race A")
    race_a = crud.create_race(
        db,
        schemas.RaceCreate(
            name=race_a_name,
            group_id=group_id,
            track_id=track_id,
            date_time="2023-10-27T10:00",
            location="Test Location A",
        ),
    )
    assert race_a.id is not None
    print(f"Created Race A: {race_a.id}")

    # 3. Create Race B
    race_b_name = get_unique_name("Race B")
    race_b = crud.create_race(
        db,
        schemas.RaceCreate(
            name=race_b_name,
            group_id=group_id,
            track_id=track_id,
            date_time="2023-10-28T10:00",
            location="Test Location B",
        ),
    )
    assert race_b.id is not None
    print(f"Created Race B: {race_b.id}")

    assert race_a.id != race_b.id
