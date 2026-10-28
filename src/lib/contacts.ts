import { fetchWithToken } from './auth';

const API = 'https://people.googleapis.com/v1';
export const MY_CONTACTS = 'contactGroups/myContacts';
// Limit of people:batchDeleteContacts
export const BATCH_DELETE_LIMIT = 500;

export interface ContactGroup {
  resourceName: string;
  name: string;
  formattedName: string;
  memberCount: number;
  etag: string;
  groupType?: string;
}

export interface GoogleContact {
  resourceName: string;
  etag: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  // Google Contacts "Notes" field (the first biography)
  note: string;
  memberships: string[];
  // Original People API fields, kept so updates don't drop data we don't display
  raw: {
    names: any[];
    phoneNumbers: any[];
    emailAddresses: any[];
  };
}

export interface ContactEdit {
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  note?: string;
}

const toContactGroup = (group: any): ContactGroup => ({
  resourceName: group.resourceName,
  name: group.name || '',
  formattedName: group.formattedName || group.name || '',
  memberCount: group.memberCount || 0,
  etag: group.etag || '',
  groupType: group.groupType
});

const errorWithBody = async (res: Response, message: string) => {
  const text = await res.text();
  console.error(message, text);
  let detail = text;
  try {
    detail = JSON.parse(text).error?.message || text;
  } catch {
    // Not JSON - keep the raw text
  }
  return new Error(`${message} (${res.status}): ${detail}`);
};

export async function getContactGroups(): Promise<ContactGroup[]> {
  const res = await fetchWithToken(`${API}/contactGroups?groupFields=name,memberCount,groupType&pageSize=1000`);
  if (!res.ok) throw await errorWithBody(res, 'Failed to fetch contact groups');
  const data = await res.json();
  return (data.contactGroups || []).map(toContactGroup);
}

export async function createContactGroup(name: string): Promise<ContactGroup> {
  const res = await fetchWithToken(`${API}/contactGroups`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contactGroup: { name } })
  });
  if (!res.ok) throw await errorWithBody(res, 'Failed to create contact group');
  return toContactGroup(await res.json());
}

const PERSON_FIELDS = 'names,emailAddresses,phoneNumbers,memberships,biographies';

const toGoogleContact = (person: any): GoogleContact => {
  const nameObj = person.names?.[0] || {};
  return {
    resourceName: person.resourceName,
    etag: person.etag,
    firstName: nameObj.givenName || nameObj.unstructuredName || '',
    lastName: nameObj.familyName || '',
    phone: person.phoneNumbers?.[0]?.value || '',
    email: person.emailAddresses?.[0]?.value || '',
    note: person.biographies?.[0]?.value || '',
    memberships: (person.memberships || [])
      .filter((m: any) => m.contactGroupMembership)
      .map((m: any) => m.contactGroupMembership.contactGroupResourceName),
    raw: {
      names: person.names || [],
      phoneNumbers: person.phoneNumbers || [],
      emailAddresses: person.emailAddresses || []
    }
  };
};

export async function getContacts(): Promise<GoogleContact[]> {
  let allConnections: any[] = [];
  let nextPageToken = '';
  do {
    const url = `${API}/people/me/connections?personFields=${PERSON_FIELDS}&pageSize=1000${nextPageToken ? `&pageToken=${encodeURIComponent(nextPageToken)}` : ''}`;
    const res = await fetchWithToken(url);
    if (!res.ok) throw await errorWithBody(res, 'Failed to fetch contacts');
    const data = await res.json();
    if (data.connections) {
      allConnections = allConnections.concat(data.connections);
    }
    nextPageToken = data.nextPageToken || '';
  } while (nextPageToken);

  return allConnections.map(toGoogleContact);
}

/** Fetches one contact fresh, so queued edits always apply against the current etag and data. */
export async function getContact(resourceName: string): Promise<GoogleContact> {
  const res = await fetchWithToken(`${API}/${resourceName}?personFields=${PERSON_FIELDS}`);
  if (!res.ok) throw await errorWithBody(res, 'Failed to fetch contact');
  return toGoogleContact(await res.json());
}

const pick = (obj: any, keys: string[]) =>
  Object.fromEntries(keys.filter(k => obj[k] !== undefined).map(k => [k, obj[k]]));

// The UI edits only the first phone/email; keep every other entry (and its type) as is.
const replaceFirstEntry = (entries: any[], value: string, keys: string[]) => {
  const kept = entries.map(e => pick(e, keys));
  if (!value) return kept.slice(1);
  if (kept.length === 0) return [{ value }];
  kept[0] = { ...kept[0], value };
  return kept;
};

/**
 * Builds a minimal updateContact request: only fields that actually changed are sent,
 * and untouched phones, emails and name parts are preserved.
 */
export function buildContactUpdate(contact: GoogleContact, edit: ContactEdit) {
  const firstName = (edit.firstName ?? contact.firstName).trim();
  const lastName = (edit.lastName ?? contact.lastName).trim();
  const phone = (edit.phone ?? contact.phone).trim();
  const email = (edit.email ?? contact.email).trim();
  const note = (edit.note ?? contact.note).trim();

  const body: Record<string, unknown> = { etag: contact.etag };
  const fields: string[] = [];

  if (firstName !== contact.firstName || lastName !== contact.lastName) {
    const { metadata, displayName, displayNameLastFirst, unstructuredName, ...nameParts } = contact.raw.names[0] || {};
    body.names = firstName || lastName ? [{ ...nameParts, givenName: firstName, familyName: lastName }] : [];
    fields.push('names');
  }
  if (phone !== contact.phone) {
    body.phoneNumbers = replaceFirstEntry(contact.raw.phoneNumbers, phone, ['value', 'type']);
    fields.push('phoneNumbers');
  }
  if (email !== contact.email) {
    body.emailAddresses = replaceFirstEntry(contact.raw.emailAddresses, email, ['value', 'type', 'displayName']);
    fields.push('emailAddresses');
  }
  if (note !== contact.note) {
    body.biographies = note ? [{ value: note, contentType: 'TEXT_PLAIN' }] : [];
    fields.push('biographies');
  }

  return { body, updatePersonFields: fields.join(',') };
}

export async function updateContact(resourceName: string, body: Record<string, unknown>, updatePersonFields: string) {
  const res = await fetchWithToken(`${API}/${resourceName}:updateContact?updatePersonFields=${updatePersonFields}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw await errorWithBody(res, 'Failed to update contact');
  return res.json();
}

export async function modifyContactGroupMembers(groupResourceName: string, contactResourceNamesToAdd: string[], contactResourceNamesToRemove: string[]) {
  const res = await fetchWithToken(`${API}/${groupResourceName}/members:modify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      resourceNamesToAdd: contactResourceNamesToAdd,
      resourceNamesToRemove: contactResourceNamesToRemove
    })
  });
  if (!res.ok) throw await errorWithBody(res, 'Failed to modify contact group members');
  return res.json();
}

/** Deletes up to BATCH_DELETE_LIMIT contacts in a single request. */
export async function batchDeleteContacts(resourceNames: string[]) {
  const res = await fetchWithToken(`${API}/people:batchDeleteContacts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resourceNames })
  });
  if (!res.ok) throw await errorWithBody(res, 'Failed to delete contacts');
}

/** IDs of the user-created groups the contact belongs to (system groups such as myContacts excluded). */
export function getUserGroupIds(contact: GoogleContact, userGroupIds: Set<string>): string[] {
  return contact.memberships.filter(m => userGroupIds.has(m));
}
