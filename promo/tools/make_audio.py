"""Synthesizes the promo lines with every Kazakh Piper voice/speaker.

  python promo/tools/make_audio.py <voices dir> promo/lines.txt promo

The voices dir holds the unpacked Piper voice archives (kk-issai-high/, kk-iseke-x-low/, kk-raya-x-low/).
"""
import re, sys, wave
from pathlib import Path
import numpy as np
from piper import PiperVoice, SynthesisConfig

VOICES = {  # piper-voices name -> folder/model name of the release copy
    'kk_KZ-issai-high': 'kk-issai-high',
    'kk_KZ-iseke-x_low': 'kk-iseke-x-low',
    'kk_KZ-raya-x_low': 'kk-raya-x-low',
}
SENTENCE_GAP, DASH_GAP, EDGE, SAMPLE_GAP = 0.40, 0.28, 0.15, 0.5
# eSpeak stresses the first syllable of «тапсыр»; Kazakh stresses the last one
STRESS = [(re.compile(r'\b[Тт]апсырыс\b'), '[[ tɑpsəɾˈəs ]]'), (re.compile(r'\b[Тт]апсыр\b'), '[[ tɑpsˈəɾ ]]')]

vdir, lines_file, out = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
lines = [l.strip() for l in lines_file.read_text(encoding='utf-8').splitlines() if l.strip()]
assert len(lines) == 10, len(lines)

def silence(sec, sr):
    return np.zeros(int(sec * sr), dtype=np.int16)

def speak(voice, text, cfg, sr):
    parts = []
    for i, piece in enumerate(text.split(' — ')):   # a dash gets its own pause
        if i:
            parts.append(silence(DASH_GAP, sr))
        for rx, ph in STRESS:
            piece = rx.sub(ph, piece)
        for j, chunk in enumerate(voice.synthesize(piece, syn_config=cfg)):  # one chunk per sentence
            if j:
                parts.append(silence(SENTENCE_GAP, sr))
            parts.append(chunk.audio_int16_array)
    return np.concatenate([silence(EDGE, sr), *parts, silence(EDGE, sr)])

def save(path, audio, sr):
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
        w.writeframes(audio.tobytes())

made = []
for name, folder in VOICES.items():
    model = vdir / folder / f'{folder}.onnx'
    voice = PiperVoice.load(model, model.with_suffix('.onnx.json'))
    sr = voice.config.sample_rate
    speakers = voice.config.speaker_id_map or {'default': None}
    for spk, sid in speakers.items():
        tag = f'{name}-{spk}'
        cfg = SynthesisConfig(speaker_id=sid, volume=0.89)  # peaks at about -1 dBFS
        clips = [speak(voice, text, cfg, sr) for text in lines]
        for n, clip in enumerate(clips, 1):
            save(out / 'audio' / tag / f'{n:02d}.wav', clip, sr)
        sample = np.concatenate([clips[0], silence(SAMPLE_GAP, sr), clips[1], silence(SAMPLE_GAP, sr), clips[9]])
        save(out / 'samples' / f'{tag}.wav', sample, sr)
        made.append((tag, sr, sum(len(c) for c in clips) / sr))
for tag, sr, dur in made:
    print(f'{tag}\t{sr} Hz\t{dur:.1f} s total')
