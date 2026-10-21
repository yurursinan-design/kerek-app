"""Animated transitions for the «Тапсыр!» ad, drawn frame by frame (numpy + Pillow).

Every effect takes and returns 1080×1920 RGB frames as uint8 arrays.
"""
import math
import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter

W, H = 1080, 1920
GOLD = (242, 183, 5)
INK = (11, 46, 68)


def ease_in(x):
    return x * x * x


def ease_out(x):
    return 1 - (1 - x) ** 3


def scaled(img, s, cx, cy):
    """The frame scaled by s around (cx, cy), cropped back to the frame"""
    a = 1 / s
    return img.transform((W, H), Image.AFFINE, (a, 0, cx - cx * a, 0, a, cy - cy * a), resample=Image.BILINEAR)


def zoom(frame, s, cx, cy, blur):
    """Zoom with a radial blur: copies at slightly growing scales, averaged"""
    img = Image.fromarray(frame)
    n = max(1, int(round(1 + blur * 7)))
    acc = np.zeros((H, W, 3), np.float32)
    for i in range(n):
        acc += np.asarray(scaled(img, s * (1 + 0.035 * blur * i), cx, cy), np.float32)
    return (acc / n).astype(np.uint8)


def hblur(a, width):
    """Horizontal box blur (motion blur of a whip pan)"""
    width = int(width)
    if width < 2:
        return a
    pad = np.pad(a.astype(np.float32), ((0, 0), (width, width), (0, 0)), mode='edge')
    cs = np.cumsum(pad, axis=1)
    out = (cs[:, width * 2:] - cs[:, :-width * 2]) / (width * 2)
    return out[:, :W].astype(np.uint8)


def whip(a, b, k, direction=-1):
    """Whip pan, k runs 0..1: the view slides from A to B with a heavy smear in the middle"""
    e = k * k * (3 - 2 * k)
    if direction < 0:          # A leaves to the left, B comes from the right
        canvas, x0 = np.concatenate([a, b], axis=1), int(e * W)
    else:                      # A leaves to the right, B comes from the left
        canvas, x0 = np.concatenate([b, a], axis=1), int((1 - e) * W)
    return hblur(canvas[:, x0:x0 + W], 6 + 260 * math.sin(math.pi * k))


def shanyrak(r, rot=0.0, lattice=1.0, width=None):
    """The crown of a yurt as a gold drawing: ring, crossed bars inside, short poles outside"""
    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    if r <= 2:
        return layer
    d = ImageDraw.Draw(layer)
    cx, cy = W / 2, H / 2
    lw = width or max(6, int(r * 0.07))
    # poles (uyk) around the ring
    for i in range(24):
        t = rot + i * math.tau / 24
        x1, y1 = cx + math.cos(t) * (r + lw * 0.4), cy + math.sin(t) * (r + lw * 0.4)
        x2, y2 = cx + math.cos(t) * r * 1.32, cy + math.sin(t) * r * 1.32
        d.line([(x1, y1), (x2, y2)], fill=GOLD + (230,), width=max(3, lw // 2))
    # the crossed bars (kuldyrausha), clipped to the ring
    if lattice > 0.01:
        bars = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        bd = ImageDraw.Draw(bars)
        for sign in (-1, 1):
            for off in (-0.42, 0, 0.42):
                t = rot + (math.pi / 4) * sign
                ux, uy = math.cos(t), math.sin(t)
                px, py = -uy, ux
                ox, oy = cx + px * off * r, cy + py * off * r
                bd.line([(ox - ux * r, oy - uy * r), (ox + ux * r, oy + uy * r)],
                        fill=GOLD + (int(235 * lattice),), width=max(4, int(lw * 0.75)))
        mask = Image.new('L', (W, H), 0)
        ImageDraw.Draw(mask).ellipse([cx - r, cy - r, cx + r, cy + r], fill=255)
        bars.putalpha(ImageChops.multiply(bars.getchannel('A'), mask))
        layer.alpha_composite(bars)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=GOLD + (255,), width=lw)
    shadow = layer.filter(ImageFilter.GaussianBlur(10))
    out = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    out.alpha_composite(Image.merge('RGBA', (*[Image.new('L', (W, H), 0)] * 3, shadow.split()[3].point(lambda v: v * 0.6))))
    out.alpha_composite(layer)
    return out


def burst(a, b, k):
    """«Тапсыр!» → the ride: B opens inside a growing shanyrak over A"""
    r = ease_in(k) * 1250 + 30 * k
    mask = Image.new('L', (W, H), 0)
    ImageDraw.Draw(mask).ellipse([W / 2 - r, H / 2 - r, W / 2 + r, H / 2 + r], fill=255)
    mask = np.asarray(mask.filter(ImageFilter.GaussianBlur(3)), np.float32)[..., None] / 255
    bz = np.asarray(scaled(Image.fromarray(b), 1.18 - 0.18 * ease_out(k), W / 2, H / 2), np.float32)
    mix = np.asarray(a, np.float32) * (1 - mask) + bz * mask
    img = Image.fromarray(mix.astype(np.uint8)).convert('RGBA')
    img.alpha_composite(shanyrak(r, rot=k * 0.9, lattice=max(0.0, 1 - k * 1.4)))
    return np.asarray(img.convert('RGB'))


def leak(a, b, k):
    """Warm light sweeping across while A dissolves into B"""
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    cx, cy = -300 + k * (W + 600), H * (0.25 + 0.3 * k)
    glow = np.exp(-(((xx - cx) / 520) ** 2 + ((yy - cy) / 900) ** 2))[..., None]
    color = np.array([255, 170, 90], np.float32)
    amount = math.sin(math.pi * k)
    mix = np.asarray(a, np.float32) * (1 - ease_out(k)) + np.asarray(b, np.float32) * ease_out(k)
    mix = mix + glow * color * 0.85 * amount + 40 * amount
    return np.clip(mix, 0, 255).astype(np.uint8)
