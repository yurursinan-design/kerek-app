"""Kazakh narration for the Tapsyr promo video.

Reads lines.json next to this file and voices every line with each listed voice through
Microsoft Edge TTS (the same voice family video.yml uses). For each line it saves
out/<voice>/<id>.mp3 and out/<voice>/<id>.json (word timings in seconds, for subtitles).
Run by .github/workflows/promo-voice.yml, because the cloud session can't open the WebSocket
the voice service needs.
"""

import asyncio
import inspect
import json
import pathlib

import edge_tts

HERE = pathlib.Path(__file__).resolve().parent
CONFIG = json.loads((HERE / "lines.json").read_text(encoding="utf-8"))
TICKS_PER_SECOND = 10_000_000


def communicate(text: str, voice: str, rate: str) -> edge_tts.Communicate:
    kwargs = {"rate": rate}
    if "boundary" in inspect.signature(edge_tts.Communicate.__init__).parameters:
        kwargs["boundary"] = "WordBoundary"
    return edge_tts.Communicate(text, voice, **kwargs)


async def voice_line(text: str, voice: str, rate: str, mp3: pathlib.Path, timings: pathlib.Path) -> None:
    audio = bytearray()
    words = []
    async for chunk in communicate(text, voice, rate).stream():
        if chunk["type"] == "audio":
            audio.extend(chunk["data"])
        elif chunk["type"] in ("WordBoundary", "SentenceBoundary"):
            start = chunk["offset"] / TICKS_PER_SECOND
            words.append({
                "text": chunk["text"],
                "start": round(start, 3),
                "end": round(start + chunk["duration"] / TICKS_PER_SECOND, 3),
            })
    if not audio:
        raise RuntimeError(f"no audio for {voice} {mp3.stem}")
    mp3.write_bytes(bytes(audio))
    timings.write_text(json.dumps(words, ensure_ascii=False, indent=1), encoding="utf-8")


async def main() -> None:
    rate = CONFIG.get("rate", "+0%")
    for voice in CONFIG["voices"]:
        out = HERE / "out" / voice
        out.mkdir(parents=True, exist_ok=True)
        for line in CONFIG["lines"]:
            for attempt in range(3):
                try:
                    await voice_line(line["kk"], voice, rate, out / f"{line['id']}.mp3", out / f"{line['id']}.json")
                    print(f"{voice} {line['id']} ok")
                    break
                except Exception as exc:  # the service sometimes drops a connection; try again
                    print(f"{voice} {line['id']} attempt {attempt + 1} failed: {exc}")
                    if attempt == 2:
                        raise
                    await asyncio.sleep(3)


if __name__ == "__main__":
    asyncio.run(main())
