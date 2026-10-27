#!/usr/bin/env python3
"""Edits the "03:07" ad: one locked-off overhead Kling take (promo/0307/clips/take.mp4), a blackout
line and the campaign end card.

There is no dialogue. Kling's own audio is dropped and every sound is made here: the bathroom tap
dripping behind the door, room tone, bedding foley that follows the movement in the take, a sigh
into the pillow, the phone, a short dombra-like phrase when she can finally sleep, one last drip in
the dark, and the app's dombra sound as the logo on the end card.

Usage:
  python3 promo/0307/edit.py --analyse <dir>          contact sheet + motion curve of the take
  python3 promo/0307/edit.py --out <file.mp4> [--stills t1,t2,...]
"""

import argparse
import importlib.util
import pathlib
import subprocess
import sys
import wave

import numpy as np
from PIL import Image, ImageDraw
from scipy.signal import butter, fftconvolve, sosfilt

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(REPO / "promo/video"))
import audio as AU  # noqa: E402
import render as R  # noqa: E402

_spec = importlib.util.spec_from_file_location("altkat_edit", REPO / "promo/altkat/edit.py")
AK = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(AK)  # the campaign end card lives there

W, H, FPS = 1080, 1920, 24
SR = AU.SR
TAKE = HERE / "clips/take.mp4"
FRAMES = HERE / "frames"

# ------------------------------------------------------------------ timeline
# Pieces of the take that are used, in order: (clip in, clip out, speed).
PIECES = [(0.0, 15.0, 1.0)]
# Moments in the take, in clip seconds (set after watching it with --analyse).
EV = {
    "pillow": 4.0,      # face reaches the pillow
    "pick": 7.0,        # phone lifted off the nightstand
    "type0": 8.0,       # typing starts
    "type1": 10.0,      # typing ends
    "send": 10.1,       # message sent
    "down": 11.0,       # phone set back on the nightstand
    "smile": 13.0,      # eyes closed, the smile
}
BLACK = 2.9            # blackout with the line
END = 3.4              # end card
LAST_DRIP = 0.4        # the drip heard in the dark, seconds after the cut to black


def take_times():
    """Clip time for every output frame of the take."""
    out = []
    for a, b, sp in PIECES:
        n = int(round((b - a) / sp * FPS))
        out += [a + k * sp / FPS for k in range(n)]
    return out


CT = take_times()
TAKE_DUR = len(CT) / FPS
TOTAL = TAKE_DUR + BLACK + END


def ot(ct):
    """Output time of clip time `ct` (first output frame at or after it)."""
    for k, c in enumerate(CT):
        if c >= ct - 1e-6:
            return k / FPS
    return TAKE_DUR


# ------------------------------------------------------------------ pictures
class Take:
    """Streams the take scaled to 1080 wide and cropped to 1920 high; frames asked in order."""

    def __init__(self):
        cmd = ["ffmpeg", "-v", "error", "-i", str(TAKE), "-vf", f"fps={FPS},scale={W}:-2:flags=lanczos,crop={W}:{H}",
               "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
        self.proc = subprocess.Popen(cmd, stdout=subprocess.PIPE)
        self.idx, self.cur = -1, None

    def at(self, ct):
        want = int(round(ct * FPS))
        while self.idx < want:
            buf = self.proc.stdout.read(W * H * 3)
            if len(buf) < W * H * 3:
                break  # past the end: hold the last frame
            self.cur = np.frombuffer(buf, np.uint8).reshape(H, W, 3)
            self.idx += 1
        return self.cur

    def close(self):
        self.proc.stdout.close()
        self.proc.wait()


def vignette():
    yy, xx = np.mgrid[0:H, 0:W]
    r = np.sqrt(((xx - W / 2) / (W * 0.62)) ** 2 + ((yy - H * 0.48) / (H * 0.62)) ** 2)
    return (1 - 0.22 * np.clip(r - 0.55, 0, 1) ** 1.6)[..., None].astype(np.float32)


class Blackout:
    def __init__(self):
        self.l1 = R.Text("*Тапсыр* да, ұйықта.", size=94, maxw=1000, shadow=0)
        self.l2 = R.Text("Поручи — и спи.", path=R.F_SEMI, size=48, maxw=900, color=(200, 212, 238), shadow=0)

    def frame(self, dt):
        cv = Image.new("RGB", (W, H), (0, 0, 0))
        t1 = LAST_DRIP + 0.3
        q = R.prog(dt, t1, t1 + 0.5)
        self.l1.draw(cv, W / 2, 830, q, dy=16 * (1 - R.e_out(q)))
        q = R.prog(dt, t1 + 0.35, t1 + 0.8)
        self.l2.draw(cv, W / 2, 975, q, dy=12 * (1 - R.e_out(q)))
        return cv


def frames():
    take, vig = Take(), vignette()
    for k, ct in enumerate(CT):
        f = take.at(ct).astype(np.float32) * vig
        yield k / FPS, Image.fromarray(np.clip(f, 0, 255).astype(np.uint8))
    take.close()
    black, end = Blackout(), AK.EndCard()
    for k in range(int(round(BLACK * FPS))):
        yield TAKE_DUR + k / FPS, black.frame(k / FPS)
    for k in range(int(round(END * FPS))):
        yield TAKE_DUR + BLACK + k / FPS, end.frame(k / FPS)


# ------------------------------------------------------------------ analysis
def motion(size=(90, 160)):
    """Mean frame difference of the take per clip frame (24 fps), low resolution, grey."""
    cmd = ["ffmpeg", "-v", "error", "-i", str(TAKE), "-vf", f"fps={FPS},scale={size[0]}:{size[1]},format=gray",
           "-f", "rawvideo", "-"]
    raw = subprocess.run(cmd, check=True, capture_output=True).stdout
    fr = np.frombuffer(raw, np.uint8).reshape(-1, size[1], size[0]).astype(np.float32)
    d = np.abs(np.diff(fr, axis=0)).mean(axis=(1, 2))
    return np.concatenate([[d[0]], d])


def analyse(out):
    out = pathlib.Path(out)
    out.mkdir(parents=True, exist_ok=True)
    m = motion()
    for k in range(0, len(m), 6):
        print(f"{k / FPS:5.2f}s  {'#' * int(m[k] * 8)}  {m[k]:.2f}")
    # contact sheet: one frame every 0.5 s with its time
    cmd = ["ffmpeg", "-v", "error", "-i", str(TAKE), "-vf", "fps=2,scale=180:-2", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
    raw = subprocess.run(cmd, check=True, capture_output=True).stdout
    w = 180
    h = len(raw) // 3 // w
    probe = subprocess.run(["ffprobe", "-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries",
                            "stream=width,height", "-of", "csv=p=0", str(TAKE)], capture_output=True, text=True).stdout
    sw, sh = (int(v) for v in probe.strip().split(","))
    th = int(round(sh * w / sw / 2) * 2)
    n = len(raw) // (w * th * 3)
    imgs = [Image.frombytes("RGB", (w, th), raw[i * w * th * 3:(i + 1) * w * th * 3]) for i in range(n)]
    cols = 8
    rows = (n + cols - 1) // cols
    sheet = Image.new("RGB", (cols * w, rows * (th + 22)), (20, 20, 20))
    d = ImageDraw.Draw(sheet)
    for i, im in enumerate(imgs):
        x, y = (i % cols) * w, (i // cols) * (th + 22)
        sheet.paste(im, (x, y + 22))
        d.text((x + 6, y + 4), f"{i * 0.5:.1f}s", fill=(255, 255, 0))
    sheet.save(out / "sheet.jpg", quality=88)
    print("sheet", sheet.size, "->", out / "sheet.jpg", "frames", n, "src", sw, sh, h)


# ------------------------------------------------------------------ sound
def _sos(kind, f):
    return butter(2, f, btype=kind, fs=SR, output="sos")


def bp(x, lo, hi):
    return sosfilt(_sos("bandpass", [lo, hi]), x)


def lp(x, hi):
    return sosfilt(_sos("lowpass", hi), x)


def hp(x, lo):
    return sosfilt(_sos("highpass", lo), x)


def norm(x, peak=1.0):
    return x / (np.abs(x).max() + 1e-12) * peak


def plink(seed, cutoff=5500):
    """One drop into a half-full basin, in a tiled bathroom, heard through the door."""
    rng = np.random.default_rng(seed)
    t = np.arange(int(0.11 * SR)) / SR
    f = 980 * rng.uniform(0.95, 1.05) * (1 + 0.8 * (t / t[-1]) ** 0.6)
    dry = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 48) + rng.normal(0, 1, len(t)) * np.exp(-t * 1500) * 0.3
    ti = np.arange(int(0.6 * SR)) / SR
    ir = lp(rng.normal(0, 1, len(ti)) * np.exp(-ti / 0.11), 4000)
    wet = norm(fftconvolve(dry, ir))
    out = wet * 0.45
    out[: len(dry)] += dry * 0.9
    return norm(lp(out, cutoff))


def room(dur, seed=11):
    rng = np.random.default_rng(seed)
    x = np.cumsum(rng.normal(0, 1, int(dur * SR)))
    x = lp(hp(x, 25), 380)
    return norm(x)


def rustle(env, seed=21):
    rng = np.random.default_rng(seed)
    n = len(env)
    x = bp(rng.normal(0, 1, n), 350, 4500)
    flutter = lp(np.abs(rng.normal(0, 1, n)), 28)
    flutter /= flutter.mean()
    crk = (rng.random(n) < 0.0009).astype(float)
    crk = bp(fftconvolve(crk, rng.normal(0, 1, int(0.008 * SR)) * np.exp(-np.arange(int(0.008 * SR)) / SR * 500))[:n],
             1500, 7000)
    return norm(x * flutter) * 0.8 * env + norm(crk) * 0.35 * env


def sigh(seed=5, dur=1.5):
    """A long tired exhale into the pillow: breath with a little voice, muffled."""
    rng = np.random.default_rng(seed)
    n = int(dur * SR)
    t = np.arange(n) / SR
    env = np.minimum(1, t / 0.18) * np.exp(-np.maximum(0, t - 0.25) * 2.2) * np.minimum(1, (dur - t) / 0.2)
    breath = bp(rng.normal(0, 1, n), 250, 2200)
    ph = 2 * np.pi * np.cumsum(205 - 45 * t / dur) / SR
    voiced = bp(sum(np.sin(k * ph) / k for k in range(1, 12)), 150, 900)
    venv = np.clip((t - 0.12) / 0.2, 0, 1) * np.exp(-np.maximum(0, t - 0.35) * 3.0)
    return norm(lp(norm(breath) * env * 0.7 + norm(voiced) * venv * env * 0.35, 900))


def clack(seed=0):
    """The phone lifted from, or set down on, the nightstand."""
    rng = np.random.default_rng(seed)
    t = np.arange(int(0.14 * SR)) / SR
    x = bp(rng.normal(0, 1, len(t)), 1200, 6000) * np.exp(-t * 90)
    thump = np.sin(2 * np.pi * (140 + 80 * np.exp(-t * 40)) * t) * np.exp(-t * 35)
    return norm(norm(x) * 0.6 + thump * 0.7)


def tap(seed):
    rng = np.random.default_rng(seed)
    t = np.arange(int(0.03 * SR)) / SR
    x = bp(rng.normal(0, 1, len(t)), 2000, 8000) * np.exp(-t * 400)
    return norm(norm(x) * 0.6 + np.sin(2 * np.pi * 230 * t) * np.exp(-t * 150) * 0.4)


def phrase():
    """Four soft plucks falling to rest (A minor pentatonic), with a low A under the last."""
    out = np.zeros(int(3.6 * SR))
    for t0, f, g in ((0.0, 659.25, 0.8), (0.38, 587.33, 0.75), (0.76, 523.25, 0.7), (1.3, 440.0, 0.9), (1.3, 220.0, 0.5)):
        p = AU.pluck(f, 2.2, bright=0.42, seed=int(f))
        AU.place(out, p, t0, g)
    return norm(lp(out, 3200))


def motion_env(n):
    """Per-sample loudness for the bedding foley, following the movement in the take."""
    m = motion()
    m_out = np.array([m[min(len(m) - 1, int(round(c * FPS)))] for c in CT])
    lo, hi = np.percentile(m_out, 35) * 1.15, np.percentile(m_out, 97)
    e = np.clip((m_out - lo) / (hi - lo + 1e-9), 0, 1) ** 0.8
    t_frames = np.arange(len(e)) / FPS
    env = np.interp(np.arange(n) / SR, t_frames, e, right=0.0)
    # smooth: fast attack, slower release
    out = np.empty_like(env)
    g = 0.0
    a, r = np.exp(-1 / (0.03 * SR)), np.exp(-1 / (0.18 * SR))
    for i, v in enumerate(env):
        k = a if v > g else r
        g = k * g + (1 - k) * v
        out[i] = g
    return out


def mix():
    n = int(TOTAL * SR) + SR
    sfx, amb, mus = np.zeros(n), np.zeros(n), np.zeros(n)
    put = AU.place
    t_cut = TAKE_DUR
    t_down, t_smile = ot(EV["down"]), ot(EV["smile"])

    # room tone under the whole take, gone with the cut to black (she is asleep)
    rt = room(t_cut)
    rt[-int(0.02 * SR):] *= np.linspace(1, 0, int(0.02 * SR))
    put(amb, rt, 0.0, 0.05)

    # the tap behind the door: steady, every 1.6 s; once the phone is down it fades from her mind
    t, k = 0.25, 0
    while t < t_cut - 0.15:
        fade = 1 - 0.6 * R.prog(t, t_down, t_smile + 0.5)
        put(sfx, plink(100 + k, cutoff=5500 - 2800 * (1 - fade) / 0.6), t, 0.55 * fade)
        k += 1
        t += 1.6 + (0.04 if k % 3 == 0 else -0.02)
    put(sfx, plink(7), t_cut + LAST_DRIP, 0.6)  # ...and in the dark, it is still dripping

    # bedding foley from the movement, a sigh into the pillow
    env = motion_env(int(t_cut * SR))
    put(sfx, rustle(env), 0.0, 0.32)
    put(sfx, sigh(), ot(EV["pillow"]) + 0.3, 0.32)

    # the phone
    put(sfx, clack(1), ot(EV["pick"]), 0.22)
    t, k = ot(EV["type0"]), 0
    rng = np.random.default_rng(9)
    while t < ot(EV["type1"]):
        put(sfx, tap(k), t, 0.16 * rng.uniform(0.6, 1.0))
        t += rng.uniform(0.11, 0.19)
        k += 1
    put(sfx, AU.whoosh(0.22), ot(EV["send"]), 0.16)
    put(sfx, AU.pop(1100, 750, 0.09), ot(EV["send"]) + 0.2, 0.12)
    put(sfx, clack(2), t_down, 0.18)

    # relief: four soft plucks as she settles; the dombra as the sound logo on the end card
    put(mus, phrase(), t_down + 0.35, 0.3)
    put(sfx, AK.load(REPO / "public/sounds/dombra.wav"), t_cut + BLACK + 0.15, 0.9)

    out = sfx + amb + mus
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
    ap.add_argument("--out")
    ap.add_argument("--stills", default="")
    ap.add_argument("--analyse")
    args = ap.parse_args()
    if args.analyse:
        analyse(args.analyse)
        return
    out = pathlib.Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    print(f"take {TAKE_DUR:.2f}s, total {TOTAL:.2f}s", flush=True)

    if args.stills:
        want = sorted(float(x) for x in args.stills.split(","))
        for t, img in frames():
            while want and t >= want[0] - 1e-6:
                img.save(out.parent / f"still_{want[0]:06.2f}.jpg", quality=90)
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
    for k, (t, img) in enumerate(frames()):
        enc.stdin.write(img.tobytes())
        if k % 96 == 0:
            print(f"t={t:.1f}s", flush=True)
    enc.stdin.close()
    enc.wait()
    print("wrote", out)


if __name__ == "__main__":
    main()
