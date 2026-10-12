import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

// Local development and browser tests against the Firebase emulators (`npm run dev:emulator`).
// Uses a demo project: nothing here can reach the real kerek-9d153 data.
process.env.VITE_FIREBASE_API_KEY ||= 'demo-emulator-key';
process.env.VITE_FIREBASE_PROJECT_ID ||= 'demo-kerek';
process.env.VITE_FIREBASE_AUTH_DOMAIN ||= 'demo-kerek.firebaseapp.com';
process.env.VITE_FIREBASE_APP_ID ||= '1:1:web:1';
process.env.VITE_FIREBASE_STORAGE_BUCKET ||= 'demo-kerek.appspot.com';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, '.'),
    },
  },
  define: {
    // src/services/firebase.ts connects to the emulators when these are present
    'process.env': JSON.stringify({
      VITE_USE_EMULATOR: 'true',
      FIRESTORE_EMULATOR_HOST: '127.0.0.1:8088',
      FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
    }),
  },
  server: { port: 3000, host: '127.0.0.1' },
});
