"""Re-encoding of uploaded photos (planned repairs, inspections) to size-capped JPEGs."""

from io import BytesIO

from fastapi import HTTPException
from PIL import Image, ImageOps, UnidentifiedImageError

#: Longest edge of a stored photo: legible detail on a damaged part, without a phone's full 12 MP.
PHOTO_MAX_SIDE = (1600, 1600)


def encode_photo(contents: bytes) -> Image.Image:
    """Decode an upload to an upright RGB image no larger than ``PHOTO_MAX_SIDE``."""
    try:
        image = ImageOps.exif_transpose(Image.open(BytesIO(contents)))
        image.thumbnail(PHOTO_MAX_SIDE)
        if image.mode in ("RGBA", "LA", "P"):
            # JPEG has no alpha: flatten onto white so a transparent PNG doesn't turn black.
            rgba = image.convert("RGBA")
            flat = Image.new("RGB", rgba.size, (255, 255, 255))
            flat.paste(rgba, mask=rgba.getchannel("A"))
            return flat
        return image.convert("RGB") if image.mode != "RGB" else image
    except UnidentifiedImageError, OSError, Image.DecompressionBombError:
        raise HTTPException(status_code=400, detail="Invalid image file")
