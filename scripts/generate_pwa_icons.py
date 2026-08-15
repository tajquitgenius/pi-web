#!/usr/bin/env python3
"""Generate the deterministic PNG icons embedded by pi-web.

The icon geometry intentionally matches the inline SVG mark. Keeping the
renderer dependency-free makes regeneration reproducible on every platform.
"""
from __future__ import annotations

import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "internal" / "ui" / "embedded" / "assets"
BACKGROUND = (9, 9, 11, 255)
FOREGROUND = (255, 255, 255, 255)


def chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


def write_png(path: Path, size: int, rounded: bool, mark_inset: float) -> None:
    pixels = bytearray(BACKGROUND * (size * size))
    radius = size * 0.15 if rounded else 0

    def set_pixel(x: int, y: int, color: tuple[int, int, int, int]) -> None:
        start = (y * size + x) * 4
        pixels[start : start + 4] = bytes(color)

    for y in range(size):
        for x in range(size):
            if rounded:
                nearest_x = min(x, size - 1 - x)
                nearest_y = min(y, size - 1 - y)
                if nearest_x < radius and nearest_y < radius:
                    dx = radius - nearest_x - 0.5
                    dy = radius - nearest_y - 0.5
                    if dx * dx + dy * dy > radius * radius:
                        set_pixel(x, y, (0, 0, 0, 0))

    origin = size * mark_inset
    mark_size = size * (1 - 2 * mark_inset)

    def rect(left: float, top: float, right: float, bottom: float) -> None:
        for y in range(max(0, int(top)), min(size, int(bottom + 0.999))):
            for x in range(max(0, int(left)), min(size, int(right + 0.999))):
                set_pixel(x, y, FOREGROUND)

    def mark_point(value: float) -> float:
        return origin + mark_size * value / 800

    # The stepped Pi mark from icon.svg, rendered as opaque rectangles.
    rect(mark_point(165.29), mark_point(165.29), mark_point(517.36), mark_point(400))
    rect(mark_point(165.29), mark_point(400), mark_point(282.65), mark_point(634.72))
    rect(mark_point(282.65), mark_point(400), mark_point(400), mark_point(517.36))
    rect(mark_point(400), mark_point(282.65), mark_point(517.36), mark_point(400))
    rect(mark_point(517.36), mark_point(400), mark_point(634.72), mark_point(634.72))
    # Cut out the inner counter.
    for y in range(max(0, int(mark_point(282.65))), min(size, int(mark_point(400)))):
        for x in range(max(0, int(mark_point(282.65))), min(size, int(mark_point(400)))):
            set_pixel(x, y, BACKGROUND)
    scanlines = b"".join(b"\x00" + pixels[y * size * 4 : (y + 1) * size * 4] for y in range(size))
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(scanlines, 9))
    png += chunk(b"IEND", b"")
    path.write_bytes(png)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    write_png(OUT / "icon-192.png", 192, False, 0.16)
    write_png(OUT / "icon-512.png", 512, False, 0.16)
    write_png(OUT / "apple-touch-icon.png", 180, True, 0.16)


if __name__ == "__main__":
    main()
