"""Trace a black-on-light logo bitmap into smooth SVG Bezier paths.

  python tools/trace_logo.py reference.webp  -> prints the path data and a
  quality score (overlap of the redrawn shape with the bitmap).

Only numpy and Pillow are needed: the boundary is followed pixel by pixel,
split at real corners, and each smooth stretch becomes cubic curves through
points sampled along it (Catmull-Rom).
"""
import sys
import math
import numpy as np
from PIL import Image, ImageDraw


STEP = float(__import__('os').environ.get('TRACE_STEP', 44))


def load_mask(path):
    im = Image.open(path).convert('L')
    a = np.asarray(im)
    mask = a < 90
    # Ignore the grid and rulers of the reference sheet: keep large blobs only.
    return mask


def components(mask):
    h, w = mask.shape
    labels = np.zeros((h, w), np.int32)
    sizes = {}
    n = 0
    for y0 in range(h):
        for x0 in range(w):
            if mask[y0, x0] and not labels[y0, x0]:
                n += 1
                stack = [(y0, x0)]
                labels[y0, x0] = n
                count = 0
                while stack:
                    y, x = stack.pop()
                    count += 1
                    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        yy, xx = y + dy, x + dx
                        if 0 <= yy < h and 0 <= xx < w and mask[yy, xx] and not labels[yy, xx]:
                            labels[yy, xx] = n
                            stack.append((yy, xx))
                sizes[n] = count
    return labels, sizes


def boundary(region):
    """Ordered outer boundary pixels of one region (Moore neighbour tracing)."""
    ys, xs = np.nonzero(region)
    start = (ys.min(), xs[ys == ys.min()].min())
    # 8 neighbours clockwise starting west.
    nb = [(0, -1), (-1, -1), (-1, 0), (-1, 1), (0, 1), (1, 1), (1, 0), (1, -1)]
    h, w = region.shape
    inside = lambda y, x: 0 <= y < h and 0 <= x < w and region[y, x]
    pts = [start]
    cur = start
    back = 0
    while True:
        found = False
        for k in range(8):
            d = (back + 1 + k) % 8
            y, x = cur[0] + nb[d][0], cur[1] + nb[d][1]
            if inside(y, x):
                back = (d + 4) % 8
                cur = (y, x)
                found = True
                break
        if not found or (cur == start and len(pts) > 2):
            break
        pts.append(cur)
        if len(pts) > 200000:
            break
    return np.array([(x, y) for y, x in pts], float)


def smooth(points, passes=3, closed=True):
    p = points.copy()
    for _ in range(passes):
        p = (np.roll(p, 1, 0) + 2 * p + np.roll(p, -1, 0)) / 4
    return p


def resample(points, step):
    d = np.hypot(*(np.roll(points, -1, 0) - points).T)
    total = d.sum()
    n = max(8, int(total / step))
    cum = np.concatenate([[0], np.cumsum(d)])
    ext = np.vstack([points, points[:1]])
    out = []
    for i in range(n):
        s = total * i / n
        k = np.searchsorted(cum, s, side='right') - 1
        t = (s - cum[k]) / max(d[k % len(d)], 1e-9)
        out.append(ext[k] + (ext[k + 1] - ext[k]) * t)
    return np.array(out)


def corners(points, window, threshold_deg):
    n = len(points)
    found = []
    for i in range(n):
        a = points[(i - window) % n]
        b = points[i]
        c = points[(i + window) % n]
        v1, v2 = b - a, c - b
        ang = math.degrees(abs(math.atan2(v1[0] * v2[1] - v1[1] * v2[0], v1 @ v2)))
        found.append(ang)
    found = np.array(found)
    idx = []
    for i in range(n):
        if found[i] > threshold_deg and found[i] == found[(np.arange(i - window, i + window + 1) % n)].max():
            idx.append(i)
    return idx


def catmull(pts, closed_ring=False, scale=1.0):
    """Cubic segments through pts (open stretch), as [(c1, c2, p), ...]."""
    segs = []
    n = len(pts)
    for i in range(n - 1):
        p0 = pts[i - 1] if i > 0 else pts[i]
        p1, p2 = pts[i], pts[i + 1]
        p3 = pts[i + 2] if i + 2 < n else pts[i + 1]
        c1 = p1 + (p2 - p0) / 6 * scale
        c2 = p2 - (p3 - p1) / 6 * scale
        segs.append((c1, c2, p2))
    return segs


def trace(region, step=STEP):
    raw = boundary(region)
    pts = resample(smooth(raw, 4), 2.0)
    cs = corners(pts, 10, 38)
    if not cs:
        cs = [0]
    # Rotate so that the first corner is the start.
    pts = np.roll(pts, -cs[0], 0)
    cs = sorted((c - cs[0]) % len(pts) for c in cs)
    cs.append(len(pts))
    cmds = [('M', pts[0])]
    for a, b in zip(cs[:-1], cs[1:]):
        stretch = pts[a:b + 1] if b < len(pts) else np.vstack([pts[a:], pts[:1]])
        m = max(3, int(np.hypot(*np.diff(stretch, axis=0).T).sum() / step) + 1)
        idx = np.linspace(0, len(stretch) - 1, m).round().astype(int)
        for c1, c2, p in catmull(stretch[idx]):
            cmds.append(('C', c1, c2, p))
    cmds.append(('Z',))
    return cmds


def to_svg(cmds, ox, oy, scale):
    f = lambda v: ('%.2f' % v).rstrip('0').rstrip('.')
    out = []
    for c in cmds:
        if c[0] == 'M':
            out.append('M%s %s' % (f((c[1][0] - ox) * scale), f((c[1][1] - oy) * scale)))
        elif c[0] == 'C':
            out.append('C' + ' '.join('%s %s' % (f((p[0] - ox) * scale), f((p[1] - oy) * scale)) for p in c[1:]))
        else:
            out.append('Z')
    return ''.join(out)


def bezier_points(cmds, n=24):
    pts = []
    cur = None
    for c in cmds:
        if c[0] == 'M':
            cur = c[1]
            pts.append(cur)
        elif c[0] == 'C':
            for t in np.linspace(0, 1, n)[1:]:
                u = 1 - t
                pts.append(u ** 3 * cur + 3 * u * u * t * c[1] + 3 * u * t * t * c[2] + t ** 3 * c[3])
            cur = c[3]
    return pts


def main():
    mask = load_mask(sys.argv[1])
    h, w = mask.shape
    # Keep the two big blobs (body and leaf) of the logo.
    labels, sizes = components(mask)
    big = [k for k, v in sizes.items() if v > 20000]
    leaf = [k for k, v in sizes.items() if 3000 < v < 20000 and v > 0]
    wanted = sorted(big + leaf, key=lambda k: -sizes[k])[:2]
    regions = [labels == k for k in wanted]
    all_ys, all_xs = np.nonzero(np.logical_or.reduce(regions))
    x0, x1, y0, y1 = all_xs.min(), all_xs.max(), all_ys.min(), all_ys.max()
    height = y1 - y0
    scale = 100.0 / height
    paths = []
    drawn = Image.new('L', (w, h), 0)
    for region in regions:
        cmds = trace(region)
        paths.append(to_svg(cmds, x0, y0, scale))
        ImageDraw.Draw(drawn).polygon([tuple(p) for p in bezier_points(cmds)], fill=255)
    redrawn = np.asarray(drawn) > 0
    target = np.logical_or.reduce(regions)
    iou = (redrawn & target).sum() / (redrawn | target).sum()
    print('bbox', x0, y0, x1, y1, 'width/height', round((x1 - x0) / height, 4), 'IoU', round(float(iou), 5))
    print('PATH', ''.join(paths))


if __name__ == '__main__':
    main()
