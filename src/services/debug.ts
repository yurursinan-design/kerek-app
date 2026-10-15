/**
 * Developer mode: diagnostics panel, data import/export and raw debug boxes. Only in local
 * development builds (`npm run dev`), opened with `?debug=1` and closed with `?debug=0`. The
 * published site never shows these tools, whatever the address says.
 */
const DEBUG_KEY = 'kerek_debug_v1';

function readFlag(): boolean {
  if (!import.meta.env?.DEV) return false;
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
