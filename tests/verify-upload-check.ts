/**
 * Server-side check of uploaded files (functions/src/uploadCheck.ts): the first bytes must match
 * the content type, photos may not be absurdly large, JPEG and PNG photos lose their metadata
 * (EXIF with GPS, text chunks). Pure parts, then the whole check against the Storage emulator.
 */
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || process.env.VITE_FIREBASE_PROJECT_ID || 'demo-kerek';
process.env.FIREBASE_STORAGE_EMULATOR_HOST = process.env.FIREBASE_STORAGE_EMULATOR_HOST || '127.0.0.1:9199';

let failed = 0;
function assert(cond: boolean, name: string, detail?: unknown) {
  if (cond) console.log(`[PASS] ${name}`);
  else {
    console.error(`[FAIL] ${name}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ''}`);
    failed++;
  }
}

const seg = (marker: number, body: Buffer) => {
  const len = Buffer.alloc(2);
  len.writeUInt16BE(body.length + 2);
  return Buffer.concat([Buffer.from([0xff, marker]), len, body]);
};
/** A small JPEG: JFIF, an EXIF segment with a GPS position, a comment, a frame header of w×h */
function jpeg(width: number, height: number, withExif = true): Buffer {
  const sof = Buffer.alloc(15);
  sof[0] = 8;
  sof.writeUInt16BE(height, 1);
  sof.writeUInt16BE(width, 3);
  sof[5] = 3;
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    seg(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1')),
    ...(withExif ? [seg(0xe1, Buffer.from('Exif\0\0GPS 44.8481N 65.4823E serial 12345', 'latin1')), seg(0xfe, Buffer.from('my home', 'latin1'))] : []),
    seg(0xc0, sof),
    seg(0xda, Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])),
    Buffer.from([0x11, 0x22, 0x33, 0xff, 0xd9]),
  ]);
}
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  return Buffer.concat([len, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
};
function png(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('tEXt', Buffer.from('Comment\0Aigul, Abay 12', 'latin1')),
    chunk('IDAT', Buffer.from([1, 2, 3])),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function main() {
  const ucPath = '../functions/src/uploadCheck';
  const uc = await import(ucPath);

  // --- Format check
  assert(uc.contentMatchesType('image/jpeg', jpeg(800, 600)), 'A real JPEG is a JPEG');
  assert(!uc.contentMatchesType('image/jpeg', Buffer.from('<html><script>alert(1)</script>')), 'HTML labelled image/jpeg is refused');
  assert(!uc.contentMatchesType('image/jpeg', Buffer.from([1, 2, 3, 4])), 'Four random bytes labelled image/jpeg are refused (audit probe)');
  assert(!uc.contentMatchesType('image/png', jpeg(10, 10)), 'A JPEG labelled image/png is refused');
  assert(uc.contentMatchesType('application/pdf', Buffer.from('%PDF-1.7\n')), 'A PDF is a PDF');
  assert(!uc.contentMatchesType('application/pdf', Buffer.from('MZ\x90\0', 'latin1')), 'A Windows program labelled PDF is refused');
  assert(uc.contentMatchesType('audio/webm;codecs=opus', Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f])), 'A voice note from the browser (WebM) passes');
  assert(uc.contentMatchesType('audio/mp4', Buffer.from('\0\0\0\x18ftypM4A ', 'latin1')), 'A voice note from an iPhone (M4A) passes');
  assert(uc.contentMatchesType('video/mp4', Buffer.from('\0\0\0\x20ftypisom', 'latin1')), 'An MP4 video passes');
  assert(uc.contentMatchesType('audio/mpeg', Buffer.from('ID3\x04', 'latin1')), 'An MP3 passes');
  assert(!uc.contentMatchesType('text/html', Buffer.from('<html>')), 'Unknown content types are refused');

  // --- Sizes and metadata
  assert(JSON.stringify(uc.imageSize(jpeg(800, 600))) === '{"width":800,"height":600}', 'JPEG size is read from the frame header');
  assert(JSON.stringify(uc.imageSize(png(30000, 20))) === '{"width":30000,"height":20}', 'PNG size is read from its header');
  const stripped = uc.stripJpegMetadata(jpeg(800, 600));
  assert(!stripped.toString('latin1').includes('GPS') && !stripped.toString('latin1').includes('my home'), 'EXIF (GPS) and comments are removed from a JPEG');
  assert(stripped.toString('latin1').includes('JFIF') && stripped.subarray(-5).equals(Buffer.from([0x11, 0x22, 0x33, 0xff, 0xd9])), 'The picture data is kept exactly');
  assert(uc.stripJpegMetadata(jpeg(800, 600, false)).equals(jpeg(800, 600, false)), 'A clean JPEG is left as it is');
  const pngClean = uc.stripPngMetadata(png(10, 10));
  assert(!pngClean.toString('latin1').includes('Abay') && pngClean.toString('latin1').includes('IDAT'), 'PNG text chunks are removed, the picture stays');
  assert(uc.isCheckedPath('requests/r1/att0') && uc.isCheckedPath('chat/c1/att_1/a.pdf') && uc.isCheckedPath('providers/u1/portfolio/p0') && !uc.isCheckedPath('other/x'), 'Only upload folders are checked');

  // --- The whole check against the Storage emulator
  const { createRequire } = await import('node:module');
  const requireFromFunctions = createRequire(new URL('../functions/package.json', import.meta.url));
  const { getStorage } = requireFromFunctions('firebase-admin/storage');
  const bucketName = `${process.env.GCLOUD_PROJECT}.appspot.com`;
  const bucket = getStorage().bucket(bucketName);
  const tail = String(Date.now()).slice(-7);
  const put = async (name: string, bytes: Buffer, contentType: string) => {
    await bucket.file(name).save(bytes, { contentType, resumable: false, metadata: { metadata: { firebaseStorageDownloadTokens: `tok-${tail}` } } });
    return name;
  };
  const exists = async (name: string) => (await bucket.file(name).exists())[0];

  const fake = await put(`requests/r_${tail}/att0`, Buffer.from([1, 2, 3, 4]), 'image/jpeg');
  assert((await uc.checkStoredFile(bucketName, fake)) === 'deleted' && !(await exists(fake)), 'A fake photo is deleted from storage');

  const huge = await put(`providers/u_${tail}/portfolio/p0`, png(30000, 30000), 'image/png');
  assert((await uc.checkStoredFile(bucketName, huge)) === 'deleted' && !(await exists(huge)), 'A photo of 30000×30000 pixels is deleted');

  const withGps = await put(`requests/r_${tail}/att1`, jpeg(1200, 900), 'image/jpeg');
  assert((await uc.checkStoredFile(bucketName, withGps)) === 'cleaned', 'A photo with GPS data is saved again without it');
  const [after] = await bucket.file(withGps).download();
  const [meta] = await bucket.file(withGps).getMetadata();
  assert(!after.toString('latin1').includes('GPS') && after.toString('latin1').includes('JFIF'), 'The stored photo no longer has the GPS position');
  assert(String(meta.metadata?.firebaseStorageDownloadTokens || '').includes(`tok-${tail}`) && meta.contentType === 'image/jpeg', 'Its link token and type stay, so the app still shows it');
  assert((await uc.checkStoredFile(bucketName, withGps)) === 'ok', 'Checking the cleaned photo again changes nothing (no loop)');

  const pdf = await put(`chat/c_${tail}/att_${tail}/smeta.pdf`, Buffer.from('%PDF-1.4\n%...'), 'application/pdf');
  assert((await uc.checkStoredFile(bucketName, pdf)) === 'ok' && (await exists(pdf)), 'A real PDF in the chat stays');
  const exe = await put(`chat/c_${tail}/att_x${tail}/smeta.pdf`, Buffer.from('MZ\x90\0\x03\0\0\0', 'latin1'), 'application/pdf');
  assert((await uc.checkStoredFile(bucketName, exe)) === 'deleted' && !(await exists(exe)), 'A program disguised as a PDF is deleted');

  console.log(failed ? `\nUPLOAD CHECK: ${failed} FAILED` : '\nUPLOAD CHECK: ALL CHECKS PASSED');
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('Upload check test error:', err);
  process.exit(1);
});
