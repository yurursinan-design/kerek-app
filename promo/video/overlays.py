"""Renders the app-styled pieces the promo video animates (Playwright + headless Chromium).

The free-text card copies HomeScreen.tsx (same texts, Tailwind colours and sizes); the
notification copies what functions/src/index.ts sends a provider for a new request.
Everything is drawn at the store screenshots' scale (360 CSS px = 664 px), so it lines up
with the phone screens cut from store/kk/phone-screenshots.

Usage: python3 promo/video/overlays.py <out-dir>
"""

import base64
import pathlib
import sys

from playwright.sync_api import sync_playwright

REPO = pathlib.Path(__file__).resolve().parents[2]
OUT = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else pathlib.Path("build/ov")
SCALE = 664 / 360

def data_uri(path: pathlib.Path, mime: str) -> str:
    return f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode()


PHOTO = data_uri(REPO / "public/img/photo/s_plumbing_repair.webp", "image/webp")
ICON = data_uri(REPO / "store/icon.png", "image/png")


def svg(body: str, size: int = 20, color: str = "currentColor", width: float = 2) -> str:
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 24 24" '
            f'fill="none" stroke="{color}" stroke-width="{width}" stroke-linecap="round" stroke-linejoin="round">{body}</svg>')


PEN = '<path d="M12 20h9"/><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z"/>'
MIC = '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>'
IMAGE = '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>'
VIDEO = '<path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>'
PIN = '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>'
SEARCH = '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>'
SQUARE = '<rect width="18" height="18" x="3" y="3" rx="2"/>'
SHIELD = '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>'
LOCK = '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>'
PLAY = '<polygon points="6 3 20 12 6 21 6 3"/>'

CSS = """
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Inter,Roboto,sans-serif;background:transparent;width:360px;-webkit-font-smoothing:antialiased}
.wrap{padding:0 16px}
.sec{padding:16px;border-radius:24px;border:1px solid #ede9fe;
  background:linear-gradient(135deg,#f5f3ff 0%,#ffffff 50%,#f0f9ff 100%);display:flex;flex-direction:column;gap:12px}
.hdr{display:flex;align-items:center;gap:12px}
.hico{width:48px;height:48px;border-radius:16px;background:#ede9fe;color:#6d28d9;display:flex;align-items:center;justify-content:center;flex-shrink:0}
h2{font-size:18px;font-weight:800;color:#0f172a;letter-spacing:-.02em;line-height:1.2}
.hdr p{font-size:12px;color:#64748b;line-height:1.35;margin-top:2px}
.box{position:relative;background:#fff;border-radius:16px;border:2px solid #e2e8f0;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,.05)}
.box.focus{border-color:#0ea5e9}
.ta{min-height:104px;padding:16px 48px 16px 16px;font-size:16px;line-height:24px;color:#1e293b}
.ph{color:#94a3b8}
.cur{display:inline-block;width:2px;height:20px;background:#0ea5e9;vertical-align:-4px;margin-left:1px}
.mic{position:absolute;right:12px;top:12px;width:36px;height:36px;border-radius:12px;background:#f1f5f9;color:#475569;display:flex;align-items:center;justify-content:center}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;padding:8px;background:rgba(248,250,252,.9);border-top:1px solid #f1f5f9}
.gb{min-height:52px;border-radius:12px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;font-size:11px;font-weight:600;color:#475569}
.gb.rec{background:#ef4444;color:#fff}
.recbar{padding:12px;background:#fef2f2;border:1px solid #fecaca;border-radius:12px;display:flex;align-items:center;justify-content:space-between;font-size:12px;color:#7f1d1d}
.recbar .l{display:flex;align-items:center;gap:8px;font-weight:600}
.dot{width:10px;height:10px;border-radius:50%;background:#dc2626;box-shadow:0 0 0 4px rgba(220,38,38,.25)}
.tm{font-family:'DejaVu Sans Mono',monospace;font-weight:700;background:#fff;padding:2px 8px;border-radius:4px;border:1px solid #fecaca}
.stop{padding:4px 10px;background:#dc2626;color:#fff;font-weight:700;border-radius:8px}
.att{padding:12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:16px}
.att .t{font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px}
.thumbs{display:flex;gap:8px;align-items:center}
.th{width:64px;height:64px;border-radius:12px;background-size:cover;background-position:center;position:relative;border:1px solid #e2e8f0}
.th .pl{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(15,23,42,.35);border-radius:12px;color:#fff}
.chip{height:40px;padding:0 12px;border-radius:12px;background:#ecfdf5;color:#047857;display:flex;align-items:center;gap:6px;font-size:13px;font-weight:700}
.sub{width:100%;min-height:52px;border-radius:12px;font-weight:700;font-size:16px;display:flex;align-items:center;justify-content:center;gap:8px}
.sub.off{background:#e2e8f0;color:#94a3b8}
.sub.on{background:#0284c7;color:#fff;box-shadow:0 4px 6px -1px rgba(2,132,199,.2)}
.sub.press{background:#0369a1;transform:scale(.99)}
.spin{width:20px;height:20px;border:2px solid #fff;border-top-color:transparent;border-radius:50%}
.note{padding:0 4px;font-size:11px;color:#64748b;line-height:1.6}
.priv{display:flex;gap:10px;font-size:12px;color:#475569;line-height:1.6}
.priv svg{flex-shrink:0;color:#059669}
.notif{margin:0 8px;padding:14px 16px;border-radius:22px;background:#fff;box-shadow:0 10px 30px rgba(15,23,42,.28);display:flex;gap:12px}
.notif img{width:40px;height:40px;border-radius:10px}
.notif .app{font-size:11px;color:#64748b;font-weight:600}
.notif .ti{font-size:15px;font-weight:800;color:#0f172a;margin-top:2px}
.notif .bo{font-size:13px;color:#334155;line-height:1.35;margin-top:2px}
.badge{width:300px;margin:0 30px;padding:20px;border-radius:24px;background:#fff;box-shadow:0 18px 40px rgba(15,23,42,.30);text-align:center}
.badge .sh{width:64px;height:64px;margin:0 auto 10px;border-radius:20px;background:#ecfdf5;color:#059669;display:flex;align-items:center;justify-content:center}
.badge .num{margin:12px auto 10px;padding:10px 14px;border-radius:14px;background:#f1f5f9;display:flex;align-items:center;justify-content:center;gap:10px;font-size:22px;font-weight:800;color:#0f172a;letter-spacing:.04em}
.badge .num svg{color:#64748b}
.badge .cap{font-size:12.5px;color:#475569;line-height:1.5}
.badge .tt{font-size:19px;font-weight:800;color:#0f172a}
"""


def card(text="", focus=False, rec=None, attachments=False, submit="off", show_cursor=True):
    body = f'{text}<span class="cur"></span>' if focus and show_cursor else (text or '<span class="ph">Сізге не керек екенін жазыңыз...</span>')
    if focus and not show_cursor:
        body = text
    if not text and focus and show_cursor:
        body = '<span class="cur"></span><span class="ph">Сізге не керек екенін жазыңыз...</span>'
    audio_btn = (f'<div class="gb rec">{svg(SQUARE, 16, "#fff")}<span>0:0{rec}</span></div>' if rec is not None
                 else f'<div class="gb">{svg(MIC, 20, "#059669")}<span>Дауыс</span></div>')
    recbar = ("" if rec is None else
              f'<div class="recbar"><div class="l"><span class="dot"></span><span>Дыбыс жазылуда...</span>'
              f'<span class="tm">0:0{rec}</span></div><div class="l"><span class="stop">Тоқтату</span>'
              f'</div></div>')
    att = ("" if not attachments else
           f'<div class="att"><div class="t">Тіркелген медиа файлдар</div><div class="thumbs">'
           f'<div class="th" style="background-image:url({PHOTO})"></div>'
           f'<div class="th" style="background-image:url({PHOTO});background-position:30% 60%"><div class="pl">{svg(PLAY, 22, "#fff")}</div></div>'
           f'<div class="chip">{svg(MIC, 16, "#047857")}0:04</div></div></div>')
    if submit == "analyzing":
        sub = '<div class="sub on"><div class="spin"></div><span>Сұранысыңызды талдаудамыз...</span></div>'
    else:
        sub = f'<div class="sub {submit}">{svg(SEARCH, 20, "currentColor", 2.5)}<span>Шешім табу</span></div>'
    return f"""<div class="wrap"><section class="sec" id="el">
<div class="hdr"><span class="hico">{svg(PEN, 20, "#6d28d9")}</span><div>
<h2>Өз сөзіңізбен жазыңыз</h2><p>Жазыңыз немесе айтыңыз, фото мен видео қосыңыз — біз өзіміз түсінеміз</p></div></div>
<div class="box{' focus' if focus else ''}"><div class="ta">{body}</div>
<div class="mic">{svg(MIC, 16, "#475569")}</div>
<div class="grid"><div class="gb">{svg(IMAGE, 20, "#0284c7")}<span>Фото</span></div>
<div class="gb">{svg(VIDEO, 20, "#7c3aed")}<span>Видео</span></div>{audio_btn}
<div class="gb">{svg(PIN, 20, "#f43f5e")}<span>Орын</span></div></div></div>
{recbar}{att}{sub}
<p class="note">Мәтініңізді түсіну үшін оны жасанды интеллект (Google Gemini) өңдейді. Телефон нөмірін, мекенжайды немесе басқа жеке деректерді жазбаңыз.</p>
<div class="priv">{svg(SHIELD, 20, "#059669")}<p>Құпиялылық: Телефон нөміріңіз тапсырыс расталғанша шеберлерге жасырын болады.</p></div>
</section></div>"""


def notif(service):
    return f"""<div class="notif" id="el"><img src="{ICON}"><div>
<div class="app">Tapsyr · қазір</div><div class="ti">Жаңа сұраныс табылды</div>
<div class="bo">Сіздің бағытыңыз бойынша жаңа тапсырыс: {service}</div></div></div>"""


def privacy_badge():
    return f"""<div class="badge" id="el"><div class="sh">{svg(SHIELD, 34, "#059669", 2)}</div>
<div class="tt">Нөміріңіз жасырын</div>
<div class="num">{svg(LOCK, 20, "#64748b")}<span>+7 ••• ••• •• ••</span></div>
<div class="cap">Нөміріңізді тек өзіңіз таңдаған шебер көреді</div></div>"""


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    typed = "Ваннадағы кран ағып тұр, су тамшылап жатыр"
    jobs = {"card_empty": card()}
    steps = list(range(0, len(typed) + 1, 2))
    if steps[-1] != len(typed):
        steps.append(len(typed))
    for i, n in enumerate(steps):
        jobs[f"card_type_{i:02d}"] = card(typed[:n], focus=True, submit="on" if n else "off")
    jobs["card_type_nocur"] = card(typed, focus=True, submit="on", show_cursor=False)
    for s in range(1, 5):
        jobs[f"card_rec_{s}"] = card(typed, focus=True, rec=s, submit="on", show_cursor=False)
    jobs["card_att"] = card(typed, focus=False, attachments=True, submit="on")
    jobs["card_press"] = card(typed, focus=False, attachments=True, submit="on press")
    jobs["card_analyzing"] = card(typed, focus=False, attachments=True, submit="analyzing")
    jobs["notif_1"] = notif("Кран және смеситель")
    jobs["notif_2"] = notif("Сантехника")
    jobs["privacy"] = privacy_badge()
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 360, "height": 1400}, device_scale_factor=SCALE)
        for name, html in jobs.items():
            if not name.startswith("card"):
                # room around the element so its shadow is in the picture
                html = f'<div id="cap" style="padding:24px 0 44px">{html}</div>'
            page.set_content(f"<html><head><meta charset='utf-8'><style>{CSS}</style></head><body>{html}</body></html>")
            page.wait_for_load_state("networkidle")
            target = page.locator(".wrap") if name.startswith("card") else page.locator("#cap")
            target.screenshot(path=str(OUT / f"{name}.png"), omit_background=True)
        browser.close()
    (OUT / "typed_steps.txt").write_text(" ".join(str(n) for n in steps))
    print(f"{len(jobs)} overlays -> {OUT}")


if __name__ == "__main__":
    main()
