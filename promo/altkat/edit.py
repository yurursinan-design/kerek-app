#!/usr/bin/env python3
"""Edits the Alt Kat ad from the Kling clips (promo/altkat/clips), the app-styled chat inserts
(chat_insert.py), the Kazakh character lines (promo/altkat/voice) and synthesised sound.

Kling's own audio is dropped: every voice, effect and music cue is laid in here.

Usage: python3 promo/altkat/edit.py --chat <chat png dir> --out <file.mp4> [--stills t1,t2,...]
"""

import argparse
import math
import pathlib
import subprocess
import sys
import wave

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(REPO / "promo/video"))
import audio as AU  # noqa: E402
import render as R  # noqa: E402

W, H, FPS = 1080, 1920, 24
SR = AU.SR
CLIPS = HERE / "clips"
VOICE = HERE / "voice"

# ------------------------------------------------------------------ timeline
# (kind, source, in, out) for clips; (kind, dur) for inserts and the end card
SEGMENTS = [
    ("clip", "G1_K1K7", 0.0, 2.4),   # hook: peephole, three knocks
    ("clip", "K2", 0.0, 2.6),        # husband recoils, whispers
    ("clip", "K3", 0.3, 1.9),        # the flooded kitchen
    ("clip", "K4", 0.2, 3.0),        # wife mocks him, knocks again, "Open!"
    ("clip", "K5", 0.0, 3.2),        # she texts the master, he hides
    ("chatA", None, 0.0, 1.6),       # her message in the app
    ("clip", "K6", 0.0, 2.2),        # notification behind the door, they freeze
    ("clip", "G1_K1K7", 3.7, 8.4),   # peephole: he reads it, looks at the ceiling
    ("chatB", None, 0.0, 1.6),       # "I'm at your door."
    ("clip", "K8", 0.0, 2.2),        # they look at each other: "Master?"
    ("clip", "K9", 0.0, 7.0),        # door opens: the punchline
    ("clip", "K10", 0.3, 3.6),       # he fixes it, they help
    ("clip", "K11", 0.0, 4.0),       # a drop from the flat above
    ("end", None, 0.0, 3.4),         # end card
]


def seg_times():
    t, out = 0.0, []
    for s in SEGMENTS:
        d = s[3] - s[2]
        out.append((t, t + d))
        t += d
    return out, t


TIMES, TOTAL = seg_times()


def at(i, dt):
    """Absolute time of `dt` seconds into segment i."""
    return TIMES[i][0] + dt


# ------------------------------------------------------------------ subtitles (Russian)
SUBS = [
    (at(1, 1.0), at(1, 2.6), "Сосед снизу, наверное…"),
    (at(3, 0.2), at(3, 2.3), "«Завтра починю», говорил…"),
    (at(3, 2.6), at(4, 1.2), "— Откройте!"),
    (at(4, 1.7), at(4, 3.2), "Ну скорее же…"),
    (at(5, 0.2), at(5, 1.6), "«Приходите скорее!»", 430),
    (at(8, 0.25), at(8, 1.6), "«Я у вашей двери.»", 430),
    (at(9, 0.9), at(9, 2.2), "— Мастер?"),
    (at(10, 0.4), at(10, 5.95), "Ваш заказ пришёл ко мне дважды: на телефон…"),
    (at(10, 5.95), at(10, 7.0), "…и на голову."),
    (at(12, 0.9), at(12, 4.0), "Следующий заказ — этажом выше."),
]
_sub_cache = {}


def draw_subs(cv, t):
    for s, e, text, *pos in SUBS:
        if s - 0.08 <= t <= e:
            if text not in _sub_cache:
                _sub_cache[text] = R.Subtitle(text)
            a = min(R.prog(t, s - 0.08, s + 0.04), 1 - R.prog(t, e - 0.08, e))
            _sub_cache[text].draw(cv, a, cy=pos[0] if pos else 1560)


# ------------------------------------------------------------------ pictures
def clip_frames(name, t0, t1):
    n = int(round((t1 - t0) * FPS))
    cmd = ["ffmpeg", "-v", "error", "-ss", f"{t0:.3f}", "-i", str(CLIPS / f"{name}.mp4"), "-frames:v", str(n),
           "-vf", f"fps={FPS},scale={W}:-2:flags=lanczos,crop={W}:{H}", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE)
    size = W * H * 3
    got = 0
    last = None
    while got < n:
        buf = proc.stdout.read(size)
        if len(buf) < size:
            break
        last = Image.frombytes("RGB", (W, H), buf)
        got += 1
        yield last
    proc.stdout.close()
    proc.wait()
    while got < n and last is not None:  # clip shorter than asked: hold the last frame
        got += 1
        yield last


class Chat:
    def __init__(self, folder):
        f = pathlib.Path(folder)
        self.typing = [Image.open(p).convert("RGB") for p in sorted(f.glob("type_*.png"))]
        self.sent = Image.open(f / "sent.png").convert("RGB")
        self.reply = Image.open(f / "reply.png").convert("RGB")

    @staticmethod
    def zoom(img, z):
        if z <= 1.0005:
            return img
        w, h = int(W / z), int(H / z)
        x, y = (W - w) // 2, int((H - h) * 0.6)
        return img.crop((x, y, x + w, y + h)).resize((W, H), Image.BICUBIC)

    def a(self, dt):
        if dt < 1.0:
            img = self.typing[min(len(self.typing) - 1, int(dt / 1.0 * len(self.typing)))]
        else:
            img = self.sent
        return self.zoom(img, 1.0 + 0.04 * dt / 1.6)

    def b(self, dt):
        img = self.sent if dt < 0.25 else self.reply
        return self.zoom(img, 1.0 + 0.04 * dt / 1.6)


class EndCard:
    def __init__(self):
        self.bg = R.make_bg()
        icon = Image.open(REPO / "store/icon.png").convert("RGBA")
        self.icon = icon.resize((250, 250), Image.LANCZOS)
        self.word = R.Text("Tapsyr", size=128, maxw=800)
        self.l1 = R.Text("Шебер іздесең — *Tapsyr.*", size=64, maxw=1000)
        self.l2 = R.Text("Тапсырыс іздесең — *Tapsyr.*", size=64, maxw=1000)
        self.ru = [R.Text(t, path=R.F_SEMI, size=38, maxw=900, color=(225, 236, 255))
                   for t in ("Ищешь мастера — Tapsyr.", "Ищешь заказы — Tapsyr.")]
        f = R.font(R.F_BLACK, 48)
        txt = "ЖАҚЫНДА · СКОРО"
        self.soon = R.rgba_rect(int(f.getlength(txt) + 86), 96, 48, R.YELLOW + (255,))
        ImageDraw.Draw(self.soon).text((43, 19), txt, font=f, fill=R.NAVY)
        self.city = R.Text("Қызылорда", path=R.F_BOLD, size=46, maxw=700)
        glow = Image.new("L", (520, 520), 0)
        ImageDraw.Draw(glow).ellipse((60, 60, 460, 460), fill=255)
        self.glow = Image.new("RGBA", (520, 520), (255, 255, 255, 0))
        self.glow.putalpha(glow.filter(ImageFilter.GaussianBlur(65)).point(lambda v: int(v * 0.55)))

    def frame(self, dt):
        cv = self.bg.copy()
        p = R.prog(dt, 0.0, 0.45)
        R.paste_center(cv, self.glow, 540, 520, min(1, p * 2))
        R.paste_center(cv, self.icon, 540, 520, min(1, p * 2), 0.5 + 0.5 * R.e_back(p))
        self.word.draw(cv, W / 2, 690, R.prog(dt, 0.15, 0.45), dy=24 * (1 - R.e_out(R.prog(dt, 0.15, 0.5))))
        for k, (txt, y) in enumerate(((self.l1, 900), (self.l2, 990))):
            q = R.prog(dt, 0.45 + 0.25 * k, 0.75 + 0.25 * k)
            txt.draw(cv, W / 2, y, q, dy=22 * (1 - R.e_out(q)))
        for k, txt in enumerate(self.ru):
            txt.draw(cv, W / 2, 1090 + 50 * k, R.prog(dt, 1.1, 1.4))
        q = R.prog(dt, 1.5, 1.8)
        if q > 0:
            R.paste_center(cv, self.soon, 540, 1320, min(1, q * 2), 0.7 + 0.3 * R.e_back(q))
        self.city.draw(cv, W / 2, 1400, R.prog(dt, 1.85, 2.15))
        return cv


def frames(chat, end):
    for i, (kind, src, t0, t1) in enumerate(SEGMENTS):
        s0 = TIMES[i][0]
        n = int(round((t1 - t0) * FPS))
        if kind == "clip":
            gen = clip_frames(src, t0, t1)
            for k, img in enumerate(gen):
                yield s0 + k / FPS, img
        else:
            for k in range(n):
                dt = k / FPS
                if kind == "chatA":
                    img = chat.a(dt)
                elif kind == "chatB":
                    img = chat.b(dt)
                else:
                    img = end.frame(dt)
                yield s0 + dt, img


# ------------------------------------------------------------------ sound
def load(path, gain_db=0.0):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"],
                         check=True, capture_output=True).stdout
    x = np.frombuffer(raw, dtype=np.float32).astype(np.float64)
    x = R.trim(x, -45, 0.03)
    return x / (np.abs(x).max() + 1e-9) * 0.9 * 10 ** (gain_db / 20)


def lowpass(x, cutoff):
    # fast one-pole low-pass via scipy-free recursion in chunks of numpy (vectorised twice for steepness)
    a = math.exp(-2 * math.pi * cutoff / SR)
    y = np.empty_like(x)
    for _ in range(2):
        acc = 0.0
        for i in range(len(x)):
            acc = (1 - a) * x[i] + a * acc
            y[i] = acc
        x = y.copy()
    return y


def knock(seed=0):
    rng = np.random.default_rng(seed)
    t = np.arange(int(0.45 * SR)) / SR
    thud = np.sin(2 * np.pi * (70 + 60 * np.exp(-t * 30)) * t) * np.exp(-t * 14)
    metal = sum(np.sin(2 * np.pi * f * t + rng.uniform(0, 6)) * np.exp(-t * d) * g
                for f, d, g in ((310, 9, 0.35), (467, 11, 0.25), (720, 14, 0.15), (1130, 20, 0.08)))
    hit = rng.normal(0, 1, len(t)) * np.exp(-t * 120) * 0.5
    return (thud * 0.9 + metal + hit) * 0.9


def hum(dur):
    t = np.arange(int(dur * SR)) / SR
    x = sum(np.sin(2 * np.pi * f * t) * g for f, g in ((100, 0.5), (150, 0.25), (200, 0.2), (300, 0.08)))
    x *= 0.8 + 0.2 * np.sin(2 * np.pi * 0.7 * t)
    return x * 0.12


def drone(dur):
    t = np.arange(int(dur * SR)) / SR
    x = np.sin(2 * np.pi * 55 * t) + 0.6 * np.sin(2 * np.pi * 82.4 * t + 1) + 0.25 * np.sin(2 * np.pi * 110.5 * t)
    env = np.minimum(1, t / 1.5) * (0.85 + 0.15 * np.sin(2 * np.pi * 0.25 * t))
    return x * env * 0.25


def water(dur, seed=4):
    rng = np.random.default_rng(seed)
    n = int(dur * SR)
    noise = rng.normal(0, 1, n)
    flow = noise - lowpass(noise, 400)
    flow = lowpass(flow, 3500) * (0.7 + 0.3 * np.sin(np.arange(n) / SR * 2 * np.pi * 3.1))
    return flow * 0.35


def clank():
    t = np.arange(int(0.5 * SR)) / SR
    return sum(np.sin(2 * np.pi * f * t) * np.exp(-t * d) * g
               for f, d, g in ((1210, 9, 0.4), (1873, 12, 0.3), (2655, 16, 0.2), (3480, 22, 0.1))) * 0.6


def mix():
    n = int(TOTAL * SR) + SR
    voice, sfx, amb, mus = (np.zeros(n) for _ in range(4))

    def put(track, clip, t, g=1.0):
        AU.place(track, clip, t, g)

    # voices
    put(voice, load(VOICE / "d1_nurlan.wav", -3), at(1, 1.0))
    put(voice, load(VOICE / "d2_aigul_Leda.wav"), at(3, 0.2))
    door = load(VOICE / "d3_kanat_door.wav")
    put(voice, lowpass(door, 900) * 1.6, at(3, 2.6), 0.75)      # through the steel door
    put(voice, load(VOICE / "d4_aigul_Leda.wav", -4), at(4, 0.9))
    put(voice, load(VOICE / "d5_kanat_short.wav"), at(10, 0.2))
    put(voice, load(VOICE / "d6_kanat.wav", -2), at(12, 0.9))

    # knocks: loud on the hook (we are right behind the door), muffled later
    for k, dt in enumerate((0.5, 0.85, 1.55)):
        put(sfx, knock(k), at(0, dt), 1.0)
    for k, dt in enumerate((2.15, 2.45)):
        put(sfx, knock(k + 5), at(3, dt), 0.75)

    # ambience: bulb hum on the landing and in the hall, water in the kitchen
    put(amb, hum(at(10, 7.0)), 0.0, 0.5)
    put(amb, water(TIMES[2][1] - TIMES[2][0] + 0.4), at(2, -0.2), 0.9)
    drip = AU.drip()
    for dt in (0.3, 0.9, 1.4):
        put(sfx, drip, at(2, dt), 0.5)

    # tension drone from the flood to the moment the notification rings behind the door
    d0, d1 = at(2, 0.0), at(6, 0.15)
    dr = drone(d1 - d0)
    dr[-int(0.05 * SR):] *= np.linspace(1, 0, int(0.05 * SR))
    put(amb, dr, d0, 0.9)

    # phones
    tick = AU.tick()
    for k in range(9):
        put(sfx, tick, at(4, 0.6 + k * 0.22), 0.35)          # she types
    for k in range(14):
        put(sfx, tick, at(5, 0.05 + k * 0.065), 0.3)         # typing in the app
    put(sfx, AU.whoosh(0.25), at(5, 1.05), 0.35)            # sent
    dombra = load(REPO / "public/sounds/dombra.wav")
    put(sfx, lowpass(dombra, 1200) * 1.5, at(6, 0.15), 0.8)  # the master's phone, behind the door
    for k in range(6):
        put(sfx, lowpass(tick, 1500), at(7, 3.6 + k * 0.12), 0.35)  # he types a reply behind the door
    put(sfx, AU.blip(), at(8, 0.25), 0.7)                   # reply arrives on her phone

    # kitchen: the repair, then the next drop
    put(sfx, clank(), at(11, 0.6), 0.4)
    put(sfx, clank(), at(11, 1.7), 0.3)
    put(sfx, drip, at(12, 0.3), 0.9)

    # end card: the dombra as the sound logo
    put(sfx, dombra, at(13, 0.15), 0.9)

    # music: warm plucks from the repair to the end
    m0 = at(11, 0.0)
    m = AU.music(TOTAL - m0 + 0.5)
    m[: int(0.8 * SR)] *= np.linspace(0, 1, int(0.8 * SR))
    put(mus, m, m0, 1.0)

    env = AU.duck_envelope(voice, floor=0.4)
    out = voice * 1.0 + sfx * 0.6 + amb * 0.5 + mus * 0.18 * env
    peak = np.abs(out).max()
    if peak > 0.97:
        out = out / peak * 0.97
    return out[: int(TOTAL * SR)]


def write_wav(path, x):
    pcm = (np.clip(x, -1, 1) * 32767).astype(np.int16)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(np.repeat(pcm[:, None], 2, axis=1).tobytes())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--chat", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--stills", default="")
    args = ap.parse_args()
    out = pathlib.Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    chat, end = Chat(args.chat), EndCard()
    print(f"duration {TOTAL:.2f}s", flush=True)

    if args.stills:
        want = sorted(float(x) for x in args.stills.split(","))
        for t, img in frames(chat, end):
            while want and t >= want[0]:
                cv = img.copy()
                draw_subs(cv, t)
                cv.save(out.parent / f"still_{want[0]:06.2f}.png")
                want.pop(0)
            if not want:
                break
        return

    wav = out.with_suffix(".wav")
    write_wav(wav, mix())
    cmd = ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS),
           "-i", "-", "-i", str(wav), "-c:v", "libx264", "-preset", "veryfast", "-crf", "19", "-pix_fmt", "yuv420p",
           "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-shortest", str(out)]
    enc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    for k, (t, img) in enumerate(frames(chat, end)):
        cv = img.copy()
        draw_subs(cv, t)
        enc.stdin.write(cv.tobytes())
        if k % 120 == 0:
            print(f"t={t:.1f}s", flush=True)
    enc.stdin.close()
    enc.wait()
    print("wrote", out)


if __name__ == "__main__":
    main()
