# Contact Manager (דילול אנשי קשר)

A client-side React + Vite app that signs in with Google (Firebase Auth) and edits Google Contacts directly through the People API. Nothing runs on a server.

## Run locally

```bash
npm install
npm run dev      # http://localhost:5173
```

## Deploy to Vercel

1. Push the project to a GitHub repo and import it in Vercel. The framework (Vite), build command and output directory come from `vercel.json`.
2. You don't need any environment variables. The Firebase web config in `firebase-applet-config.json` is public by design.
3. **Firebase Console → Authentication → Settings → Authorized domains**: add `<project>.vercel.app` and any custom domain. Without this, sign-in fails with `auth/unauthorized-domain`.
4. **Google Cloud Console → APIs & Services**: make sure the **People API** is enabled. Add the Vercel domain to the OAuth consent screen. The `contacts` scope is sensitive, so until the app is verified, only users listed as *test users* can sign in.

Or deploy from the CLI: `npx vercel` (preview) / `npx vercel --prod`.
