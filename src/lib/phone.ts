// Numbers without a country code are assumed to be Israeli
const DEFAULT_COUNTRY_CODE = '972';

/** Converts a phone number to international digits-only format, e.g. "050-123 4567" -> "972501234567". */
export function toInternationalDigits(phone: string): string | null {
  const trimmed = phone.trim();
  let digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;

  if (trimmed.startsWith('+')) return digits;
  if (digits.startsWith('00')) return digits.slice(2);
  if (digits.startsWith('0')) return DEFAULT_COUNTRY_CODE + digits.slice(1);
  return digits;
}

/** Link that opens a WhatsApp chat with the number (without sending anything). */
export function whatsAppUrl(phone: string): string | null {
  const digits = toInternationalDigits(phone);
  return digits ? `https://wa.me/${digits}` : null;
}
