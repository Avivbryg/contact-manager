import React, { useEffect, useState } from 'react';
import { User } from 'firebase/auth';
import { initAuth, googleSignIn, logout } from './lib/auth';
import PhoneContacts from './components/PhoneContacts';

export default function App() {
  const [needsAuth, setNeedsAuth] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = initAuth(
      (user, token) => {
        setUser(user);
        setNeedsAuth(false);
        setAuthError(null);
      },
      () => {
        setUser(null);
        setNeedsAuth(true);
      }
    );
    return () => unsubscribe();
  }, []);

  const handleLogin = async () => {
    setIsLoggingIn(true);
    setAuthError(null);
    try {
      const result = await googleSignIn();
      setUser(result.user);
      setNeedsAuth(false);
    } catch (err: any) {
      console.error('Login failed:', err);
      if (err?.code === 'auth/popup-blocked') {
        setAuthError('הדפדפן חסם את חלון ההתחברות. אפשר חלונות קופצים לאתר זה ונסה שנית.');
      } else {
        setAuthError('אירעה שגיאה בהתחברות. אנא נסה שנית.');
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    setUser(null);
    setNeedsAuth(true);
  };

  if (needsAuth) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-slate-100 p-8 text-center" dir="rtl">
          <div className="mb-8">
            <div className="w-16 h-16 bg-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
               <span className="text-white font-bold text-3xl">ט</span>
            </div>
            <h1 className="text-3xl font-bold text-slate-900 mb-2">דילול אנשי קשר</h1>
            <p className="text-slate-500 mb-4">נקה וסדר את רשימת אנשי הקשר שלך בגוגל, בקלות ובמהירות.</p>
            
            {authError && (
              <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm mb-6 flex text-right gap-2">
                <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>{authError}</span>
              </div>
            )}
          </div>
          
          <button 
            disabled={isLoggingIn}
            onClick={handleLogin}
            className="w-full flex items-center justify-center gap-3 bg-white border border-slate-300 rounded-xl px-4 py-3 text-slate-700 font-medium hover:bg-slate-50 transition-colors disabled:opacity-50"
          >
            <svg viewBox="0 0 48 48" className="w-5 h-5">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
              <path fill="none" d="M0 0h48v48H0z"></path>
            </svg>
            {isLoggingIn ? "מתחבר..." : "התחבר עם Google"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[100dvh] flex flex-col bg-slate-50" dir="rtl">
      <header className="bg-white border-b border-slate-200 shrink-0">
        <div className="max-w-md mx-auto w-full px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold text-slate-900">דילול אנשי קשר</h1>
          </div>
          <div className="flex items-center gap-4">
            <button 
              onClick={handleLogout}
              className="text-sm text-slate-500 hover:text-slate-900 font-medium"
            >
              התנתק
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-hidden relative max-w-md mx-auto w-full flex flex-col">
          <PhoneContacts />
      </main>
    </div>
  );
}
