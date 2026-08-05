"""Turn the logo PNG into a multi-resolution Windows .ico.

A file rather than a `python -c` here-string in the build script. The
here-string version could not be parsed by PowerShell at all — a here-string
has to be closed by `"@` at the start of a line with nothing after it, and the
one above it in the script ended `"@ 2>$null`, which swallowed the rest of the
file and made the whole script a syntax error.

macOS does the same job with `sips` and `iconutil`, which ship with the OS;
Windows has no equivalent, so this uses Pillow, which is already a dependency.

    python make_ico.py <logo.png> <output.ico>
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

#: What Windows asks for, from the taskbar up to the high-DPI shortcut.
SIZES = [(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2

    source, target = Path(argv[1]), Path(argv[2])
    if not source.is_file():
        print(f"logo not found: {source}", file=sys.stderr)
        return 1

    image = Image.open(source).convert("RGBA")
    frames = [image.resize(size, Image.LANCZOS) for size in SIZES]
    frames[0].save(target, format="ICO", sizes=SIZES, append_images=frames[1:])
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
