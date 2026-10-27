"""Sound for the promo video: a soft plucked-string music bed and small UI sound effects,
all synthesised here (no third-party audio), plus mixing helpers."""

import numpy as np

SR = 44100


def _env(n, attack=0.005, release=0.05):
    e = np.ones(n)
    a = max(1, int(attack * SR))
    r = max(1, int(release * SR))
    e[:a] = np.linspace(0, 1, a)
    e[-r:] *= np.linspace(1, 0, r)
    return e


def pluck(freq, dur, bright=0.5, seed=0):
    """Karplus-Strong plucked string (close to a dombra's dry pluck)."""
    rng = np.random.default_rng(seed)
    n = int(dur * SR)
    period = max(2, int(SR / freq))
    buf = rng.uniform(-1, 1, period)
    out = np.empty(n)
    decay = 0.996
    prev = 0.0
    for i in range(n):
        v = buf[i % period]
        out[i] = v
        nv = decay * (bright * v + (1 - bright) * prev)
        prev = v
        buf[i % period] = nv
    return out * _env(n, 0.001, 0.08)


def lowpass(x, cutoff):
    a = np.exp(-2 * np.pi * cutoff / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i, v in enumerate(x):
        acc = (1 - a) * v + a * acc
        y[i] = acc
    return y


def music(duration, bpm=104):
    """Light pentatonic plucks over a warm pad; loops for `duration` seconds."""
    beat = 60 / bpm
    n = int(duration * SR) + SR
    out = np.zeros(n)
    # A minor pentatonic-ish progression: Am - F - C - G (roots), arpeggios on eighths
    chords = [
        [220.0, 261.63, 329.63, 440.0],
        [174.61, 220.0, 261.63, 349.23],
        [130.81, 196.0, 261.63, 329.63],
        [196.0, 246.94, 293.66, 392.0],
    ]
    pattern = [0, 2, 1, 3, 2, 1, 3, 2]
    cache = {}
    t = 0.0
    bar = 0
    while t < duration + 1:
        chord = chords[bar % 4]
        for step, idx in enumerate(pattern):
            f = chord[idx] * 2
            key = (round(f, 2), step % 2)
            if key not in cache:
                cache[key] = pluck(f, 0.9, bright=0.55 if step % 2 else 0.7, seed=int(f))
            p = cache[key] * (0.55 if step % 2 else 0.8)
            s = int((t + step * beat / 2) * SR)
            e = min(n, s + len(p))
            if s < n:
                out[s:e] += p[: e - s]
        # pad: two detuned saws on the chord, low-passed
        dur = 4 * beat
        tt = np.arange(int(dur * SR)) / SR
        pad = np.zeros_like(tt)
        for f in chord[:3]:
            for det in (0.997, 1.003):
                ph = (tt * f * det) % 1.0
                pad += (2 * ph - 1)
        pad = lowpass(pad / 6, 900) * _env(len(tt), 0.4, 0.5) * 0.35
        s = int(t * SR)
        e = min(n, s + len(pad))
        if s < n:
            out[s:e] += pad[: e - s]
        # soft kick on beats 1 and 3, shaker on off-beats
        for b in range(4):
            s = int((t + b * beat) * SR)
            if b in (0, 2):
                kt = np.arange(int(0.18 * SR)) / SR
                kick = np.sin(2 * np.pi * (50 + 70 * np.exp(-kt * 30)) * kt) * np.exp(-kt * 18) * 0.5
                e = min(n, s + len(kick))
                if s < n:
                    out[s:e] += kick[: e - s]
            s2 = int((t + b * beat + beat / 2) * SR)
            sh = np.random.default_rng(b).normal(0, 1, int(0.05 * SR))
            sh = (sh - lowpass(sh, 5000)) * np.exp(-np.arange(len(sh)) / SR * 70) * 0.08
            e = min(n, s2 + len(sh))
            if s2 < n:
                out[s2:e] += sh[: e - s2]
        t += 4 * beat
        bar += 1
    out = out[: int(duration * SR)]
    fade = int(2.0 * SR)
    out[-fade:] *= np.linspace(1, 0, fade)
    out[: int(0.5 * SR)] *= np.linspace(0, 1, int(0.5 * SR))
    return out / (np.abs(out).max() + 1e-9)


def whoosh(dur=0.45):
    n = int(dur * SR)
    noise = np.random.default_rng(7).normal(0, 1, n)
    t = np.linspace(0, 1, n)
    # sweep a simple one-pole low-pass up and down
    y = np.empty(n)
    acc = 0.0
    for i in range(n):
        cut = 300 + 5000 * np.sin(np.pi * t[i]) ** 2
        a = np.exp(-2 * np.pi * cut / SR)
        acc = (1 - a) * noise[i] + a * acc
        y[i] = acc
    return y * np.sin(np.pi * t) ** 1.5 * 0.9


def pop(f0=900, f1=500, dur=0.12):
    t = np.arange(int(dur * SR)) / SR
    f = f1 + (f0 - f1) * np.exp(-t * 40)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 30) * 0.8


def tick():
    t = np.arange(int(0.025 * SR)) / SR
    return np.random.default_rng(3).normal(0, 1, len(t)) * np.exp(-t * 300) * 0.35


def blip():
    a = pop(1200, 1000, 0.08)
    b = pop(1600, 1400, 0.1)
    out = np.zeros(int(0.2 * SR))
    out[: len(a)] += a
    s = int(0.07 * SR)
    out[s: s + len(b)] += b
    return out * 0.6


def drip():
    t = np.arange(int(0.18 * SR)) / SR
    f = 600 + 1400 * (t / t[-1]) ** 0.5
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 25) * 0.7


def stamp():
    t = np.arange(int(0.35 * SR)) / SR
    thump = np.sin(2 * np.pi * (60 + 120 * np.exp(-t * 25)) * t) * np.exp(-t * 12)
    noise = np.random.default_rng(5).normal(0, 1, len(t)) * np.exp(-t * 40) * 0.3
    return (thump + noise) * 0.8


def chime():
    out = np.zeros(int(1.2 * SR))
    for i, f in enumerate((880, 1318.5, 1760)):
        t = np.arange(int(1.0 * SR)) / SR
        tone = (np.sin(2 * np.pi * f * t) + 0.3 * np.sin(4 * np.pi * f * t)) * np.exp(-t * 4) * 0.25
        s = int(i * 0.07 * SR)
        out[s: s + len(tone)] += tone
    return out


def place(track, clip, at, gain=1.0):
    s = int(at * SR)
    if s >= len(track) or s + len(clip) <= 0:
        return
    if s < 0:
        clip = clip[-s:]
        s = 0
    e = min(len(track), s + len(clip))
    track[s:e] += clip[: e - s] * gain


def duck_envelope(voice, floor=0.38, attack=0.05, release=0.35):
    """1.0 where the voice is silent, `floor` where it speaks, smoothed."""
    win = int(0.03 * SR)
    level = np.sqrt(np.convolve(voice ** 2, np.ones(win) / win, mode="same"))
    active = (level > 0.01).astype(float)
    target = 1 - (1 - floor) * active
    env = np.empty_like(target)
    g = 1.0
    a = np.exp(-1 / (attack * SR))
    r = np.exp(-1 / (release * SR))
    for i, v in enumerate(target):
        k = a if v < g else r
        g = k * g + (1 - k) * v
        env[i] = g
    return env
