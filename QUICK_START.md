npm # Quick Start Guide

## 🚀 Installation & Setup (5 minutes)

### 1. Install Dependencies
```bash
npm install
```

### 2. Set Up Environment Variables
Create `.env.local` in the root directory:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
NEXT_PUBLIC_SITE_URL=https://3rdspace.com
```

### 3. Set Up Git Hooks
```bash
npx husky install
chmod +x .husky/pre-commit
```

### 4. Install Playwright Browsers (for E2E tests)
```bash
npx playwright install
```

### 5. Start Development Server
```bash
npm run dev
```

Visit `http://localhost:3000` 🎉

---

## ✅ Verification Steps

### Run Tests
```bash
npm test              # Unit tests
npm run test:e2e      # E2E tests (requires dev server)
```

### Check Types
```bash
npm run type-check
```

### Lint Code
```bash
npm run lint
```

### Build for Production
```bash
npm run build
```

---

## 📋 Complete Setup Checklist

- [ ] `npm install` completed
- [ ] `.env.local` created with Supabase credentials
- [ ] `npx husky install` run
- [ ] `npx playwright install` run
- [ ] Dev server starts (`npm run dev`)
- [ ] Tests pass (`npm test`)
- [ ] Build succeeds (`npm run build`)

---

## 🆘 Common Issues

**"Cannot find module" errors**
→ Run `npm install` again

**Environment variables not working**
→ Restart dev server after changing `.env.local`

**Tests failing**
→ Make sure all dependencies installed and `jest.setup.js` exists

**Playwright tests failing**
→ Run `npx playwright install` and ensure dev server is running

---

For detailed setup instructions, see [SETUP.md](./SETUP.md)
