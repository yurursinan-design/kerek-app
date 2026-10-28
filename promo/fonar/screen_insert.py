"""Phone-screen inserts for the "Жарықты ұста" ad, drawn like the app (ProviderOnboarding.tsx steps
3 and 4, the push a provider gets from functions/src/index.ts), Kazakh texts from translations.ts.

States: the son types the father's experience ("3", "38"), the preview card shows "38 жыл
тәжірибе", "Профильді жариялау" is pressed; next morning the job notification on the lock screen.

Usage: python3 promo/fonar/screen_insert.py <out-dir>
"""

import base64
import importlib.util
import io
import pathlib
import sys

from PIL import Image, ImageFilter, ImageEnhance
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parents[1]
_spec = importlib.util.spec_from_file_location("overlays", REPO / "promo/video/overlays.py")
OV = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(OV)
svg = OV.svg

OUT = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else pathlib.Path("build/fonar_screen")

BRIEFCASE = '<path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/><rect width="20" height="14" x="2" y="6" rx="2"/>'
BRIEFCASE_B = ('<path d="M12 12h.01"/><path d="M16 6V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>'
               '<path d="M22 13a18.15 18.15 0 0 1-20 0"/><rect width="20" height="14" x="2" y="6" rx="2"/>')
ROCKET = ('<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/>'
          '<path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/>'
          '<path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>')
CLOCK = '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'
WALLET = ('<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/>'
          '<path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>')
FILE = ('<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>'
        '<path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>')
SPARK = ('<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135'
         'a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 '
         '1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>')
SEND = ('<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 '
        '3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>')
EYE = ('<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/>'
       '<circle cx="12" cy="12" r="3"/>')
LEFT, RIGHT = '<path d="m15 18-6-6 6-6"/>', '<path d="m9 18 6-6-6-6"/>'

NAME, CITY, CATEGORY = "Сәкен Омаров", "Қызылорда", "Сантехника"
SERVICES = "Кран, су құбыры, кәріз, су жылытқыш"
HOURS, PRICE = "09:00 - 19:00", "Келісім бойынша"
ABOUT = "Құралдарым өзімде."

CSS = """
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:320px;height:569px;background:#f8fafc;overflow:hidden;font-family:Inter,Roboto,sans-serif;-webkit-font-smoothing:antialiased}
.status{height:24px;padding:0 14px;display:flex;align-items:center;justify-content:space-between;font-size:11px;font-weight:600;color:#0f172a;background:#fff}
.page{padding:10px 12px;display:flex;flex-direction:column;gap:10px}
.card{background:#fff;padding:14px;border-radius:22px;border:1px solid rgba(226,232,240,.9)}
.pill{display:inline-flex;padding:3px 10px;background:#ecfdf5;color:#065f46;border-radius:999px;font-size:11px;font-weight:700}
.bars{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin-top:10px}
.bar{height:7px;border-radius:999px;background:#e2e8f0}.bar.done{background:#6ee7b7}.bar.now{background:#10b981}
.tt{display:flex;gap:12px;align-items:center;margin-top:12px}
.ic{width:50px;height:50px;border-radius:16px;background:#ecfdf5;color:#047857;display:flex;align-items:center;justify-content:center;flex-shrink:0}
h2{font-size:16px;font-weight:800;color:#0f172a;letter-spacing:-.02em;line-height:1.2}
.sub{font-size:11px;color:#64748b;margin-top:2px;line-height:1.4}
label{font-size:11px;font-weight:700;color:#334155;display:flex;align-items:center;gap:5px;margin-bottom:4px}
.in{height:42px;padding:0 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;font-size:13px;font-weight:600;color:#0f172a;display:flex;align-items:center}
.in.focus{background:#fff;border:2px solid #0ea5e9}
.ph{color:#94a3b8;font-weight:500}
.cur{display:inline-block;width:2px;height:17px;background:#0ea5e9;margin-left:1px}
.ta{min-height:58px;padding:10px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;font-size:12.5px;color:#0f172a}
.f{margin-top:10px}
.btns{display:flex;gap:8px;margin-top:12px}
.b1{min-height:46px;padding:0 16px;border-radius:12px;background:#f1f5f9;color:#334155;font-weight:700;font-size:13px;display:flex;align-items:center;gap:4px}
.b2{flex:1;min-height:46px;border-radius:12px;background:#0284c7;color:#fff;font-weight:700;font-size:13px;display:flex;align-items:center;justify-content:center;gap:6px}
.b2.green{background:#059669}.b2.press{background:#047857;transform:scale(.985)}
.banner{padding:11px;background:#f0f9ff;border:1px solid #e0f2fe;border-radius:16px;display:flex;gap:8px;align-items:center;font-size:11px;color:#0c4a6e;font-weight:500;line-height:1.45}
.top{display:flex;justify-content:space-between;align-items:flex-start}
.who{display:flex;gap:12px;align-items:center}
.av{width:50px;height:50px;border-radius:16px;background:#0284c7;color:#fff;font-weight:800;font-size:20px;display:flex;align-items:center;justify-content:center}
h3{font-size:15px;font-weight:700;color:#0f172a}
.city{font-size:11px;color:#64748b;display:flex;gap:4px;align-items:center;margin-top:2px;font-weight:500}
.ank{padding:5px 9px;border-radius:12px;background:#f1f5f9;color:#334155;font-size:11px;font-weight:700;display:flex;gap:4px;align-items:center}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:12px}
.box{padding:10px;border-radius:16px;background:#f8fafc;border:1px solid #f1f5f9}
.box.sky{background:rgba(240,249,255,.7);border-color:#e0f2fe}
.box.hl{background:#e0f2fe;border:2px solid #0ea5e9}
.k{font-size:9.5px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em}
.box.sky .k,.box.hl .k{color:#0369a1}
.v{font-size:12.5px;font-weight:700;color:#1e293b;margin-top:2px}
.box.sky .v,.box.hl .v{color:#082f49}
.box.hl .v{font-size:15px}
.full{margin-top:7px}
.vv{font-size:12px;color:#334155;margin-top:3px;line-height:1.45}
"""


def frame(inner):
    return (f"<html><head><meta charset='utf-8'><style>{CSS}</style></head><body>"
            f"<div class='status'><span>21:16</span><span>LTE ▮▮▮</span></div><div class='page'>{inner}</div></body></html>")


def head(step, icon, title, sub):
    bars = "".join(f"<div class='bar {'now' if i == step else 'done' if i < step else ''}'></div>" for i in range(1, 5))
    return (f"<div class='card'><span class='pill'>Қадам {step} / 4</span><div class='bars'>{bars}</div>"
            f"<div class='tt'><span class='ic'>{svg(icon, 24, '#047857')}</span><div><h2>{title}</h2>"
            f"<div class='sub'>{sub}</div></div></div></div>")


def step3(exp, focus=True):
    val = (f"{exp}<span class='cur'></span>" if focus else exp) if exp else "<span class='cur'></span><span class='ph'>Мысалы: 7</span>"
    return frame(head(3, BRIEFCASE_B, "Кәсіби мәліметтер", "Тәжірибеңіз, жұмыс кестесі және баға аралығы") + f"""
<div class='card'>
<label>{svg(BRIEFCASE, 13, '#0284c7')}Тәжірибе (жыл)</label><div class='in{' focus' if focus else ''}'>{val}</div>
<div class='f'><label>{svg(CLOCK, 13, '#0284c7')}Жұмыс кестесі</label><div class='in'>{HOURS}</div></div>
<div class='f'><label>{svg(WALLET, 13, '#0284c7')}Баға аралығы</label><div class='in'>{PRICE}</div></div>
<div class='f'><label>{svg(FILE, 13, '#0284c7')}Өзіңіз немесе қызметіңіз туралы қысқаша</label><div class='ta'>{ABOUT}</div></div>
<div class='btns'><div class='b1'>{svg(LEFT, 15, '#334155', 2.5)}Артқа</div><div class='b2'>Келесі қадам{svg(RIGHT, 15, '#fff', 2.5)}</div></div>
</div>""")


def step4(press=False):
    return frame(head(4, ROCKET, "Профильді алдын ала қарау", "Клиенттер сіздің профиліңізді осылай көреді") + f"""
<div class='banner'>{svg(SPARK, 15, '#0284c7')}<span>Тексеру: барлық мәліметтер дұрыс болса, профильді жариялаңыз</span></div>
<div class='card'><div class='top'><div class='who'><div class='av'>С</div><div><h3>{NAME}</h3>
<div class='city'>{svg(OV.PIN, 13, '#94a3b8')}{CITY}</div></div></div><div class='ank'>{svg(EYE, 13, '#64748b')}Анкета</div></div>
<div class='g2'><div class='box'><div class='k'>Санат</div><div class='v'>{CATEGORY}</div></div>
<div class='box hl'><div class='k'>Тәжірибе</div><div class='v'>38 жыл тәжірибе</div></div></div>
<div class='box full'><div class='k'>Көрсетілетін қызметтер</div><div class='vv'>{SERVICES}</div></div>
<div class='btns'><div class='b1'>{svg(LEFT, 15, '#334155', 2.5)}Артқа</div>
<div class='b2 green{' press' if press else ''}'>{svg(SEND, 15, '#fff')}Профильді жариялау</div></div></div>""")


def lock_screen(bg_path):
    im = Image.open(bg_path).convert("RGB").resize((320 * 3, int(320 * 3 * 1376 / 768)))
    im = ImageEnhance.Brightness(im.filter(ImageFilter.GaussianBlur(28))).enhance(0.55)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=85)
    bg = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
    return f"""<html><head><meta charset='utf-8'><style>
*{{margin:0;padding:0;box-sizing:border-box}}
html,body{{width:320px;height:569px;overflow:hidden;font-family:Inter,Roboto,sans-serif;-webkit-font-smoothing:antialiased;
background:url('{bg}') center/cover}}
.clock{{margin-top:70px;text-align:center;color:#fff;font-size:68px;font-weight:300;letter-spacing:-.02em}}
.date{{text-align:center;color:rgba(255,255,255,.9);font-size:15px;font-weight:600;margin-top:2px}}
.n{{margin:30px 10px 0;padding:13px 14px;border-radius:20px;background:rgba(255,255,255,.93);display:flex;gap:11px;box-shadow:0 10px 30px rgba(0,0,0,.25)}}
.n img{{width:38px;height:38px;border-radius:10px}}
.a{{font-size:11px;color:#64748b;font-weight:600}}.t{{font-size:14px;font-weight:800;color:#0f172a;margin-top:1px}}
.b{{font-size:12.5px;color:#334155;line-height:1.35;margin-top:1px}}
</style></head><body><div class='clock'>07:42</div><div class='date'>Бейсенбі, 29 қазан</div>
<div class='n'><img src='{OV.ICON}'><div><div class='a'>Tapsyr · қазір</div><div class='t'>Жаңа сұраныс табылды</div>
<div class='b'>Сіздің бағытыңыз бойынша жаңа тапсырыс: Сантехника</div></div></div></body></html>"""


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    jobs = {"exp_0": step3(""), "exp_1": step3("3"), "exp_2": step3("38"), "exp_done": step3("38", focus=False),
            "preview": step4(), "preview_press": step4(press=True),
            "lock": lock_screen(HERE / "frames/N2.jpg")}
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 320, "height": 569}, device_scale_factor=3.375)
        for name, html in jobs.items():
            page.set_content(html)
            page.wait_for_load_state("networkidle")
            page.screenshot(path=str(OUT / f"{name}.png"))
        browser.close()
    print(len(jobs), "screens ->", OUT)


if __name__ == "__main__":
    main()
