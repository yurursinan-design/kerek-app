// The app's own address and the move from the project's old addresses
import { LEGACY_HOSTS, PUBLIC_SITE_URL, legacyRedirectTarget } from '../src/config/site';

let failed = 0;
const check = (name: string, cond: boolean, extra = '') => {
  console.log(`${cond ? '[PASS]' : '[FAIL]'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failed++;
};
const at = (href: string) => {
  const u = new URL(href);
  return { hostname: u.hostname, pathname: u.pathname, search: u.search, hash: u.hash };
};

check('Shared links use tapsyr.web.app', PUBLIC_SITE_URL === 'https://tapsyr.web.app');
check('Both old addresses are listed', LEGACY_HOSTS.includes('kerek-9d153.web.app') && LEGACY_HOSTS.includes('kerek-9d153.firebaseapp.com'));
check(
  'Old address with a master link moves to the same link on the new address',
  legacyRedirectTarget(at('https://kerek-9d153.web.app/?master=abc123#x')) === 'https://tapsyr.web.app/?master=abc123#x'
);
check('firebaseapp.com address moves too', legacyRedirectTarget(at('https://kerek-9d153.firebaseapp.com/')) === 'https://tapsyr.web.app/');
check('The new address stays', legacyRedirectTarget(at('https://tapsyr.web.app/?master=abc')) === null);
check('Preview links stay', legacyRedirectTarget(at('https://kerek-9d153--pr-4-abcd1234.web.app/')) === null);
check('The phone app (localhost) stays', legacyRedirectTarget(at('https://localhost/')) === null);

if (failed) {
  console.log(`${failed} site address check(s) failed`);
  process.exit(1);
}
console.log('ALL SITE ADDRESS CHECKS PASSED');
