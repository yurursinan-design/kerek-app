"""Phone-screen inserts for the Танысымның танысы ad: Arman writes his request in Tapsyr and the
first offers come in. Drawn like the app (HomeScreen.tsx free-text card, ResultScreen.tsx offer
cards, same Tailwind colours and Kazakh texts) and rendered full screen, 1080x1920.

Usage: python3 promo/tanys/screen_insert.py <out-dir>
"""

import importlib.util
import pathlib
import sys

from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parents[1]
_spec = importlib.util.spec_from_file_location("overlays", REPO / "promo/video/overlays.py")
OV = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(OV)

OUT = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else pathlib.Path("build/tanys_screen")
TEXT = "Кір жуғыш машина қосылмайды, қате шығып тұр"
# the photo he attaches: his own machine, cut from the S8 frame
MACHINE = OV.data_uri(HERE / "frames/machine_photo.jpg", "image/jpeg")
CLOCK = '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'

CSS = OV.CSS + """
html,body{width:360px;height:640px;background:#f8fafc;overflow:hidden}
.status{height:26px;padding:0 16px;display:flex;align-items:center;justify-content:space-between;font-size:12px;font-weight:600;color:#0f172a;background:#fff}
.top{height:52px;padding:0 16px;display:flex;align-items:center;gap:10px;background:#fff;border-bottom:1px solid #e2e8f0}
.top img{width:30px;height:30px;border-radius:9px}
.top b{font-size:17px;font-weight:800;color:#0f172a;letter-spacing:-.02em}
.body{padding-top:14px}
.th1{width:64px;height:64px;border-radius:12px;background-size:cover;background-position:center;border:1px solid #e2e8f0}
.res{padding:16px;display:flex;flex-direction:column;gap:12px}
.rq{padding:14px;background:#fff;border:1px solid #e2e8f0;border-radius:18px;display:flex;gap:12px;align-items:center}
.rq .t{font-size:13px;font-weight:700;color:#0f172a;line-height:1.4}
.rq .s{font-size:11px;color:#0284c7;font-weight:600;margin-top:3px}
h3{font-size:18px;font-weight:700;color:#0f172a;letter-spacing:-.02em}
.srch{font-size:12px;color:#0284c7;font-weight:600;margin-top:2px}
.of{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:16px;display:flex;justify-content:space-between;gap:8px;box-shadow:0 1px 2px rgba(0,0,0,.04)}
.of.new{border:2px solid #0ea5e9}
.of .l{display:flex;gap:12px;min-width:0}
.av{width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,#0ea5e9,#6366f1);color:#fff;font-weight:700;font-size:14px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.nm{font-size:14px;font-weight:700;color:#0f172a}
.nw{font-size:11px;color:#64748b;margin-top:2px}
.tm2{display:flex;align-items:center;gap:4px;font-size:12px;color:#64748b;margin-top:4px}
.pr{font-size:16px;font-weight:800;color:#0f172a;white-space:nowrap}
"""


def frame(inner):
    return (f"<html><head><meta charset='utf-8'><style>{CSS}</style></head><body>"
            f"<div class='status'><span>19:42</span><span>LTE ▮▮▮</span></div>"
            f"<div class='top'><img src='{OV.ICON}'><b>Tapsyr</b></div>{inner}</body></html>")


def card(text, focus=True, photo=False, submit="off"):
    body = (f"{text}<span class='cur'></span>" if focus else text) if text else "<span class='cur'></span><span class='ph'>Сізге не керек екенін жазыңыз...</span>"
    att = ("" if not photo else
           f"<div class='att'><div class='t'>Тіркелген медиа файлдар</div><div class='thumbs'>"
           f"<div class='th1' style=\"background-image:url('{MACHINE}')\"></div></div></div>")
    if submit == "analyzing":
        sub = "<div class='sub on'><div class='spin'></div><span>Сұранысыңызды талдаудамыз...</span></div>"
    else:
        sub = f"<div class='sub {submit}'>{OV.svg(OV.SEARCH, 20, 'currentColor', 2.5)}<span>Шешім табу</span></div>"
    return frame(f"""<div class='body'><div class='wrap'><section class='sec'>
<div class='hdr'><span class='hico'>{OV.svg(OV.PEN, 20, '#6d28d9')}</span><div>
<h2>Өз сөзіңізбен жазыңыз</h2><p>Жазыңыз немесе айтыңыз, фото мен видео қосыңыз — біз өзіміз түсінеміз</p></div></div>
<div class='box{" focus" if focus else ""}'><div class='ta'>{body}</div>
<div class='mic'>{OV.svg(OV.MIC, 16, '#475569')}</div>
<div class='grid'><div class='gb'>{OV.svg(OV.IMAGE, 20, '#0284c7')}<span>Фото</span></div>
<div class='gb'>{OV.svg(OV.VIDEO, 20, '#7c3aed')}<span>Видео</span></div>
<div class='gb'>{OV.svg(OV.MIC, 20, '#059669')}<span>Дауыс</span></div>
<div class='gb'>{OV.svg(OV.PIN, 20, '#f43f5e')}<span>Орын</span></div></div></div>
{att}{sub}</section></div></div>""")


OFFERS = [("Серік Жұмабаев", "СЖ", "Бүгін, 18:00–20:00", "8 000 ₸"),
          ("Нұрлан Әбенов", "НӘ", "Ертең, 10:00", "9 000 ₸")]


def offers(n):
    cards = ""
    for i, (name, ini, when, price) in enumerate(OFFERS[:n]):
        cards += (f"<div class='of{' new' if i == n - 1 else ''}'><div class='l'><span class='av'>{ini}</span><div>"
                  f"<div class='nm'>{name}</div><div class='nw'>Жаңа шебер</div>"
                  f"<div class='tm2'>{OV.svg(CLOCK, 12, '#94a3b8')}<span>{when}</span></div></div></div>"
                  f"<span class='pr'>{price}</span></div>")
    head = (f"<div><h3>Орындаушылардан түскен ұсыныстар ({n})</h3>"
            f"<span class='srch'>Шеберлер іздестірілуде...</span></div>") if n else ""
    return frame(f"""<div class='res'><div class='rq'><div class='th1' style="background-image:url('{MACHINE}')"></div>
<div><div class='t'>{TEXT}</div><div class='s'>Тұрмыстық техника жөндеу</div></div></div>{head}{cards}</div>""")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    jobs = {}
    steps = list(range(0, len(TEXT) + 1, 2))
    if steps[-1] != len(TEXT):
        steps.append(len(TEXT))
    for i, n in enumerate(steps):
        jobs[f"type_{i:02d}"] = card(TEXT[:n], submit="on" if n else "off")
    jobs["photo"] = card(TEXT, focus=False, photo=True, submit="on")
    jobs["press"] = card(TEXT, focus=False, photo=True, submit="on press")
    jobs["analyzing"] = card(TEXT, focus=False, photo=True, submit="analyzing")
    for n in range(0, 3):
        jobs[f"offers_{n}"] = offers(n)
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 360, "height": 640}, device_scale_factor=3)
        for name, html in jobs.items():
            page.set_content(html)
            page.wait_for_load_state("networkidle")
            page.screenshot(path=str(OUT / f"{name}.png"))
        browser.close()
    print(len(jobs), "screens ->", OUT, "typing steps", len(steps))


if __name__ == "__main__":
    main()
