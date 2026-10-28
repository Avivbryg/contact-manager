// Sorting progress is kept in localStorage so it survives the phone discarding the tab
// (common after switching to WhatsApp). Contact changes themselves are already in Google.

export type Stage = 'sorting' | 'unboxing';

export interface SessionStats {
  ok: number;
  boxed: number;
  edited: number;
  deleted: number;
}

export interface SortSession {
  stage: Stage;
  // Contact resource names in the order they are shown
  order: string[];
  index: number;
  stats: SessionStats;
  // False after Save & exit: offer to continue, but don't jump straight back in
  active: boolean;
}

const SESSION_KEY = 'sort-session';
const SETTINGS_KEY = 'sort-settings';
const WHATSAPP_KEY = 'whatsapp-pending';

export interface Settings {
  confirmDelete: boolean;
}

const read = <T,>(key: string): T | null => {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
};

const write = (key: string, value: unknown) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable - progress just won't survive a reload
  }
};

export const loadSession = () => read<SortSession>(SESSION_KEY);
export const saveSession = (session: SortSession | null) => write(SESSION_KEY, session);

export const loadSettings = (): Settings => ({ confirmDelete: false, ...read<Settings>(SETTINGS_KEY) });
export const saveSettings = (settings: Settings) => write(SETTINGS_KEY, settings);

/** The contact whose WhatsApp chat was opened, so we can ask "who's this?" on return. */
export const loadWhatsAppPending = () => read<string>(WHATSAPP_KEY);
export const saveWhatsAppPending = (resourceName: string | null) => write(WHATSAPP_KEY, resourceName);
