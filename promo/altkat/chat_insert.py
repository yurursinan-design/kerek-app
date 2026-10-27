"""Chat screen inserts for the Alt Kat ad, drawn like the app's ChatScreen.tsx (same layout,
Tailwind colours, Kazakh labels). Renders 1080x1920 PNG states with Playwright.

Usage: python3 promo/altkat/chat_insert.py <out-dir>
"""

import pathlib
import sys

from playwright.sync_api import sync_playwright

OUT = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else pathlib.Path("build/chat")

CHEVRON = '<path d="m15 18-6-6 6-6"/>'
FLAG = '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/>'
CLIP = '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>'
SEND = '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>'
CHECKS = '<path d="M18 6 7 17l-5-5"/><path d="m22 10-7.5 7.5L13 16"/>'


def svg(body, size, color, width=2.0):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" '
            f'stroke="{color}" stroke-width="{width}" stroke-linecap="round" stroke-linejoin="round">{body}</svg>')


CSS = """
*{box-sizing:border-box;margin:0;padding:0}
body{width:360px;height:640px;font-family:Inter,Roboto,sans-serif;background:#f8fafc;display:flex;flex-direction:column;-webkit-font-smoothing:antialiased}
.status{height:26px;padding:0 16px;display:flex;align-items:center;justify-content:space-between;font-size:12px;font-weight:600;color:#0f172a;background:#fff}
header{background:#fff;border-bottom:1px solid #e2e8f0;padding:8px 12px 10px;display:flex;align-items:center;justify-content:space-between;gap:8px}
.l{display:flex;align-items:center;gap:10px;min-width:0}
.back{width:36px;height:36px;border-radius:12px;background:#f1f5f9;display:flex;align-items:center;justify-content:center}
.av{width:40px;height:40px;border-radius:16px;background:#0284c7;color:#fff;font-weight:800;font-size:16px;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 2px rgba(0,0,0,.08)}
h2{font-size:14px;font-weight:700;color:#0f172a;line-height:1.2}
.badge{font-size:10px;font-weight:600;padding:2px 8px;border-radius:999px;background:#f0f9ff;color:#075985;border:1px solid #bae6fd}
.sub{font-size:11px;color:#64748b;font-weight:500;margin-top:2px}
.rep{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:#64748b}
main{flex:1;padding:16px 12px;display:flex;flex-direction:column;gap:12px;overflow:hidden;justify-content:flex-end}
.row{display:flex;flex-direction:column}
.me{align-items:flex-end}.ot{align-items:flex-start}
.b{max-width:85%;padding:10px 14px;font-size:12px;line-height:1.6;border-radius:16px;box-shadow:0 1px 1px rgba(0,0,0,.04)}
.me .b{background:#0284c7;color:#fff;border-top-right-radius:4px}
.ot .b{background:#fff;color:#0f172a;border:1px solid rgba(226,232,240,.9);border-top-left-radius:4px}
.t{display:flex;justify-content:flex-end;align-items:center;gap:3px;font-size:9px;margin-top:2px;opacity:.75}
.new .b{animation:none}
footer{background:#fff;border-top:1px solid #e2e8f0;padding:10px 12px 14px;display:flex;align-items:center;gap:8px}
.clip{height:48px;width:48px;border-radius:16px;background:#f1f5f9;display:flex;align-items:center;justify-content:center}
.in{flex:1;height:48px;padding:0 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:16px;font-size:14px;font-weight:500;color:#94a3b8;display:flex;align-items:center}
.in.typed{color:#0f172a;border-color:#0ea5e9;background:#fff}
.cur{display:inline-block;width:2px;height:18px;background:#0ea5e9;margin-left:1px}
.send{height:48px;width:48px;border-radius:16px;background:#0284c7;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 6px -1px rgba(2,132,199,.2)}
.send.off{opacity:.4;box-shadow:none}
"""

HISTORY = [
    ("me", "Сәлеметсіз бе! Ваннадағы кран ағып тұр, келе аласыз ба?", "20:41"),
    ("ot", "Сәлеметсіз бе! Иә, жақын жердемін, қазір барамын.", "20:42"),
]


def bubble(side, text, time):
    tick = svg(CHECKS, 12, "#ffffff", 2.2) if side == "me" else ""
    return f'<div class="row {side}"><div class="b">{text}<div class="t">{time} {tick}</div></div></div>'


def page(messages, typed=""):
    msgs = "".join(bubble(*m) for m in messages)
    if typed:
        field = f'<div class="in typed">{typed}<span class="cur"></span></div>'
        send = f'<div class="send">{svg(SEND, 16, "#fff")}</div>'
    else:
        field = '<div class="in">Хабарлама жазыңыз...</div>'
        send = f'<div class="send off">{svg(SEND, 16, "#fff")}</div>'
    return f"""<html><head><meta charset="utf-8"><style>{CSS}</style></head><body>
<div class="status"><span>20:58</span><span>LTE ▮▮▮</span></div>
<header><div class="l"><div class="back">{svg(CHEVRON, 20, "#334155", 2.5)}</div>
<div class="av">Қ</div><div><div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap"><h2>Қанат Сантехник</h2>
<span class="badge">Шебер таңдалды</span></div><div class="sub">Ваннадағы кран ағып тұр</div></div></div>
<div class="rep">{svg(FLAG, 14, "#64748b")}</div></header>
<main>{msgs}</main>
<footer><div class="clip">{svg(CLIP, 20, "#475569")}</div>{field}{send}</footer>
</body></html>"""


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    sent = ("me", "Тезірек келіңізші!", "20:58")
    reply = ("ot", "Есігіңіздің алдындамын.", "20:58")
    text = "Тезірек келіңізші!"
    states = {f"type_{i:02d}": page(HISTORY, text[:i]) for i in range(1, len(text) + 1)}
    states["sent"] = page(HISTORY + [sent])
    states["reply"] = page(HISTORY + [sent, reply])
    with sync_playwright() as p:
        browser = p.chromium.launch()
        pg = browser.new_page(viewport={"width": 360, "height": 640}, device_scale_factor=3)
        for name, html in states.items():
            pg.set_content(html)
            pg.screenshot(path=str(OUT / f"{name}.png"))
        browser.close()
    print(len(states), "states ->", OUT)


if __name__ == "__main__":
    main()
