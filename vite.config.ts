import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import {legalPages} from './scripts/legalPages';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), legalPages()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
  };
});
