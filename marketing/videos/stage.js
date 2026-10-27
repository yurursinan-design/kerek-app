/*
 * Deterministic timeline for the Tapsyr social videos: each video defines window.seek(t), which
 * draws the frame at t seconds, and window.DURATION. render.mjs calls seek for every frame, so the
 * output never depends on how fast the machine is.
 */
window.STAGE = (() => {
  const clamp = (x) => Math.max(0, Math.min(1, x));
  /** Progress 0..1 of a step that starts at `at` and lasts `dur` seconds */
  const p = (t, at, dur) => clamp((t - at) / dur);
  const E = {
    out: (x) => 1 - (1 - x) ** 3,
    inOut: (x) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2),
    back: (x) => {
      const c1 = 1.70158;
      const c3 = c1 + 1;
      return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2;
    },
  };
  const lang = new URLSearchParams(location.search).get('lang') === 'ru' ? 'ru' : 'kz';
  const $ = (id) => document.getElementById(id);

  /** Shows an element from `inAt` (fade and slide in) until `outAt` (fade out). */
  function vis(el, t, inAt, outAt = Infinity, { dy = 50, dx = 0, scale = 0, dur = 0.45, outDur = 0.3, ease = E.out } = {}) {
    const a = ease(p(t, inAt, dur));
    const b = outAt === Infinity ? 0 : p(t, outAt, outDur);
    const o = clamp(a) * (1 - b);
    const k = 1 - a;
    el.style.opacity = String(o);
    el.style.transform = `translate(${dx * k}px, ${dy * k - b * 30}px) scale(${1 - scale * k})`;
    el.style.visibility = o < 0.002 ? 'hidden' : 'visible';
  }

  /** Captions that replace each other: [{ at, out, text }] */
  function captions(parent, list) {
    const els = list.map((c) => {
      const d = document.createElement('div');
      d.className = 'cap';
      // Keeps a dash from starting a line
      d.textContent = c.text.replace(' — ', '\u00a0— ');
      parent.appendChild(d);
      return d;
    });
    return (t) => list.forEach((c, i) => vis(els[i], t, c.at, c.out ?? Infinity, { dy: 40 }));
  }

  /** Text typed out between `at` and `at + dur` */
  function type(el, caret, text, t, at, dur) {
    const n = Math.round(text.length * p(t, at, dur));
    el.textContent = text.slice(0, n);
    if (caret) caret.style.visibility = t >= at - 0.4 && (n < text.length || Math.floor(t * 2) % 2 === 0) ? 'visible' : 'hidden';
  }

  /** The closing card: logo, name, line, address */
  function endCard(stage, { tag, small }) {
    const end = document.createElement('div');
    end.className = 'end';
    end.innerHTML = `<img src="../../public/icon-512.png" alt=""><div class="name">Tapsyr</div><div class="tag"></div><div class="url">tapsyr.web.app</div><div class="small"></div>`;
    end.querySelector('.tag').textContent = tag;
    end.querySelector('.small').textContent = small;
    stage.appendChild(end);
    const [logo, name, line, url, sm] = end.children;
    return (t, at) => {
      const k = E.inOut(p(t, at, 0.5));
      end.style.clipPath = `circle(${k * 150}% at 50% 100%)`;
      end.style.visibility = k <= 0 ? 'hidden' : 'visible';
      const pop = E.back(p(t, at + 0.35, 0.5));
      logo.style.transform = `scale(${0.4 + 0.6 * pop})`;
      logo.style.opacity = String(p(t, at + 0.35, 0.2));
      vis(name, t, at + 0.55);
      vis(line, t, at + 0.8);
      vis(url, t, at + 1.1, Infinity, { scale: 0.15, dy: 0, ease: E.back });
      vis(sm, t, at + 1.35);
    };
  }

  return { clamp, p, E, lang, $, vis, captions, type, endCard };
})();
