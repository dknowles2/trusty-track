import random
import os
import shutil
import uuid
from sqlalchemy.orm import Session
from . import crud, models, schemas

FIRST_NAMES = [
    "Ace", "Blaze", "Crash", "Dash", "Earl", "Flynn", "Gus", "Hawk", "Iggy", "Jax",
    "Kit", "Leo", "Max", "Neo", "Ozzie", "Pip", "Quinn", "Rex", "Sky", "Tex",
    "Uma", "Vince", "Wes", "Xander", "Yuri", "Zack", "Aria", "Bella", "Coco", "Dot"
]

LAST_NAMES = [
    "Speedman", "Wheeler", "Driver", "Racer", "Walker", "Flyer", "Pilot", "Dash", 
    "Quick", "Zoom", "Turbo", "Nitro", "Spark", "Bolt", "Thunder", "Storm", 
    "Power", "Engine", "Gear", "Shift", "Clutch", "Brake", "Tire", "Rim", "Axle"
]

RANKS = ["LION", "TIGER", "WOLF", "BEAR", "WEBELOS", "ARROW_OF_LIGHT"]

def generate_fake_racers(db: Session, race_id: int, count: int = 20):
    # Ensure assets exist
    assets_base = "backend/assets/defaults"
    uploads_dir = "backend/uploads"
    
    racer_assets = []
    if os.path.exists(f"{assets_base}/racers"):
        racer_assets = [f for f in os.listdir(f"{assets_base}/racers") if f.endswith(".png")]
        
    car_assets = []
    if os.path.exists(f"{assets_base}/cars"):
        car_assets = [f for f in os.listdir(f"{assets_base}/cars") if f.endswith(".png")]

    for _ in range(count):
        # Pick names
        first = random.choice(FIRST_NAMES)
        last = random.choice(LAST_NAMES)
        rank = random.choice(RANKS)
        
        # Handle Images
        racer_img_url = None
        if racer_assets:
            src_name = random.choice(racer_assets)
            src_path = f"{assets_base}/racers/{src_name}"
            # Copy to uploads with unique name
            ext = os.path.splitext(src_name)[1]
            new_filename = f"{uuid.uuid4()}{ext}"
            dst_path = f"{uploads_dir}/{new_filename}"
            shutil.copy(src_path, dst_path)
            racer_img_url = f"http://127.0.0.1:8000/static/{new_filename}"
            
        car_img_url = None
        if car_assets:
            src_name = random.choice(car_assets)
            src_path = f"{assets_base}/cars/{src_name}"
            # Copy to uploads with unique name
            ext = os.path.splitext(src_name)[1]
            new_filename = f"{uuid.uuid4()}{ext}"
            dst_path = f"{uploads_dir}/{new_filename}"
            shutil.copy(src_path, dst_path)
            car_img_url = f"http://127.0.0.1:8000/static/{new_filename}"
            
        # Create Racer
        racer_in = schemas.RacerCreate(
            first_name=first,
            last_name=last,
            rank=rank,
            car_number=random.randint(100, 999), 
            car_passed_inspection=True,
            racer_image_url=racer_img_url,
            car_image_url=car_img_url,
            race_id=race_id
        )
        
        crud.create_racer(db, racer_in)

    return {"message": f"Successfully created {count} fake racers"}
