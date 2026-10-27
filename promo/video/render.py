#!/usr/bin/env python3
"""Renders the Tapsyr promo video (1080x1920, 30 fps, under 60 s).

Pictures: the app's own store screenshots (store/kk/phone-screenshots), its icon and photos,
and the app-styled pieces from overlays.py. Sound: the Kazakh narration (one file per line,
01..10), the app's dombra notification sound and the music/effects from audio.py.
Subtitles are the Russian lines from promo/voice/lines.json.

Usage:
  python3 promo/video/render.py --voice DIR --overlays DIR --out FILE.mp4
  python3 promo/video/render.py ... --stills 1.0,5.5,9   (PNG frames instead of the video)
"""

import argparse
import json
import math
import pathlib
import re
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(HERE))
import audio as AU  # noqa: E402

W, H, FPS = 1080, 1920, 30
SR = AU.SR
FONTS = pathlib.Path("/usr/share/fonts/opentype/inter")
F_BLACK = FONTS / "InterDisplay-Black.otf"
F_XBOLD = FONTS / "InterDisplay-ExtraBold.otf"
F_BOLD = FONTS / "Inter-Bold.otf"
F_SEMI = FONTS / "Inter-SemiBold.otf"
WHITE = (255, 255, 255)
YELLOW = (253, 224, 71)
NAVY = (11, 26, 66)
SKY = (14, 165, 233)

LINES = json.loads((REPO / "promo/voice/lines.json").read_text(encoding="utf-8"))["lines"]

# ---------------------------------------------------------------- helpers

_fonts = {}


def font(path, size):
    key = (str(path), size)
    if key not in _fonts:
        _fonts[key] = ImageFont.truetype(str(path), size)
    return _fonts[key]


def clamp(x, a=0.0, b=1.0):
    return max(a, min(b, x))


def prog(t, a, b):
    if b <= a:
        return 1.0 if t >= a else 0.0
    return clamp((t - a) / (b - a))


def e_out(x):
    return 1 - (1 - x) ** 3


def e_inout(x):
    return x * x * (3 - 2 * x)


def e_back(x, s=1.6):
    x -= 1
    return 1 + (s + 1) * x ** 3 + s * x ** 2


def fade(t, start, end, fin=0.3, fout=0.2):
    """1 inside [start, end], ramps at both ends."""
    return min(prog(t, start, start + fin), 1 - prog(t, end - fout, end))


def rmask(w, h, r, ss=3):
    m = Image.new("L", (w * ss, h * ss), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, w * ss - 1, h * ss - 1), r * ss, fill=255)
    return m.resize((w, h), Image.LANCZOS)


def shadow_of(mask, blur, opacity, pad, color=(4, 14, 44)):
    w, h = mask.size
    s = Image.new("L", (w + 2 * pad, h + 2 * pad), 0)
    s.paste(mask, (pad, pad))
    s = s.filter(ImageFilter.GaussianBlur(blur)).point(lambda v: int(v * opacity))
    img = Image.new("RGBA", s.size, color + (0,))
    img.putalpha(s)
    return img


def with_alpha(img, a):
    if a >= 0.999:
        return img
    out = img.copy()
    out.putalpha(img.getchannel("A").point(lambda v: int(v * a)))
    return out


def paste(canvas, img, x, y, a=1.0):
    if a <= 0.004 or img is None:
        return
    img = with_alpha(img, a)
    canvas.paste(img, (int(round(x)), int(round(y))), img)


def scaled(img, s):
    if abs(s - 1) < 1e-3:
        return img
    w, h = img.size
    return img.resize((max(1, int(w * s)), max(1, int(h * s))), Image.BICUBIC)


def paste_center(canvas, img, cx, cy, a=1.0, s=1.0):
    im = scaled(img, s)
    paste(canvas, im, cx - im.width / 2, cy - im.height / 2, a)


def rgba_rect(w, h, r, fill):
    img = Image.new("RGBA", (w, h), fill[:3] + (0,))
    a = fill[3] if len(fill) == 4 else 255
    img.putalpha(rmask(w, h, r).point(lambda v: int(v * a / 255)))
    return img


def cover(img, w, h, zoom=1.0, fx=0.5, fy=0.5):
    """Crop `img` to fill w x h (like CSS cover), zoomed in by `zoom` around (fx, fy)."""
    iw, ih = img.size
    s = max(w / iw, h / ih) * zoom
    cw, ch = w / s, h / s
    x0 = clamp(fx * iw - cw / 2, 0, iw - cw)
    y0 = clamp(fy * ih - ch / 2, 0, ih - ch)
    return img.resize((w, h), Image.BICUBIC, box=(x0, y0, x0 + cw, y0 + ch))


# ---------------------------------------------------------------- text

class Text:
    """A block of centred text; words between *stars* are drawn in yellow."""

    PAD = 34

    def __init__(self, markup, path=F_BLACK, size=74, maxw=960, color=WHITE, accent=YELLOW,
                 lh=1.1, shadow=0.45):
        f = font(path, size)
        tokens, acc = [], False
        for raw in markup.split():
            if raw.startswith("*"):
                acc = True
            tokens.append((raw.replace("*", ""), acc))
            if "*" in raw[1:]:
                acc = False
        space = f.getlength(" ")
        lines, cur, cw = [], [], 0.0
        for word, a in tokens:
            ww = f.getlength(word)
            if cur and cw + space + ww > maxw:
                lines.append(cur)
                cur, cw = [], 0.0
            cw = cw + (space if cur else 0) + ww
            cur.append((word, a, ww))
        if cur:
            lines.append(cur)
        line_h = int(size * lh)
        pad = self.PAD
        self.w, self.h = maxw + 2 * pad, line_h * len(lines) + int(size * 0.3) + 2 * pad
        self.words = []
        y = pad
        for line in lines:
            lw = sum(w for _, _, w in line) + space * (len(line) - 1)
            x = pad + (maxw - lw) / 2
            for word, a, ww in line:
                self.words.append((word, a, x, y, ww))
                x += ww + space
            y += line_h
        self.f, self.size, self.color, self.accent, self.shadow = f, size, color, accent, shadow
        self.line_h = line_h
        self.img = self._render(self.words, (self.w, self.h))
        self._word_imgs = None

    def _render(self, words, size, offset=(0, 0)):
        img = Image.new("RGBA", size, (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        for word, a, x, y, _ in words:
            d.text((x - offset[0], y - offset[1]), word, font=self.f, fill=self.accent if a else self.color)
        if not self.shadow:
            return img
        sh = img.getchannel("A").filter(ImageFilter.GaussianBlur(9)).point(lambda v: int(v * self.shadow))
        base = Image.new("RGBA", size, (4, 16, 52, 0))
        base.putalpha(sh)
        out = Image.new("RGBA", size, (0, 0, 0, 0))
        out.paste(base, (0, 5), base)
        return Image.alpha_composite(out, img)

    def word_imgs(self):
        if self._word_imgs is None:
            self._word_imgs = []
            for word in self.words:
                _, _, x, y, ww = word
                p = 26
                box = (int(x) - p, int(y) - p, int(x + ww) + p, int(y + self.line_h) + p)
                img = self._render([word], (box[2] - box[0], box[3] - box[1]), (box[0], box[1]))
                self._word_imgs.append((img, box))
        return self._word_imgs

    def draw(self, cv, cx, top, a=1.0, dy=0.0, s=1.0):
        if s == 1.0:
            paste(cv, self.img, cx - self.w / 2, top - self.PAD + dy, a)
        else:
            paste_center(cv, self.img, cx, top - self.PAD + self.h / 2 + dy, a, s)

    def draw_words(self, cv, cx, top, times, t, a=1.0):
        ox, oy = cx - self.w / 2, top - self.PAD
        for (img, box), t0 in zip(self.word_imgs(), times):
            p = prog(t, t0, t0 + 0.24)
            if p <= 0:
                continue
            s = 0.6 + 0.4 * e_back(p)
            paste_center(cv, img, ox + (box[0] + box[2]) / 2, oy + (box[1] + box[3]) / 2, a * min(1, p * 2), s)


class Subtitle:
    def __init__(self, text):
        f = font(F_BOLD, 44)
        maxw = 820
        words, lines, cur = text.split(), [], ""
        for w in words:
            test = (cur + " " + w).strip()
            if cur and f.getlength(test) > maxw:
                lines.append(cur)
                cur = w
            else:
                cur = test
        lines.append(cur)
        lh = 58
        tw = max(f.getlength(l) for l in lines)
        bw, bh = int(tw + 64), int(lh * len(lines) + 30)
        img = rgba_rect(bw, bh, 30, (8, 20, 56, 214))
        d = ImageDraw.Draw(img)
        for i, l in enumerate(lines):
            d.text(((bw - f.getlength(l)) / 2, 13 + i * lh), l, font=f, fill=WHITE)
        self.img = img

    def draw(self, cv, a=1.0, cy=1548):
        paste_center(cv, self.img, W / 2, cy, a)


# ---------------------------------------------------------------- phone

BEZ = 18
SW, SH = 664, 1437
PW, PH = SW + 2 * BEZ, SH + 2 * BEZ
OV = (1.0, 0.0, 0.0, 208.0, 488.0)  # (scale, screen x, screen y, frame x, frame y)


class Phone:
    def __init__(self):
        outer = rmask(PW, PH, 88)
        base = Image.new("RGBA", (PW, PH), (17, 21, 33, 0))
        base.putalpha(outer)
        d = ImageDraw.Draw(base)
        d.rounded_rectangle((2, 2, PW - 3, PH - 3), 86, outline=(62, 70, 92, 255), width=3)
        self.base = base
        self.screen_mask = rmask(SW, SH, 70)
        self.shadow = shadow_of(outer, 34, 0.5, 90)
        self._cache = {}

    def draw(self, cv, screen, pose, off=(0.0, 0.0)):
        k, sx, sy, fx, fy = pose
        img = self.base.copy()
        img.paste(screen, (BEZ, BEZ), self.screen_mask)
        key = round(k, 3)
        if key not in self._cache:
            self._cache = {key: scaled(self.shadow, k)}
        sh = self._cache[key]
        img = scaled(img, k)
        x = fx - k * (BEZ + sx) + off[0]
        y = fy - k * (BEZ + sy) + off[1]
        paste(cv, sh, x - 90 * k, y - 90 * k + 26 * k)
        paste(cv, img, x, y)


def pose_at(keys, t):
    if t <= keys[0][0]:
        return keys[0][1]
    for (t0, p0), (t1, p1) in zip(keys, keys[1:]):
        if t <= t1:
            u = e_inout(prog(t, t0, t1))
            return tuple(a + (b - a) * u for a, b in zip(p0, p1))
    return keys[-1][1]


def push(prev, new, p):
    """App-style navigation: the new screen slides in from the right."""
    if prev is None or p >= 1:
        return new
    p = e_out(p)
    out = Image.new("RGB", (SW, SH))
    out.paste(prev, (int(-0.3 * SW * p), 0))
    dim = Image.new("RGB", (SW, SH), (0, 0, 0))
    out = Image.blend(out, dim, 0.25 * p)
    out.paste(new, (int(SW * (1 - p)), 0))
    return out


def overlay_draw(screen, draw_fn):
    layer = Image.new("RGBA", (SW, SH), (0, 0, 0, 0))
    draw_fn(ImageDraw.Draw(layer), layer)
    return Image.alpha_composite(screen.convert("RGBA"), layer).convert("RGB")


def highlight(d, box, a, s=1.0):
    if a <= 0.01:
        return
    x0, y0, x1, y1 = box
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    hw, hh = (x1 - x0) / 2 * s + 10, (y1 - y0) / 2 * s + 10
    d.rounded_rectangle((cx - hw, cy - hh, cx + hw, cy + hh), 22, fill=SKY + (int(34 * a),),
                        outline=SKY + (int(255 * a),), width=5)


def ripple(d, x, y, p):
    if p <= 0 or p >= 1:
        return
    r = 18 + 70 * e_out(p)
    d.ellipse((x - r, y - r, x + r, y + r), fill=(255, 255, 255, int(120 * (1 - p))))
    r2 = 26
    d.ellipse((x - r2, y - r2, x + r2, y + r2), fill=(15, 23, 42, int(70 * (1 - p))))


# ---------------------------------------------------------------- assets

class Assets:
    def __init__(self, ov_dir):
        def screen(lang, n):
            im = Image.open(REPO / f"store/{lang}/phone-screenshots/{n}.jpg").convert("RGB")
            return im.crop((208, 409, 872, 1846))
        self.scr = {n: screen("kk", n) for n in range(1, 7)}
        self.scr_ru1 = screen("ru-RU", 1)
        photo = lambda n: Image.open(REPO / f"public/img/photo/{n}.webp").convert("RGB")
        self.photo = {n: photo(n) for n in ("s_plumbing_repair", "role_customer", "role_master")}
        self.groups = [photo(p.stem) for p in sorted((REPO / "public/img/photo").glob("g_*.webp"))]
        self.icon = Image.open(REPO / "store/icon.png").convert("RGBA")
        ov = pathlib.Path(ov_dir)
        self.ov = {p.stem: Image.open(p).convert("RGBA") for p in ov.glob("*.png")}
        self.typed_steps = len([k for k in self.ov if k.startswith("card_type_") and k[-2:].isdigit()])


# ---------------------------------------------------------------- narration

def decode(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"],
                         check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).astype(np.float64)


def trim(x, thr_db=-42, margin=0.04):
    frame = int(0.01 * SR)
    n = len(x) // frame
    e = np.sqrt(np.mean(x[: n * frame].reshape(n, frame) ** 2, axis=1) + 1e-12)
    voiced = np.where(20 * np.log10(e / (e.max() + 1e-12)) > thr_db)[0]
    s = max(0, voiced[0] * frame - int(margin * SR))
    t = min(len(x), (voiced[-1] + 1) * frame + int(margin * SR))
    return x[s:t]


def sentences(text):
    return [s.strip() for s in re.findall(r"[^.!?]+[.!?]?", text) if s.strip()]


def sentence_spans(x, n):
    frame = int(0.01 * SR)
    m = len(x) // frame
    e = np.sqrt(np.mean(x[: m * frame].reshape(m, frame) ** 2, axis=1) + 1e-12)
    voiced = e > e.max() * 0.05
    first = int(np.argmax(voiced))
    last = int(m - 1 - np.argmax(voiced[::-1]))
    runs, i = [], first
    while i < last:
        if not voiced[i]:
            j = i
            while j < last and not voiced[j]:
                j += 1
            runs.append((i, j))
            i = j
        else:
            i += 1
    cuts = sorted(sorted(runs, key=lambda r: r[1] - r[0], reverse=True)[: max(0, n - 1)])
    spans, s = [], first
    for a, b in cuts:
        spans.append((s * 0.01, a * 0.01))
        s = b
    spans.append((s * 0.01, (last + 1) * 0.01))
    return spans


def word_times(sentence, span):
    words = sentence.split()
    weights = np.array([len(re.sub(r"[^\w]", "", w)) + 2 for w in words], dtype=float)
    starts = np.concatenate([[0], np.cumsum(weights)[:-1]]) / weights.sum()
    return [span[0] + (span[1] - span[0]) * s for s in starts]


# ---------------------------------------------------------------- scenes

class Scene:
    lead, tail = 0.3, 0.55
    phone_keys = None  # list of (t, pose) when the phone is on screen; first pose may be "PREV"

    def __init__(self, idx, voice, assets):
        self.idx = idx
        self.A = assets
        line = LINES[idx - 1]
        self.kk, self.ru = line["kk"], line["ru"]
        self.voice = voice
        self.vlen = len(voice) / SR
        kk_s, ru_s = sentences(self.kk), sentences(self.ru)
        spans = sentence_spans(voice, len(kk_s))
        self.a0 = self.lead + self.pre()
        self.spans = [(s + self.a0, e + self.a0) for s, e in spans]
        self.kk_s = kk_s
        if len(ru_s) == len(kk_s):
            self.subs = [(Subtitle(r), s, e) for r, (s, e) in zip(ru_s, self.spans)]
        else:
            self.subs = [(Subtitle(self.ru), self.spans[0][0], self.spans[-1][1])]
        self.dur = self.a0 + self.vlen + self.tail + self.post()
        self.sfx = []
        self.prev = None

    def pre(self):
        return 0.0

    def post(self):
        return 0.0

    def span(self, i):
        return self.spans[min(i, len(self.spans) - 1)]

    def draw_subs(self, cv, t):
        if not getattr(self, "show_subs", True):
            return
        for i, (sub, s, e) in enumerate(self.subs):
            end = self.subs[i + 1][1] - 0.05 if i + 1 < len(self.subs) else min(self.dur, e + 0.45)
            a = fade(t, s - 0.12, end, 0.12, 0.12)
            if a > 0:
                sub.draw(cv, a)

    def headline(self, cv, t, text, start, end, top=150, size=74):
        a = fade(t, start, end, 0.3, 0.2)
        if a > 0:
            text.draw(cv, W / 2, top, a, dy=26 * (1 - e_out(prog(t, start, start + 0.35))))

    # phone scenes override these
    def screen(self, t):
        return None

    def final_pose(self):
        return self.phone_keys[-1][1] if self.phone_keys else None

    def draw(self, cv, t, phone):
        pass


SCRIM = None


def top_scrim(bg):
    global SCRIM
    if SCRIM is None:
        part = bg.crop((0, 0, W, 470)).convert("RGBA")
        a = np.clip((450 - np.arange(470)) / 200.0, 0, 1)
        a = np.where(np.arange(470) < 250, 1.0, a)
        alpha = Image.fromarray((np.repeat(a[:, None], W, axis=1) * 255).astype(np.uint8))
        part.putalpha(alpha)
        SCRIM = part
    return SCRIM


class S1(Scene):
    """Hook: something broke at home."""

    def __init__(self, *a):
        super().__init__(*a)
        self.h = [Text(s, size=86) for s in ("Үйде бірдеңе *бұзылды* ма?", "Шеберді *таныс* арқылы іздемеңіз")]
        self.times = [word_times(s, sp) for s, sp in zip(self.kk_s, self.spans)]
        self.card_mask = rmask(860, 860, 52)
        self.card_shadow = shadow_of(self.card_mask, 30, 0.45, 70)
        self.sfx = [(0.05, "drip", 0.5), (0.5, "drip", 0.4), (self.span(1)[0] - 0.25, "whoosh", 0.35)]

    def draw(self, cv, t, phone):
        out = 1 - prog(t, self.dur - 0.25, self.dur)
        swap = self.span(1)[0] - 0.12
        pin = e_out(prog(t, 0, 0.5))
        for name, a_fn, z0 in (("s_plumbing_repair", lambda: 1.0, 1.0), ("role_customer", lambda: prog(t, swap, swap + 0.35), 1.08)):
            a = a_fn() * pin * out
            if a <= 0:
                continue
            zoom = z0 + 0.10 * prog(t, 0, self.dur) if name == "s_plumbing_repair" else 1.08 - 0.06 * prog(t, swap, self.dur)
            img = cover(self.A.photo[name], 860, 860, zoom, 0.5, 0.45).convert("RGBA")
            img.putalpha(self.card_mask)
            s = 0.92 + 0.08 * pin
            paste_center(cv, self.card_shadow, 540, 990 + 20, a * 0.9, s)
            paste_center(cv, img, 540, 990, a, s)
        a1 = out * (1 - prog(t, swap - 0.1, swap + 0.1))
        if a1 > 0:
            self.h[0].draw_words(cv, W / 2, 200, self.times[0], t, a1)
        if t >= swap - 0.05:
            self.h[1].draw_words(cv, W / 2, 200, self.times[1], t, out)
        self.draw_subs(cv, t)


class S2(Scene):
    """Brand: Tapsyr - Kyzylorda's masters in one app."""

    def post(self):
        return 0.3

    def __init__(self, *a):
        super().__init__(*a)
        self.icon_big = self.A.icon.resize((300, 300), Image.LANCZOS)
        self.icon_small = self.A.icon.resize((112, 112), Image.LANCZOS)
        self.word_big = Text("Tapsyr", size=150, maxw=800)
        self.sub = Text("Қызылорданың шеберлері — бір қосымшада", path=F_SEMI, size=44, maxw=900)
        self.word_small = Text("Tapsyr", size=92, maxw=420)
        glow = Image.new("L", (520, 520), 0)
        ImageDraw.Draw(glow).ellipse((60, 60, 460, 460), fill=255)
        self.glow = Image.new("RGBA", (520, 520), (255, 255, 255, 0))
        self.glow.putalpha(glow.filter(ImageFilter.GaussianBlur(60)).point(lambda v: int(v * 0.55)))
        self.switch = 1.45
        self.phone_keys = [(0.0, (1.0, 0, 0, 208, 488 + 1500)), (self.switch, (1.0, 0, 0, 208, 488 + 1500)),
                           (self.switch + 0.7, OV)]
        self.sfx = [(0.05, "chime", 0.45), (self.switch, "whoosh", 0.35)]

    def screen(self, t):
        return self.A.scr[1]

    def draw(self, cv, t, phone):
        sw = self.switch
        p_out = e_inout(prog(t, sw - 0.1, sw + 0.35))
        pop = prog(t, 0.0, 0.5)
        a = (1 - p_out)
        if a > 0:
            paste_center(cv, self.glow, 540, 720, a * min(1, pop * 2) * (0.8 + 0.2 * math.sin(t * 3)))
            paste_center(cv, self.icon_big, 540, 720 - 160 * p_out, a * min(1, pop * 2), (0.5 + 0.5 * e_back(pop)) * (1 - 0.4 * p_out))
            self.word_big.draw(cv, W / 2, 900 - 160 * p_out, a * prog(t, 0.2, 0.5), dy=30 * (1 - e_out(prog(t, 0.2, 0.55))))
            self.sub.draw(cv, W / 2, 1075 - 160 * p_out, a * prog(t, 0.45, 0.75))
        b = prog(t, sw + 0.1, sw + 0.45)
        if b > 0:
            dy = 24 * (1 - e_out(b))
            total = 112 + 22 + self.word_small.f.getlength("Tapsyr")
            x0 = 540 - total / 2
            paste(cv, self.icon_small, x0, 150 + dy, b)
            paste(cv, self.word_small.img, x0 + 134 - Text.PAD - (self.word_small.w - 2 * Text.PAD - self.word_small.f.getlength("Tapsyr")) / 2,
                  150 - Text.PAD + 2 + dy, b)
            self.sub.draw(cv, W / 2, 292 + dy, b)
        self.draw_subs(cv, t)


class PhoneScene(Scene):
    screen_no = 1

    def base_screen(self, t):
        return self.A.scr[self.screen_no]

    def decorate(self, img, t):
        return img

    def screen(self, t):
        img = self.decorate(self.base_screen(t), t)
        if self.prev is not None and t < 0.4 and getattr(self, "push_in", True):
            img = push(self.prev, img, prog(t, 0.0, 0.4))
        return img


class S3(PhoneScene):
    """Describe the problem in your own words: typing, voice, photo and video."""

    def post(self):
        return 0.35

    def __init__(self, *a):
        super().__init__(*a)
        self.push_in = False
        sp = self.span(0)
        L = sp[1] - sp[0]
        self.t_scroll = (0.0, 0.5)
        self.t_type = (0.55, sp[0] + 0.45 * L)
        self.t_rec = (self.t_type[1] + 0.05, sp[0] + 0.86 * L)
        self.t_att = self.t_rec[1] + 0.05
        self.t_press = self.dur - 0.32
        self.t_anal = self.dur - 0.18
        self.h = Text("Мәселені *өз сөзіңізбен* жазыңыз")
        self.page_top = self.A.scr[1].crop((0, 95, SW, 1322))
        self.nav = self.A.scr[1].crop((0, 1322, SW, SH))
        self.header = self.A.scr[1].crop((0, 0, SW, 95))
        self.phone_keys = [(0.0, "PREV"), (self.dur, OV)]
        n = self.A.typed_steps
        step = (self.t_type[1] - self.t_type[0]) / max(1, n)
        self.sfx = [(self.t_type[0] + i * step, "tick", 0.25) for i in range(0, n, 2)]
        self.sfx += [(self.t_rec[0], "pop", 0.35), (self.t_att, "pop", 0.45), (self.t_press, "tick", 0.5)]

    def card(self, t):
        ov = self.A.ov
        if t < self.t_type[0]:
            return ov["card_type_00"]
        if t < self.t_type[1]:
            n = self.A.typed_steps
            i = min(n - 1, int(prog(t, *self.t_type) * n))
            return ov[f"card_type_{i:02d}"]
        if t < self.t_rec[1]:
            r = 1 + min(3, int((t - self.t_rec[0]) / max(0.2, (self.t_rec[1] - self.t_rec[0]) / 4)))
            return ov[f"card_rec_{r}"]
        if t < self.t_press:
            return ov["card_att"]
        if t < self.t_anal:
            return ov["card_press"]
        return ov["card_analyzing"]

    def base_screen(self, t):
        card = self.card(t)
        page_h = self.page_top.height + 24 + card.height + 400
        page = Image.new("RGB", (SW, page_h), (255, 255, 255))
        page.paste(self.page_top, (0, 0))
        y_card = self.page_top.height + 24
        page.paste(card, (0, y_card), card)
        scroll = (y_card - 16) * e_inout(prog(t, *self.t_scroll))
        view_h = 1322 - 95
        img = Image.new("RGB", (SW, SH), (255, 255, 255))
        img.paste(page.crop((0, int(scroll), SW, int(scroll) + view_h)), (0, 95))
        img.paste(self.header, (0, 0))
        img.paste(self.nav, (0, 1322))
        return img

    def draw(self, cv, t, phone):
        self.headline(cv, t, self.h, 0.0, self.dur + 0.3)
        self.draw_subs(cv, t)


class S4(PhoneScene):
    """Tapsyr understands and sends it to the right masters."""
    screen_no = 2
    ROWS = [(30, 455, 634, 535), (30, 545, 634, 625), (30, 635, 634, 715), (30, 720, 634, 805),
            (30, 810, 634, 895), (30, 900, 634, 990)]

    def __init__(self, *a):
        super().__init__(*a)
        self.h = Text("Тапсыр *түсініп*, шеберлерге жібереді")
        self.phone_keys = [(0.0, "PREV"), (0.35, OV), (0.85, (1.14, 332, 720, 540, 1010)), (self.dur, (1.14, 332, 720, 540, 1010))]
        sp = self.span(0)
        self.row_t = [0.55 + i * (sp[1] - 0.55) / len(self.ROWS) for i in range(len(self.ROWS))]
        self.sfx = [(0.0, "whoosh", 0.25)] + [(x, "pop", 0.12) for x in self.row_t]

    def decorate(self, img, t):
        def f(d, layer):
            for i, (box, t0) in enumerate(zip(self.ROWS, self.row_t)):
                t1 = self.row_t[i + 1] if i + 1 < len(self.row_t) else self.dur
                a = fade(t, t0, t1 + 0.15, 0.12, 0.2)
                highlight(d, box, a, 0.96 + 0.04 * e_out(prog(t, t0, t0 + 0.2)))
        return overlay_draw(img, f)

    def draw(self, cv, t, phone):
        self.headline(cv, t, self.h, 0.0, self.dur + 0.3)
        self.draw_subs(cv, t)


class S5(PhoneScene):
    """Masters offer their price; compare and choose."""
    screen_no = 3
    COUNT = (330, 392, 520, 446)
    PRICES = [(488, 848, 620, 900), (488, 1272, 620, 1324)]
    TIME = (140, 918, 365, 962)
    NAME = (140, 852, 400, 916)
    ACCEPT = (56, 1071, 324, 1146)

    def __init__(self, *a):
        super().__init__(*a)
        self.h1 = Text("Шеберлер *бағасын* өзі ұсынады")
        self.h2 = Text("Салыстырып, *ұнағанын* таңдаңыз")
        s0, s1 = self.span(0), self.span(1)
        focus = (1.1, 332, 1010, 540, 1060)
        self.t_move = s0[0] + 0.7
        self.phone_keys = [(0.0, "PREV"), (0.35, OV), (self.t_move, OV), (self.t_move + 0.6, focus), (self.dur, focus)]
        self.t_price = self.t_move + 0.55
        self.t_cmp = s1[0] + 0.1
        self.t_tap = s1[1] - 0.25
        self.sfx = [(0.0, "whoosh", 0.25), (0.6, "pop", 0.15), (self.t_price, "pop", 0.3), (self.t_cmp, "pop", 0.2),
                    (self.t_tap, "tick", 0.6)]

    def decorate(self, img, t):
        def f(d, layer):
            highlight(d, self.COUNT, fade(t, 0.55, self.t_move + 0.2, 0.15, 0.2))
            for box in self.PRICES:
                highlight(d, box, fade(t, self.t_price, self.t_cmp + 0.1, 0.15, 0.2), 0.95 + 0.05 * e_back(prog(t, self.t_price, self.t_price + 0.3)))
            highlight(d, self.NAME, fade(t, self.t_cmp, self.t_tap, 0.15, 0.2))
            highlight(d, self.TIME, fade(t, self.t_cmp + 0.15, self.t_tap, 0.15, 0.2))
            if t >= self.t_tap:
                p = prog(t, self.t_tap, self.t_tap + 0.5)
                x0, y0, x1, y1 = self.ACCEPT
                if p < 0.6:
                    d.rounded_rectangle(self.ACCEPT, 18, fill=(0, 0, 0, int(50 * (1 - p / 0.6))))
                ripple(d, (x0 + x1) / 2, (y0 + y1) / 2, p)
        return overlay_draw(img, f)

    def draw(self, cv, t, phone):
        sw = self.span(1)[0] - 0.1
        self.headline(cv, t, self.h1, 0.0, sw)
        self.headline(cv, t, self.h2, sw, self.dur + 0.3)
        self.draw_subs(cv, t)


class S6(PhoneScene):
    """Chat with the master; your number stays hidden."""
    screen_no = 4
    BUBBLES = [((222, 293, 641, 408), "r"), ((22, 418, 480, 532), "l"), ((412, 541, 641, 655), "r")]

    def __init__(self, *a):
        super().__init__(*a)
        self.h1 = Text("Шебермен *тікелей* сөйлесіңіз")
        self.h2 = Text("Нөміріңіз *жасырын*")
        base = self.A.scr[4].copy()
        d = ImageDraw.Draw(base)
        for box, _ in self.BUBBLES:
            d.rectangle(box, fill=(249, 250, 252))
        self.empty = base
        self.crops = [self.A.scr[4].crop(box) for box, _ in self.BUBBLES]
        self.bt = [0.35, 0.95, 1.55]
        self.t_badge = self.span(1)[0] - 0.15
        focus = (1.1, 332, 520, 540, 960)
        self.phone_keys = [(0.0, "PREV"), (0.35, OV), (0.75, focus), (self.dur, focus)]
        self.sfx = [(0.0, "whoosh", 0.25)] + [(x, "blip", 0.35) for x in self.bt] + [(self.t_badge, "pop", 0.5)]
        self.badge = self.A.ov["privacy"]

    def base_screen(self, t):
        img = self.empty.copy()
        for (box, side), crop, t0 in zip(self.BUBBLES, self.crops, self.bt):
            p = prog(t, t0, t0 + 0.28)
            if p <= 0:
                continue
            s = 0.7 + 0.3 * e_back(p)
            c = scaled(crop, s)
            x = box[2] - c.width if side == "r" else box[0]
            y = box[3] - c.height
            mask = Image.new("L", c.size, int(255 * min(1, p * 1.5)))
            img.paste(c, (x, y), mask)
        if t >= self.t_badge:
            p = prog(t, self.t_badge, self.t_badge + 0.35)
            img = Image.blend(img, Image.new("RGB", img.size, (15, 23, 42)), 0.45 * min(1, p * 1.5))
            b = scaled(self.badge, 0.8 + 0.2 * e_back(p))
            mask = b.getchannel("A").point(lambda v: int(v * min(1, p * 2)))
            img.paste(b, (int(SW / 2 - b.width / 2), int(560 - b.height / 2)), mask)
        return img

    def draw(self, cv, t, phone):
        self.headline(cv, t, self.h1, 0.0, self.t_badge)
        self.headline(cv, t, self.h2, self.t_badge, self.dur + 0.3)
        self.draw_subs(cv, t)


class S7(PhoneScene):
    """Are you a master? Orders come to your phone with the dombra sound."""
    screen_no = 5
    JOB = (18, 470, 646, 830)

    def post(self):
        return 1.45

    def __init__(self, *a):
        super().__init__(*a)
        self.push_in = False
        self.h1 = Text("*Шеберсіз* бе?", size=124)
        self.h2 = Text("Тапсырыстар *өзі келеді*")
        s0, s1 = self.span(0), self.span(1)
        self.times = word_times(self.kk_s[0], s0)
        self.t_switch = s1[0] - 0.2
        self.t_n1 = s1[1] + 0.05
        self.t_n2 = self.t_n1 + 0.95
        low = (1.0, 0, 0, 208, 488 + 1550)
        self.phone_keys = [(0.0, "PREV"), (0.35, ("PREV_LOW",)), (self.t_switch, low), (self.t_switch + 0.55, OV), (self.dur, OV)]
        self.card_mask = rmask(800, 800, 52)
        self.card_shadow = shadow_of(self.card_mask, 30, 0.45, 70)
        self.sfx = [(0.0, "whoosh", 0.3), (self.t_switch, "whoosh", 0.3), (self.t_n1, "dombra", 0.9), (self.t_n2, "dombra", 0.75)]

    def screen(self, t):
        if t < self.t_switch - 0.1 and self.prev is not None:
            return self.prev  # the chat phone leaves first
        return super().screen(t)

    def phone_off(self, t):
        if self.t_n1 <= t < self.t_n1 + 0.5:
            p = prog(t, self.t_n1, self.t_n1 + 0.5)
            return (9 * math.sin(p * 40) * (1 - p), 0)
        if self.t_n2 <= t < self.t_n2 + 0.5:
            p = prog(t, self.t_n2, self.t_n2 + 0.5)
            return (7 * math.sin(p * 40) * (1 - p), 0)
        return (0, 0)

    def base_screen(self, t):
        img = self.A.scr[5]
        def f(d, layer):
            highlight(d, self.JOB, fade(t, self.t_n1 + 0.4, self.dur + 1, 0.2, 0.2))
        img = overlay_draw(img, f)
        for t0, name in ((self.t_n1, "notif_1"), (self.t_n2, "notif_2")):
            if t < t0:
                continue
            n = self.A.ov[name]
            p_in = e_back(prog(t, t0, t0 + 0.4), 1.2)
            y = -n.height + (n.height + 6) * p_in
            if name == "notif_1" and t > self.t_n2 - 0.1:
                y -= (n.height + 20) * e_inout(prog(t, self.t_n2 - 0.1, self.t_n2 + 0.25))
            img.paste(n, (0, int(y)), n)
        return img

    def draw(self, cv, t, phone):
        pin = e_out(prog(t, 0.1, 0.55))
        pout = e_inout(prog(t, self.t_switch, self.t_switch + 0.45))
        a = pin * (1 - pout)
        if a > 0:
            img = cover(self.A.photo["role_master"], 800, 800, 1.04 + 0.06 * prog(t, 0, self.t_switch), 0.5, 0.42).convert("RGBA")
            img.putalpha(self.card_mask)
            cy = 1010 - 500 * pout
            paste_center(cv, self.card_shadow, 540, cy + 20, a * 0.9, 0.92 + 0.08 * pin)
            paste_center(cv, img, 540, cy, a, 0.92 + 0.08 * pin)
        ah = 1 - prog(t, self.t_switch - 0.15, self.t_switch + 0.1)
        if ah > 0:
            self.h1.draw_words(cv, W / 2, 210, self.times, t, ah)
        self.headline(cv, t, self.h2, self.t_switch, self.dur + 0.3)
        self.draw_subs(cv, t)


class S8(PhoneScene):
    """Set your own price and time."""
    screen_no = 6
    PRICE = (22, 732, 642, 805)
    TIME = (22, 860, 642, 935)
    SEND = (22, 1108, 642, 1192)

    def __init__(self, *a):
        super().__init__(*a)
        self.h = Text("Бағаны да, уақытты да *өзіңіз* белгілейсіз")
        s0 = self.span(0)
        focus = (1.1, 332, 720, 540, 1010)
        self.phone_keys = [(0.0, "PREV"), (0.35, OV), (0.85, focus), (self.dur, focus)]
        w = word_times(self.kk_s[0], s0)
        self.t_price = max(0.6, w[0])
        self.t_time = max(self.t_price + 0.5, w[2])
        self.t_tap = s0[1] - 0.05
        self.sfx = [(0.0, "whoosh", 0.25), (self.t_price, "pop", 0.25), (self.t_time, "pop", 0.25), (self.t_tap, "tick", 0.6)]

    def decorate(self, img, t):
        def f(d, layer):
            highlight(d, self.PRICE, fade(t, self.t_price, self.t_tap + 0.3, 0.15, 0.2))
            highlight(d, self.TIME, fade(t, self.t_time, self.t_tap + 0.3, 0.15, 0.2))
            if t >= self.t_tap:
                p = prog(t, self.t_tap, self.t_tap + 0.5)
                x0, y0, x1, y1 = self.SEND
                ripple(d, (x0 + x1) / 2, (y0 + y1) / 2, p)
        return overlay_draw(img, f)

    def draw(self, cv, t, phone):
        self.headline(cv, t, self.h, 0.0, self.dur + 0.3)
        self.draw_subs(cv, t)


class S9(Scene):
    """Free for both sides; 20 groups and 150+ services."""

    def post(self):
        return 0.35

    def __init__(self, *a):
        super().__init__(*a)
        s0 = self.span(0)
        w = word_times(self.kk_s[0], s0)
        self.t_p1, self.t_p2 = w[0], w[3]
        self.t_free = s0[1] - 0.42
        self.pill1 = self.pill("Өтініш беру")
        self.pill2 = self.pill("Тіркелу")
        self.free = Text("ТЕГІН", path=F_BLACK, size=230, maxw=1000, color=YELLOW, shadow=0.6)
        self.cap = Text("20 санат · 150+ қызмет", path=F_BOLD, size=50, maxw=900)
        tiles = []
        tm = rmask(200, 200, 30)
        for g in self.A.groups:
            t_img = cover(g, 200, 200).convert("RGBA")
            t_img.putalpha(tm)
            tiles.append(t_img)
        self.tiles = tiles
        self.phone_keys = [(0.0, "PREV"), (0.4, ("PREV_LOW",))]
        self.sfx = [(0.0, "whoosh", 0.3), (self.t_p1, "pop", 0.45), (self.t_p2, "pop", 0.45), (self.t_free, "stamp", 0.9)]

    @staticmethod
    def pill(text):
        f = font(F_BOLD, 56)
        w = int(f.getlength(text) + 80)
        img = rgba_rect(w, 104, 52, (255, 255, 255, 255))
        ImageDraw.Draw(img).text((40, 18), text, font=f, fill=NAVY)
        return img

    def draw(self, cv, t, phone):
        # dimmed wall of the 20 group photos, drifting up
        a_grid = 0.32 * prog(t, 0.0, 0.6) * (1 - prog(t, self.dur - 0.25, self.dur))
        if a_grid > 0:
            drift = 60 * prog(t, 0, self.dur)
            for i, tile in enumerate(self.tiles):
                r, c = divmod(i, 4)
                x = 540 - (4 * 200 + 3 * 18) / 2 + c * 218
                y = 330 + r * 218 - drift + (40 if c % 2 else 0)
                paste(cv, tile, x, y, a_grid)
        out = 1 - prog(t, self.dur - 0.25, self.dur)
        for img, t0, y in ((self.pill1, self.t_p1, 640), (self.pill2, self.t_p2, 770)):
            p = prog(t, t0, t0 + 0.3)
            if p > 0:
                paste_center(cv, img, 540, y, min(1, p * 2) * out, 0.7 + 0.3 * e_back(p))
        p = prog(t, self.t_free, self.t_free + 0.28)
        if p > 0:
            s = 1.6 - 0.6 * e_out(p)
            img = self.free.img.rotate(5, resample=Image.BICUBIC, expand=True)
            paste_center(cv, img, 540, 1040, min(1, p * 2.5) * out, s)
            self.cap.draw(cv, W / 2, 1210, prog(t, self.t_free + 0.3, self.t_free + 0.6) * out)
        self.draw_subs(cv, t)


class S10(Scene):
    """End card."""
    show_subs = False

    def post(self):
        return 2.0

    def __init__(self, *a):
        super().__init__(*a)
        self.icon = self.A.icon.resize((300, 300), Image.LANCZOS)
        self.word = Text("Tapsyr", size=150, maxw=800)
        self.slogan = Text("Тапсыр да, *демал!*", size=84, maxw=980)
        self.ru_slogan = Text("Поручи — и отдыхай!", path=F_SEMI, size=50, maxw=900, color=(225, 236, 255))
        f = font(F_BLACK, 50)
        txt = "ЖАҚЫНДА · СКОРО"
        self.soon = rgba_rect(int(f.getlength(txt) + 90), 100, 50, YELLOW + (255,))
        ImageDraw.Draw(self.soon).text((45, 20), txt, font=f, fill=NAVY)
        self.city = Text("Қызылорда", path=F_BOLD, size=50, maxw=700)
        glow = Image.new("L", (560, 560), 0)
        ImageDraw.Draw(glow).ellipse((70, 70, 490, 490), fill=255)
        self.glow = Image.new("RGBA", (560, 560), (255, 255, 255, 0))
        self.glow.putalpha(glow.filter(ImageFilter.GaussianBlur(70)).point(lambda v: int(v * 0.6)))
        sp = self.spans
        self.t_slogan = sp[1][0] if len(sp) > 1 else 1.0
        self.t_soon = sp[2][0] if len(sp) > 2 else self.t_slogan + 1.2
        self.sfx = [(0.05, "chime", 0.45), (self.t_soon, "pop", 0.5)]

    def draw(self, cv, t, phone):
        p = prog(t, 0.0, 0.5)
        paste_center(cv, self.glow, 540, 600, min(1, p * 2) * (0.85 + 0.15 * math.sin(t * 2.5)))
        paste_center(cv, self.icon, 540, 600, min(1, p * 2), 0.5 + 0.5 * e_back(p))
        self.word.draw(cv, W / 2, 790, prog(t, 0.2, 0.5), dy=30 * (1 - e_out(prog(t, 0.2, 0.55))))
        q = prog(t, self.t_slogan - 0.05, self.t_slogan + 0.3)
        self.slogan.draw(cv, W / 2, 1000, q, dy=26 * (1 - e_out(q)))
        self.ru_slogan.draw(cv, W / 2, 1115, prog(t, self.t_slogan + 0.35, self.t_slogan + 0.65))
        q = prog(t, self.t_soon, self.t_soon + 0.3)
        if q > 0:
            paste_center(cv, self.soon, 540, 1300, min(1, q * 2), 0.7 + 0.3 * e_back(q))
        q = prog(t, self.t_soon + 0.4, self.t_soon + 0.7)
        if q > 0:
            self.city.draw(cv, W / 2, 1385, q)
            # map pin before the city name
            d_x = 540 - self.city.f.getlength("Қызылорда") / 2 - 40
            pin = Image.new("RGBA", (60, 80), (0, 0, 0, 0))
            dd = ImageDraw.Draw(pin)
            dd.ellipse((8, 4, 52, 48), fill=(244, 63, 94, 255))
            dd.polygon([(12, 36), (48, 36), (30, 74)], fill=(244, 63, 94, 255))
            dd.ellipse((22, 18, 38, 34), fill=WHITE + (255,))
            paste(cv, scaled(pin, 0.75), d_x - 30, 1395, q)


SCENES = [S1, S2, S3, S4, S5, S6, S7, S8, S9, S10]


# ---------------------------------------------------------------- timeline

class Timeline:
    def __init__(self, voice_dir, assets):
        self.A = assets
        self.scenes, self.starts = [], []
        vdir = pathlib.Path(voice_dir)
        t = 0.0
        prev_pose, prev_screen_scene = None, None
        for i, cls in enumerate(SCENES, start=1):
            f = next(p for ext in ("wav", "mp3") if (p := vdir / f"{i:02d}.{ext}").exists())
            voice = trim(decode(f))
            peak = np.abs(voice).max()
            voice = voice / (peak + 1e-9) * 0.89
            sc = cls(i, voice, assets)
            if sc.phone_keys:
                keys = []
                for tk, pose in sc.phone_keys:
                    if pose == "PREV":
                        pose = prev_pose or OV
                    elif pose == ("PREV_LOW",):
                        base = prev_pose or OV
                        pose = (base[0], base[1], base[2], base[3], base[4] + 2100)
                    keys.append((tk, pose))
                sc.phone_keys = keys
                if prev_screen_scene is not None and isinstance(sc, PhoneScene):
                    sc.prev = prev_screen_scene.screen(prev_screen_scene.dur)
                prev_pose = keys[-1][1]
                if isinstance(sc, PhoneScene) or isinstance(sc, S2):
                    prev_screen_scene = sc
            self.scenes.append(sc)
            self.starts.append(t)
            t += sc.dur
        self.duration = t

    def scene_at(self, t):
        for sc, s in zip(self.scenes, self.starts):
            if t < s + sc.dur:
                return sc, t - s
        return self.scenes[-1], self.scenes[-1].dur

    def frame(self, t, bg, phone):
        sc, lt = self.scene_at(t)
        cv = bg.copy()
        if sc.phone_keys:
            pose = pose_at(sc.phone_keys, lt)
            if pose[4] - pose[0] * (BEZ + pose[2]) < H:  # phone at least partly on screen
                screen = sc.screen(lt)
                if screen is None:  # scenes that only move the phone away keep the last screen
                    screen = self._last_screen(sc)
                off = sc.phone_off(lt) if hasattr(sc, "phone_off") else (0, 0)
                phone.draw(cv, screen, pose, off)
                scrim = top_scrim(bg)
                cv.paste(scrim, (0, 0), scrim)
        sc.draw(cv, lt, phone)
        return cv

    def _last_screen(self, sc):
        i = self.scenes.index(sc)
        for prev in reversed(self.scenes[:i]):
            if isinstance(prev, (PhoneScene, S2)):
                return prev.screen(prev.dur)
        return self.A.scr[1]

    def mix(self):
        n = int(self.duration * SR) + SR
        voice = np.zeros(n)
        sfx = np.zeros(n)
        dombra = trim(decode(REPO / "public/sounds/dombra.wav"), -50, 0.01)
        clips = {"drip": AU.drip(), "whoosh": AU.whoosh(), "pop": AU.pop(), "tick": AU.tick(), "blip": AU.blip(),
                 "stamp": AU.stamp(), "chime": AU.chime(), "dombra": dombra / (np.abs(dombra).max() + 1e-9)}
        for sc, s in zip(self.scenes, self.starts):
            AU.place(voice, sc.voice, s + sc.a0)
            for t0, name, g in sc.sfx:
                AU.place(sfx, clips[name], s + t0, g)
        music = AU.music(self.duration)
        music = np.pad(music, (0, n - len(music)))
        env = AU.duck_envelope(voice, floor=0.35)
        mix = voice * 1.0 + sfx * 0.55 + music * 0.20 * env
        peak = np.abs(mix).max()
        if peak > 0.97:
            mix = mix / peak * 0.97
        return mix[: int(self.duration * SR)]


def write_wav(path, x):
    import wave
    pcm = (np.clip(x, -1, 1) * 32767).astype(np.int16)
    st = np.repeat(pcm[:, None], 2, axis=1)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(st.tobytes())


def make_bg():
    y = np.linspace(0, 1, H)
    stops = [(0.0, (18, 168, 236)), (0.45, (4, 132, 206)), (1.0, (66, 62, 196))]
    col = np.stack([np.interp(y, [s[0] for s in stops], [s[1][c] for s in stops]) for c in range(3)], axis=1)
    img = np.repeat(col[:, None, :], W, axis=1)
    yy, xx = np.mgrid[0:H, 0:W]
    img += np.exp(-(((xx - 160) / 700) ** 2 + ((yy - 180) / 600) ** 2))[..., None] * 26
    return Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--voice", required=True)
    ap.add_argument("--overlays", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--stills", default="")
    ap.add_argument("--from", dest="t_from", type=float, default=0.0)
    ap.add_argument("--to", dest="t_to", type=float, default=None)
    args = ap.parse_args()

    assets = Assets(args.overlays)
    tl = Timeline(args.voice, assets)
    bg = make_bg()
    phone = Phone()
    print(f"duration {tl.duration:.2f}s; scenes " + ", ".join(f"{type(s).__name__}={s.dur:.2f}" for s in tl.scenes), flush=True)
    out = pathlib.Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)

    if args.stills:
        for ts in args.stills.split(","):
            t = float(ts)
            tl.frame(t, bg, phone).save(out.parent / f"still_{t:06.2f}.png")
        return

    wav = out.with_suffix(".wav")
    write_wav(wav, tl.mix())
    t_to = args.t_to if args.t_to is not None else tl.duration
    cmd = ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS),
           "-i", "-", "-ss", f"{args.t_from}", "-i", str(wav), "-c:v", "libx264", "-preset", "veryfast", "-crf", "19",
           "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-shortest", str(out)]
    enc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    n0, n1 = int(args.t_from * FPS), int(t_to * FPS)
    for i in range(n0, n1):
        enc.stdin.write(tl.frame(i / FPS, bg, phone).tobytes())
        if i % 150 == 0:
            print(f"frame {i}/{n1}", flush=True)
    enc.stdin.close()
    enc.wait()
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
