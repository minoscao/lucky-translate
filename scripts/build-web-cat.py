"""Build a small transparent animated WebP from the desktop pet PNG sequence."""

from pathlib import Path
import sys
from PIL import Image


def main() -> None:
    source, output = Path(sys.argv[1]), Path(sys.argv[2])
    files = sorted(source.glob("frame-*.png"))[::2]
    if not files:
        raise SystemExit("No pet frames found")
    frames = []
    for path in files:
        image = Image.open(path).convert("RGBA")
        image.thumbnail((256, 256), Image.Resampling.LANCZOS)
        frames.append(image.copy())
    output.parent.mkdir(parents=True, exist_ok=True)
    frames[0].save(output, format="WEBP", save_all=True, append_images=frames[1:], duration=83, loop=0, quality=78, method=6, minimize_size=True)
    print(f"{len(frames)} frames -> {output.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
