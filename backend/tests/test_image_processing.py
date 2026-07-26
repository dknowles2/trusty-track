import os
from typing import Any

import numpy as np
from PIL import Image

from backend.services.image_processing import (
    convert_to_favicon,
    crop_to_content,
    remove_green_screen,
)


def test_remove_green_screen_pure_green() -> None:
    # Create a pure green image
    green_rgb = (0, 255, 0)
    image = Image.new("RGB", (100, 100), color=green_rgb)

    # Process image
    result = remove_green_screen(image)

    # Check if result is fully transparent
    alpha = np.array(result.split()[-1])
    assert np.all(alpha == 0), "Pure green image should be fully transparent"


def test_remove_green_screen_no_green() -> None:
    # Create a pure red image
    red_rgb = (255, 0, 0)
    image = Image.new("RGB", (100, 100), color=red_rgb)

    # Process image
    result = remove_green_screen(image)

    # Check if result is fully opaque
    alpha = np.array(result.split()[-1])
    assert np.all(alpha == 255), "Pure red image should be fully opaque"


def test_remove_green_screen_with_object() -> None:
    # Create an image with a red square on a green background
    green_rgb = (0, 255, 0)
    red_rgb = (255, 0, 0)
    img_array = np.zeros((100, 100, 3), dtype=np.uint8)
    img_array[:, :] = green_rgb
    img_array[25:75, 25:75] = red_rgb

    image = Image.fromarray(img_array)

    # Process image
    result = remove_green_screen(image)

    # Check transparency
    alpha = np.array(result.split()[-1])

    # The center (red square) should be opaque
    # We use a smaller range (30:70) than the square (25:75) because dilation (radius 1)
    # will expand the transparent mask by 1 pixel into the square.
    assert np.all(alpha[30:70, 30:70] == 255)

    # The outer part (green) should be transparent
    assert np.all(alpha[0:10, 0:10] == 0)


def test_crop_to_content() -> None:
    """Tests the crop_to_content function."""
    # Create an image with a small square in the middle
    img = Image.new("RGBA", (100, 100), (0, 0, 0, 0))
    # 20x20 square from (40, 40) to (60, 60)
    for x in range(40, 60):
        for y in range(40, 60):
            img.putpixel((x, y), (255, 255, 255, 255))

    # Crop with 5px padding
    cropped = crop_to_content(img, padding=5)

    # Expected size: 20 + 2*5 = 30
    assert cropped.size == (30, 30)

    # Check that it's actually cropped to the right area
    # Original (40,40) is now at (5,5) in the cropped image
    assert cropped.getpixel((5, 5)) == (255, 255, 255, 255)
    assert cropped.getpixel((0, 0)) == (0, 0, 0, 0)


def test_convert_to_favicon(tmp_path: Any) -> None:
    """Tests the convert_to_favicon function."""
    img = Image.new("RGBA", (100, 100), (255, 0, 0, 255))
    output_path = str(tmp_path / "test.ico")

    convert_to_favicon(img, output_path)

    assert os.path.exists(output_path)
    # Check if it's a valid ICO by opening it
    with Image.open(output_path) as ico:
        assert ico.format == "ICO"
        # ICO files can contain multiple sizes
        # In PIL, when you open an ICO, the sizes are available in info['sizes']
        assert "sizes" in ico.info
        assert len(ico.info["sizes"]) > 0


def test_remove_green_screen_dilation() -> None:
    # Create an image with a single green pixel in a red field
    red_rgb = (255, 0, 0)
    green_rgb = (0, 255, 0)
    img_array = np.zeros((10, 10, 3), dtype=np.uint8)
    img_array[:, :] = red_rgb
    # With noise reduction + dilation:
    # A single pixel would be removed by the median filter.
    # A 3x3 block would shrink to 1x1.
    # So we use a 5x5 block (2:7, 2:7).
    img_array[2:7, 2:7] = green_rgb

    image = Image.fromarray(img_array)

    # Without dilation/blur
    result_raw = remove_green_screen(image, dilation_radius=0, blur_radius=0)
    alpha_raw = np.array(result_raw.split()[-1])
    assert alpha_raw[0, 0] == 255  # Red corner
    assert alpha_raw[5, 5] == 0  # Green center

    # With blur (feathering)
    result_blurred = remove_green_screen(image, dilation_radius=0, blur_radius=2.0)
    alpha_blurred = np.array(result_blurred.split()[-1])

    # Check for soft edges (values between 0 and 255)
    # The edges of the 5x5 green block should now be feathered
    assert np.any((alpha_blurred > 0) & (alpha_blurred < 255))


def test_convert_to_browser_safe_png_resizing() -> None:
    """Tests that convert_to_browser_safe_png resizes large images."""
    import io

    from backend.services.image_processing import (
        MAX_IMAGE_SIZE,
        convert_to_browser_safe_png,
    )

    # Create a large image (larger than MAX_IMAGE_SIZE)
    large_size = MAX_IMAGE_SIZE + 500
    img = Image.new("RGB", (large_size, large_size // 2), color=(255, 0, 0))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    large_bytes = buf.getvalue()

    # Process image
    processed_bytes = convert_to_browser_safe_png(large_bytes)

    # Check if resized
    processed_img = Image.open(io.BytesIO(processed_bytes))
    assert processed_img.width == MAX_IMAGE_SIZE
    assert processed_img.height == MAX_IMAGE_SIZE // 2
    assert processed_img.format == "PNG"


def test_convert_to_browser_safe_png_no_resize_if_small() -> None:
    """convert_to_browser_safe_png leaves small, already-safe images alone."""
    import io

    from backend.services.image_processing import (
        MAX_IMAGE_SIZE,
        convert_to_browser_safe_png,
    )

    # Create a small JPEG image
    small_size = MAX_IMAGE_SIZE - 100
    img = Image.new("RGB", (small_size, small_size), color=(255, 0, 0))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    small_bytes = buf.getvalue()

    # Process image
    processed_bytes = convert_to_browser_safe_png(small_bytes)

    # Should be identical
    assert processed_bytes == small_bytes
