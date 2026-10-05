import { initializeApp } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User } from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

const provider = new GoogleAuthProvider();
provider.addScope('https://www.googleapis.com/auth/contacts');

// Google OAuth access tokens live for one hour. Firebase doesn't expose the expiry, so assume slightly less.
const TOKEN_TTL_MS = 55 * 60 * 1000;
const TOKEN_STORAGE_KEY = 'google-access-token';

export class AuthExpiredError extends Error {
  constructor() {
    super('Google access token is missing or expired');
    this.name = 'AuthExpiredError';
  }
}

let isSigningIn = false;
let cachedAccessToken: string | null = null;
let tokenExpiresAt = 0;

const setToken = (token: string | null) => {
  cachedAccessToken = token;
  tokenExpiresAt = token ? Date.now() + TOKEN_TTL_MS : 0;
  try {
    if (token) {
      sessionStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify({ token, expiresAt: tokenExpiresAt }));
    } else {
      sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // Storage unavailable (private mode etc.) - the in-memory token still works.
  }
};

// Restore the token so a page refresh doesn't force a new sign-in
try {
  const stored = JSON.parse(sessionStorage.getItem(TOKEN_STORAGE_KEY) || 'null');
  if (stored?.token && stored.expiresAt > Date.now()) {
    cachedAccessToken = stored.token;
    tokenExpiresAt = stored.expiresAt;
  }
} catch {
  // Ignore corrupt or unavailable storage
}

export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, (user: User | null) => {
    const token = getAccessToken();
    if (user && token) {
      if (onAuthSuccess) onAuthSuccess(user, token);
    } else if (!isSigningIn) {
      if (!user) setToken(null);
      if (onAuthFailure) onAuthFailure();
    }
  });
};

export const googleSignIn = async (): Promise<{ user: User; accessToken: string }> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Failed to get access token from Firebase Auth');
    }

    setToken(credential.accessToken);
    return { user: result.user, accessToken: credential.accessToken };
  } catch (error) {
    console.error('Sign in error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = (): string | null => {
  if (cachedAccessToken && Date.now() < tokenExpiresAt) return cachedAccessToken;
  return null;
};

export const logout = async () => {
  setToken(null);
  await auth.signOut();
};

export const fetchWithToken = async (url: string, options: RequestInit = {}): Promise<Response> => {
  const token = getAccessToken();
  if (!token) throw new AuthExpiredError();

  const res = await fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      'Authorization': `Bearer ${token}`
    }
  });
  if (res.status === 401) {
    setToken(null);
    throw new AuthExpiredError();
  }
  return res;
};
