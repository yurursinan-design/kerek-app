/**
 * Media links in documents other users write (chat messages, request attachments) are shown only
 * when they point at this project's own Cloud Storage bucket or are local previews
 * (src/services/safeData.ts).
 */
import { isTrustedMediaUrl } from '../src/services/safeData';

let failed = 0;
function assert(cond: boolean, name: string) {
  if (cond) console.log(`[PASS] ${name}`);
  else {
    console.error(`[FAIL] ${name}`);
    failed++;
  }
}

const OWN = 'kerek-9d153.firebasestorage.app';
const ownLink = `https://firebasestorage.googleapis.com/v0/b/${OWN}/o/chat%2Fconv_1%2Fm1%2Fa_photo.jpg?alt=media&token=abc`;

assert(isTrustedMediaUrl(ownLink, OWN), 'A download link from our own bucket is shown');
assert(
  !isTrustedMediaUrl('https://firebasestorage.googleapis.com/v0/b/someone-else.appspot.com/o/login.html?alt=media', OWN),
  "Another Firebase project's bucket is refused (it could serve a fake login page)"
);
assert(
  !isTrustedMediaUrl(`https://firebasestorage.googleapis.com/v0/b/${OWN}.evil.app/o/x?alt=media`, OWN),
  'A bucket name that only starts like ours is refused'
);
assert(!isTrustedMediaUrl(ownLink, ''), 'Without a known bucket no storage link is trusted');
assert(!isTrustedMediaUrl('https://evil.example/photo.jpg', OWN), 'Outside websites are refused');
assert(!isTrustedMediaUrl('javascript:alert(1)', OWN), 'Script links are refused');
assert(isTrustedMediaUrl('data:image/jpeg;base64,AAAA', OWN), 'A photo preview made on this phone is shown');
assert(!isTrustedMediaUrl('data:image/svg+xml;base64,PHN2Zz4=', OWN), 'An SVG "image" (it can carry scripts) is refused');
assert(!isTrustedMediaUrl('data:text/html,<b>x</b>', OWN), 'A web page packed into a link is refused');
assert(isTrustedMediaUrl('blob:https://tapsyr.web.app/1234', OWN), 'A local file preview is shown');

if (failed > 0) {
  console.error(`\n${failed} media link check(s) failed`);
  process.exit(1);
}
console.log('\nALL PASSED');
