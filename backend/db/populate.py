import os
import shutil
import sys
import uuid
from pathlib import Path

from sqlalchemy.orm import Session

from backend import demo_seed

from . import crud, models, schemas
from .database import DATA_DIR

FIRST_NAMES = [
    "Ace",
    "Blaze",
    "Crash",
    "Dash",
    "Earl",
    "Flynn",
    "Gus",
    "Hawk",
    "Iggy",
    "Jax",
    "Kit",
    "Leo",
    "Max",
    "Neo",
    "Ozzie",
    "Pip",
    "Quinn",
    "Rex",
    "Sky",
    "Tex",
    "Uma",
    "Vince",
    "Wes",
    "Xander",
    "Yuri",
    "Zack",
    "Aria",
    "Bella",
    "Coco",
    "Dot",
]

LAST_NAMES = [
    "Speedman",
    "Wheeler",
    "Driver",
    "Racer",
    "Walker",
    "Flyer",
    "Pilot",
    "Dash",
    "Quick",
    "Zoom",
    "Turbo",
    "Nitro",
    "Spark",
    "Bolt",
    "Thunder",
    "Storm",
    "Power",
    "Engine",
    "Gear",
    "Shift",
    "Clutch",
    "Brake",
    "Tire",
    "Rim",
    "Axle",
]

RACING_GROUPS = [
    {"name": "Lion", "color": "#F4D03F", "rank": models.Rank.LION},
    {"name": "Tiger", "color": "#E67E22", "rank": models.Rank.TIGER},
    {"name": "Wolf", "color": "#AAB7B8", "rank": models.Rank.WOLF},
    {"name": "Bear", "color": "#85C1E9", "rank": models.Rank.BEAR},
    {"name": "Webelos", "color": "#2E86C1", "rank": models.Rank.WEBELOS},
    {"name": "Arrow of Light", "color": "#CB4335", "rank": models.Rank.ARROW_OF_LIGHT},
]


def ensure_racing_groups(db: Session, race_id: int):
    existing_racing_groups = crud.get_racing_groups(db, race_id=race_id)
    if not existing_racing_groups:
        created_racing_groups = []
        for racing_group_data in RACING_GROUPS:
            # Explicitly cast rank to help mypy if needed, or rely on runtime type.
            # RACING_GROUPS has Rank enum members now.
            racing_group_in = schemas.RacingGroupCreate(
                name=str(racing_group_data["name"]),
                color=str(racing_group_data["color"]),
                rank=racing_group_data["rank"],  # type: ignore
            )
            created_racing_groups.append(
                crud.create_racing_group(db, racing_group_in, race_id=race_id)
            )
        return created_racing_groups
    return existing_racing_groups


def get_unique_name(existing_names, source=None):
    source = source or demo_seed.generator("names")
    for _ in range(100):  # Try 100 times to get a unique name
        first = source.choice(FIRST_NAMES)
        last = source.choice(LAST_NAMES)
        full_name = f"{first} {last}"
        if full_name not in existing_names:
            existing_names.add(full_name)
            return first, last
    # Fallback if we accidentally exhaust combinations (unlikely)
    return f"Racer{source.randint(1000, 9999)}", "Doe"


def generate_fake_racers(
    db: Session,
    race_id: int,
    count: int = 20,
    add_racer_photos: bool = True,
    add_car_photos: bool = True,
    assign_racing_groups: bool = True,
    check_in: bool = False,
):
    # Ensure assets exist
    if getattr(sys, "frozen", False):
        # In a PyInstaller bundle, the root is sys._MEIPASS
        # Based on trustytrack.spec, backend/assets is placed at
        # sys._MEIPASS/backend/assets
        backend_dir = Path(sys._MEIPASS) / "backend"  # type: ignore[attr-defined]
    else:
        # Development mode: Path(__file__) is backend/db/populate.py
        backend_dir = Path(__file__).parent.parent

    assets_base = str(backend_dir / "assets" / "defaults")
    uploads_dir = os.path.join(DATA_DIR, "uploads")

    # Everything invented below comes from here. Keyed on the race's *name*
    # rather than its id, which depends on how many races were created before
    # it — see `backend.demo_seed`. Unseeded in every real install, where this
    # is the ordinary global generator.
    race = db.query(models.Race).filter(models.Race.id == race_id).first()
    source = demo_seed.generator(f"roster:{race.name if race else race_id}")

    # Sorted, because `os.listdir` promises no order and the photographs are
    # dealt out in the order they arrive.
    racer_assets = []
    if add_racer_photos and os.path.exists(f"{assets_base}/racers"):
        racer_assets = sorted(
            f for f in os.listdir(f"{assets_base}/racers") if f.endswith(".png")
        )

    car_assets = []
    if add_car_photos and os.path.exists(f"{assets_base}/cars"):
        car_assets = sorted(
            f for f in os.listdir(f"{assets_base}/cars") if f.endswith(".png")
        )

    # Get existing names to enforce uniqueness
    existing_racers = crud.get_racers(db, race_id=race_id)
    existing_names = {f"{r.first_name} {r.last_name}" for r in existing_racers}

    # Ensure RacingGroups exist and get them
    racing_groups = []
    if assign_racing_groups:
        racing_groups = ensure_racing_groups(db, race_id)
        if not racing_groups:
            return {"error": "Could not create racing groups"}

    # Shuffle assets for variety in this batch
    if add_racer_photos:
        source.shuffle(racer_assets)
    if add_car_photos:
        source.shuffle(car_assets)

    racer_asset_idx = 0
    car_asset_idx = 0

    for _ in range(count):
        # Pick unique names
        first, last = get_unique_name(existing_names, source)

        racing_group_id = None
        if assign_racing_groups and racing_groups:
            racing_group = source.choice(racing_groups)
            racing_group_id = racing_group.id

        # Handle Racer Images (Cycling)
        racer_img_url = None
        if add_racer_photos and racer_assets:
            src_name = racer_assets[racer_asset_idx % len(racer_assets)]
            racer_asset_idx += 1

            src_path = f"{assets_base}/racers/{src_name}"
            ext = os.path.splitext(src_name)[1]
            new_filename = f"{uuid.uuid4()}{ext}"
            dst_path = f"{uploads_dir}/{new_filename}"
            shutil.copy(src_path, dst_path)
            racer_img_url = f"/static/{new_filename}"

        # Handle Car Images (Cycling)
        car_img_url = None
        if add_car_photos and car_assets:
            src_name = car_assets[car_asset_idx % len(car_assets)]
            car_asset_idx += 1

            src_path = f"{assets_base}/cars/{src_name}"
            ext = os.path.splitext(src_name)[1]
            new_filename = f"{uuid.uuid4()}{ext}"
            dst_path = f"{uploads_dir}/{new_filename}"
            shutil.copy(src_path, dst_path)
            car_img_url = f"/static/{new_filename}"

        # Create Racer
        racer_in = schemas.RacerCreate(
            first_name=first,
            last_name=last,
            racing_group_id=racing_group_id,
            # Will be assigned by auto-numbering based on race strategy
            car_number=None,
            car_passed_inspection=check_in,
            racer_image_url=racer_img_url,
            car_image_url=car_img_url,
            race_id=race_id,
        )

        crud.create_racer(db, racer_in)

    # Apply auto-numbering based on race's car_numbering_strategy
    crud.auto_number_racers(db, race_id)

    return {"message": f"Successfully created {count} fake racers"}
