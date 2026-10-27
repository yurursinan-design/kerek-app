/**
 * Operator contact shown on the profile tab ("Help / support") and in the legal texts. An empty
 * value hides that link.
 */
export const SUPPORT_EMAIL = 'support@tapsyrapp.com';
/** Telegram username without @, e.g. 'kerek_support' */
export const SUPPORT_TELEGRAM = '';
/** Support WhatsApp (international digits) and how it is written for people */
export const SUPPORT_WHATSAPP = '77479693852';
export const SUPPORT_WHATSAPP_DISPLAY = '+7 747 969 38 52';

/** WhatsApp chat with support, with an optional first message typed in */
export function supportWhatsAppHref(text?: string): string {
  if (!SUPPORT_WHATSAPP) return '';
  return `https://wa.me/${SUPPORT_WHATSAPP}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}
