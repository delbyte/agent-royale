
import base64
import os

# 1x1 grey pixel PNG
base64_data = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=="
binary_data = base64.b64decode(base64_data)

paths = [
    "public/assets/models/environment/Textures/colormap.png",
    "public/assets/models/characters/Textures/colormap.png"
]

for path in paths:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(binary_data)
    print(f"Wrote valid PNG to {path}")
