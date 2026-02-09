import numpy as np
from PIL import Image
from .image_processing import remove_green_screen


def test_remove_green_screen_pure_green():
    # Create a pure green image
    green_rgb = (0, 255, 0)
    image = Image.new("RGB", (100, 100), color=green_rgb)
    
    # Process image
    result = remove_green_screen(image)
    
    # Check if result is fully transparent
    alpha = np.array(result.split()[-1])
    assert np.all(alpha == 0), "Pure green image should be fully transparent"


def test_remove_green_screen_no_green():
    # Create a pure red image
    red_rgb = (255, 0, 0)
    image = Image.new("RGB", (100, 100), color=red_rgb)
    
    # Process image
    result = remove_green_screen(image)
    
    # Check if result is fully opaque
    alpha = np.array(result.split()[-1])
    assert np.all(alpha == 255), "Pure red image should be fully opaque"


def test_remove_green_screen_with_object():
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


def test_remove_green_screen_dilation():
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
    assert alpha_raw[0, 0] == 255 # Red corner
    assert alpha_raw[5, 5] == 0   # Green center
    
    # With blur (feathering)
    result_blurred = remove_green_screen(image, dilation_radius=0, blur_radius=2.0)
    alpha_blurred = np.array(result_blurred.split()[-1])
    
    # Check for soft edges (values between 0 and 255)
    # The edges of the 5x5 green block should now be feathered
    assert np.any((alpha_blurred > 0) & (alpha_blurred < 255))
