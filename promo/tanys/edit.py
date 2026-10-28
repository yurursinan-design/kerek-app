#!/usr/bin/env python3
"""Edits the "Танысымның танысы" ad from the Kling shots (promo/tanys/clips), the app-styled phone
screens (screen_insert.py), the Kazakh lines (promo/tanys/voice, Gemini TTS) and synthesised sound.

Kling's own audio is dropped. Russian subtitles carry every line; the day captions and the end
card are drawn here. Story: Arman asks his brother-in-law for "a guy", the chain of acquaintances
runs across the city while the laundry piles up, on day five a stranger calls Arman asking for
the same guy; he writes it in Tapsyr, a master comes, and only then the brother-in-law calls back.

Usage:
  python3 promo/tanys/edit.py --analyse <dir>                       contact sheets of every shot
  python3 promo/tanys/edit.py --screen <png dir> --out <file.mp4> [--stills t1,t2,...]
"""

import argparse
import importlib.util
import pathlib
import subprocess
import sys
import wave

import numpy as np
from PIL import Image, ImageDraw

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(REPO / "promo/video"))
import audio as AU  # noqa: E402
import render as R  # noqa: E402


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


AK = _load("altkat_edit", REPO / "promo/altkat/edit.py")   # end card, voice loader, clank
E7 = _load("e0307", REPO / "promo/0307/edit.py")           # filters, room tone, taps

W, H, FPS = 1080, 1920, 24
SR = AU.SR
CLIPS = HERE / "clips"
VOICE = HERE / "voice"

# ------------------------------------------------------------------ the cut
# (kind, source, in, out): kind "clip" = a Kling shot, "screen" = the phone insert, "end" = end card.
SEGMENTS = [
    ("clip", "S1", 0.0, 4.0),     # 0  hook: from inside the dead machine, he calls his brother-in-law
    ("clip", "S2", 0.0, 3.0),     # 1  Yerbolat: "Бар! Қазір хабарласайын."
    ("clip", "C1", 1.0, 2.15),    # 2  the chain: toastmaster
    ("clip", "C2", 1.25, 2.4),    # 3  taxi driver
    ("clip", "S8", 0.6, 1.55),    # 4  day 1: laundry to his knees
    ("clip", "C3", 1.2, 2.4),     # 5  bazaar apa
    ("clip", "C4", 1.5, 2.4),     # 6  mangal, waving the smoke away
    ("clip", "S9", 0.8, 1.7),     # 7  day 3: up to his chest, rubbing his forehead
    ("clip", "C5", 0.85, 2.35),   # 8  fisherman
    ("clip", "S10", 0.0, 4.5),    # 9  day 5: buried; a stranger calls HIM for the guy
    ("clip", "S11", 0.0, 1.6),    # 10 he writes it in Tapsyr
    ("screen", None, 0.0, 3.0),   # 11 the request and the first offers
    ("clip", "S12", 0.0, 2.4),    # 12 the master leaves, job done
    ("clip", "S13", 0.2, 1.7),    # 13 Yerbolat, proud: "Таптым!"
    ("clip", "S14", 0.0, 3.9),    # 14 he shuts the door, starts the machine: "Рақмет, жезде."
    ("end", None, 0.0, 3.8),      # 15 end card
]


def seg_times():
    t, out = 0.0, []
    for s in SEGMENTS:
        d = s[3] - s[2]
        out.append((t, t + d))
        t += d
    return out, t


TIMES, TOTAL = seg_times()


def at(i, dt=0.0):
    return TIMES[i][0] + dt


# ------------------------------------------------------------------ words on screen
# Each line sits where its own speaker's mouth moves in the Kling shot (measured on the speech in
# Kling's discarded audio track): S1 0.6-3.4 s, S2 0.9-1.9, C1 1.25-2.0, C2 1.4-2.1, C3 1.25-2.0,
# C4 1.6-2.25, C5 0.9-2.1, S13 0.5-1.5, S14 2.4-3.4. No line crosses a cut.
LINES = [  # (segment, offset, voice file, gain dB, tempo)
    (0, 0.55, "a1s_arman_Iapetus", 0, 1.1),
    (1, 0.85, "e1t_yerbolat_Fenrir", 0, 1.0),
    (2, 0.28, "c1_host", -1, 1.0),
    (3, 0.1, "c2_taxi", -1, 1.0),
    (5, 0.06, "c3_apa", -1, 1.0),
    (6, 0.12, "c4_mangal", -1, 1.0),
    (8, 0.06, "c5_fisher", -1, 1.0),
    (13, 0.35, "e2_yerbolat_Fenrir", 0, 1.0),
    (14, 2.45, "a2_arman_Iapetus", -2, 1.0),
]
SUBS = [  # (start, end, text) — Russian subtitles of the Kazakh lines
    (at(0, 0.5), at(0, 3.85), "Жезде, стиралка сломалась. Есть знакомый?"),
    (at(1, 0.8), at(1, 2.6), "Есть! Сейчас позвоню."),
    (at(2, 0.25), at(2, 1.05), "Есть знакомый!"),
    (at(3, 0.08), at(3, 1.15), "Есть знакомый!"),
    (at(5, 0.05), at(5, 1.15), "Есть знакомый!"),
    (at(6, 0.1), at(6, 0.9), "Есть знакомый!"),
    (at(8, 0.05), at(8, 1.45), "Есть знакомый!"),
    (at(9, 0.7), at(9, 4.45), "Здравствуйте, у вас нет знакомого мастера по стиральным машинам?"),
    (at(13, 0.3), at(13, 1.5), "Нашёл!"),
    (at(14, 2.4), at(14, 3.85), "Спасибо, жезде."),
]
DAYS = [(4, "1-күн", "День 1"), (7, "3-күн", "День 3"), (9, "5-күн", "День 5")]

_cache = {}


def _sub(text):
    if text not in _cache:
        _cache[text] = R.Subtitle(text)
    return _cache[text]


def day_tag(kk, ru):
    key = ("day", kk)
    if key not in _cache:
        f1, f2 = R.font(R.F_BLACK, 64), R.font(R.F_SEMI, 34)
        w = int(max(f1.getlength(kk), f2.getlength(ru)) + 80)
        img = R.rgba_rect(w, 150, 34, (8, 20, 56, 205))
        d = ImageDraw.Draw(img)
        d.text(((w - f1.getlength(kk)) / 2, 14), kk, font=f1, fill=R.YELLOW)
        d.text(((w - f2.getlength(ru)) / 2, 96), ru, font=f2, fill=(225, 236, 255))
        _cache[key] = img
    return _cache[key]


def draw_words(cv, t):
    for s, e, text in SUBS:
        if s - 0.06 <= t <= e:
            a = min(R.prog(t, s - 0.06, s + 0.04), 1 - R.prog(t, e - 0.06, e))
            _sub(text).draw(cv, a, cy=1560)
    for i, kk, ru in DAYS:
        s, e = TIMES[i][0], TIMES[i][0] + (1.2 if i == 9 else TIMES[i][1] - TIMES[i][0])
        if s <= t <= e:
            a = min(R.prog(t, s, s + 0.08), 1 - R.prog(t, e - 0.1, e))
            p = R.prog(t, s, s + 0.25)
            R.paste_center(cv, day_tag(kk, ru), W / 2, 300, a, 0.85 + 0.15 * R.e_back(p))


# ------------------------------------------------------------------ pictures
def clip_frames(name, t0, t1):
    n = int(round((t1 - t0) * FPS))
    cmd = ["ffmpeg", "-v", "error", "-ss", f"{t0:.3f}", "-i", str(CLIPS / f"{name}.mp4"), "-frames:v", str(n),
           "-vf", f"fps={FPS},scale={W}:-2:flags=lanczos,crop={W}:{H}", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE)
    got, last = 0, None
    while got < n:
        buf = proc.stdout.read(W * H * 3)
        if len(buf) < W * H * 3:
            break
        last = Image.frombytes("RGB", (W, H), buf)
        got += 1
        yield last
    proc.stdout.close()
    proc.wait()
    while got < n and last is not None:
        got += 1
        yield last


class Screen:
    """The phone insert: typing, photo, send, then two offers arrive. Zoomed to its upper part."""

    def __init__(self, folder):
        f = pathlib.Path(folder)
        self.typing = [Image.open(p).convert("RGB") for p in sorted(f.glob("type_*.png"))]
        self.st = {n: Image.open(f / f"{n}.png").convert("RGB") for n in
                   ("photo", "press", "analyzing", "offers_0", "offers_1", "offers_2")}

    @staticmethod
    def zoom(img, z):
        img = img.resize((W, H), Image.BICUBIC) if img.size != (W, H) else img
        w, h = int(W / z), int(H / z)
        return img.crop(((W - w) // 2, 0, (W - w) // 2 + w, h)).resize((W, H), Image.BICUBIC)

    def frame(self, dt):
        if dt < 1.0:
            img = self.typing[min(len(self.typing) - 1, int(dt / 0.95 * len(self.typing)))]
        elif dt < 1.3:
            img = self.st["photo"]
        elif dt < 1.45:
            img = self.st["press"]
        elif dt < 1.85:
            img = self.st["analyzing"]
        elif dt < 2.0:
            img = self.st["offers_0"]
        elif dt < 2.45:
            img = self.st["offers_1"]
        else:
            img = self.st["offers_2"]
        return self.zoom(img, 1.0 + 0.03 * dt / 3.0)


class EndCard(AK.EndCard):
    """The campaign end card with this film's line on top."""

    def __init__(self):
        super().__init__()
        self.head = R.Text("Таныс іздеме. *Тапсыр.*", size=78, maxw=1000)
        self.head_ru = R.Text("Не ищи знакомых. Поручи.", path=R.F_SEMI, size=38, maxw=900, color=(225, 236, 255))

    def frame(self, dt):
        cv = super().frame(dt + 0.0)
        q = R.prog(dt, 0.05, 0.4)
        self.head.draw(cv, W / 2, 215, q, dy=18 * (1 - R.e_out(q)))
        self.head_ru.draw(cv, W / 2, 312, R.prog(dt, 0.3, 0.6))
        return cv


def frames(screen, end):
    for i, (kind, src, t0, t1) in enumerate(SEGMENTS):
        s0 = TIMES[i][0]
        n = int(round((t1 - t0) * FPS))
        if kind == "clip":
            for k, img in enumerate(clip_frames(src, t0, t1)):
                yield s0 + k / FPS, img
        else:
            for k in range(n):
                dt = k / FPS
                yield s0 + dt, (screen.frame(dt) if kind == "screen" else end.frame(dt))


# ------------------------------------------------------------------ analysis
def analyse(out):
    out = pathlib.Path(out)
    out.mkdir(parents=True, exist_ok=True)
    for f in sorted(CLIPS.glob("*.mp4")):
        raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(f), "-vf", "fps=4,scale=150:-2", "-f", "rawvideo",
                              "-pix_fmt", "rgb24", "-"], capture_output=True, check=True).stdout
        w = 150
        h = int(round(1280 * w / 716 / 2) * 2)
        n = len(raw) // (w * h * 3)
        sheet = Image.new("RGB", (n * w, h + 20), (20, 20, 20))
        d = ImageDraw.Draw(sheet)
        for k in range(n):
            sheet.paste(Image.frombytes("RGB", (w, h), raw[k * w * h * 3:(k + 1) * w * h * 3]), (k * w, 20))
            d.text((k * w + 4, 4), f"{k / 4:.2f}", fill=(255, 255, 0))
        sheet.save(out / f"{f.stem}.jpg", quality=85)
    print("sheets ->", out)


# ------------------------------------------------------------------ sound
bp, lp, hp, norm = E7.bp, E7.lp, E7.hp, E7.norm


def tight(x, lead=0.03, tail=0.12):
    """Cut a line to its speech: from the first to the last 20 ms window above 6 % of the loudest."""
    win = int(0.02 * SR)
    e = np.array([np.sqrt((x[i:i + win] ** 2).mean()) for i in range(0, len(x) - win, win)])
    on = np.where(e > e.max() * 0.06)[0]
    a, b = max(0, on[0] * win - int(lead * SR)), min(len(x), (on[-1] + 1) * win + int(tail * SR))
    y = x[a:b].copy()
    f = int(0.06 * SR)
    y[-f:] *= np.linspace(1, 0, f)
    return y


def voice(name, gain_db=0.0, tempo=1.0):
    af = ["-af", f"atempo={tempo}"] if tempo != 1.0 else []
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(VOICE / f"{name}.wav"), *af, "-f", "f32le", "-ac", "1",
                          "-ar", str(SR), "-"], check=True, capture_output=True).stdout
    x = tight(np.frombuffer(raw, dtype=np.float32).astype(np.float64))
    return x / (np.abs(x).max() + 1e-9) * 0.9 * 10 ** (gain_db / 20)


def phone_eq(x):
    """A voice heard through a phone speaker."""
    return norm(np.tanh(bp(x, 350, 3200) * 2.2)) * 0.8


def noise(dur, seed):
    return np.random.default_rng(seed).normal(0, 1, int(dur * SR))


def error_beeps(dur):
    out = np.zeros(int(dur * SR))
    t = np.arange(int(0.09 * SR)) / SR
    b = np.sign(np.sin(2 * np.pi * 2200 * t)) * np.exp(-t * 8) * 0.25
    b = lp(b, 6000)
    for k in range(int(dur / 1.0) + 1):
        for j in range(3):
            AU.place(out, b, k * 1.0 + j * 0.14, 1.0)
    return out


def crowd(dur, seed, lo=250, hi=2500, rate=4.0):
    """Many people talking far off: band-limited noise with syllable-rate flutter."""
    rng = np.random.default_rng(seed)
    n = int(dur * SR)
    x = np.zeros(n)
    for k in range(6):
        v = bp(rng.normal(0, 1, n), lo * rng.uniform(0.8, 1.2), hi * rng.uniform(0.8, 1.2))
        env = lp(np.abs(rng.normal(0, 1, n)), rate * rng.uniform(0.7, 1.4))
        x += norm(v) * norm(env)
    return norm(x)


def sizzle(dur, seed=31):
    rng = np.random.default_rng(seed)
    n = int(dur * SR)
    hiss = hp(rng.normal(0, 1, n), 3000) * 0.4
    pops = (rng.random(n) < 0.004) * rng.normal(0, 1, n)
    pops = bp(np.convolve(pops, np.exp(-np.arange(200) / 30), mode="same"), 1500, 9000)
    return norm(hiss + norm(pops) * 0.8)


def river(dur, seed=41):
    rng = np.random.default_rng(seed)
    n = int(dur * SR)
    x = lp(rng.normal(0, 1, n), 900) * (0.7 + 0.3 * np.sin(np.arange(n) / SR * 2 * np.pi * 0.6))
    t = np.arange(int(0.25 * SR)) / SR
    bird = np.sin(2 * np.pi * np.cumsum(3200 + 900 * np.sin(2 * np.pi * 9 * t)) / SR) * np.exp(-t * 9) * 0.25
    x = norm(x)
    AU.place(x, bird, dur * 0.35, 1.0)
    return x


def car(dur, seed=51):
    rng = np.random.default_rng(seed)
    n = int(dur * SR)
    t = np.arange(n) / SR
    eng = np.sin(2 * np.pi * 38 * t) * 0.5 + np.sin(2 * np.pi * 76 * t) * 0.25
    return norm(eng + lp(rng.normal(0, 1, n), 500) * 0.8)


def ring(n_rings=2):
    """A plain phone ringtone: two-tone bursts."""
    out = np.zeros(int((n_rings * 1.6) * SR))
    t = np.arange(int(0.8 * SR)) / SR
    tone = (np.sin(2 * np.pi * 1180 * t) + np.sin(2 * np.pi * 1420 * t)) * (np.sin(2 * np.pi * 20 * t) > 0) * 0.2
    tone *= np.minimum(1, t / 0.01) * np.minimum(1, (0.8 - t) / 0.02)
    for k in range(n_rings):
        AU.place(out, tone, k * 1.6, 1.0)
    return out


def motor(dur):
    """The washing machine starts: a rising hum, a latch click, water."""
    t = np.arange(int(dur * SR)) / SR
    f = 40 + 30 * np.minimum(1, t / 1.5)
    hum = np.sin(2 * np.pi * np.cumsum(f) / SR) * 0.6 + np.sin(2 * np.pi * np.cumsum(2 * f) / SR) * 0.25
    water = lp(noise(dur, 61), 1800) * np.minimum(1, np.maximum(0, t - 0.5) / 0.8) * 0.5
    return norm(hum * np.minimum(1, t / 0.6) + water)


def dombra_drive(dur, bpm0=128, bpm1=184):
    """Two-string dombra strumming that speeds up link by link along the chain."""
    out = np.zeros(int(dur * SR) + SR)
    chords = [(146.83, 196.0), (146.83, 196.0), (164.81, 220.0), (130.81, 196.0)]
    cache = {}
    t, k = 0.0, 0
    while t < dur:
        bpm = bpm0 + (bpm1 - bpm0) * (t / dur)
        step = 60 / bpm / 2
        c = chords[(k // 8) % 4]
        accent = k % 4 == 0
        key = (c, accent)
        if key not in cache:
            s = sum(AU.pluck(f, 0.5, bright=0.75 if accent else 0.6, seed=int(f) + accent) for f in c)
            cache[key] = s
        AU.place(out, cache[key], t, 0.9 if accent else 0.55)
        if k % 2 == 1:  # the knock of the hand on the body between strums
            AU.place(out, lp(noise(0.03, k), 900) * np.exp(-np.arange(int(0.03 * SR)) / SR * 120), t + step / 2, 0.25)
        t += step
        k += 1
    out = out[: int(dur * SR)]
    out[-int(0.05 * SR):] *= np.linspace(1, 0, int(0.05 * SR))
    return norm(out)


def mix():
    n = int(TOTAL * SR) + SR
    vo, sfx, amb, mus = (np.zeros(n) for _ in range(4))
    put = AU.place

    def span(i):
        return TIMES[i][1] - TIMES[i][0]

    # voices (Arman = Iapetus, Yerbolat = Fenrir)
    for i, dt, name, gain, tempo in LINES:
        x = voice(name, gain, tempo)
        end = at(i, dt) + len(x) / SR
        assert end <= TIMES[i][1] + 0.12, f"{name} runs {end - TIMES[i][1]:.2f}s past its shot"
        put(vo, x, at(i, dt))
    put(vo, phone_eq(voice("x1_stranger", 0, 1.1)), at(9, 0.7), 0.9)   # off screen, through his phone

    # places
    room = E7.room(TOTAL) * 0.05
    for i in (0, 4, 7, 9, 10, 11, 12, 14):
        a, b = int(TIMES[i][0] * SR), int(TIMES[i][1] * SR)
        amb[a:b] += room[a:b]
    put(sfx, error_beeps(span(0)), at(0), 0.35)
    put(amb, AK.hum(span(1)) * 0.8, at(1))
    put(sfx, AK.clank(), at(1, 0.4), 0.15)
    put(amb, crowd(span(2), 1) * 0.12 + lp(AU.music(4.0), 700)[: len(crowd(span(2), 1))] * 0.12, at(2))
    put(amb, car(span(3)) * 0.12, at(3))
    put(amb, crowd(span(5), 2, 300, 3000, 5.0) * 0.14, at(5))
    put(amb, sizzle(span(6)) * 0.12, at(6))
    put(amb, river(span(8)) * 0.12, at(8))
    put(amb, room[: int(span(13) * SR)] * 2, at(13))
    put(sfx, AK.clank(), at(13, 0.9), 0.1)

    # day 5: his phone rings, he answers, and it is a stranger asking him for the guy
    put(sfx, ring(1), at(9, 0.0), 0.35)
    # he writes it in the app
    t, k = at(10, 0.1), 0
    rng = np.random.default_rng(3)
    while t < at(11, 1.0):
        put(sfx, E7.tap(k), t, 0.2 * rng.uniform(0.6, 1.0))
        t += rng.uniform(0.08, 0.14)
        k += 1
    put(sfx, E7.tap(90), at(11, 1.0), 0.18)            # photo
    put(sfx, E7.tap(91), at(11, 1.3), 0.2)             # "Шешім табу"
    put(sfx, AU.whoosh(0.22), at(11, 1.35), 0.15)
    put(sfx, AU.blip(), at(11, 2.0), 1.0)               # first offer: the only sound in the silence
    put(sfx, AU.blip(), at(11, 2.45), 0.6)
    # the master leaves; the front door shuts; Arman's phone rings: the brother-in-law
    put(sfx, E7.clack(5) * 0.8, at(12, 1.9), 0.25)
    put(sfx, ring(1)[: int(0.75 * SR)], at(12, 1.65), 0.25)
    # he shuts the machine and starts it
    put(sfx, E7.clack(6), at(14, 1.45), 0.25)               # the door latches
    put(sfx, AU.pop(1600, 1500, 0.06), at(14, 2.15), 0.15)  # start button
    put(sfx, motor(span(14) - 2.2), at(14, 2.2), 0.3)

    # music: the dombra drives the chain; nothing on day five or in the app; warm plucks after
    m0, m1 = at(1, 2.1), at(9, 0.0)
    put(mus, dombra_drive(m1 - m0), m0, 1.0)
    w0 = at(12, 0.3)
    warm = AU.music(TOTAL - w0)
    warm[: int(0.6 * SR)] *= np.linspace(0, 1, int(0.6 * SR))
    put(mus, warm, w0, 1.0)
    put(sfx, AK.load(REPO / "public/sounds/dombra.wav"), at(15, 0.15), 0.8)

    env = AU.duck_envelope(vo, floor=0.45)
    out = vo * 1.0 + sfx * 0.7 + amb * 0.8 + mus * 0.32 * env
    return norm(out[: int(TOTAL * SR)], 0.95)


def write_wav(path, x):
    pcm = (np.clip(x, -1, 1) * 32767).astype(np.int16)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(np.repeat(pcm[:, None], 2, axis=1).tobytes())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--screen")
    ap.add_argument("--out")
    ap.add_argument("--stills", default="")
    ap.add_argument("--analyse")
    args = ap.parse_args()
    if args.analyse:
        analyse(args.analyse)
        return
    out = pathlib.Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    screen, end = Screen(args.screen), EndCard()
    print(f"duration {TOTAL:.2f}s", flush=True)
    if args.stills:
        want = sorted(float(x) for x in args.stills.split(","))
        for t, img in frames(screen, end):
            while want and t >= want[0] - 1e-6:
                cv = img.copy()
                draw_words(cv, t)
                cv.save(out.parent / f"still_{want[0]:06.2f}.jpg", quality=88)
                want.pop(0)
            if not want:
                break
        return
    wav = out.with_suffix(".wav")
    write_wav(wav, mix())
    cmd = ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS),
           "-i", "-", "-i", str(wav), "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
           "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-shortest", str(out)]
    enc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    for k, (t, img) in enumerate(frames(screen, end)):
        cv = img.copy()
        draw_words(cv, t)
        enc.stdin.write(cv.tobytes())
        if k % 120 == 0:
            print(f"t={t:.1f}s", flush=True)
    enc.stdin.close()
    enc.wait()
    print("wrote", out)


if __name__ == "__main__":
    main()
