"""
Creates lightweight WebP copies of every gallery photo.

Run it from the Gallery folder (same place as ratio.py):
    pip install pillow
    python optimize_images.py

For each category it makes:
    <Category>/thumbs/<name>.webp   800px on the long side of the grid view
    <Category>/webp/<name>.webp     full 1400px size, for the lightbox

Your original JPGs are never changed. Run it again after adding photos;
files that are already up to date are skipped.
Then set  USE_OPTIMIZED = true  in gallery.html.
"""

from pathlib import Path
from PIL import Image, ImageOps

CATEGORIES = ["Landscape", "Wildlife", "Travel", "Holi", "Theyyam", "Taj Mahal"]
THUMB_WIDTH = 800      # grid columns are at most ~530px wide; 800 stays sharp on most screens
THUMB_QUALITY = 78
FULL_QUALITY = 85

here = Path(__file__).resolve().parent
before = after = 0


def save_webp(img, out_path, quality):
    out_path.parent.mkdir(exist_ok=True)
    img.save(out_path, "WEBP", quality=quality, method=6)


for category in CATEGORIES:
    folder = here / category
    if not folder.is_dir():
        print(f"Skipping {category}: folder not found")
        continue

    for src in sorted(folder.glob("*.jpg")):
        thumb_path = folder / "thumbs" / f"{src.stem}.webp"
        full_path = folder / "webp" / f"{src.stem}.webp"
        before += src.stat().st_size

        up_to_date = all(
            p.exists() and p.stat().st_mtime >= src.stat().st_mtime
            for p in (thumb_path, full_path)
        )
        if not up_to_date:
            with Image.open(src) as img:
                img = ImageOps.exif_transpose(img).convert("RGB")

                # Full size (kept at its current dimensions)
                save_webp(img, full_path, FULL_QUALITY)

                # Grid thumbnail: scale so the width is THUMB_WIDTH (never enlarge)
                if img.width > THUMB_WIDTH:
                    new_h = round(img.height * THUMB_WIDTH / img.width)
                    thumb = img.resize((THUMB_WIDTH, new_h), Image.LANCZOS)
                else:
                    thumb = img
                save_webp(thumb, thumb_path, THUMB_QUALITY)
            print(f"  {category}/{src.name}")

        after += thumb_path.stat().st_size

print()
print(f"Grid download before: {before / 1_048_576:.1f} MB (JPGs)")
print(f"Grid download after:  {after / 1_048_576:.1f} MB (WebP thumbnails)")
print("Now set  USE_OPTIMIZED = true  in gallery.html")
