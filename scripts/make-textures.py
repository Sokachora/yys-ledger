"""生成自绘纸纹与墨纹，替换原先来自官网的素材。

用法：python scripts/make-textures.py
输出：public/brand/paper.png, public/brand/ink.png
"""

import random
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SIZE = 512


def grain(base: tuple[int, int, int], tint: tuple[int, int, int], strength: int) -> Image.Image:
    image = Image.new("RGB", (SIZE, SIZE), base)
    noise = Image.effect_noise((SIZE, SIZE), strength).convert("L")
    overlay = Image.new("RGBA", (SIZE, SIZE), (*tint, 0))
    overlay.putalpha(noise.point(lambda value: max(0, int((value - 128) / 10))))
    return Image.alpha_composite(image.convert("RGBA"), overlay).convert("RGB")


def fibers(image: Image.Image, colors: list[tuple[int, int, int]], count: int) -> None:
    draw = ImageDraw.Draw(image)
    for _ in range(count):
        x = random.randrange(SIZE)
        y = random.randrange(SIZE)
        length = random.randrange(5, 30)
        slope = random.uniform(-0.16, 0.16)
        draw.line(
            (x, y, x + length, y + length * slope),
            fill=random.choice(colors),
            width=1,
        )
    for _ in range(count * 3):
        x = random.randrange(SIZE)
        y = random.randrange(SIZE)
        draw.point((x, y), fill=random.choice(colors))


def main() -> None:
    random.seed(20260814)

    paper = grain((247, 243, 234), (92, 71, 29), 12)
    fibers(paper, [(240, 234, 218), (236, 229, 210), (250, 246, 238)], 900)
    paper.save(ROOT / "public" / "brand" / "paper.png", optimize=True)

    ink = grain((26, 24, 21), (194, 160, 96), 9)
    fibers(ink, [(32, 29, 25), (36, 32, 27), (48, 42, 33)], 700)
    ink.save(ROOT / "public" / "brand" / "ink.png", optimize=True)

    print("已生成 paper.png 与 ink.png")


if __name__ == "__main__":
    main()
