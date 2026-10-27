"""Makes the first frames of the «Тапсыр!» ad (shots.json) with Google's image model.

Runs on GitHub (ad-frames.yml) with the app's Gemini API key. Character photos are made first;
scene frames then get them as reference images so the same faces appear in every shot. The frames
are animated in Google Flow afterwards.

Every image is paid from the app's Gemini balance, so spend.json keeps a running total and nothing
is made once the next image would take it past budget_usd.

  ONLY="ref_aje s1_kitchen"  makes (or remakes) just those; without it, only missing ones are made.
"""
import base64, json, os, pathlib, subprocess, sys, time, urllib.error, urllib.request

HERE = pathlib.Path(__file__).resolve().parent
spec = json.loads((HERE / 'shots.json').read_text())
LEDGER = HERE / 'spend.json'
ledger = json.loads(LEDGER.read_text()) if LEDGER.exists() else {'total_usd': 0.0, 'log': []}
ONLY = os.environ.get('ONLY', '').split()
KEY = os.environ['GEMINI_API_KEY']
API = 'https://generativelanguage.googleapis.com/v1beta'

# Preferred models, best first. Prices are Google's list prices per 2K image, rounded up.
PREFS = ['gemini-3-pro-image', 'gemini-3-pro-image-preview', 'gemini-3.1-flash-image',
         'gemini-3.1-flash-image-preview', 'gemini-2.5-flash-image']
PRICES = {'gemini-3-pro-image': 0.14, 'gemini-3.1-flash-image': 0.11, 'gemini-2.5-flash-image': 0.04}


def price(model):
    return next((p for k, p in PRICES.items() if model.startswith(k)), 0.25)


def call(method, path, body=None):
    req = urllib.request.Request(f'{API}/{path}', json.dumps(body).encode() if body else None,
                                 {'x-goog-api-key': KEY, 'Content-Type': 'application/json'}, method=method)
    with urllib.request.urlopen(req, timeout=240) as r:
        return json.loads(r.read())


def pick_model():
    names = {m['name'].removeprefix('models/') for m in call('GET', 'models?pageSize=1000').get('models', [])}
    print('image models here:', ' '.join(sorted(n for n in names if 'image' in n)))
    wanted = os.environ.get('MODEL')
    for name in [wanted] if wanted else PREFS:
        if name in names:
            return name
    sys.exit('none of the image models is available')


def jpeg_part(path):
    return {'inlineData': {'mimeType': 'image/jpeg', 'data': base64.b64encode((HERE / path).read_bytes()).decode()}}


def generate(model, name, item):
    parts, intro = [], ''
    refs = item.get('refs', [])
    if refs:
        who = ' '.join(f'Image {i + 1} shows {label}.' for i, (_, label) in enumerate(refs))
        intro = (f'Use the attached reference images: keep each person\'s exact face, hairstyle, body type and '
                 f'clothing, and each place exactly as shown. {who} ')
        parts += [jpeg_part(path) for path, _ in refs]
    style = spec['ref_style'] if item['kind'] == 'ref' else spec['scene_style']
    parts.append({'text': f"{intro}{item['prompt']} {style}"})
    image_config = {'aspectRatio': '3:4' if item['kind'] == 'ref' else '9:16'}
    if model.startswith('gemini-3'):
        image_config['imageSize'] = '2K'
    body = {'contents': [{'role': 'user', 'parts': parts}],
            'generationConfig': {'responseModalities': ['TEXT', 'IMAGE'], 'imageConfig': image_config}}
    # "High demand" answers are common and not billed, so they are retried for a few minutes
    for attempt in range(6):
        try:
            res = call('POST', f'models/{model}:generateContent', body)
            break
        except urllib.error.HTTPError as e:
            print(f'  {name}: HTTP {e.code} {e.read()[:200].decode(errors="ignore")}')
            if e.code not in (429, 500, 503) or attempt == 5:
                return None
        except (urllib.error.URLError, TimeoutError) as e:
            print(f'  {name}: {e}')
            if attempt == 5:
                return None
        time.sleep(20 * (attempt + 1))
    cand = (res.get('candidates') or [{}])[0]
    images = [p for p in cand.get('content', {}).get('parts', []) if 'inlineData' in p and not p.get('thought')]
    if not images:
        texts = ' '.join(p.get('text', '') for p in cand.get('content', {}).get('parts', []))
        print(f'  {name}: no image ({cand.get("finishReason")}) {texts[:300]}')
        return None
    return base64.b64decode(images[-1]['inlineData']['data']), images[-1]['inlineData'].get('mimeType', 'image/png')


model = pick_model()
cost = price(model)
(HERE / 'frames').mkdir(exist_ok=True)
print(f'model {model}, about ${cost} per image, spent so far ${ledger["total_usd"]:.2f} of ${spec["budget_usd"]}')
made, failed = [], []
for name, item in spec['items'].items():
    target = HERE / 'frames' / f'{name}.jpg'
    if (ONLY and name not in ONLY) or (not ONLY and target.exists()):
        continue
    missing = [p for p, _ in item.get('refs', []) if not (HERE / p).exists()]
    if missing:
        print(f'  {name}: skipped, reference not made yet: {" ".join(missing)}')
        failed.append(name)
        continue
    if ledger['total_usd'] + cost > spec['budget_usd'] + 1e-9:
        print(f'  budget reached (${ledger["total_usd"]:.2f}); stopping before {name}')
        failed.append(name)
        break
    answer = generate(model, name, item)
    if answer is None:
        failed.append(name)
        continue
    data, mime = answer
    ledger['total_usd'] = round(ledger['total_usd'] + cost, 4)
    ledger['log'].append({'name': name, 'model': model, 'usd': cost, 'at': time.strftime('%Y-%m-%d %H:%M')})
    LEDGER.write_text(json.dumps(ledger, indent=1) + '\n')
    # The image is paid for at this point, so it is kept even if the JPEG conversion fails
    src = target.with_name(f"{name}.src.{mime.split('/')[-1]}")
    src.write_bytes(data)
    if subprocess.call(['convert', str(src), '-quality', '90', str(target)]) == 0:
        src.unlink()
    made.append(name)
    print(f'ok {name}')

print(f'made {len(made)}: {" ".join(made)}; failed {len(failed)}: {" ".join(failed)}; '
      f'spent ${ledger["total_usd"]:.2f} of ${spec["budget_usd"]}')
sys.exit(1 if failed and not made else 0)
