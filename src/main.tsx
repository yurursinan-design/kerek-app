import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary';
import { startDialogA11y } from './services/dialogA11y';
import './index.css';

// Keyboard and focus handling for all dialogs (Escape, focus kept inside, focus returned)
startDialogA11y();

// After a new version is published, a phone that still runs the old page asks for screen files
// that no longer exist. Reload once to pick up the new version instead of showing a blank screen.
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  try {
    const last = Number(sessionStorage.getItem('kerek_reload_after_update') || 0);
    if (Date.now() - last < 10000) return;
    sessionStorage.setItem('kerek_reload_after_update', String(Date.now()));
  } catch {}
  window.location.reload();
});

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
