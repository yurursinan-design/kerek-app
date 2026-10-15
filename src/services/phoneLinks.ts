// Kazakhstan numbers are stored as typed (e.g. "+7 701 111 22 33" or "8 701 111 22 33").
// Normalize to international digits: a leading 8 on an 11-digit number is the domestic prefix for +7.
export function toIntlDigits(raw?: string): string | null {
  let digits = (raw || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('8')) digits = '7' + digits.slice(1);
  return digits.length >= 10 && digits.length <= 15 ? digits : null;
}

export function toTelHref(raw?: string): string | null {
  const digits = toIntlDigits(raw);
  return digits ? `tel:+${digits}` : null;
}

export function toWhatsAppHref(raw?: string): string | null {
  const digits = toIntlDigits(raw);
  return digits ? `https://wa.me/${digits}` : null;
}
