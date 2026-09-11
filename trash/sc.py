import math
from pathlib import Path
from PIL import Image

# Supported extensions
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff", ".gif"}


def get_image_ratios(folder_path: str):
    folder = Path(folder_path)

    if not folder.exists() or not folder.is_dir():
        print(f"Error: Directory '{folder_path}' does not exist.")
        return

    # Header
    print(
        f"{'Filename':<35} | {'Dimensions (WxH)':<18} | {'Ratio':<10} | {'Decimal':<8}"
    )
    print("-" * 80)

    for file_path in folder.iterdir():
        if file_path.suffix.lower() in IMAGE_EXTENSIONS:
            try:
                with Image.open(file_path) as img:
                    width, height = img.size

                    # Calculate simplified integer ratio using GCD
                    divisor = math.gcd(width, height)
                    ratio_w = width // divisor
                    ratio_h = height // divisor

                    decimal_ratio = round(width / height, 2)

                    print(
                        f"{file_path.name:<35} | "
                        f"{f'{width}x{height}':<18} | "
                        f"{f'{ratio_w}:{ratio_h}':<10} | "
                        f"{decimal_ratio:<8}"
                    )
            except Exception as e:
                print(f"{file_path.name:<35} | Error reading image: {e}")


if __name__ == "__main__":
    # Replace with your target folder path
    target_folder = "D:\\photogrpahy web\\wetransfer_pics-for-website_2026-09-08_0523\\Wildlife"
    get_image_ratios(target_folder)