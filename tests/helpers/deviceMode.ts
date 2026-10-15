/** Imported first by tests of device mode (no cloud): removes the Firebase settings the test runner sets. */
for (const key of Object.keys(process.env)) {
  if (key.startsWith('VITE_FIREBASE_') || key === 'VITE_USE_EMULATOR' || key.endsWith('_EMULATOR_HOST') || key === 'KEREK_TEST_AUTO_PHONE') {
    delete process.env[key];
  }
}
