"""生成随主题切换的透明底图标：浅色墨色单色版 / 暗色金色朱印版。

用法：python scripts/make-theme-icons.py
输出：public/brand/icon-light.png, public/brand/icon-dark.png
      src-tauri/icons/theme-light.png, src-tauri/icons/theme-dark.png
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SIZE = 1024
INK = (43, 35, 24)
GOLD = (194, 160, 96)
VERMILION = (178, 58, 46)


def make(foreground: tuple[int, int, int], seal: tuple[int, int, int]) -> Image.Image:
    image = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    # 圆角双线框
    draw.rounded_rectangle(
        (56, 56, SIZE - 56, SIZE - 56), radius=94, outline=(*foreground, 255), width=8
    )
    draw.rounded_rectangle(
        (88, 88, SIZE - 88, SIZE - 88), radius=76, outline=(*foreground, 140), width=3
    )

    # 太极：一半实色、一半透明，嵌在任意底色上都成立
    center = SIZE // 2
    radius = 300
    draw.ellipse(
        (center - radius, center - radius, center + radius, center + radius),
        fill=(*foreground, 255),
    )
    draw.pieslice(
        (center - radius, center - radius, center + radius, center + radius),
        start=-90,
        end=90,
        fill=(0, 0, 0, 0),
    )
    draw.ellipse(
        (center - radius // 2, center - radius, center + radius // 2, center),
        fill=(*foreground, 255),
    )
    draw.ellipse(
        (center - radius // 2, center, center + radius // 2, center + radius),
        fill=(0, 0, 0, 0),
    )
    eye = radius // 6
    draw.ellipse(
        (
            center - eye,
            center - radius // 2 - eye,
            center + eye,
            center - radius // 2 + eye,
        ),
        fill=(0, 0, 0, 0),
    )
    draw.ellipse(
        (
            center - eye,
            center + radius // 2 - eye,
            center + eye,
            center + radius // 2 + eye,
        ),
        fill=(*foreground, 255),
    )

    # 右下角印章
    draw.rectangle((SIZE - 232, SIZE - 232, SIZE - 116, SIZE - 116), fill=(*seal, 255))
    draw.rectangle(
        (SIZE - 214, SIZE - 214, SIZE - 134, SIZE - 134),
        outline=(0, 0, 0, 0),
        width=7,
    )

    return image.resize((512, 512), Image.LANCZOS)


def main() -> None:
    light = make(INK, INK)
    dark = make(GOLD, VERMILION)

    (ROOT / "public" / "brand").mkdir(parents=True, exist_ok=True)
    light.save(ROOT / "public" / "brand" / "icon-light.png", optimize=True)
    dark.save(ROOT / "public" / "brand" / "icon-dark.png", optimize=True)

    icons = ROOT / "src-tauri" / "icons"
    icons.mkdir(parents=True, exist_ok=True)
    light.save(icons / "theme-light.png", optimize=True)
    dark.save(icons / "theme-dark.png", optimize=True)
    print("已生成 icon-light.png 与 icon-dark.png")


if __name__ == "__main__":
    main()
