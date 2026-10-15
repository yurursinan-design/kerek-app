#!/usr/bin/env bash
# Runs every tests/verify-*.ts against the Firestore, Auth and Storage emulators (started by `npm run test:verify`).
# Test users get a verified phone number through the Auth emulator (KEREK_TEST_AUTO_PHONE=1), because
# publishing requests, offers and provider profiles requires one.
# verify-ai-parser-e2e calls the real Gemini API and runs only when GEMINI_API_KEY is set.
set -u
cd "$(dirname "$0")/.."

export VITE_FIREBASE_API_KEY="${VITE_FIREBASE_API_KEY:-demo-emulator-key}"
export VITE_FIREBASE_PROJECT_ID="${VITE_FIREBASE_PROJECT_ID:-demo-kerek}"
export VITE_FIREBASE_AUTH_DOMAIN="${VITE_FIREBASE_AUTH_DOMAIN:-demo-kerek.firebaseapp.com}"
export VITE_FIREBASE_APP_ID="${VITE_FIREBASE_APP_ID:-1:1:web:1}"
export VITE_FIREBASE_STORAGE_BUCKET="${VITE_FIREBASE_STORAGE_BUCKET:-demo-kerek.appspot.com}"
export VITE_USE_EMULATOR=true
export FIRESTORE_EMULATOR_HOST="${FIRESTORE_EMULATOR_HOST:-127.0.0.1:8088}"
export FIREBASE_AUTH_EMULATOR_HOST="${FIREBASE_AUTH_EMULATOR_HOST:-127.0.0.1:9099}"
export FIREBASE_STORAGE_EMULATOR_HOST="${FIREBASE_STORAGE_EMULATOR_HOST:-127.0.0.1:9199}"
export KEREK_TEST_AUTO_PHONE=1

failed=()
passed=0
for f in tests/verify-*.ts; do
  name="$(basename "$f" .ts)"
  if [ "$name" = "verify-ai-parser-e2e" ] && [ -z "${GEMINI_API_KEY:-}" ]; then
    echo "--- $name: not run (needs GEMINI_API_KEY for the real Gemini API)"
    continue
  fi
  echo "=== $name"
  if timeout 180 npx tsx "$f"; then
    passed=$((passed + 1))
  else
    failed+=("$name")
  fi
done

echo
echo "verify tests: $passed passed, ${#failed[@]} failed"
if [ ${#failed[@]} -gt 0 ]; then
  printf '  failed: %s\n' "${failed[@]}"
  exit 1
fi
