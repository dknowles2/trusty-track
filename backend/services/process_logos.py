import os

from PIL import Image

from .image_processing import remove_green_screen


def main() -> None:
    # Paths relative to project root
    # __file__ is backend/services/process_logos.py
    abs_path = os.path.abspath(__file__)
    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(abs_path)))
    assets_dir = os.path.join(base_dir, "frontend", "src", "assets")

    logos = ["logo_chromakey.png", "logo_full_chromakey.png"]

    for logo_name in logos:
        input_path = os.path.join(assets_dir, logo_name)
        if not os.path.exists(input_path):
            print(f"Warning: {input_path} not found.")
            continue

        print(f"Processing {logo_name}...")
        with Image.open(input_path) as img:
            # Using default green screen removal settings
            transparent_img = remove_green_screen(img)

            # Save with _transparent suffix
            output_name = logo_name.replace(".png", "_transparent.png")
            output_path = os.path.join(assets_dir, output_name)
            transparent_img.save(output_path, "PNG")
            print(f"Saved to {output_path}")


if __name__ == "__main__":
    main()
