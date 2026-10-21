"""Cuts the «Тапсыр!» ad together: Flow clips, graphics (overlay.html) and sound.

  python3 edit.py <clips dir> <sfx dir> <work dir> [kz,ru]

The clips dir holds the Flow videos as v01.mp4 … v14.mp4 (see SHOTS for which is which), the
sfx dir the Mixkit sounds used in sound() (free licence, no attribution needed). The original
sound of the clips is dropped. The result is tapsyr-tapsyr-<lang>.mp4 in the work dir:
1080×1920, 24 fps (the clips' own rate, so motion stays smooth), loudness -14 LUFS.
"""
import json, os, subprocess, sys, wave
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fx  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
CLIPS, SFX, WORK = (os.path.abspath(a) for a in sys.argv[1:4])
LANGS = (sys.argv[4] if len(sys.argv) > 4 else 'kz,ru').split(',')
FPS, SR = 24, 48000
os.makedirs(WORK, exist_ok=True)

# (clip, source start in s, frames, speed). Veo for movement, Omni where it kept faces and props.
# Cut after Gemini's review: the ride is shorter, the salute (an extra hand appears) and the end of
# the tea shot (a second bowl appears) are gone, and the landing is one push-in instead of a jump cut.
SHOTS = [
    ('v01', 1.2, 72, 1),    # kitchen, fountain, the grandmother sips (Veo)
    ('v04', 3.8, 77, 1),    # phone up, «Тапсыр!» at 6.1 s in the clip (Veo)
    ('v05', 3.4, 53, 1),    # riders on the Syr Darya bank (Veo)
    ('v07', 7.95, 46, 1),   # riders in the street; a horse passes the lens at the end (Omni)
    ('v10', 3.0, 84, 1),    # the three on the landing while the offers come in (Omni)
    ('v10', 6.5, 41, 2),    # … the push-in to Nurlan, twice as fast
    ('v12', 2.6, 48, 1),    # the tea is handed over (Omni)
    ('v14', 1.6, 67, 1),    # horses at the flower bed (Veo)
    (None, 0, 72, 1),       # end card (drawn by the overlay)
]
starts = np.cumsum([0] + [f for _, _, f, _ in SHOTS]) / FPS
S = dict(zip(['k1', 'k2', 'ride', 'street', 'door', 'close', 'tea', 'horses', 'end', 'total'], starts))
PICK = S['door'] + 2.0   # the grandmother picks Nurlan
TL = {
    'cap1': [0.25, S['k2'] - 0.25],
    'slam': S['k2'] + (6.1 - 3.8), 'slamOut': S['ride'] + 0.5,
    'saga1': [S['ride'] + 0.25, S['street'] - 0.15],
    'saga2': [S['street'] + 0.2, S['door'] - 0.2],
    'offers': [S['door'] + 0.3, PICK, S['close'] - 0.1],
    'tag': [S['close'] + 0.25, S['tea'] - 0.2],
    'cap6': [S['tea'] + 0.2, S['horses'] - 0.2],
    'cap7': [S['horses'] + 0.3, S['end'] - 0.2],
    'end': S['end'],
    'duration': S['total'],
}


def run(cmd):
    subprocess.run(cmd, check=True)


# ---------- picture ----------
# Transition after each shot (index = the shot it leaves). Zooms and whips only reshape the frames
# around the cut; the shanyrak burst and the light leak let the outgoing clip run on under the next
# one, so no cut point (and no graphic) moves.
TRANSITIONS = {
    0: ('zoom', dict(out=5, inn=5, a=(780, 1020), b=(540, 900), s_out=1.45, s_in=1.35)),
    1: ('burst', dict(n=10)),
    2: ('whip', dict(n=4, dir=-1)),
    3: ('whip', dict(n=4, dir=1)),      # with the horse that crosses the lens
    5: ('whip', dict(n=4, dir=-1)),
    6: ('leak', dict(n=8)),
}
FRAME = 1080 * 1920 * 3


def frames_of(path, start=None, count=None):
    cmd = ['ffmpeg', '-v', 'error'] + (['-ss', str(start)] if start is not None else []) + ['-i', path]
    cmd += ['-vf', f'fps={FPS},scale=1080:1920:flags=lanczos,unsharp=5:5:0.45:5:5:0'] if start is not None else []
    cmd += (['-frames:v', str(count)] if count else []) + ['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE)
    while True:
        buf = proc.stdout.read(FRAME)
        if len(buf) < FRAME:
            break
        yield np.frombuffer(buf, np.uint8).reshape(1920, 1080, 3)
    proc.wait()


def footage():
    out = os.path.join(WORK, 'bg.mp4')
    if os.path.exists(out):
        return out
    enc = ['-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '14', '-pix_fmt', 'yuv420p']
    parts = []
    for i, (clip, ss, frames, speed) in enumerate(SHOTS):
        part = os.path.join(WORK, f'part{i}.mp4')
        if not os.path.exists(part):
            if clip:
                run(['ffmpeg', '-v', 'error', '-y', '-ss', str(ss), '-i', os.path.join(CLIPS, f'{clip}.mp4'),
                     '-vf', f'setpts=PTS/{speed},fps={FPS},scale=1080:1920:flags=lanczos,unsharp=5:5:0.45:5:5:0,setsar=1',
                     '-frames:v', str(frames), *enc, part])
            else:
                run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', f'color=c=0x0284c7:s=1080x1920:r={FPS}',
                     '-frames:v', str(frames), *enc, part])
        parts.append(part)
    # What the overlapping transitions need: the next shot's first frame, the outgoing clip's run-on
    first = [next(frames_of(p, count=1)).copy() for p in parts]
    tails = {}
    for i, (kind, o) in TRANSITIONS.items():
        if kind in ('burst', 'leak'):
            clip, ss, frames, speed = SHOTS[i]
            tails[i] = [f.copy() for f in frames_of(os.path.join(CLIPS, f'{clip}.mp4'), ss + frames * speed / FPS, o['n'])]
    writer = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', '1080x1920',
                               '-r', str(FPS), '-i', '-', *enc, out], stdin=subprocess.PIPE)
    last = None
    for i, part in enumerate(parts):
        n = SHOTS[i][2]
        for j, frame in enumerate(frames_of(part)):
            img = frame
            if i in TRANSITIONS:                      # leaving this shot
                kind, o = TRANSITIONS[i]
                if kind == 'zoom' and j >= n - o['out']:
                    k = (j - (n - o['out']) + 1) / o['out']
                    img = fx.zoom(img, 1 + (o['s_out'] - 1) * fx.ease_in(k), *o['a'], k)
                elif kind == 'whip' and j >= n - o['n']:
                    img = fx.whip(img, first[i + 1], (j - (n - o['n']) + 0.5) / (2 * o['n']), o['dir'])
            if i - 1 in TRANSITIONS:                  # arriving in this shot
                kind, o = TRANSITIONS[i - 1]
                if kind == 'zoom' and j < o['inn']:
                    k = (j + 1) / o['inn']
                    img = fx.zoom(img, o['s_in'] + (1 - o['s_in']) * fx.ease_out(k), *o['b'], 0.8 * (1 - k))
                elif kind == 'whip' and j < o['n']:
                    img = fx.whip(last, img, 0.5 + (j + 0.5) / (2 * o['n']), o['dir'])
                elif kind == 'burst' and j < o['n']:
                    img = fx.burst(tails[i - 1][j], img, (j + 1) / (o['n'] + 1))
                elif kind == 'leak' and j < o['n']:
                    img = fx.leak(tails[i - 1][j], img, (j + 1) / (o['n'] + 1))
            writer.stdin.write(np.ascontiguousarray(img).tobytes())
            if j == n - 1:
                last = frame.copy()
    writer.stdin.close()
    writer.wait()
    return out


def overlay(lang):
    out = os.path.join(WORK, f'frames_{lang}')
    if not os.path.exists(os.path.join(out, f'f{int(round(S["total"] * FPS)) - 1:04d}.png')):
        run(['node', os.path.join(HERE, 'render-overlay.mjs'), lang, out, str(FPS), json.dumps(TL)])
    return out


# ---------- sound ----------
def load(name, start=0.0, dur=None, af=None):
    cmd = ['ffmpeg', '-v', 'error', '-ss', str(start), '-i', os.path.join(SFX, name)]
    if dur:
        cmd += ['-t', str(dur)]
    if af:
        cmd += ['-af', af]
    raw = subprocess.run(cmd + ['-ac', '2', '-ar', str(SR), '-f', 'f32le', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype='<f4').reshape(-1, 2).copy()


def db(x):
    return 10 ** (x / 20)


def fade(sig, fin=0.0, fout=0.0):
    n = len(sig)
    env = np.ones(n)
    if fin:
        k = min(n, int(fin * SR)); env[:k] = np.linspace(0, 1, k)
    if fout:
        k = min(n, int(fout * SR)); env[n - k:] *= np.linspace(1, 0, k)
    return sig * env[:, None]


def level(sig):
    """Loudness of the part of a sound that is actually heard (dBFS RMS over its louder 100 ms blocks)"""
    m = sig.mean(axis=1)
    w = SR // 10
    blocks = np.array([np.sqrt(np.mean(m[i:i + w] ** 2)) for i in range(0, max(1, len(m) - w), w)]) + 1e-9
    heard = blocks[blocks > blocks.max() * 0.1]
    return 20 * np.log10(np.sqrt(np.mean(heard ** 2)))


def sound():
    out = os.path.join(WORK, 'mix.wav')
    if os.path.exists(out):
        return out
    total = S['total']
    mix = np.zeros((int(total * SR) + SR, 2))

    def put(sig, at, target):
        """Places a sound so that its heard part sits at `target` dBFS"""
        s = int(at * SR)
        e = min(len(mix), s + len(sig))
        mix[s:e] += sig[: e - s] * db(target - level(sig))

    # Kitchen: the fountain, softened (its hiss was harsh), quieter once she reaches for the phone
    soft = 'lowpass=f=4500,highpass=f=120'
    water = fade(load('water.mp3', 5, S['ride'] + 0.2, soft), 0.03, 0.25)
    gush = fade(load('gush.mp3', 0, 5.3, soft), 0.02, 0.4)
    for sig in (water, gush):
        sig[int(S['k2'] * SR):] *= db(-8)
    put(water, 0, -25)
    put(gush, 0, -26)
    put(load('sip.mp3'), 2.0, -21)
    # «Тапсыр!»: a riser, then impact and thunder
    put(fade(load('riser.mp3', 1.3, TL['slam'] - S['k2'] + 0.05), 0.4, 0.05), S['k2'], -19)
    put(load('impact.mp3'), TL['slam'] - 0.894, -11)
    put(load('thunder.mp3'), TL['slam'] - 0.569, -18)
    # One piece of music from the ride to the end card, stepping back under the offers and the tea
    music = load('m680.mp3', 73.54, total - S['ride'])
    env = np.ones(len(music))
    for start, end, gain in (('door', 'close', -5), ('close', 'tea', -3), ('tea', 'horses', -8), ('horses', 'end', -10)):
        a, b = int((S[start] - S['ride']) * SR), int((S[end] - S['ride']) * SR)
        env[a:b] = db(gain)
    k = int(0.25 * SR)                      # smooth the steps
    env = np.convolve(env, np.ones(k) / k, 'same')
    put(fade(music * env[:, None], 0.02, 1.0), S['ride'], -17)
    # Hooves, louder than before
    put(fade(load('gallop_dirt.mp3', 0.3, S['street'] - S['ride'] + 0.1), 0.05, 0.1), S['ride'], -19)
    put(fade(load('gallop_concrete.mp3', 0.3, S['door'] - S['street']), 0.05, 0.3), S['street'], -19)
    # Transition sounds, each peaking on its cut
    put(load('whoosh2.mp3'), S['k2'] - 0.70, -20)
    put(load('sparkle.mp3'), S['ride'] - 0.25, -22)
    put(load('whoosh.mp3'), S['street'] - 1.05, -18)
    put(load('whoosh.mp3'), S['door'] - 1.05, -17)
    put(load('whoosh2.mp3'), S['tea'] - 0.70, -20)
    put(load('sparkle.mp3'), S['horses'] - 0.2, -26)
    # The offers: a pop for each card, a clear tone when Nurlan is picked
    for i in range(3):
        put(load('pop.mp3'), TL['offers'][0] + 0.15 + i * 0.3, -20)
    put(load('positive.mp3'), PICK - 0.3, -18)
    put(load('confirm.mp3'), TL['tag'][0] - 0.25, -24)
    # Each new place is heard half a second before it is seen (J-cut): tea being poured, the courtyard
    put(fade(load('pour.mp3', 0, 2.4), 0.1, 0.6), S['tea'] - 0.5, -25)
    put(fade(load('courtyard.mp3', 2, total - S['horses'] + 0.5), 0.4, 0.8), S['horses'] - 0.5, -31)
    put(load('snort.mp3'), S['horses'] + 1.0, -17)
    # End card: one hit on the logo
    put(fade(load('logo.mp3', 3.8), 0, 1.5), S['end'] + 0.35 - 0.8, -14)

    mix = mix[: int(total * SR)]
    mix = fade(mix, 0, 0.3)
    mix *= 0.9 / (np.abs(mix).max() + 1e-9)
    raw = os.path.join(WORK, 'mix_raw.wav')
    with wave.open(raw, 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((mix * 32767).astype('<i2').tobytes())
    # A limiter tames the impact, then two-pass loudness normalisation to -14 LUFS (Instagram, TikTok)
    lim = 'alimiter=limit=0.6:attack=4:release=80:level=false'
    probe = subprocess.run(['ffmpeg', '-hide_banner', '-i', raw, '-af', f'{lim},loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json',
                            '-f', 'null', '-'], capture_output=True, text=True).stderr
    m = json.loads(probe[probe.rindex('{'):])
    run(['ffmpeg', '-v', 'error', '-y', '-i', raw, '-af',
         f"{lim},loudnorm=I=-14:TP=-1.5:LRA=11:measured_I={m['input_i']}:measured_TP={m['input_tp']}:"
         f"measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true",
         '-ar', str(SR), out])
    return out


if __name__ == '__main__':
    print(json.dumps(TL))
    bg, audio = footage(), sound()
    for lang in LANGS:
        frames = overlay(lang)
        out = os.path.join(WORK, f'tapsyr-tapsyr-{lang}.mp4')
        run(['ffmpeg', '-v', 'error', '-y', '-i', bg, '-framerate', str(FPS), '-i', os.path.join(frames, 'f%04d.png'),
             '-i', audio, '-filter_complex', '[0:v][1:v]overlay=0:0:format=auto,format=yuv420p[v]',
             '-map', '[v]', '-map', '2:a', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
             '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-shortest', out])
        print(out)
