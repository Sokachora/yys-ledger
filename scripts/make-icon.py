"""生成应用图标源文件：太极印章。

用法：python scripts/make-icon.py
然后：npx tauri icon src-tauri/app-icon.png
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SIZE = 1024
PAPER = (28, 27, 25, 255)
GOLD = (194, 160, 96, 255)
GOLD_DIM = (194, 160, 96, 150)
VERMILION = (178, 58, 46, 255)
CREAM = (247, 235, 213, 210)


def main() -> None:
    image = Image.new("RGBA", (SIZE, SIZE), PAPER)

    # 轻微径向渐变：单独图层做 alpha 合成，直接画在 RGBA 上会覆盖 alpha
    glow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    for index in range(14):
        radius = int(SIZE * 0.75) - index * 34
        box = (
            SIZE // 2 - radius,
            SIZE // 2 - radius,
            SIZE // 2 + radius,
            SIZE // 2 + radius,
        )
        glow_draw.ellipse(box, fill=(194, 160, 96, 6))
    image = Image.alpha_composite(image, glow)
    draw = ImageDraw.Draw(image)

    # 双层金框
    draw.rectangle((56, 56, SIZE - 56, SIZE - 56), outline=GOLD, width=6)
    draw.rectangle((84, 84, SIZE - 84, SIZE - 84), outline=GOLD_DIM, width=2)

    # 太极
    cx = cy = SIZE // 2
    radius = 300
    draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=GOLD)
    draw.pieslice(
        (cx - radius, cy - radius, cx + radius, cy + radius),
        start=-90,
        end=90,
        fill=PAPER,
    )
    draw.ellipse((cx - radius // 2, cy - radius, cx + radius // 2, cy), fill=GOLD)
    draw.ellipse(
        (cx - radius // 2, cy, cx + radius // 2, cy + radius), fill=PAPER
    )
    eye = radius // 6
    draw.ellipse(
        (cx - eye, cy - radius // 2 - eye, cx + eye, cy - radius // 2 + eye),
        fill=PAPER,
    )
    draw.ellipse(
        (cx - eye, cy + radius // 2 - eye, cx + eye, cy + radius // 2 + eye),
        fill=GOLD,
    )

    # 右下角朱印
    draw.rectangle((SIZE - 228, SIZE - 228, SIZE - 116, SIZE - 116), fill=VERMILION)
    draw.rectangle(
        (SIZE - 214, SIZE - 214, SIZE - 130, SIZE - 130), outline=CREAM, width=4
    )

    image.save(ROOT / "src-tauri" / "app-icon.png")
    image.resize((512, 512), Image.LANCZOS).save(ROOT / "public" / "brand" / "icon.png")
    print("图标已生成：src-tauri/app-icon.png, public/brand/icon.png")


if __name__ == "__main__":
    main()
