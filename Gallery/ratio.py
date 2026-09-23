import os
import math
from PIL import Image

def get_image_ratios(folder_path):
    # Supported image extensions
    valid_extensions = ('.png', '.jpg', '.jpeg', '.bmp', '.gif', '.webp')
    
    if not os.path.exists(folder_path):
        print(f"Error: The folder '{folder_path}' was not found.")
        return

    print(f"{'Filename':<30} | {'Dimensions':<12} | {'Exact Ratio':<12} | {'Decimal'}")
    print("-" * 75)

    for filename in os.listdir(folder_path):
        if filename.lower().endswith(valid_extensions):
            file_path = os.path.join(folder_path, filename)
            
            try:
                with Image.open(file_path) as img:
                    width, height = img.size
                    
                    # Calculate exact ratio using Greatest Common Divisor
                    divisor = math.gcd(width, height)
                    exact_ratio = f"{width // divisor}:{height // divisor}"
                    
                    # Calculate decimal ratio (useful for images that don't crop to clean integers)
                    decimal_ratio = round(width / height, 2)
                    
                    # Truncate filename if too long for clean table formatting
                    display_name = filename if len(filename) <= 28 else filename[:25] + "..."
                    
                    print(f"{display_name:<30} | {f'{width}x{height}':<12} | {exact_ratio:<12} | {decimal_ratio}:1")
                    
            except Exception as e:
                print(f"{filename:<30} | Error: Could not read file")

if __name__ == "__main__":
    folder_input = input("Enter the path to your image folder: ")
    # Remove quotes if the user dragged and dropped the folder into the terminal
    folder_input = folder_input.strip('"\'') 
    get_image_ratios(folder_input)