import type { CapacitorConfig } from '@capacitor/cli';

// Android (and later iPhone) app around the same web build in dist/
const config: CapacitorConfig = {
  appId: 'kz.kerek.app',
  appName: 'KEREK',
  webDir: 'dist',
  plugins: {
    // Light status bar with dark icons; the page sits between the system bars
    SystemBars: { style: 'LIGHT' },
    // SMS login through the phone's own Firebase SDK; the web SDK keeps the signed-in session
    FirebaseAuthentication: { skipNativeAuth: true, providers: ['phone'] },
  },
};

export default config;
