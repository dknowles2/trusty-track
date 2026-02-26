import sys
from PIL import Image

def cleanup_chromakey(input_path: str, output_path: str):
    """
    Cleans up an image for chromakey extraction.
    Forces greenish background to exactly #00FF00 and whitish border to #FFFFFF.
    """
    img = Image.open(input_path).convert("RGB")
    pixels = img.load()
    width, height = img.size

    # Target colors
    PURE_GREEN = (0, 255, 0)
    PURE_WHITE = (255, 255, 255)

    for y in range(height):
        for x in range(width):
            r, g, b = pixels[x, y]
            
            # Identify green-ish (background)
            # We look for high green and low red/blue
            # The prompt requested #00FF00, so any pixel where G is dominant and R/B are low
            if g > 150 and r < 100 and b < 100:
                pixels[x, y] = PURE_GREEN
                continue
            
            # Identify white-ish (outline)
            # Any pixel where all components are very high
            if r > 200 and g > 200 and b > 200:
                pixels[x, y] = PURE_WHITE
                continue

    img.save(output_path, "PNG")
    print(f"Refined image saved to {output_path}")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python3 cleanup_chromakey.py <input> <output>")
        sys.exit(1)
    cleanup_chromakey(sys.argv[1], sys.argv[2])
