# Deploy 3rdSpace to Vercel (OAuth & Ticket Linking)

This guide walks you through deploying the app to Vercel so you can test OAuth (Google, etc.) and later integrate ticket linking from **Eventbrite**, **Posh**, and **Luma**.

---

## Prerequisites

- [Vercel account](https://vercel.com/signup)
- Project in a Git repo (GitHub, GitLab, or Bitbucket)
- Supabase project (you already have `.env.local`)

---

## 1. Push Your Code to Git

If the project isn’t in a remote repo yet:

```bash
cd /Users/chrisredd/3rdSpace.webapp
git init
git add .
git commit -m "Initial commit for Vercel deploy"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

---

## 2. Import Project in Vercel

1. Go to [vercel.com/new](https://vercel.com/new).
2. **Import Git Repository**: Connect GitHub/GitLab/Bitbucket and select the `3rdSpace.webapp` repo.
3. **Configure Project**:
   - **Framework Preset**: Next.js (auto-detected).
   - **Root Directory**: `./` (leave default).
   - **Build Command**: `npm run build` (default).
   - **Output Directory**: `.next` (default).
   - **Install Command**: `npm install` (default).

Do **not** deploy yet; add environment variables first.

---

## 3. Add Environment Variables in Vercel

In the same “Import” screen (or later in **Project → Settings → Environment Variables**), add:

| Name | Value | Notes |
|------|--------|--------|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL | From Supabase → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Your Supabase anon/public key | From Supabase → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Your Supabase service role key | From Supabase → Settings → API (if used server-side) |

Optional (for future OAuth / ticket linking):

| Name | Value |
|------|--------|
| `NEXT_PUBLIC_SITE_URL` | `https://your-app.vercel.app` (replace with your real Vercel URL after first deploy) |

- Apply to **Production**, **Preview**, and **Development** if you want OAuth to work on preview URLs too.

---

## 4. Deploy

Click **Deploy**. Wait for the build to finish. Your app will be at:

- **Production**: `https://your-project.vercel.app`
- You can set a custom domain later in **Project → Settings → Domains**.

---

## 5. Configure Supabase for OAuth (Required for Google, etc.)

OAuth redirects must be allowed in Supabase.

1. Open [Supabase Dashboard](https://supabase.com/dashboard) → your project.
2. Go to **Authentication → URL Configuration**.
3. **Site URL**: set to your Vercel URL, e.g.  
   `https://your-project.vercel.app`
4. **Redirect URLs**: add:
   - `https://your-project.vercel.app/auth/callback`
   - For preview deployments: `https://*.vercel.app/auth/callback`  
   (so every branch/preview URL can use OAuth)

Save. Then test **Sign in with Google** (or other provider) on the deployed app.

---

## 6. (Optional) Set `NEXT_PUBLIC_SITE_URL` After First Deploy

If you use a canonical site URL in code or meta tags:

1. **Vercel** → your project → **Settings** → **Environment Variables**.
2. Add or update:
   - **Name**: `NEXT_PUBLIC_SITE_URL`
   - **Value**: `https://your-project.vercel.app` (or your custom domain).
3. Redeploy (e.g. **Deployments** → **⋯** on latest → **Redeploy**).

---

## 7. Ticket Linking (Eventbrite, Posh, Luma) – When You Add OAuth

When you implement OAuth for Eventbrite, Posh, and Luma, do the following.

### In your app (Vercel)

- Use your **production** (and optionally preview) base URL for redirects, e.g.  
  `https://your-project.vercel.app/api/auth/callback/eventbrite`  
  (or whatever paths you create).

### In each provider’s developer console

- **Eventbrite**: [Eventbrite API / OAuth](https://www.eventbrite.com/platform/) → add **Redirect URI**:  
  `https://your-project.vercel.app/auth/callback/eventbrite` (or your real callback path).
- **Posh**: In Posh’s developer/app settings, add the same style of **Callback / Redirect URL**.
- **Luma**: In Luma’s app/API settings, add your **Redirect URI** (e.g.  
  `https://your-project.vercel.app/auth/callback/luma`).

Use **HTTPS** and the **exact** path your app uses; otherwise the provider will reject the redirect.

### In Supabase (if you store OAuth tokens or user links)

- If you use Supabase Auth or custom OAuth flows that redirect through your app, keep **Redirect URLs** in Supabase in sync with the callback paths you use (e.g.  
  `https://your-project.vercel.app/auth/callback/*` or specific paths).

---

## 8. Redeploying and Preview Deployments

- **Production**: Push to `main` (or your production branch) → Vercel deploys automatically.
- **Preview**: Push to another branch or open a PR → Vercel creates a preview URL.  
  Use `https://*.vercel.app/auth/callback` in Supabase so these previews can use OAuth.

---

## 9. Quick Checklist

- [ ] Code in Git and repo connected to Vercel  
- [ ] Env vars set in Vercel: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, (optional) `SUPABASE_SERVICE_ROLE_KEY`  
- [ ] First deploy succeeded  
- [ ] Supabase **Site URL** = your Vercel URL  
- [ ] Supabase **Redirect URLs** include `https://your-project.vercel.app/auth/callback` (and `https://*.vercel.app/auth/callback` for previews)  
- [ ] Google (or other) OAuth tested on the live URL  
- [ ] When adding Eventbrite/Posh/Luma: callback URLs added in each provider and in your app

---

## Troubleshooting

| Issue | Fix |
|--------|-----|
| Build fails | Check **Deployments** → failed deployment → **Building** logs. Fix TypeScript/lint errors and missing env vars. |
| OAuth “redirect_uri mismatch” | Supabase **Redirect URLs** must include the exact URL the app uses (e.g. `https://your-app.vercel.app/auth/callback`). |
| 404 on `/auth/callback` | Confirm `app/auth/callback/route.ts` is in the repo and that you’re on the correct branch. |
| Env vars not applied | Redeploy after changing env vars (they are baked in at build time for `NEXT_PUBLIC_*`). |

For more: [Vercel Next.js docs](https://vercel.com/docs/frameworks/nextjs), [Supabase Auth with Next.js](https://supabase.com/docs/guides/auth/server-side/nextjs).
