from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

S = 4096
canvas = Image.new("RGBA", (S, S), (0, 0, 0, 0))
draw = ImageDraw.Draw(canvas)

# 圆角底板
plate = Image.new("RGBA", (S, S), (0, 0, 0, 0))
pd = ImageDraw.Draw(plate)
for y in range(S):
    t = y / (S - 1)
    r = int(13 + (8 - 13) * t)
    g = int(15 + (10 - 15) * t)
    b = int(18 + (13 - 18) * t)
    pd.line([(0, y), (S, y)], fill=(r, g, b, 255))
mask = Image.new("L", (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=760, fill=255)
canvas.paste(plate, (0, 0), mask)

# 柔和的绿色光
glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
gd = ImageDraw.Draw(glow)
gd.ellipse([S * 0.12, S * 0.12, S * 0.72, S * 0.72], fill=(201, 243, 107, 38))
glow = glow.filter(ImageFilter.GaussianBlur(180))
canvas.alpha_composite(glow)

# 两个重叠的圆角方框
lime = (201, 243, 107, 255)
steel = (128, 140, 155, 235)
lw = 44
d = ImageDraw.Draw(canvas)
d.rounded_rectangle([S * 0.176, S * 0.176, S * 0.684, S * 0.684], radius=150, outline=lime, width=lw)
d.rounded_rectangle([S * 0.410, S * 0.410, S * 0.918, S * 0.918], radius=150, outline=steel, width=lw)

# 交点
dot = Image.new("RGBA", (S, S), (0, 0, 0, 0))
dd = ImageDraw.Draw(dot)
dd.ellipse([S * 0.513, S * 0.513, S * 0.597, S * 0.597], fill=lime)
dot = dot.filter(ImageFilter.GaussianBlur(4))
canvas.alpha_composite(dot)

out = Path("build")
out.mkdir(exist_ok=True)
icon = canvas.resize((1024, 1024), Image.LANCZOS)
icon.save(out / "icon.png")
icon.save(
    out / "icon.ico",
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)
print("icon written")
