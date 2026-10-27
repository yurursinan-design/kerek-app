"""Kazakh narration for the Tapsyr promo video with Gemini TTS.

Reads lines.json next to this file. Its "gemini" block names the model, the voices, the
speaking style and (optionally) which line ids to voice ("only"). Saves
out-gemini/<voice>/<id>.wav (24 kHz mono, 16-bit). Needs GEMINI_API_KEY in the environment;
run by .github/workflows/promo-voice-gemini.yml, which reads the key from Secret Manager.
"""

import base64
import json
import os
import pathlib
import re
import sys
import time
import urllib.error
import urllib.request
import wave

HERE = pathlib.Path(__file__).resolve().parent
CONFIG = json.loads((HERE / "lines.json").read_text(encoding="utf-8"))
GEMINI = CONFIG["gemini"]
BASE = "https://generativelanguage.googleapis.com/v1beta"
KEY = os.environ["GEMINI_API_KEY"]


def post(url: str, body: dict) -> dict:
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json", "x-goog-api-key": KEY},
    )
    with urllib.request.urlopen(req, timeout=180) as res:
        return json.loads(res.read())


def via_interactions(model: str, voice: str, text: str, style: str):
    body = {
        "model": model,
        "input": [{
            "type": "user_input",
            "content": [{
                "type": "text",
                "text": text,
                "annotations": [{"type": "speech_metadata", "style": style}],
            }],
        }],
        "response_format": {"type": "audio"},
        "generation_config": {"speech_config": [{"voice": voice}]},
    }
    res = post(f"{BASE}/interactions", body)
    audio = [c for s in res.get("steps", []) if s.get("type") == "model_output"
             for c in s.get("content", []) if c.get("type") == "audio"]
    if not audio:
        raise RuntimeError("no audio in response: " + json.dumps(res)[:600])
    return base64.b64decode(audio[-1]["data"]), audio[-1].get("mime_type", "audio/wav")


def via_generate_content(model: str, voice: str, text: str, style: str):
    body = {
        "contents": [{"parts": [{"text": f"Say in Kazakh, {style}: {text}"}]}],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice}}},
        },
    }
    res = post(f"{BASE}/models/{model}:generateContent", body)
    part = res["candidates"][0]["content"]["parts"][0]["inlineData"]
    return base64.b64decode(part["data"]), part.get("mimeType", "audio/L16;rate=24000")


def save(data: bytes, mime: str, path: pathlib.Path) -> None:
    if data[:4] == b"RIFF":
        path.write_bytes(data)
        return
    rate = int(m.group(1)) if (m := re.search(r"rate=(\d+)", mime or "")) else 24000
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(data)


def synth(model: str, voice: str, text: str, style: str):
    errors = []
    for attempt in range(5):
        for fn in (via_interactions, via_generate_content):
            try:
                return fn(model, voice, text, style)
            except urllib.error.HTTPError as exc:
                detail = exc.read().decode("utf-8", "replace")[:600]
                errors.append(f"{fn.__name__} {exc.code}: {detail}")
                print(errors[-1], flush=True)
                if exc.code == 429:
                    break  # quota: wait, then retry both
            except Exception as exc:  # malformed or empty response: try the other endpoint
                errors.append(f"{fn.__name__}: {exc}")
                print(errors[-1], flush=True)
        time.sleep(min(90, 10 * (attempt + 1) ** 2))
    raise RuntimeError(f"{voice}: gave up\n" + "\n".join(errors[-4:]))


def main() -> int:
    model = GEMINI["model"]
    style = GEMINI["style"]
    only = set(GEMINI.get("only") or [])
    lines = [l for l in CONFIG["lines"] if not only or l["id"] in only]
    failed = 0
    for voice in GEMINI["voices"]:
        out = HERE / "out-gemini" / voice
        out.mkdir(parents=True, exist_ok=True)
        for line in lines:
            try:
                data, mime = synth(model, voice, line["kk"], style)
                save(data, mime, out / f"{line['id']}.wav")
                print(f"{model} {voice} {line['id']} ok ({mime}, {len(data)} bytes)", flush=True)
            except Exception as exc:
                failed += 1
                print(f"{voice} {line['id']} FAILED: {exc}", flush=True)
            time.sleep(3)
    return 1 if failed and failed == len(lines) * len(GEMINI["voices"]) else 0


if __name__ == "__main__":
    sys.exit(main())
