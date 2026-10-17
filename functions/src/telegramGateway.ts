import { defineSecret } from 'firebase-functions/params';
import { HttpsError } from 'firebase-functions/v2/https';

/**
 * Login codes through Telegram's verification service (Telegram Gateway API): the code arrives in
 * the number's Telegram from the official "Verification Codes" account. About $0.01 per delivered
 * code, refunded when it isn't delivered, no monthly fee and no Meta setup.
 *
 * The number is first checked (checkSendAbility, free when the number has no Telegram), then the
 * message is sent with that request id, so one code costs one fee.
 */

/** Access token from gateway.telegram.org (account settings); "henuz-yok" until it is set */
export const telegramGatewayToken = defineSecret('TELEGRAM_GATEWAY_TOKEN');

const API = 'https://gatewayapi.telegram.org/';
/** The message expires (and its fee is refunded) when it isn't read within the code's lifetime */
const TTL_SECONDS = 600;

/** Whether a real token is stored (the placeholder or an empty value turns the channel off) */
export function telegramReady(): boolean {
  const token = (telegramGatewayToken.value() || '').trim();
  return token.length > 20 && token !== 'henuz-yok';
}

type GatewayReply = { ok: boolean; result?: { request_id?: string }; error?: string };

async function call(method: string, params: Record<string, unknown>): Promise<GatewayReply> {
  const res = await fetch(API + method, {
    method: 'POST',
    headers: { Authorization: `Bearer ${telegramGatewayToken.value().trim()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(10000),
  });
  const data = (await res.json().catch(() => null)) as GatewayReply | null;
  return data || { ok: false, error: `HTTP_${res.status}` };
}

/**
 * Sends our own 6-digit code to the number's Telegram. Throws not-found when the number has no
 * Telegram (the app then asks to install it), resource-exhausted when sending too fast, and
 * unavailable for anything else (token, balance, …), whose reason stays in the server log.
 */
export async function sendTelegramCode(phone: string, code: string): Promise<void> {
  const check = await call('checkSendAbility', { phone_number: phone });
  const fail = (step: string, error?: string): never => {
    const reason = String(error || 'NO_REPLY');
    console.error(`[requestLoginCode] Telegram refused the code (${step}):`, reason);
    if (/FLOOD|TOO_MANY/i.test(reason)) throw new HttpsError('resource-exhausted', 'Too many codes requested. Please wait and try again.');
    if (step === 'check' && /PHONE|USER|NOT_FOUND|UNAVAILABLE|PRIVACY/i.test(reason)) {
      throw new HttpsError('not-found', 'This number has no Telegram.');
    }
    throw new HttpsError('unavailable', 'The code could not be sent. Please try again later.');
  };
  if (!check.ok || !check.result?.request_id) fail('check', check.error);
  const sent = await call('sendVerificationMessage', {
    phone_number: phone,
    request_id: check.result!.request_id,
    code,
    ttl: TTL_SECONDS,
  });
  if (!sent.ok) fail('send', sent.error);
}
