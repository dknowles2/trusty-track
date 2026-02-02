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

def get_unique_name(existing_names):
    for _ in range(100): # Try 100 times to get a unique name
        first = random.choice(FIRST_NAMES)
        last = random.choice(LAST_NAMES)
        full_name = f"{first} {last}"
        if full_name not in existing_names:
            existing_names.add(full_name)
            return first, last
    # Fallback if we accidentally exhaust combinations (unlikely)
    return f"Racer{random.randint(1000,9999)}", "Doe"

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

    # Get existing names to enforce uniqueness
    existing_racers = crud.get_racers(db, race_id=race_id)
    existing_names = set(f"{r.first_name} {r.last_name}" for r in existing_racers)
    
    # Shuffle assets for variety in this batch
    random.shuffle(racer_assets)
    random.shuffle(car_assets)
    
    racer_asset_idx = 0
    car_asset_idx = 0

    for _ in range(count):
        # Pick unique names
        first, last = get_unique_name(existing_names)
        rank = random.choice(RANKS)
        
        # Handle Racer Images (Cycling)
        racer_img_url = None
        if racer_assets:
            src_name = racer_assets[racer_asset_idx % len(racer_assets)]
            racer_asset_idx += 1
            
            src_path = f"{assets_base}/racers/{src_name}"
            ext = os.path.splitext(src_name)[1]
            new_filename = f"{uuid.uuid4()}{ext}"
            dst_path = f"{uploads_dir}/{new_filename}"
            shutil.copy(src_path, dst_path)
            racer_img_url = f"http://127.0.0.1:8000/static/{new_filename}"
            
        # Handle Car Images (Cycling)
        car_img_url = None
        if car_assets:
            src_name = car_assets[car_asset_idx % len(car_assets)]
            car_asset_idx += 1
            
            src_path = f"{assets_base}/cars/{src_name}"
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
