import { getStorage } from 'firebase-admin/storage';
import { onObjectFinalized } from 'firebase-functions/v2/storage';
import { appBucket } from './kzMirror';
import './limits';

/**
 * Every uploaded file (request photos, videos and voice notes, chat files, work photos) is checked
 * on the server, whatever app sent it: its first bytes must be the format its content type claims
 * (a "photo" that is really something else is deleted), a photo may not be absurdly large in
 * pixels, and JPEG and PNG photos lose their hidden metadata (EXIF with GPS position, camera serial
 * numbers, text comments). The app cleans photos too, but a direct upload skips the app.
 */

type Kind = 'jpeg' | 'png' | 'webp' | 'pdf' | 'isobmff' | 'ebml' | 'mp3' | 'aac' | 'wav' | 'ogg';

const KINDS_BY_TYPE: Record<string, Kind[]> = {
  'image/jpeg': ['jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'application/pdf': ['pdf'],
  'video/mp4': ['isobmff'],
  'video/quicktime': ['isobmff'],
  'video/webm': ['ebml'],
  'audio/mpeg': ['mp3'],
  'audio/mp4': ['isobmff'],
  'audio/x-m4a': ['isobmff'],
  'audio/aac': ['aac', 'isobmff'],
  'audio/wav': ['wav'],
  'audio/webm': ['ebml'],
  'audio/ogg': ['ogg'],
};

/** The largest photo accepted: 12 000 pixels on a side and 50 million pixels in all */
export const MAX_SIDE = 12000;
export const MAX_PIXELS = 50_000_000;

const ascii = (b: Buffer, start: number, text: string) => b.length >= start + text.length && b.toString('latin1', start, start + text.length) === text;

/** The formats the first bytes of a file can be. */
export function sniff(head: Buffer): Kind[] {
  const out: Kind[] = [];
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) out.push('jpeg');
  if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) out.push('png');
  if (ascii(head, 0, 'RIFF') && ascii(head, 8, 'WEBP')) out.push('webp');
  if (ascii(head, 0, 'RIFF') && ascii(head, 8, 'WAVE')) out.push('wav');
  if (ascii(head, 0, '%PDF-')) out.push('pdf');
  if (ascii(head, 4, 'ftyp')) out.push('isobmff');
  if (head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) out.push('ebml');
  if (ascii(head, 0, 'OggS')) out.push('ogg');
  if (ascii(head, 0, 'ID3') || (head.length >= 2 && head[0] === 0xff && (head[1] & 0xe0) === 0xe0 && (head[1] & 0x06) !== 0)) out.push('mp3');
  if (head.length >= 2 && head[0] === 0xff && (head[1] & 0xf6) === 0xf0) out.push('aac');
  return out;
}

/** Whether the first bytes of a file are the format its content type ("audio/webm;codecs=opus") claims. */
export function contentMatchesType(contentType: string | undefined, head: Buffer): boolean {
  const kinds = KINDS_BY_TYPE[String(contentType || '').split(';')[0].trim().toLowerCase()];
  if (!kinds) return false;
  const found = sniff(head);
  return kinds.some((k) => found.includes(k));
}

/** Width and height of a JPEG, PNG or WebP photo, or null when the header can't be read. */
export function imageSize(buf: Buffer): { width: number; height: number } | null {
  const kinds = sniff(buf);
  if (kinds.includes('png') && buf.length >= 24 && ascii(buf, 12, 'IHDR')) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (kinds.includes('jpeg')) {
    let i = 2;
    while (i + 9 < buf.length && buf[i] === 0xff) {
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isFrame) return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
      if (marker === 0xda || len < 2) break;
      i += 2 + len;
    }
    return null;
  }
  if (kinds.includes('webp') && buf.length >= 30) {
    if (ascii(buf, 12, 'VP8X')) return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
    if (ascii(buf, 12, 'VP8 ')) return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    if (ascii(buf, 12, 'VP8L')) {
      const bits = buf.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
  }
  return null;
}

/**
 * A JPEG without its metadata segments: APP1–APP15 (EXIF with GPS position, XMP, maker notes) and
 * comments go; JFIF (APP0), the colour profile (APP2 "ICC_PROFILE") and Adobe colour data (APP14)
 * stay so the picture looks the same. The image data itself is copied unchanged.
 */
export function stripJpegMetadata(buf: Buffer): Buffer {
  if (!sniff(buf).includes('jpeg')) return buf;
  const parts: Buffer[] = [buf.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= buf.length && buf[i] === 0xff) {
    const marker = buf[i + 1];
    if (marker === 0xda) break; // start of the image data: the rest is copied as it is
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      parts.push(buf.subarray(i, i + 2));
      i += 2;
      continue;
    }
    const end = i + 2 + buf.readUInt16BE(i + 2);
    if (end > buf.length) return buf; // damaged file: left to the format check
    const isIcc = marker === 0xe2 && ascii(buf, i + 4, 'ICC_PROFILE');
    const drop = (marker >= 0xe1 && marker <= 0xef && marker !== 0xee && !isIcc) || marker === 0xfe;
    if (!drop) parts.push(buf.subarray(i, end));
    i = end;
  }
  parts.push(buf.subarray(i));
  const out = Buffer.concat(parts);
  return out.length === buf.length ? buf : out;
}

const PNG_TEXT_CHUNKS = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);

/** A PNG without its text, EXIF and time chunks; the picture chunks are copied unchanged. */
export function stripPngMetadata(buf: Buffer): Buffer {
  if (!sniff(buf).includes('png')) return buf;
  const parts: Buffer[] = [buf.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= buf.length) {
    const end = i + 12 + buf.readUInt32BE(i);
    if (end > buf.length) return buf;
    if (!PNG_TEXT_CHUNKS.has(buf.toString('latin1', i + 4, i + 8))) parts.push(buf.subarray(i, end));
    i = end;
  }
  const out = Buffer.concat(parts);
  return out.length === buf.length ? buf : out;
}

/** Folders whose files are checked (anything else in the bucket is left alone) */
export function isCheckedPath(name: string): boolean {
  return /^requests\/[^/]+\/[^/]+$/.test(name) || /^chat\/[^/]+\/[^/]+\/[^/]+$/.test(name) || /^providers\/[^/]+\/portfolio\/[^/]+$/.test(name);
}

/**
 * Checks one stored file: deletes it when its bytes are not what its type claims or a photo is too
 * large in pixels, and saves a photo again without its metadata. Returns what happened.
 */
export async function checkStoredFile(bucketName: string, name: string): Promise<'ok' | 'deleted' | 'cleaned' | 'skipped'> {
  if (!isCheckedPath(name)) return 'skipped';
  const file = getStorage().bucket(bucketName).file(name);
  const [exists] = await file.exists();
  if (!exists) return 'skipped';
  const [meta] = await file.getMetadata();
  const type = String(meta.contentType || '');
  const isImage = type.startsWith('image/');
  // Photos are small (at most 10 MB) and read whole; for other files the first bytes are enough
  const [bytes] = isImage ? await file.download() : await file.download({ start: 0, end: 63 });
  if (!contentMatchesType(type, bytes)) {
    console.warn(`[uploadCheck] ${name}: content is not ${type}; deleted`);
    await file.delete({ ignoreNotFound: true });
    return 'deleted';
  }
  if (!isImage) return 'ok';
  const size = imageSize(bytes);
  if (!size || size.width < 1 || size.height < 1 || size.width > MAX_SIDE || size.height > MAX_SIDE || size.width * size.height > MAX_PIXELS) {
    console.warn(`[uploadCheck] ${name}: unreadable or oversized photo ${JSON.stringify(size)}; deleted`);
    await file.delete({ ignoreNotFound: true });
    return 'deleted';
  }
  const clean = type === 'image/jpeg' ? stripJpegMetadata(bytes) : type === 'image/png' ? stripPngMetadata(bytes) : bytes;
  if (clean === bytes) return 'ok';
  // Saved again under the same name, content type and download token, so its links keep working;
  // only if nobody replaced it meanwhile. The new version is checked again and found clean.
  await file.save(clean, {
    contentType: type,
    metadata: { metadata: meta.metadata || {} },
    preconditionOpts: { ifGenerationMatch: Number(meta.generation) },
    resumable: false,
  });
  return 'cleaned';
}

export const checkUploadedFile = onObjectFinalized(
  { region: 'asia-south1', bucket: appBucket, memory: '512MiB', retry: true, maxInstances: 5 },
  async (event) => {
    try {
      await checkStoredFile(event.data.bucket, event.data.name);
    } catch (err: any) {
      // Replaced meanwhile: the newer version gets its own check
      if (err?.code === 412) return;
      throw err;
    }
  }
);
