# 3rdSpace Setup Guide

This guide will walk you through setting up the 3rdSpace webapp project from scratch.

## Prerequisites

- **Node.js** 20.x or higher
- **npm** 9.x or higher (comes with Node.js)
- **Git** (for version control)
- **Supabase account** (for backend)

## Step 1: Install Dependencies

```bash
npm install
```

This will install all dependencies including:
- Next.js 14
- React 18
- Supabase client libraries
- React Query
- Testing libraries (Jest, Playwright, React Testing Library)
- UI libraries (shadcn/ui components)
- Form libraries (React Hook Form, Zod)
- And all other dependencies

## Step 2: Set Up Environment Variables

Create a `.env.local` file in the root directory:

```bash
cp .env.example .env.local  # If you have an example file
# OR create .env.local manually
```

Add the following environment variables:

```env
# Database
DATABASE_URL=your_supabase_connection_string
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Stripe
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_CONNECT_WEBHOOK_SECRET=whsec_...
STRIPE_CONNECT_CLIENT_ID=ca_...

# Stripe Price IDs
STRIPE_PRICE_PAY_PER_EVENT=price_...
STRIPE_PRICE_PRO_MONTHLY=price_...
STRIPE_PRICE_PRO_ANNUAL=price_...

# Pricing
PLATFORM_FEE_PER_EVENT=30.00
PLATFORM_FEE_PRO_MONTHLY=79.00
PLATFORM_FEE_PRO_ANNUAL=690.00

# Site
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Email (Optional - SendGrid)
SENDGRID_API_KEY=SG.xxx
SENDGRID_FROM_EMAIL=notifications@example.com
BILLING_FROM_EMAIL=billing@example.com
INVOICE_FROM_EMAIL=billing@example.com
MESSAGE_FROM_EMAIL=messages@example.com
NOTIFICATIONS_FROM_EMAIL=notifications@example.com

# Email (Optional - AWS SES for later)
AWS_SES_ACCESS_KEY=xxx
AWS_SES_SECRET_KEY=xxx

# Monitoring (Optional - Sentry or similar)
NEXT_PUBLIC_SENTRY_DSN=https://examplePublicKey@o0.ingest.sentry.io/0
SENTRY_DSN=https://examplePrivateKey@o0.ingest.sentry.io/0
SENTRY_AUTH_TOKEN=sntrys_...
SENTRY_ORG=your-sentry-org
SENTRY_PROJECT=your-sentry-project

# Invoices
INVOICE_TAX_RATE_PERCENTAGE=8.5

# Playwright Testing (optional, defaults to localhost:3000)
PLAYWRIGHT_TEST_BASE_URL=http://localhost:3000
```

**Where to find Supabase credentials:**
1. Go to your Supabase project dashboard
2. Navigate to Settings → API
3. Copy the Project URL and anon/public key
4. Copy the service_role key (keep this secret!)

## Step 3: Set Up Husky (Pre-commit Hooks)

```bash
# Install Husky
npx husky install

# Make pre-commit hook executable (if not already)
chmod +x .husky/pre-commit
```

This sets up pre-commit hooks that will:
- Run the linter
- Run type checking
- Run tests

## Step 4: Install Playwright Browsers (for E2E Tests)

```bash
npx playwright install
```

This installs Chromium, Firefox, and WebKit browsers needed for E2E testing.

**Note:** On Linux, you may also need system dependencies:
```bash
npx playwright install-deps
```

## Step 5: Verify TypeScript Configuration

The project uses TypeScript. Verify the configuration:

```bash
npm run type-check
```

This should complete without errors.

## Step 6: Run the Development Server

```bash
npm run dev
```

The application will be available at `http://localhost:3000`

## Step 7: Verify Everything Works

### Run Tests

```bash
# Unit tests
npm test

# Unit tests in watch mode
npm run test:watch

# Unit tests with coverage
npm run test:coverage

# E2E tests (requires dev server running)
npm run test:e2e

# E2E tests with UI
npm run test:e2e:ui
```

### Run Linter

```bash
npm run lint
```

### Build for Production

```bash
npm run build
```

This verifies that the project builds successfully.

## Step 8: Set Up Supabase Database

Make sure your Supabase database has all the required tables. Refer to your database schema documentation.

## Step 9: Create Default OG Image (Optional but Recommended)

Create a default Open Graph image for SEO:

1. Create an image: `1200x630px` (recommended size)
2. Save it as `/public/og-default.png`
3. This will be used for social media sharing

## Step 10: Configure GitHub Actions (If Using CI/CD)

If you're using GitHub Actions for CI/CD:

1. Go to your GitHub repository
2. Navigate to Settings → Secrets and variables → Actions
3. Add the following secrets:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`

## Troubleshooting

### Issue: `npm install` fails

**Solution:**
- Clear npm cache: `npm cache clean --force`
- Delete `node_modules` and `package-lock.json`
- Run `npm install` again

### Issue: TypeScript errors

**Solution:**
- Run `npm run type-check` to see specific errors
- Make sure all dependencies are installed
- Check `tsconfig.json` configuration

### Issue: Tests fail

**Solution:**
- Make sure all dependencies are installed
- Check that `jest.setup.js` exists
- Verify test files are in correct locations

### Issue: Playwright tests fail

**Solution:**
- Make sure browsers are installed: `npx playwright install`
- Ensure dev server is running: `npm run dev`
- Check `playwright.config.ts` baseURL

### Issue: Husky hooks not running

**Solution:**
- Run `npx husky install`
- Make sure `.husky/pre-commit` is executable: `chmod +x .husky/pre-commit`
- Verify Git hooks directory: `git config core.hooksPath`

### Issue: Environment variables not working

**Solution:**
- Make sure `.env.local` is in the root directory
- Restart the dev server after changing env vars
- Variables must start with `NEXT_PUBLIC_` to be available in browser

## Project Structure

```
3rdSpace.webapp/
├── app/                    # Next.js App Router pages
│   ├── (auth)/            # Authentication pages
│   ├── (dashboard)/       # Dashboard pages
│   └── layout.tsx         # Root layout
├── components/            # React components
│   ├── ui/                # shadcn/ui components
│   ├── shared/            # Shared components
│   ├── forms/             # Form components
│   ├── builder/           # Builder-specific components
│   ├── venue/             # Venue-specific components
│   └── vendor/            # Vendor-specific components
├── lib/                   # Utility libraries
│   ├── hooks/             # React Query hooks
│   ├── supabase/          # Supabase client setup
│   ├── types/             # TypeScript types
│   ├── utils/             # Utility functions
│   └── test-utils.tsx     # Test utilities
├── e2e/                   # Playwright E2E tests
├── __tests__/             # Jest unit/integration tests
├── public/                # Static assets
├── .github/               # GitHub Actions workflows
├── .husky/                # Git hooks
├── jest.config.js         # Jest configuration
├── jest.setup.js          # Jest setup
├── playwright.config.ts   # Playwright configuration
└── package.json           # Dependencies and scripts
```

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |
| `npm run type-check` | Check TypeScript types |
| `npm test` | Run unit tests |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with coverage |
| `npm run test:e2e` | Run E2E tests |
| `npm run test:e2e:ui` | Run E2E tests with UI |

## Next Steps

1. **Set up your Supabase database** with all required tables
2. **Configure authentication** in Supabase dashboard
3. **Set up storage buckets** for file uploads (venue photos, etc.)
4. **Create your first user** via signup or Supabase dashboard
5. **Start developing** features!

## Getting Help

- Check the `README.md` for project overview
- Review `TESTING.md` for testing guidelines
- Review `PERFORMANCE.md` for performance optimizations
- Review `SEO.md` for SEO implementation

## Quick Start Checklist

- [ ] Node.js 20+ installed
- [ ] Dependencies installed (`npm install`)
- [ ] Environment variables configured (`.env.local`)
- [ ] Husky set up (`npx husky install`)
- [ ] Playwright browsers installed (`npx playwright install`)
- [ ] Dev server runs (`npm run dev`)
- [ ] Tests pass (`npm test`)
- [ ] Build succeeds (`npm run build`)
- [ ] Supabase database configured
- [ ] Default OG image created (optional)

Once all items are checked, you're ready to start developing.
