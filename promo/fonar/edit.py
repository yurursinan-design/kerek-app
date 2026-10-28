#!/usr/bin/env python3
"""Edits the "Жарықты ұста" ad from the Kling shots (promo/fonar/clips), the app-styled phone screens
(screen_insert.py), Saken's lines (promo/fonar/voice, Gemini TTS, voice Algenib) and synthesised sound.

Story: as a boy, Nurzhan held the flashlight while his father fixed the sink. Today the father, a
master of 38 years, wipes his tools next to a phone that never rings. Nurzhan puts him on Tapsyr;
the next morning a job comes in, and at a young man's flat the father says, without looking,
the same words: «Фонарьды ұста, балам.» The young man holds the flashlight, framed like the memory.

Kling's own audio is dropped; its speech only tells where a speaker's mouth moves (see LINES).

Usage:
  python3 promo/fonar/edit.py --analyse <dir>
  python3 promo/fonar/edit.py --screen <png dir> --out <file.mp4> [--stills t1,t2,...]
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


AK = _load("altkat_edit", REPO / "promo/altkat/edit.py")   # end card, clank, wav loader
E7 = _load("e0307", REPO / "promo/0307/edit.py")           # filters, room tone, taps, clack
TN = _load("tanys_edit", REPO / "promo/tanys/edit.py")     # tight(), crowd(), analyse helpers

W, H, FPS = 1080, 1920, 24
SR = AU.SR
CLIPS = HERE / "clips"
VOICE = HERE / "voice"

# ------------------------------------------------------------------ the cut
SEGMENTS = [
    ("clip", "M1", 0.0, 3.4),        # 0  memory: the boy holds the flashlight for his father
    ("clip", "T1", 0.0, 3.2),        # 1  today: the tools, the silent phone. «Әкем — 38 жыл ұста.»
    ("clip", "P1", 0.0, 2.0),        # 2  the son fills in his father's profile
    ("screen", "profile", 0.0, 2.8), # 3  "38" -> the preview card "38 жыл тәжірибе" -> publish
    ("clip", "P2", 0.0, 4.2),        # 4  «Қой, балам, мақтану ұят.»
    ("screen", "lock", 0.0, 1.6),    # 5  next morning: a job, with the dombra
    ("clip", "N2", 0.0, 2.8),        # 6  he reads it; his eyes light up
    ("clip", "N3", 0.4, 1.9),        # 7  the son nods
    ("clip", "N4", 0.0, 2.4),        # 8  he lifts the old green toolbox, back straight
    ("clip", "F1", 0.0, 4.4),        # 9  «Фонарьды ұста, балам.» — the young man takes the flashlight
    ("clip", "F2", 0.0, 3.4),        # 10 the same frame as the memory
    ("clip", "F3", 0.0, 2.4),        # 11 he smiles to himself
    ("end", None, 0.0, 3.8),         # 12 end card
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


# Lines: (segment, offset, voice file, gain dB, tempo, treatment). Saken is off screen in M1 (only
# his hands) and under the sink in F1 (face hidden); in P2 the line sits on his mouth movement.
LINES = [
    (0, 1.0, "m1_saken_Algenib", -1, 1.0, "memory"),
    (4, 0.5, "p2_saken_Algenib", 0, 1.0, "dry"),
    (9, 0.5, "f1_saken_Algenib", 0, 1.0, "cabinet"),
]
SUBS = [
    (at(0, 0.95), at(0, 2.4), "Держи фонарик, сынок."),
    (at(4, 0.45), at(4, 4.0), "Брось, сынок, хвастаться стыдно."),
    (at(9, 0.45), at(9, 2.2), "Держи фонарик, сынок."),
]

_cache = {}


def caption(kk, ru):
    key = ("cap", kk)
    if key not in _cache:
        f1, f2 = R.font(R.F_BLACK, 58), R.font(R.F_SEMI, 34)
        w = int(max(f1.getlength(kk), f2.getlength(ru)) + 90)
        img = R.rgba_rect(w, 150, 34, (8, 20, 56, 205))
        d = ImageDraw.Draw(img)
        d.text(((w - f1.getlength(kk)) / 2, 16), kk, font=f1, fill=R.WHITE)
        d.text(((w - f2.getlength(ru)) / 2, 96), ru, font=f2, fill=(225, 236, 255))
        _cache[key] = img
    return _cache[key]


def draw_words(cv, t):
    for s, e, text in SUBS:
        if s - 0.06 <= t <= e:
            a = min(R.prog(t, s - 0.06, s + 0.04), 1 - R.prog(t, e - 0.06, e))
            if text not in _cache:
                _cache[text] = R.Subtitle(text)
            _cache[text].draw(cv, a, cy=1560)
    s, e = at(1, 0.5), TIMES[1][1] - 0.05
    if s <= t <= e:
        a = min(R.prog(t, s, s + 0.25), 1 - R.prog(t, e - 0.15, e))
        R.paste_center(cv, caption("Әкем — 38 жыл ұста.", "Мой отец — мастер уже 38 лет."), W / 2, 300, a)


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


_rng = np.random.default_rng(3)
_vig = None


def memory_look(img):
    """Old-memory look for M1: film grain and a soft vignette on top of Kling's warm colours."""
    global _vig
    if _vig is None:
        yy, xx = np.mgrid[0:H, 0:W]
        r = np.sqrt(((xx - W / 2) / (W * 0.6)) ** 2 + ((yy - H / 2) / (H * 0.6)) ** 2)
        _vig = (1 - 0.35 * np.clip(r - 0.45, 0, 1) ** 1.4)[..., None].astype(np.float32)
    f = np.asarray(img, np.float32) * _vig
    grain = _rng.normal(0, 7, (H // 2, W // 2, 1)).astype(np.float32)
    f += np.repeat(np.repeat(grain, 2, 0), 2, 1)
    return Image.fromarray(np.clip(f, 0, 255).astype(np.uint8))


class Screens:
    def __init__(self, folder):
        f = pathlib.Path(folder)
        self.s = {p.stem: Image.open(p).convert("RGB").resize((W, H), Image.BICUBIC) for p in f.glob("*.png")}

    def profile(self, dt):
        for until, name in ((0.3, "exp_0"), (0.55, "exp_1"), (1.0, "exp_2"), (1.2, "exp_done"), (2.4, "preview")):
            if dt < until:
                return self.push(self.s[name], dt)
        return self.push(self.s["preview_press"], dt)

    def lock(self, dt):
        img = self.s["lock"]
        shake = 0
        if 0.1 < dt < 0.55 or 0.75 < dt < 1.1:  # the phone buzzes on the table
            shake = int(7 * np.sin(dt * 2 * np.pi * 24))
        if shake:
            img = img.transform(img.size, Image.AFFINE, (1, 0, shake, 0, 1, 0), fillcolor=(10, 10, 10))
        return img

    @staticmethod
    def push(img, dt):
        z = 1.0 + 0.025 * dt / 3.0
        w, h = int(W / z), int(H / z)
        return img.crop(((W - w) // 2, 0, (W - w) // 2 + w, h)).resize((W, H), Image.BICUBIC)


class EndCard(AK.EndCard):
    def __init__(self):
        super().__init__()
        self.head = R.Text("Ұстаның қолы *әлі керек.*", size=74, maxw=1000)
        self.head_ru = R.Text("Руки мастера всё ещё нужны.", path=R.F_SEMI, size=38, maxw=900, color=(225, 236, 255))

    def frame(self, dt):
        cv = super().frame(dt)
        q = R.prog(dt, 0.05, 0.4)
        self.head.draw(cv, W / 2, 215, q, dy=18 * (1 - R.e_out(q)))
        self.head_ru.draw(cv, W / 2, 312, R.prog(dt, 0.3, 0.6))
        return cv


def frames(screens, end):
    for i, (kind, src, t0, t1) in enumerate(SEGMENTS):
        s0 = TIMES[i][0]
        n = int(round((t1 - t0) * FPS))
        if kind == "clip":
            for k, img in enumerate(clip_frames(src, t0, t1)):
                yield s0 + k / FPS, (memory_look(img) if src == "M1" else img)
        else:
            for k in range(n):
                dt = k / FPS
                if kind == "screen":
                    img = screens.profile(dt) if src == "profile" else screens.lock(dt)
                else:
                    img = end.frame(dt)
                yield s0 + dt, img


# ------------------------------------------------------------------ sound
bp, lp, hp, norm = E7.bp, E7.lp, E7.hp, E7.norm


def voice(name, gain_db=0.0, tempo=1.0):
    af = ["-af", f"atempo={tempo}"] if tempo != 1.0 else []
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(VOICE / f"{name}.wav"), *af, "-f", "f32le", "-ac", "1",
                          "-ar", str(SR), "-"], check=True, capture_output=True).stdout
    x = TN.tight(np.frombuffer(raw, dtype=np.float32).astype(np.float64))
    return x / (np.abs(x).max() + 1e-9) * 0.9 * 10 ** (gain_db / 20)


def room_verb(x, size=0.25, wet=0.25, seed=5):
    from scipy.signal import fftconvolve
    rng = np.random.default_rng(seed)
    ti = np.arange(int(size * 2.5 * SR)) / SR
    ir = lp(rng.normal(0, 1, len(ti)) * np.exp(-ti / size * 3), 3500)
    y = fftconvolve(x, ir)[: len(x) + len(ir) // 2]
    out = np.zeros(len(y))
    out[: len(x)] += x
    return out + norm(y) * wet * np.abs(x).max()


def treat(x, kind):
    if kind == "memory":      # a little far and warm, like remembered
        return norm(room_verb(lp(x, 4500), 0.3, 0.3)) * 0.85
    if kind == "cabinet":     # from inside the cabinet under the sink
        return norm(room_verb(lp(hp(x, 180), 2600), 0.12, 0.35)) * 0.9
    return x


def clink(seed=0):
    """A wrench on a nut."""
    rng = np.random.default_rng(seed)
    t = np.arange(int(0.18 * SR)) / SR
    x = sum(np.sin(2 * np.pi * f * rng.uniform(0.97, 1.03) * t) * np.exp(-t * d) * g
            for f, d, g in ((2350, 30, 0.5), (3720, 40, 0.3), (5100, 60, 0.2)))
    return norm(x + bp(rng.normal(0, 1, len(t)), 2000, 8000) * np.exp(-t * 300) * 0.4)


def clock(dur, start=0.0):
    """The kitchen wall clock: tick... tock..., once a second."""
    out = np.zeros(int(dur * SR))
    t = np.arange(int(0.04 * SR)) / SR
    for k in range(int(dur) + 1):
        f = 2300 if k % 2 else 1900
        tk = (np.sin(2 * np.pi * f * t) * np.exp(-t * 180) + bp(np.random.default_rng(k).normal(0, 1, len(t)), 1500, 6000)
              * np.exp(-t * 400) * 0.5)
        AU.place(out, tk, start + k * 1.0, 1.0)
    return norm(out)


def old_tv(dur):
    """A television in another room of the 90s flat: muffled voices and music."""
    x = TN.crowd(dur, 9, 250, 1800, 4.0) * 0.7
    m = lp(AU.music(max(4.0, dur + 0.5)), 900)[: len(x)]
    return norm(lp(x + m * 0.5, 1200))


def buzz(n=2):
    """The phone vibrating on a wooden table."""
    out = np.zeros(int(n * 0.65 * SR))
    t = np.arange(int(0.42 * SR)) / SR
    b = np.sign(np.sin(2 * np.pi * 150 * t)) * 0.4 + np.sin(2 * np.pi * 300 * t) * 0.3
    b = lp(b, 900) * np.minimum(1, t / 0.02) * np.minimum(1, (0.42 - t) / 0.03)
    for k in range(n):
        AU.place(out, b, k * 0.65, 1.0)
    return norm(out)


def warm_theme(dur):
    """A simple warm plucked theme for the flashlight rhyme: Am - F - C - G, slow arpeggios."""
    out = np.zeros(int(dur * SR) + SR)
    chords = [(220.0, 261.63, 329.63), (174.61, 220.0, 261.63), (130.81, 196.0, 261.63), (196.0, 246.94, 293.66)]
    beat = 60 / 76
    t, k = 0.0, 0
    cache = {}
    while t < dur:
        c = chords[(k // 4) % 4]
        f = c[k % 3] * (2 if k % 4 == 3 else 1)
        if f not in cache:
            cache[f] = AU.pluck(f * 2, 1.8, bright=0.45, seed=int(f))
        AU.place(out, cache[f], t, 0.7 if k % 4 == 0 else 0.5)
        t += beat / 2
        k += 1
    out = lp(out[: int(dur * SR)], 3500)
    out[: int(0.4 * SR)] *= np.linspace(0, 1, int(0.4 * SR))
    out[-int(1.2 * SR):] *= np.linspace(1, 0, int(1.2 * SR))
    return norm(out)


def mix():
    n = int(TOTAL * SR) + SR
    vo, sfx, amb, mus = (np.zeros(n) for _ in range(4))
    put = AU.place

    def span(i):
        return TIMES[i][1] - TIMES[i][0]

    for i, dt, name, gain, tempo, kind in LINES:
        x = treat(voice(name, gain, tempo), kind)
        assert at(i, dt) + len(x) / SR <= TIMES[i][1] + 0.3, f"{name} runs past its shot"
        put(vo, x, at(i, dt))

    # 0 memory: a night kitchen, the wrench, a television far away
    put(amb, E7.room(span(0)) * 0.05, at(0))
    put(amb, old_tv(span(0)) * 0.08, at(0))
    for k, dt in enumerate((0.5, 1.7, 2.6)):
        put(sfx, clink(k), at(0, dt), 0.22)

    # 1-4 today: only the wall clock, the cloth, the phone
    a, b = at(1), at(5)
    put(amb, clock(b - a) * 0.12, a)
    put(amb, E7.room(b - a, 21) * 0.04, a)
    for dt in (0.3, 1.1, 1.9):                                                          # the cloth
        swish = lp(np.random.default_rng(int(dt * 10)).normal(0, 1, int(0.35 * SR)), 1800)
        put(sfx, norm(swish) * np.sin(np.pi * np.linspace(0, 1, len(swish))), at(1, dt), 0.05)
    t, k = at(2, 0.3), 0
    rng = np.random.default_rng(4)
    while t < at(2, 1.9):
        put(sfx, E7.tap(k), t, 0.16 * rng.uniform(0.6, 1.0))
        t += rng.uniform(0.1, 0.17)
        k += 1
    put(sfx, E7.tap(60), at(3, 0.3), 0.2)                     # "3"
    put(sfx, E7.tap(61), at(3, 0.55), 0.2)                    # "8"
    put(sfx, AU.pop(900, 700, 0.08), at(3, 1.25), 0.15)       # the preview card: 38 жыл тәжірибе
    put(sfx, E7.tap(62), at(3, 2.4), 0.22)                    # Профильді жариялау
    put(sfx, AU.whoosh(0.22), at(3, 2.45), 0.14)

    # 5 morning: the phone buzzes, the dombra: a job
    put(sfx, buzz(2), at(5, 0.1), 0.25)
    dombra = AK.load(REPO / "public/sounds/dombra.wav")
    put(sfx, dombra, at(5, 0.15), 0.75)
    a, b = at(5), at(9)
    put(amb, E7.room(b - a, 31) * 0.05, a)
    birds = TN.river(b - a)  # soft outdoor air with a bird through the window
    put(amb, lp(birds, 4000) * 0.03, a)

    # 8 the toolbox; one dombra string as he straightens up
    put(sfx, AK.clank() * 0.6, at(8, 0.7), 0.18)
    put(mus, AU.pluck(146.83, 2.5, bright=0.6, seed=7), at(8, 1.3), 0.5)

    # 9-11 the young man's flat: under the sink, the flashlight, the theme
    a, b = at(9), at(12)
    put(amb, E7.room(b - a, 41) * 0.05, a)
    for k, dt in enumerate((0.2, 1.6, 2.4)):
        put(sfx, lp(clink(10 + k), 3000), at(9, dt), 0.18)
    put(sfx, E7.tap(70), at(9, 3.2), 0.3)                     # the flashlight switches on
    for k, dt in enumerate((0.8, 2.1)):
        put(sfx, clink(20 + k), at(10, dt), 0.2)
    th0 = at(10, 0.0)
    put(mus, warm_theme(TOTAL - th0), th0, 1.0)
    put(sfx, dombra, at(12, 0.15), 0.8)

    env = AU.duck_envelope(vo, floor=0.5)
    out = vo * 1.0 + sfx * 0.75 + amb * 0.85 + mus * 0.3 * env
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
        TN.CLIPS = CLIPS
        TN.analyse(args.analyse)
        return
    out = pathlib.Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    screens, end = Screens(args.screen), EndCard()
    print(f"duration {TOTAL:.2f}s", flush=True)
    if args.stills:
        want = sorted(float(x) for x in args.stills.split(","))
        for t, img in frames(screens, end):
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
    for k, (t, img) in enumerate(frames(screens, end)):
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
