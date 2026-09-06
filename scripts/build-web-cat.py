"""Build a small transparent animated WebP from the desktop pet PNG sequence."""

from pathlib import Path
import sys
from PIL import Image


def main() -> None:
    source, output = Path(sys.argv[1]), Path(sys.argv[2])
    stride = int(sys.argv[3]) if len(sys.argv) > 3 else 3
    size = int(sys.argv[4]) if len(sys.argv) > 4 else 224
    quality = int(sys.argv[5]) if len(sys.argv) > 5 else 72
    files = sorted(source.glob("frame-*.png"))[::stride]
    if not files:
        raise SystemExit("No pet frames found")
    frames = []
    for path in files:
        image = Image.open(path).convert("RGBA")
        image.thumbnail((size, size), Image.Resampling.LANCZOS)
        frames.append(image.copy())
    output.parent.mkdir(parents=True, exist_ok=True)
    frames[0].save(output, format="WEBP", save_all=True, append_images=frames[1:], duration=round(1000 / 24 * stride), loop=0, quality=quality, method=4, minimize_size=True)
    print(f"{len(frames)} frames -> {output.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
