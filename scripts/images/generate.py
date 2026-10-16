"""Makes the app photos listed in prompts.json that are not in public/img/photo yet.

Runs on GitHub (images.yml). Tries Vertex AI Imagen with the deploy account first; if that is not
allowed, uses the Gemini API key passed in GEMINI_API_KEY. Each image is saved as a 768px WebP.
"""
import base64, io, json, os, pathlib, subprocess, sys, time, urllib.request, urllib.error

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / 'public' / 'img' / 'photo'
OUT.mkdir(parents=True, exist_ok=True)
spec = json.loads((ROOT / 'scripts' / 'images' / 'prompts.json').read_text())
PROJECT = os.environ['FIREBASE_PROJECT_ID']
ONLY = set(filter(None, os.environ.get('ONLY', '').split()))


def post(url, body, headers):
    req = urllib.request.Request(url, json.dumps(body).encode(), {**headers, 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.loads(r.read())


def vertex(prompt):
    token = subprocess.check_output(['gcloud', 'auth', 'print-access-token'], text=True).strip()
    url = (f'https://us-central1-aiplatform.googleapis.com/v1/projects/{PROJECT}/locations/us-central1/'
           'publishers/google/models/imagen-4.0-generate-001:predict')
    res = post(url, {'instances': [{'prompt': prompt}],
                     'parameters': {'sampleCount': 1, 'aspectRatio': '1:1', 'personGeneration': 'allow_adult'}},
               {'Authorization': f'Bearer {token}'})
    return base64.b64decode(res['predictions'][0]['bytesBase64Encoded'])


def gemini_key(prompt):
    key = os.environ.get('GEMINI_API_KEY')
    if not key:
        raise RuntimeError('no key')
    url = 'https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict'
    try:
        res = post(url, {'instances': [{'prompt': prompt}],
                         'parameters': {'sampleCount': 1, 'aspectRatio': '1:1', 'personGeneration': 'allow_adult'}},
                   {'x-goog-api-key': key})
        return base64.b64decode(res['predictions'][0]['bytesBase64Encoded'])
    except urllib.error.HTTPError as e:
        print('  imagen via key:', e.code, e.read()[:300].decode(errors='ignore'))
    url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent'
    res = post(url, {'contents': [{'parts': [{'text': prompt}]}],
                     'generationConfig': {'responseModalities': ['IMAGE'], 'imageConfig': {'aspectRatio': '1:1'}}},
               {'x-goog-api-key': key})
    for part in res['candidates'][0]['content']['parts']:
        if 'inlineData' in part:
            return base64.b64decode(part['inlineData']['data'])
    raise RuntimeError('no image in answer')


backends = [vertex, gemini_key]
made, failed = 0, []
for name, scene in spec['images'].items():
    if ONLY and name not in ONLY:
        continue
    target = OUT / f'{name}.webp'
    if target.exists() and not ONLY:
        continue
    prompt = f"{scene} {spec['style']}"
    data = None
    for b in list(backends):
        try:
            data = b(prompt)
            break
        except Exception as e:  # noqa: BLE001
            msg = e.read()[:300].decode(errors='ignore') if isinstance(e, urllib.error.HTTPError) else str(e)[:300]
            print(f'  {b.__name__} failed for {name}: {msg}')
            if b is vertex and isinstance(e, urllib.error.HTTPError) and e.code in (403, 404):
                backends.remove(vertex)  # not allowed for this project: stop trying it
    if data is None:
        failed.append(name)
        continue
    raw = OUT / f'{name}.png'
    raw.write_bytes(data)
    subprocess.check_call(['convert', str(raw), '-resize', '768x768^', '-gravity', 'center', '-extent', '768x768',
                           '-quality', '80', str(target)])
    raw.unlink()
    made += 1
    print(f'ok {name}')
    time.sleep(1)

print(f'made {made}, failed {len(failed)}: {" ".join(failed)}')
sys.exit(1 if failed and not made else 0)
