/**
 * Public address of the website, used in links people share (e.g. a master's profile).
 * Change it here when the app's own domain is connected.
 */
export const PUBLIC_SITE_URL = 'https://tapsyr.web.app';

/**
 * The app's Google Play page, shown on the website's landing page. Empty until the app is
 * published there (the page then says "soon" instead of linking).
 */
export const PLAY_STORE_URL = '';

/** The app's App Store page, likewise empty until the iPhone app is published */
export const APP_STORE_URL = '';

/** Where the website's pre-registration form for masters is sent (functions/src/masterSignup.ts) */
export const MASTER_SIGNUP_URL = 'https://asia-south1-kerek-9d153.cloudfunctions.net/masterSignup';

/**
 * The project's first addresses, from before the app was called Tapsyr. They still serve the
 * same app (old shared links, the privacy policy link in Google Play), but opening the app there
 * moves the visitor to PUBLIC_SITE_URL with the same path. Preview links (kerek-9d153--pr-…) stay.
 */
export const LEGACY_HOSTS = ['kerek-9d153.web.app', 'kerek-9d153.firebaseapp.com'];

/**
 * Switched on once the app was checked on the new address (sign-in works there); until then
 * both addresses simply serve the app.
 */
export const MOVE_TO_NEW_ADDRESS = true;

/** Where the app should continue when it was opened on an old address, otherwise null */
export function legacyRedirectTarget(loc: Pick<Location, 'hostname' | 'pathname' | 'search' | 'hash'>): string | null {
  if (!LEGACY_HOSTS.includes(loc.hostname)) return null;
  return `${PUBLIC_SITE_URL}${loc.pathname}${loc.search}${loc.hash}`;
}
