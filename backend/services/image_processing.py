import io

import numpy as np
from PIL import Image, ImageFilter, ImageOps, UnidentifiedImageError

# Formats natively supported by all major browsers.
_BROWSER_NATIVE_FORMATS = {"JPEG", "PNG", "GIF", "WEBP"}

# Maximum dimension for uploaded images (racer photos, etc.)
MAX_IMAGE_SIZE = 1024


class UnreadableImageError(ValueError):
    """*image_bytes* could not be decoded as an image at all.

    A `ValueError` subclass so a caller that already treats a `ValueError`
    as a user-facing refusal (both upload doors do — see `Mutation.
    upload_image` and `POST /upload/`) needs no extra branch. Before this
    existed, a corrupt or truncated upload (flaky venue wifi, a half-written
    camera capture) reached Pillow's own `UnidentifiedImageError` uncaught,
    which neither door handled — it surfaced as a raw 500 rather than a
    sentence a check-in volunteer could act on (#885).
    """


def resize_image(img: Image.Image, max_size: int = MAX_IMAGE_SIZE) -> Image.Image:
    """Resize *img* so that its longest side does not exceed *max_size*."""
    width, height = img.size
    if width <= max_size and height <= max_size:
        return img

    if width > height:
        new_width = max_size
        new_height = int(height * (max_size / width))
    else:
        new_height = max_size
        new_width = int(width * (max_size / height))

    # Using LANCZOS for high-quality downsampling.
    return img.resize((new_width, new_height), Image.Resampling.LANCZOS)


def convert_to_browser_safe_png(
    image_bytes: bytes, max_size: int = MAX_IMAGE_SIZE
) -> bytes:
    """Return *image_bytes* re-encoded as PNG if the format is not natively
    supported by all major browsers (e.g. HEIC/HEIF, TIFF, BMP), or if it
    exceeds *max_size* in either dimension.

    If the image is already a native format and within *max_size*, the original
    bytes are returned unchanged — including whatever EXIF orientation tag
    they carry, which a browser already honours when displaying the file
    as-is, so there is nothing to correct on that path.

    Raises:
        UnreadableImageError: *image_bytes* is not decodable as an image at
            all — garbage bytes, or a truncated upload.
    """
    try:
        img: Image.Image = Image.open(io.BytesIO(image_bytes))
        width, height = img.size
        needs_resize = width > max_size or height > max_size
        needs_conversion = img.format not in _BROWSER_NATIVE_FORMATS

        if not needs_resize and not needs_conversion:
            # Even if we don't need to resize or convert format, we still apply
            # auto-cropping if there's transparency information.
            if img.mode == "RGBA":
                # `crop_to_content` already forces a full pixel decode via
                # `getbbox()`, so correcting orientation first is free here
                # and keeps the crop bounds meaningful for a rotated image.
                img = _exif_transposed(img)
                img = crop_to_content(img)
                # If cropping changed the image, we must continue to
                # re-encoding. Otherwise we can still return original bytes.
                if img.size[0] == width and img.size[1] == height:
                    return image_bytes
            else:
                return image_bytes
        else:
            # Resizing or converting format is about to happen, which means
            # re-encoding the pixels from scratch — so a phone photo stored
            # in sensor orientation (`Orientation=6`, say) must be corrected
            # *before* that, or the orientation is lost for good once the
            # PNG re-encode below drops the tag that would have corrected it
            # on display (#885). Not done unconditionally above: it forces a
            # full pixel decode (`ImageOps.exif_transpose` always calls
            # `image.load()`), which the fast "return unchanged" path above
            # exists specifically to avoid.
            img = _exif_transposed(img)

        if needs_resize:
            img = resize_image(img, max_size)

        # Convert to RGBA so transparency is preserved for any source mode.
        if img.mode not in ("RGB", "RGBA"):
            img = img.convert("RGBA")

        # Apply auto-cropping as per SPEC
        img = crop_to_content(img)

        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()
    except UnidentifiedImageError as error:
        raise UnreadableImageError(
            "That file is not a photo Trusty Track can read."
        ) from error
    except OSError as error:
        # A truncated upload (flaky venue wifi, a half-written camera
        # capture) can have a header intact enough for `Image.open` to
        # identify the format and report a size, and only fail once
        # something above actually reads the pixel data it never received.
        raise UnreadableImageError(
            "That file is not a photo Trusty Track can read."
        ) from error


def _exif_transposed(img: Image.Image) -> Image.Image:
    """Return *img* rotated/flipped to match its EXIF orientation tag, with
    the tag itself cleared from the result (`ImageOps.exif_transpose`'s own
    behaviour). A phone photo is stored in sensor orientation with a tag
    saying how to display it upright; skipping this before a resize or a
    format conversion is #885 — the pixels are processed sideways, and the
    PNG this function re-encodes to has nowhere to put a tag that would have
    corrected it afterwards.
    """
    transposed = ImageOps.exif_transpose(img)
    # `in_place` defaults to False, so this is never actually None — Pillow's
    # own return type just allows for the `in_place=True` case, which is not
    # used here.
    assert transposed is not None
    return transposed


def remove_green_screen(
    image: Image.Image,
    hue_center: float = 120.0,
    hue_range: float = 30.0,
    min_saturation: float = 0.1,
    min_value: float = 0.1,
    dilation_radius: int = 1,
    softness: float = 0.1,
    blur_radius: float = 0.5,
) -> Image.Image:
    """
    Removes the green screen from an image using soft-thresholding and
    morphological cleanup.

    Args:
        image: The input PIL Image (RGB).
        hue_center: The center hue to target (default 120 for green).
        hue_range: The range around the center hue to be fully transparent.
        min_saturation: Minimum saturation threshold (0-1).
        min_value: Minimum value (brightness) threshold (0-1).
        dilation_radius: Radius for morphological dilation to remove edge halos.
        softness: The width of the soft-thresholding transition (0-1).
        blur_radius: Radius for Gaussian blur to smooth (feather) the alpha edges.

    Returns:
        A PIL Image in RGBA mode with the green screen replaced by transparency.
    """
    # Ensure image is RGB
    if image.mode != "RGB":
        image = image.convert("RGB")

    # Use PIL's built-in HSV conversion for robustness
    hsv_image = image.convert("HSV")
    h_img, s_img, v_img = hsv_image.split()

    # Convert to NumPy for vectorized thresholding
    h = np.array(h_img).astype(np.float32) * 360.0 / 255.0
    s = np.array(s_img).astype(np.float32) / 255.0
    v = np.array(v_img).astype(np.float32) / 255.0

    # Calculate distance from target hue
    h_dist = np.abs(h - hue_center)
    h_dist = np.minimum(h_dist, 360 - h_dist)

    # Soft Thresholding: Linear ramp for alpha transition
    # 1.0 (fully green/transparent) to 0.0 (not green/opaque)
    # softness_val defines the width of the transition zone in degrees
    softness_val = 60.0 * softness

    # Calculate initial green mask with soft falloff
    # 0 = not green, 1 = fully green
    green_mask = 1.0 - np.clip((h_dist - hue_range) / softness_val, 0, 1)

    # Apply S and V thresholds (keep them binary-ish but could also be soft)
    green_mask *= (s >= min_saturation) & (v >= min_value)

    # Convert mask to PIL Image for morphological cleanup
    # 0 = keep, 255 = remove
    mask_image = Image.fromarray((green_mask * 255).astype(np.uint8), mode="L")

    # 1. Noise reduction: median filter to remove "salt and pepper" noise
    mask_image = mask_image.filter(ImageFilter.MedianFilter(size=3))

    # 2. Morphological Edge Polish (Dilation)
    if dilation_radius > 0:
        mask_image = mask_image.filter(
            ImageFilter.MaxFilter(size=dilation_radius * 2 + 1)
        )

    # 3. Morphological Closing (Smoothing boundary shape)
    # Dilation then Erosion helps smooth out small jagged protrusions
    if dilation_radius > 0:
        mask_image = mask_image.filter(
            ImageFilter.MinFilter(size=dilation_radius * 2 + 1)
        )

    # Invert mask (255 = keep, 0 = remove) for alpha channel
    alpha_channel = Image.fromarray(255 - np.array(mask_image), mode="L")

    # 4. Smoothing (Feathering): Gaussian blur to smooth jagged edges
    if blur_radius > 0:
        alpha_channel = alpha_channel.filter(
            ImageFilter.GaussianBlur(radius=blur_radius)
        )

    # Combine with original image
    rgba_image = image.copy().convert("RGBA")
    rgba_image.putalpha(alpha_channel)

    return rgba_image


def crop_to_content(image: Image.Image, padding: int = 10) -> Image.Image:
    """
    Crops the image to contain only the primary subject based on transparency.

    Args:
        image: The input PIL Image (should be RGBA).
        padding: Padding to add around the subject.

    Returns:
        The cropped PIL Image.
    """
    if image.mode != "RGBA":
        image = image.convert("RGBA")

    # Get the bounding box of non-transparent pixels
    # getbbox() returns (left, top, right, bottom)
    bbox = image.getbbox()

    if not bbox:
        return image

    left, top, right, bottom = bbox

    # Add padding
    left = max(0, left - padding)
    top = max(0, top - padding)
    right = min(image.width, right + padding)
    bottom = min(image.height, bottom + padding)

    return image.crop((left, top, right, bottom))


def convert_to_favicon(image: Image.Image, output_path: str) -> None:
    """
    Converts an image to a favicon format (.ico).

    Args:
        image: The input PIL Image.
        output_path: Path where the .ico file will be saved.
    """
    # Standard favicon sizes
    sizes = [(16, 16), (32, 32), (48, 48), (64, 64), (180, 180), (192, 192), (512, 512)]

    # We need to ensure the image is in a mode that supports transparency if we
    # want the favicon to be transparent
    if image.mode != "RGBA":
        image = image.convert("RGBA")

    image.save(output_path, format="ICO", sizes=sizes)
