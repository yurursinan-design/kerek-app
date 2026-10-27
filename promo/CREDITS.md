# Credits — promo voice-over

The Kazakh voice-over in `promo/audio/` and `promo/samples/` was synthesized with
[Piper](https://github.com/rhasspy/piper) text-to-speech, using Piper's Kazakh (`kk_KZ`) voices.

## Voices

| Voice | Speakers | Quality | Sample rate |
|---|---|---|---|
| `kk_KZ-issai-high` | ISSAI_KazakhTTS2_M2, ISSAI_KazakhTTS_M1_Iseke, ISSAI_KazakhTTS2_F3, ISSAI_KazakhTTS_F1_Raya, ISSAI_KazakhTTS2_F1, ISSAI_KazakhTTS2_F2 | high | 22 050 Hz |
| `kk_KZ-iseke-x_low` | one speaker (`default`) | x-low | 16 000 Hz |
| `kk_KZ-raya-x_low` | one speaker (`default`) | x-low | 16 000 Hz |

The models were taken from the voice archives of Piper's v0.0.2 GitHub release
(`voice-kk-issai-high.tar.gz`, `voice-kk-iseke-x-low.tar.gz`, `voice-kk-raya-x-low.tar.gz`),
because the `rhasspy/piper-voices` repository on Hugging Face could not be reached from the build machine.

## Training data and licence

All three voices were trained on the **KazakhTTS** and **KazakhTTS2** corpora
(<https://github.com/IS2AI/Kazakh_TTS>) of the Institute of Smart Systems and Artificial Intelligence (ISSAI),
Nazarbayev University, Kazakhstan. The voice model cards list the licence as
**CC BY 4.0** (<https://creativecommons.org/licenses/by/4.0/>).

ISSAI requires attribution that includes the title of the original paper, the authors and the organization:

> Mussakhojayeva, S., Janaliyeva, A., Mirzakhmetov, A., Khassanov, Y., Varol, H.A. (2021) KazakhTTS: An Open-Source
> Kazakh Text-to-Speech Synthesis Dataset. Proc. Interspeech 2021, 2786-2790, doi: 10.21437/Interspeech.2021-2124.
> The Institute of Smart Systems and Artificial Intelligence (issai.nu.edu.kz), Nazarbayev University, Kazakhstan

ISSAI also asks that the models be used only for a good cause, and never to generate content that is obscene,
offensive or discriminatory with regard to religion, sex, race, language or territory of origin.

Short form for the video description or end credits:

> Voice: Piper TTS, trained on ISSAI KazakhTTS (Nazarbayev University), CC BY 4.0.
> Mussakhojayeva et al. (2021), KazakhTTS: An Open-Source Kazakh Text-to-Speech Synthesis Dataset, Interspeech 2021.

## How the audio was made

- Script: `promo/tools/make_audio.py`, text: `promo/lines.txt` (10 lines).
- Normal speed (the models' default `length_scale` 1.0).
- Pauses: 0.40 s between sentences and 0.28 s at each dash; commas use the voice's own pause.
- «Тапсыр» and «тапсырыс» are passed as phonemes with the stress on the last syllable, because eSpeak
  (Piper's phonemizer) stresses their first syllable.
- Peaks are set to about −1 dBFS. Samples join lines 01, 02 and 10 with 0.5 s of silence.
