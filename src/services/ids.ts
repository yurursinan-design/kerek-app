/**
 * Collision-resistant, human-readable document ids.
 *
 * Request ids used to be `REQ-` + the last 6 digits of Date.now(), which wraps every
 * ~16.7 minutes; as data grows a new request could land on an existing id and fail to save.
 * These ids combine a base-36 timestamp with random characters from an alphabet that
 * avoids look-alike characters (0/O, 1/I/L), so they stay easy to read aloud or type.
 */

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

function randomChars(count: number): string {
  const out: string[] = [];
  const cryptoObj: Crypto | undefined = typeof globalThis !== 'undefined' ? (globalThis as any).crypto : undefined;
  if (cryptoObj?.getRandomValues) {
    const bytes = new Uint8Array(count);
    cryptoObj.getRandomValues(bytes);
    for (let i = 0; i < count; i++) out.push(ALPHABET[bytes[i] % ALPHABET.length]);
  } else {
    for (let i = 0; i < count; i++) out.push(ALPHABET[Math.floor(Math.random() * ALPHABET.length)]);
  }
  return out.join('');
}

/** e.g. `REQ-MG9K2P-7QX4` */
export function generateRequestId(now: number = Date.now()): string {
  const time = now.toString(36).toUpperCase().slice(-6);
  return `REQ-${time}-${randomChars(4)}`;
}

/** e.g. `OFFER-REQ-MG9K2P-7QX4-H3TZ` */
export function generateOfferId(requestId: string): string {
  return `OFFER-${requestId}-${randomChars(4)}`;
}

/** The offer a provider makes on a request: one per provider and request (firestore.rules checks this id). */
export function providerOfferId(requestId: string, providerUid: string): string {
  return `OFFER-${requestId}-${providerUid}`;
}
