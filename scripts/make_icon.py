from pathlib import Path

from PIL import Image, ImageDraw

# 与渲染进程 LogoMark 相同的 28x28 几何结构；浅色模式主色 #5c7a00
S = 4096
ACCENT = (92, 122, 0, 255)
ACCENT_SOFT = (92, 122, 0, 140)  # 55% opacity，对应标题栏第二个方框
BORDER = (232, 232, 226, 255)
PLATE = (255, 255, 255, 255)

canvas = Image.new("RGBA", (S, S), (0, 0, 0, 0))

# 白色圆角底板
mask = Image.new("L", (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle(
    [0, 0, S - 1, S - 1], radius=760, fill=255
)
canvas.paste(Image.new("RGBA", (S, S), PLATE), (0, 0), mask)

# 极细的浅灰描边，避免纯白底在浅色桌面上看不见边界
plate_draw = ImageDraw.Draw(canvas)
plate_draw.rounded_rectangle(
    [4, 4, S - 5, S - 5], radius=756, outline=BORDER, width=8
)

# 将 28x28 的 LogoMark 放大到画面约 83% 宽
scale = 3400 / 28
origin = (S - 3400) / 2


def point(value: float) -> float:
    return origin + value * scale


def box(x1: float, y1: float, x2: float, y2: float) -> list[float]:
    return [point(x1), point(y1), point(x2), point(y2)]


stroke = int(round(1.6 * scale))
radius = int(round(4.5 * scale))

# 第一个圆角方框
plate_draw.rounded_rectangle(
    box(2.5, 2.5, 17.5, 17.5), radius=radius, outline=ACCENT, width=stroke
)

# 第二个圆角方框以 55% 透明度叠在上面
soft = Image.new("RGBA", (S, S), (0, 0, 0, 0))
soft_draw = ImageDraw.Draw(soft)
soft_draw.rounded_rectangle(
    box(10.5, 10.5, 25.5, 25.5),
    radius=radius,
    outline=ACCENT_SOFT,
    width=stroke,
)
canvas.alpha_composite(soft)

# 中心点
plate_draw.ellipse(box(7.8, 7.8, 12.2, 12.2), fill=ACCENT)

icon = canvas.resize((1024, 1024), Image.Resampling.LANCZOS)
out = Path("build")
out.mkdir(exist_ok=True)
icon.save(out / "icon.png", optimize=True)
icon.save(
    out / "icon.ico",
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)
icon.save(Path("resources") / "icon.png", optimize=True)
icon.save(Path("docs/assets") / "icon.png", optimize=True)
print("light rounded icon written")
