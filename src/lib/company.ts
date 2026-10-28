import { GoogleContact } from './contacts';

// Personal email providers say nothing about where someone works
const PERSONAL_EMAIL_DOMAINS = new Set([
  'gmail', 'googlemail', 'walla', 'hotmail', 'outlook', 'live', 'msn', 'yahoo', 'icloud', 'me', 'mac',
  'aol', 'protonmail', 'proton', 'gmx', 'mail', 'zahav', 'bezeqint', 'netvision', '012', '013', 'inter',
  'smile', 'nana', 'nana10', 'yandex', 'ymail', 'rocketmail', 'campus', 'post', 'mail2world',
]);
// Second-level labels like the "co" in "elbit.co.il"
const GENERIC_LABELS = new Set(['co', 'com', 'org', 'net', 'ac', 'gov', 'edu', 'muni', 'k12', 'idf']);

/** Companies already used in the address book, most common first. */
export function knownCompanies(contacts: GoogleContact[]): string[] {
  const counts = new Map<string, number>();
  contacts.forEach(c => {
    if (c.company) counts.set(c.company, (counts.get(c.company) || 0) + 1);
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
}

const findKnown = (candidate: string, known: string[]) =>
  known.find(k => k.toLowerCase() === candidate.toLowerCase());

/** Company name from a work email, e.g. "dana@intel.com" -> "Intel" (or the existing spelling). */
function fromEmail(email: string, known: string[]): string | null {
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return null;
  const labels = domain.split('.').filter(l => !GENERIC_LABELS.has(l));
  // Drop the TLD ("com", "il"...) and keep the label before it
  const main = labels.length > 1 ? labels[labels.length - 2] : labels[0];
  if (!main || PERSONAL_EMAIL_DOMAINS.has(main) || main.length < 2) return null;
  return findKnown(main, known) || main.charAt(0).toUpperCase() + main.slice(1);
}

/** A known company written into the name, e.g. a contact saved as "Dana Intel". */
function fromName(contact: Pick<GoogleContact, 'firstName' | 'lastName'>, known: string[]): string | null {
  const words = `${contact.firstName} ${contact.lastName}`.split(/[\s\-–()]+/).filter(w => w.length >= 3);
  for (const word of words) {
    const match = findKnown(word, known);
    if (match) return match;
  }
  return null;
}

export function suggestCompany(contact: Pick<GoogleContact, 'firstName' | 'lastName' | 'email'>, known: string[]): string | null {
  return (contact.email && fromEmail(contact.email, known)) || fromName(contact, known);
}
