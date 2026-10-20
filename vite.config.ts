import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {execSync} from 'child_process';
import path from 'path';
import {defineConfig} from 'vite';
import {legalPages} from './scripts/legalPages';
import {sitePages} from './scripts/landingPage';

// Shown on the profile tab, so a support question can name the exact build
function buildId(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', {stdio: ['ignore', 'pipe', 'ignore']}).toString().trim();
  } catch {
    return 'dev';
  }
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), legalPages(), sitePages()],
    define: {
      __APP_VERSION__: JSON.stringify(`${process.env.KEREK_VERSION_NAME || '1.0'} · ${buildId()}`),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
  };
});
