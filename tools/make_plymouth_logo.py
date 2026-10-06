"""Render plymouth/gnomac/logo.png from icons/apple.svg's path: glass-white body
with a soft vertical shading and a fading reflection underneath (same look as
the start-up animation)."""
import re
import numpy as np
from PIL import Image, ImageDraw

svg = open('extension/gnomac@nayzer974.github.io/icons/apple.svg', encoding='utf-8').read()
d = re.search(r' d="([^"]+)"', svg).group(1)
tokens = re.findall(r'[MCZ]|-?\d*\.?\d+', d)


def contours(tokens):
    out, cur, i = [], None, 0
    while i < len(tokens):
        t = tokens[i]
        if t == 'M':
            cur = [(float(tokens[i + 1]), float(tokens[i + 2]))]
            out.append(cur)
            i += 3
        elif t == 'C':
            i += 1
            while i < len(tokens) and tokens[i] not in 'MCZ':
                p0 = cur[-1]
                c1 = (float(tokens[i]), float(tokens[i + 1]))
                c2 = (float(tokens[i + 2]), float(tokens[i + 3]))
                p3 = (float(tokens[i + 4]), float(tokens[i + 5]))
                for k in range(1, 17):
                    u = k / 16
                    v = 1 - u
                    cur.append((v ** 3 * p0[0] + 3 * v * v * u * c1[0] + 3 * v * u * u * c2[0] + u ** 3 * p3[0],
                                v ** 3 * p0[1] + 3 * v * v * u * c1[1] + 3 * v * u * u * c2[1] + u ** 3 * p3[1]))
                i += 6
        else:
            i += 1
    return out


shapes = contours(tokens)
xs = [p[0] for c in shapes for p in c]
ys = [p[1] for c in shapes for p in c]
x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
lw, lh = x1 - x0, y1 - y0

W, H, S = 360, 520, 3
scale = (H * 0.66) / lh * S
total = lh * scale * 1.34
ox = (W * S - lw * scale) / 2 - x0 * scale
oy = (H * S - total) / 2 - y0 * scale


def mask(flip=False):
    im = Image.new('L', (W * S, H * S), 0)
    dr = ImageDraw.Draw(im)
    for c in shapes:
        pts = []
        for x, y in c:
            yy = (2 * y1 + lh * 0.015 - y) if flip else y
            pts.append((ox + x * scale, oy + yy * scale))
        dr.polygon(pts, fill=255)
    return np.asarray(im, float) / 255


body = mask()
refl = mask(True)
h = H * S
yy = np.arange(h)[:, None] * np.ones((1, W * S))
top = oy + y0 * scale
bottom = oy + y1 * scale
t = np.clip((yy - top) / (bottom - top), 0, 1)
rgb = np.zeros((h, W * S, 3))
stops = [(1, 1, 1), (0.93, 0.94, 0.97), (0.73, 0.76, 0.84)]
for ch in range(3):
    a, b, c = stops[0][ch], stops[1][ch], stops[2][ch]
    rgb[..., ch] = np.where(t < 0.55, a + (b - a) * t / 0.55, b + (c - b) * (t - 0.55) / 0.45)
fade = np.clip(1 - (yy - bottom) / (lh * 0.3 * scale), 0, 1)
reflection = refl * (fade ** 1.6) * 0.34
alpha = np.clip(body + reflection * (1 - body), 0, 1)
out = np.dstack([np.where(body[..., None] > 0, rgb, 1.0), alpha])
img = Image.fromarray((out * 255).astype(np.uint8), 'RGBA').resize((W, H), Image.LANCZOS)
img.save('plymouth/gnomac/logo.png')
print('logo.png', img.size)
