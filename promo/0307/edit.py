#!/usr/bin/env python3
"""Edits the "03:07" ad from one locked-off overhead Kling take (promo/0307/clips/take.mp4) with its
middle re-shot (clips/pillow.mp4), a blackout line and the campaign end card.

In the take her body morphed instead of rolling over into the pillow (1.3-4.5 s). That stretch was
re-shot from the take's own frames 31 and 108, so the new clip starts and ends on the take's
pictures and is cut in with a short crossfade on each side.

There is no dialogue. Kling's own audio is dropped and every sound is made here: the bathroom tap
dripping behind the door (muffled while she holds the pillow over her ears), room tone, bedding
foley that follows the movement on screen, a frustrated sigh, the phone, a short dombra-like
phrase when she can finally sleep, one last drip in the dark, and the app's dombra sound as the
logo on the end card.

Usage:
  python3 promo/0307/edit.py --analyse <dir> [--clip take|pillow]   contact sheet + motion curve
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
CLIPS = HERE / "clips"
SRC_W, SRC_H = 716, 1280

# ------------------------------------------------------------------ the cut
# (source clip, first frame, end frame (exclusive), speed), in 24 fps frames of each clip.
EDIT = [
    ("take", 0, 31, 1.0),         # 0.00-1.29 s: she stares into the lens, her eyes slowly close
    ("pillow", 0, 96, 1.0),       # re-shot: the pillow pressed over her ears against the drip; she gives up
    ("take", 109, 158, 1.0),      # 4.54-6.58 s: hands in her hair, she reaches for the phone
    ("take", 158, 247, 1.25),     # 6.58-10.29 s: typing, a touch quicker
    ("take", 247, 351, 1.0),      # 10.29-14.63 s: sent, phone down, she turns onto her side and sleeps
]
XF = 3  # frames of crossfade where the re-shot clip meets the take

# Moments on screen: (clip, frame).
EV = {
    "cover": ("pillow", 30),      # pillow folded over her ears (set from --analyse --clip pillow)
    "release": ("pillow", 66),    # she lets go of it
    "pick": ("take", 127),        # phone lifted off the nightstand
    "type0": ("take", 151),       # typing starts
    "send": ("take", 251),        # request sent
    "lock": ("take", 257),        # screen off, the blue light goes
    "down": ("take", 283),        # phone set back on the nightstand
    "smile": ("take", 288),       # eyes closed, the smile; she turns onto her side
}
DRIP_STEP = 1.35       # seconds between drops once the rhythm is set
BLACK = 2.9            # blackout with the line
END = 3.4              # end card
LAST_DRIP = 0.4        # the drop heard in the dark, seconds after the cut to black


def build():
    """Per output frame of the picture: [(clip, frame, weight), ...]."""
    seq, prev = [], None
    for src, a, b, sp in EDIT:
        n = int(round((b - a) / sp))
        idx = [a + int(round(k * sp)) for k in range(n)]
        piece = [[(src, f, 1.0)] for f in idx]
        if prev and prev[0] != src:
            psrc, pnext = prev
            for j in range(XF):
                w = (j + 1) / (XF + 1)
                if psrc == "take":   # the take runs on under the new clip's first frames
                    piece[j] = [("take", pnext + j, 1 - w), (src, idx[j], w)]
                else:                # the take is already running under the old clip's last frames
                    k = len(seq) - XF + j
                    seq[k] = [(psrc, seq[k][0][1], 1 - w), ("take", a - XF + j, w)]
        seq += piece
        prev = (src, idx[-1] + 1)
    return seq


SEQ = build()
TAKE_DUR = len(SEQ) / FPS
TOTAL = TAKE_DUR + BLACK + END


def ot(src, frame):
    """Output time where clip `src` reaches `frame` on screen."""
    for k, comps in enumerate(SEQ):
        s, f, _ = max(comps, key=lambda c: c[2])
        if s == src and f >= frame:
            return k / FPS
    raise ValueError(f"{src} frame {frame} is not in the cut")


def evt(name):
    return ot(*EV[name])


# ------------------------------------------------------------------ pictures
def decode(name, size=(SRC_W, SRC_H), gray=False):
    fmt = "gray" if gray else "rgb24"
    ch = 1 if gray else 3
    cmd = ["ffmpeg", "-v", "error", "-i", str(CLIPS / f"{name}.mp4"), "-vf", f"fps={FPS},scale={size[0]}:{size[1]}",
           "-f", "rawvideo", "-pix_fmt", fmt, "-"]
    raw = subprocess.run(cmd, check=True, capture_output=True).stdout
    arr = np.frombuffer(raw, np.uint8)
    return arr.reshape(-1, size[1], size[0]) if gray else arr.reshape(-1, size[1], size[0], ch)


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
    clips = {name: decode(name) for name in {s for s, *_ in EDIT}}
    vig = vignette()
    h2 = int(round(SRC_H * W / SRC_W))
    top = (h2 - H) // 2
    for k, comps in enumerate(SEQ):
        acc = np.zeros((SRC_H, SRC_W, 3), np.float32)
        for s, f, w in comps:
            acc += clips[s][min(f, len(clips[s]) - 1)].astype(np.float32) * w
        img = Image.fromarray(np.clip(acc, 0, 255).astype(np.uint8)).resize((W, h2), Image.LANCZOS)
        f = np.asarray(img, np.float32)[top:top + H] * vig
        yield k / FPS, Image.fromarray(np.clip(f, 0, 255).astype(np.uint8))
    black, end = Blackout(), AK.EndCard()
    for k in range(int(round(BLACK * FPS))):
        yield TAKE_DUR + k / FPS, black.frame(k / FPS)
    for k in range(int(round(END * FPS))):
        yield TAKE_DUR + BLACK + k / FPS, end.frame(k / FPS)


# ------------------------------------------------------------------ analysis
def motion(name):
    """Mean frame difference per frame of a clip (low resolution, grey)."""
    fr = decode(name, (90, 160), gray=True).astype(np.float32)
    d = np.abs(np.diff(fr, axis=0)).mean(axis=(1, 2))
    return np.concatenate([[d[0]], d])


def analyse(out, name):
    out = pathlib.Path(out)
    out.mkdir(parents=True, exist_ok=True)
    m = motion(name)
    for k in range(0, len(m), 3):
        print(f"f{k:3d} {k / FPS:5.2f}s  {'#' * int(m[k] * 8)}  {m[k]:.2f}")
    fr = decode(name, (180, 322))
    step = 6
    imgs = [(k, Image.fromarray(fr[k])) for k in range(0, len(fr), step)]
    cols = 8
    rows = (len(imgs) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * 180, rows * (322 + 22)), (20, 20, 20))
    d = ImageDraw.Draw(sheet)
    for i, (k, im) in enumerate(imgs):
        x, y = (i % cols) * 180, (i // cols) * (322 + 22)
        sheet.paste(im, (x, y + 22))
        d.text((x + 6, y + 4), f"f{k} {k / FPS:.2f}s", fill=(255, 255, 0))
    sheet.save(out / f"sheet_{name}.jpg", quality=88)
    print("sheet ->", out / f"sheet_{name}.jpg", "frames", len(fr))


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
    return norm(lp(hp(x, 25), 380))


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


def sigh(seed=5, dur=1.3, cutoff=1800):
    """A long, fed-up exhale: breath with a little voice in it."""
    rng = np.random.default_rng(seed)
    n = int(dur * SR)
    t = np.arange(n) / SR
    env = np.minimum(1, t / 0.18) * np.exp(-np.maximum(0, t - 0.25) * 2.2) * np.minimum(1, (dur - t) / 0.2)
    breath = bp(rng.normal(0, 1, n), 250, 2600)
    ph = 2 * np.pi * np.cumsum(205 - 45 * t / dur) / SR
    voiced = bp(sum(np.sin(k * ph) / k for k in range(1, 12)), 150, 900)
    venv = np.clip((t - 0.12) / 0.2, 0, 1) * np.exp(-np.maximum(0, t - 0.35) * 3.0)
    return norm(lp(norm(breath) * env * 0.75 + norm(voiced) * venv * env * 0.25, cutoff))


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
        AU.place(out, AU.pluck(f, 2.2, bright=0.42, seed=int(f)), t0, g)
    return norm(lp(out, 3200))


def motion_env(n):
    """Per-sample loudness for the bedding foley, following the movement on screen."""
    mo = {name: motion(name) for name in {s for s, *_ in EDIT}}
    m = np.array([sum(w * mo[s][min(f, len(mo[s]) - 1)] for s, f, w in comps) for comps in SEQ])
    lo, hi = np.percentile(m, 35) * 1.15, np.percentile(m, 97)
    e = np.clip((m - lo) / (hi - lo + 1e-9), 0, 1) ** 0.8
    env = np.interp(np.arange(n) / SR, np.arange(len(e)) / FPS, e, right=0.0)
    out = np.empty_like(env)
    g = 0.0
    a, r = np.exp(-1 / (0.03 * SR)), np.exp(-1 / (0.18 * SR))
    for i, v in enumerate(env):
        k = a if v > g else r
        g = k * g + (1 - k) * v
        out[i] = g
    return out


def drips():
    """(time, gain, cutoff) of every drop: one wakes her, then a steady rhythm; muffled while the pillow
    is over her ears; none while she sets the phone down; then they fade from her mind."""
    t_cover, t_release = evt("cover"), evt("release")
    t_down, t_smile = evt("down"), evt("smile")
    out = [(0.20, 0.55, 5500)]
    t = ot("pillow", 4)  # the drop that makes her frown
    while t < TAKE_DUR - 0.5:
        if abs(t - t_down) < 0.35 or abs(t - evt("send")) < 0.2:
            t += 0.4
            continue
        if t_cover + 0.1 <= t <= t_release:
            out.append((t, 0.35, 650))           # through the pillow
        else:
            p = R.prog(t, t_down, t_smile + 0.8)
            out.append((t, 0.55 * (1 - 0.55 * p), 5500 - 2800 * p))
        t += DRIP_STEP
    return out


def mix():
    n = int(TOTAL * SR) + SR
    sfx, amb, mus = np.zeros(n), np.zeros(n), np.zeros(n)
    put = AU.place
    t_cut = TAKE_DUR

    # room tone under the picture, ducked while the pillow is over her ears, gone with the cut to black
    rt = room(t_cut) * 0.05
    tt = np.arange(len(rt)) / SR
    rt *= 1 - 0.6 * np.clip(np.minimum((tt - evt("cover")) / 0.2, (evt("release") - tt) / 0.2), 0, 1)
    rt[-int(0.02 * SR):] *= np.linspace(1, 0, int(0.02 * SR))
    put(amb, rt, 0.0)

    # the tap behind the door
    for k, (t, g, cut) in enumerate(drips()):
        put(sfx, plink(100 + k, cutoff=cut), t, g)
    put(sfx, plink(7), t_cut + LAST_DRIP, 0.6)  # ...and in the dark, it is still dripping

    # bedding foley from the movement; a fed-up sigh as she lets go of the pillow
    put(sfx, rustle(motion_env(int(t_cut * SR))), 0.0, 0.32)
    put(sfx, sigh(), evt("release") + 0.1, 0.3)

    # the phone
    put(sfx, clack(1), evt("pick"), 0.22)
    t, k = evt("type0"), 0
    rng = np.random.default_rng(9)
    while t < evt("send") - 0.1:
        put(sfx, tap(k), t, 0.16 * rng.uniform(0.6, 1.0))
        t += rng.uniform(0.09, 0.16)
        k += 1
    put(sfx, AU.whoosh(0.22), evt("send"), 0.16)
    put(sfx, AU.pop(1100, 750, 0.09), evt("send") + 0.2, 0.12)
    put(sfx, tap(50), evt("lock"), 0.12)
    put(sfx, clack(2), evt("down"), 0.18)

    # relief: four soft plucks as she settles; the dombra as the sound logo on the end card
    put(mus, phrase(), evt("down") + 0.35, 0.3)
    put(sfx, AK.load(REPO / "public/sounds/dombra.wav"), t_cut + BLACK + 0.15, 0.9)

    return norm((sfx + amb + mus)[: int(TOTAL * SR)], 0.95)


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
    ap.add_argument("--clip", default="take")
    args = ap.parse_args()
    if args.analyse:
        analyse(args.analyse, args.clip)
        return
    out = pathlib.Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    print(f"picture {TAKE_DUR:.2f}s, total {TOTAL:.2f}s; " + ", ".join(f"{k} {evt(k):.2f}" for k in EV), flush=True)

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
