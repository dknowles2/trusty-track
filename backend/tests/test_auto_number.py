"""Tests for auto-assigning car numbers when adding racers (#789).

When a race uses GLOBAL or PER_GROUP numbering strategy, adding a racer
without specifying a car number should automatically pick the next free
number. When MANUAL is configured, car numbers remain None.
"""

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend.db import crud, models, schemas


def _create_test_race(
    db: Session,
    strategy: models.CarNumberingStrategy,
    global_start_number: int = 1,
) -> models.Race:
    """Create a race with the specified numbering strategy for testing."""
    org = crud.create_organization(db, schemas.OrganizationCreate(name="Pack 789"))
    track = crud.create_track(db, schemas.TrackCreate(name="Test Track", lane_count=4))
    return crud.create_race(
        db,
        schemas.RaceCreate(
            name=f"Race {strategy.value}",
            organization_id=org.id,
            track_id=track.id,
            car_numbering_strategy=strategy,
            global_start_number=global_start_number,
        ),
    )


def test_create_racer_global_strategy_picks_next_free_number(db: Session) -> None:
    """A racer added without a car number gets the next free global number."""
    race = _create_test_race(
        db,
        strategy=models.CarNumberingStrategy.GLOBAL,
        global_start_number=10,
    )

    racer1 = crud.create_racer(
        db,
        schemas.RacerCreate(
            first_name="Alice",
            last_name="Archer",
            race_id=race.id,
            car_number=None,
        ),
    )
    assert racer1 is not None
    assert racer1.car_number == 10

    racer2 = crud.create_racer(
        db,
        schemas.RacerCreate(
            first_name="Bob",
            last_name="Baker",
            race_id=race.id,
            car_number=None,
        ),
    )
    assert racer2 is not None
    assert racer2.car_number == 11


def test_create_racer_global_strategy_skips_taken_numbers(db: Session) -> None:
    """Auto-numbering skips car numbers already assigned in the race."""
    race = _create_test_race(
        db,
        strategy=models.CarNumberingStrategy.GLOBAL,
        global_start_number=1,
    )

    # Pre-existing racer with explicit car number 1
    crud.create_racer(
        db,
        schemas.RacerCreate(
            first_name="Charlie",
            last_name="Clark",
            race_id=race.id,
            car_number=1,
        ),
    )

    # Pre-existing racer with explicit car number 2
    crud.create_racer(
        db,
        schemas.RacerCreate(
            first_name="David",
            last_name="Davis",
            race_id=race.id,
            car_number=2,
        ),
    )

    # Adding a racer without car number should get 3
    racer3 = crud.create_racer(
        db,
        schemas.RacerCreate(
            first_name="Eve",
            last_name="Evans",
            race_id=race.id,
            car_number=None,
        ),
    )
    assert racer3 is not None
    assert racer3.car_number == 3


def test_create_racer_global_strategy_preserves_explicit_number(db: Session) -> None:
    """An explicitly supplied car number is preserved under GLOBAL strategy."""
    race = _create_test_race(
        db,
        strategy=models.CarNumberingStrategy.GLOBAL,
        global_start_number=1,
    )

    racer = crud.create_racer(
        db,
        schemas.RacerCreate(
            first_name="Frank",
            last_name="Fisher",
            race_id=race.id,
            car_number=99,
        ),
    )
    assert racer is not None
    assert racer.car_number == 99


def test_create_racer_per_group_strategy_picks_next_free_in_range(
    db: Session,
) -> None:
    """A racer added to a group gets the next free car number in that group's range."""
    race = _create_test_race(
        db,
        strategy=models.CarNumberingStrategy.PER_GROUP,
    )

    group1 = crud.create_racing_group(
        db,
        schemas.RacingGroupCreate(
            name="Tigers",
            color="#FFA500",
            car_number_range_start=100,
            car_number_range_end=199,
        ),
        race_id=race.id,
    )
    group2 = crud.create_racing_group(
        db,
        schemas.RacingGroupCreate(
            name="Wolves",
            color="#808080",
            car_number_range_start=200,
            car_number_range_end=299,
        ),
        race_id=race.id,
    )

    racer_g1_a = crud.create_racer(
        db,
        schemas.RacerCreate(
            first_name="Grace",
            last_name="Green",
            race_id=race.id,
            racing_group_id=group1.id,
            car_number=None,
        ),
    )
    assert racer_g1_a is not None
    assert racer_g1_a.car_number == 100

    racer_g1_b = crud.create_racer(
        db,
        schemas.RacerCreate(
            first_name="Henry",
            last_name="Hill",
            race_id=race.id,
            racing_group_id=group1.id,
            car_number=None,
        ),
    )
    assert racer_g1_b is not None
    assert racer_g1_b.car_number == 101

    racer_g2_a = crud.create_racer(
        db,
        schemas.RacerCreate(
            first_name="Ivy",
            last_name="Irwin",
            race_id=race.id,
            racing_group_id=group2.id,
            car_number=None,
        ),
    )
    assert racer_g2_a is not None
    assert racer_g2_a.car_number == 200


def test_create_racer_per_group_skips_taken_numbers(db: Session) -> None:
    """PER_GROUP auto-numbering skips car numbers already assigned."""
    race = _create_test_race(
        db,
        strategy=models.CarNumberingStrategy.PER_GROUP,
    )

    group = crud.create_racing_group(
        db,
        schemas.RacingGroupCreate(
            name="Bears",
            color="#8B4513",
            car_number_range_start=300,
            car_number_range_end=399,
        ),
        race_id=race.id,
    )

    # Pre-assign 300 explicitly
    crud.create_racer(
        db,
        schemas.RacerCreate(
            first_name="Jack",
            last_name="Jones",
            race_id=race.id,
            racing_group_id=group.id,
            car_number=300,
        ),
    )

    # Next racer without car number should receive 301
    racer = crud.create_racer(
        db,
        schemas.RacerCreate(
            first_name="Kate",
            last_name="King",
            race_id=race.id,
            racing_group_id=group.id,
            car_number=None,
        ),
    )
    assert racer is not None
    assert racer.car_number == 301


def test_create_racer_per_group_no_group_or_range_leaves_none(
    db: Session,
) -> None:
    """When a racer has no group or group has no range, car_number remains None."""
    race = _create_test_race(
        db,
        strategy=models.CarNumberingStrategy.PER_GROUP,
    )

    # Racer with no group
    racer_no_group = crud.create_racer(
        db,
        schemas.RacerCreate(
            first_name="Leo",
            last_name="Long",
            race_id=race.id,
            car_number=None,
        ),
    )
    assert racer_no_group is not None
    assert racer_no_group.car_number is None

    # Group without car_number_range_start
    group_no_range = crud.create_racing_group(
        db,
        schemas.RacingGroupCreate(
            name="Webelos",
            color="#0000FF",
        ),
        race_id=race.id,
    )
    racer_group_no_range = crud.create_racer(
        db,
        schemas.RacerCreate(
            first_name="Mia",
            last_name="Moore",
            race_id=race.id,
            racing_group_id=group_no_range.id,
            car_number=None,
        ),
    )
    assert racer_group_no_range is not None
    assert racer_group_no_range.car_number is None


def test_create_racer_per_group_exhausted_range_leaves_none(db: Session) -> None:
    """When the group range has no free numbers remaining, car_number is None."""
    race = _create_test_race(
        db,
        strategy=models.CarNumberingStrategy.PER_GROUP,
    )

    group = crud.create_racing_group(
        db,
        schemas.RacingGroupCreate(
            name="Arrows",
            color="#FF0000",
            car_number_range_start=500,
            car_number_range_end=501,
        ),
        race_id=race.id,
    )

    crud.create_racer(
        db,
        schemas.RacerCreate(
            first_name="Noah",
            last_name="Nelson",
            race_id=race.id,
            racing_group_id=group.id,
            car_number=500,
        ),
    )
    crud.create_racer(
        db,
        schemas.RacerCreate(
            first_name="Olivia",
            last_name="Owens",
            race_id=race.id,
            racing_group_id=group.id,
            car_number=501,
        ),
    )

    # Range 500-501 is exhausted
    overflow_racer = crud.create_racer(
        db,
        schemas.RacerCreate(
            first_name="Peter",
            last_name="Parker",
            race_id=race.id,
            racing_group_id=group.id,
            car_number=None,
        ),
    )
    assert overflow_racer is not None
    assert overflow_racer.car_number is None


def test_create_racer_manual_strategy_leaves_none(db: Session) -> None:
    """MANUAL strategy leaves car_number as None when not supplied."""
    race = _create_test_race(
        db,
        strategy=models.CarNumberingStrategy.MANUAL,
    )

    racer = crud.create_racer(
        db,
        schemas.RacerCreate(
            first_name="Quinn",
            last_name="Quick",
            race_id=race.id,
            car_number=None,
        ),
    )
    assert racer is not None
    assert racer.car_number is None

    # Explicit number still kept
    racer_explicit = crud.create_racer(
        db,
        schemas.RacerCreate(
            first_name="Rachel",
            last_name="Reed",
            race_id=race.id,
            car_number=42,
        ),
    )
    assert racer_explicit is not None
    assert racer_explicit.car_number == 42


def test_create_racer_graphql_mutation_auto_assigns_number(
    client: TestClient, db: Session
) -> None:
    """GraphQL createRacer mutation auto-assigns car number under GLOBAL strategy."""
    race = _create_test_race(
        db,
        strategy=models.CarNumberingStrategy.GLOBAL,
        global_start_number=50,
    )
    mutation = f"""
    mutation {{
        createRacer(racer: {{
            firstName: "Sam",
            lastName: "Stone",
            raceId: {race.id}
        }}) {{
            id
            firstName
            lastName
            carNumber
        }}
    }}
    """
    response = client.post("/graphql", json={"query": mutation})
    assert response.status_code == 200
    data = response.json()
    assert "errors" not in data, data.get("errors")
    racer_data = data["data"]["createRacer"]
    assert racer_data["firstName"] == "Sam"
    assert racer_data["carNumber"] == 50
