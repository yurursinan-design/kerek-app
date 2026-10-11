/**
 * Developer mode: diagnostics panel, data import/export and raw debug boxes are hidden from
 * regular users. Open the app once with `?debug=1` to turn it on for this browser, and with
 * `?debug=0` to turn it off again.
 */
const DEBUG_KEY = 'kerek_debug_v1';

function readFlag(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    const param = new URLSearchParams(window.location.search).get('debug');
    if (param === '1') localStorage.setItem(DEBUG_KEY, '1');
    if (param === '0') localStorage.removeItem(DEBUG_KEY);
    return localStorage.getItem(DEBUG_KEY) === '1';
  } catch {
    return false;
  }
}

export const isDebugMode: boolean = readFlag();
