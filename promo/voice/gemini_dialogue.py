"""Character lines for an ad (e.g. promo/altkat/dialogue.json) with Gemini TTS.

Each line names its own voice and speaking style. Saves <dialogue dir>/voice/<id>.wav.
Usage: GEMINI_API_KEY=... python3 promo/voice/gemini_dialogue.py promo/altkat/dialogue.json
"""

import json
import pathlib
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import gemini_voice as gv  # noqa: E402


def main(path: str) -> int:
    cfg_path = pathlib.Path(path)
    cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
    out = cfg_path.parent / "voice"
    out.mkdir(parents=True, exist_ok=True)
    failed = 0
    for line in cfg["lines"]:
        try:
            data, mime = gv.synth(cfg["model"], line["voice"], line["kk"], line["style"])
            gv.save(data, mime, out / f"{line['id']}.wav")
            print(f"{line['id']} ok ({line['voice']})", flush=True)
        except Exception as exc:
            failed += 1
            print(f"{line['id']} FAILED: {exc}", flush=True)
        time.sleep(3)
    return 1 if failed == len(cfg["lines"]) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
