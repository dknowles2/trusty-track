import argparse
import sys

from PIL import Image

from .image_processing import convert_to_favicon, crop_to_content


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Crop an image and convert it to a favicon."
    )
    parser.add_argument("input", help="Path to the input image")
    parser.add_argument("output", help="Path to the output favicon (.ico)")
    parser.add_argument(
        "--padding",
        type=int,
        default=10,
        help="Padding around the subject (default: 10)",
    )
    parser.add_argument(
        "--no-crop", action="store_true", help="Skip cropping to content"
    )

    args = parser.parse_args()

    try:
        img: Image.Image = Image.open(args.input)

        if not args.no_crop:
            print(f"Cropping {args.input} with padding {args.padding}...")
            img = crop_to_content(img, padding=args.padding)

        if args.output.lower().endswith(".ico"):
            print(f"Converting to favicon: {args.output}...")
            convert_to_favicon(img, args.output)
        else:
            print(f"Saving cropped image to: {args.output}...")
            img.save(args.output)
        print("Done!")

    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
