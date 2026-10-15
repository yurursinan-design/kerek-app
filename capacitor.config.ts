import type { CapacitorConfig } from '@capacitor/cli';

// Android (and later iPhone) app around the same web build in dist/
const config: CapacitorConfig = {
  // The package name in Google Play (android/app/build.gradle has the same applicationId)
  appId: 'kerek.kz.app',
  appName: 'Tapsyr',
  webDir: 'dist',
  plugins: {
    // Light status bar with dark icons; the page sits between the system bars
    SystemBars: { style: 'LIGHT' },
  },
};

export default config;
