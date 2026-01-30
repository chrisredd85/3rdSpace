# 3rdSpace Webapp - Project Summary & Debugging Guide

## Project Overview

**3rdSpace** is a B2B event marketplace connecting three user types:
- **Community Builders**: Create and manage events, book venues and vendors
- **Venue Owners**: List venues, manage bookings, set availability
- **Vendors**: Offer services, manage bookings, set availability

Built with **Next.js 14 App Router**, **Supabase**, and **TypeScript**.

---

## Tech Stack

### Core Framework
- **Next.js 14.2.0** (App Router)
- **React 18.3.0**
- **TypeScript 5.3.3**

### Backend & Database
- **Supabase** (PostgreSQL + Auth + Storage + Realtime)
  - `@supabase/ssr@0.3.0` (Server-side rendering support)
  - `@supabase/supabase-js@2.39.0` (Client SDK)

### State Management & Data Fetching
- **TanStack Query (React Query) 5.17.0** - Data fetching, caching, mutations
- **Zustand 4.4.7** - Client-side state management

### UI & Styling
- **Tailwind CSS 3.4.1** - Utility-first CSS
- **shadcn/ui** - Component library (Button, Card, Input, Toast)
- **Lucide React** - Icons
- **Recharts** - Data visualization

### Forms & Validation
- **React Hook Form 7.49.3** - Form management
- **Zod 3.22.4** - Schema validation
- **@hookform/resolvers** - Form validation integration

### Testing
- **Jest** - Unit & integration tests
- **React Testing Library** - Component tests
- **Playwright** - E2E tests
- **MSW** - API mocking

---

## Architecture Patterns

### 1. Server/Client Separation (CRITICAL)

**Rule**: Never import server-side code in client components.

- **Server Components** (default): Can use `next/headers`, direct database access
- **Client Components** (`'use client'`): Must use API routes or client-side Supabase client
- **API Routes**: All sensitive operations (auth, data mutations) happen here

**Supabase Clients:**
- `/lib/supabase/server.ts` - Server Components & API routes only
  - Uses `next/headers` → **NEVER import in client components**
  - Dynamic imports used in `lib/auth.ts` to avoid bundling issues
- `/lib/supabase/client.ts` - Client Components only
  - Uses `createBrowserClient` from `@supabase/ssr`
- `/lib/supabase/middleware.ts` - Middleware only

### 2. API-First Architecture

All data operations go through API routes:
- `/app/api/auth/*` - Authentication
- `/app/api/builder/*` - Builder-specific data
- `/app/api/venue/*` - Venue-specific data
- `/app/api/vendor/*` - Vendor-specific data
- `/app/api/messages/*` - Messaging system
- `/app/api/onboarding/*` - User onboarding

**Client components** fetch data via `fetch()` calls to these API routes, not direct Supabase queries.

### 3. React Query for Data Fetching

All data fetching uses React Query hooks:
- Custom hooks in `/lib/hooks/*` wrap React Query
- Automatic caching, refetching, optimistic updates
- Loading/error states handled automatically

---

## Directory Structure

```
3rdSpace.webapp/
├── app/                          # Next.js App Router
│   ├── (auth)/                   # Authentication routes (route group)
│   │   ├── login/page.tsx
│   │   ├── signup/page.tsx
│   │   └── onboarding/page.tsx
│   ├── (dashboard)/              # Dashboard routes (route group)
│   │   ├── builder/              # Community Builder dashboard
│   │   │   ├── page.tsx          # Dashboard landing
│   │   │   ├── events/
│   │   │   ├── venues/
│   │   │   ├── vendors/
│   │   │   └── analytics/
│   │   ├── venue/                # Venue Owner dashboard
│   │   │   ├── page.tsx
│   │   │   ├── calendar/
│   │   │   ├── requests/
│   │   │   └── pricing/
│   │   ├── vendor/               # Vendor dashboard
│   │   │   ├── page.tsx
│   │   │   ├── bookings/
│   │   │   ├── calendar/
│   │   │   └── services/
│   │   └── [userType]/           # Dynamic routes
│   │       ├── messages/
│   │       └── notifications/
│   ├── api/                      # API Routes (server-only)
│   │   ├── auth/
│   │   ├── builder/
│   │   ├── venue/
│   │   ├── vendor/
│   │   ├── messages/
│   │   └── onboarding/
│   ├── auth/callback/            # OAuth callback handler
│   ├── layout.tsx                # Root layout
│   ├── providers.tsx             # React Query, Toast providers
│   ├── page.tsx                  # Homepage
│   ├── sitemap.ts                # Dynamic sitemap
│   └── robots.ts                 # Robots.txt
│
├── components/
│   ├── ui/                       # shadcn/ui components
│   ├── shared/                   # Reusable components
│   │   ├── StatCard.tsx
│   │   ├── RequestCard.tsx
│   │   ├── QuickActionCard.tsx
│   │   ├── ErrorBoundary.tsx
│   │   ├── ErrorState.tsx
│   │   └── ...
│   ├── builder/                  # Builder-specific components
│   ├── venue/                    # Venue-specific components
│   ├── vendor/                   # Vendor-specific components
│   └── forms/                    # Form components
│
├── lib/
│   ├── supabase/
│   │   ├── client.ts             # Client-side Supabase client
│   │   ├── server.ts             # Server-side Supabase client
│   │   └── middleware.ts         # Middleware helpers
│   ├── hooks/                    # Custom React hooks
│   │   ├── useUser.ts            # Current user hook
│   │   ├── useEvents.ts          # Event data fetching
│   │   ├── useVenues.ts          # Venue data fetching
│   │   ├── useMessages.ts        # Messaging hooks
│   │   └── ...
│   ├── types/                    # TypeScript types
│   │   ├── database.ts           # Supabase database types
│   │   ├── enums.ts              # Enums (UserType, EventStatus, etc.)
│   │   └── index.ts              # Exported types
│   ├── utils/                    # Utility functions
│   │   ├── errorHandling.ts      # Error formatting
│   │   ├── performance.ts        # Debounce, throttle, memoize
│   │   └── filters.ts            # Data filtering
│   ├── auth.ts                   # Auth utilities (mixed client/server)
│   └── store/                    # Zustand stores
│
├── middleware.ts                 # Next.js middleware (route protection)
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

---

## Authentication System

### User Types

```typescript
type UserType = 'community_builder' | 'venue_owner' | 'vendor'
```

### Database Schema (Inferred)

**Users Table** (`public.users`):
- `id` (UUID, primary key, matches auth.users.id)
- `email` (string)
- `role` (string) - **REQUIRED**: 'builder', 'owner', or 'vendor'
- `user_type` (string, nullable) - 'community_builder', 'venue_owner', 'vendor'
- `company_name` (string, nullable)
- `email_verified` (boolean)
- `last_login_at` (timestamp, nullable)

**Profiles Table** (`public.profiles`) - Legacy, may still exist:
- `id`, `email`, `name`, `user_type`

**Venues Table** (`public.venues`):
- `id`, `owner_id` (FK to users), `name`, `venue_type`, `capacity`, etc.

**Vendors Table** (`public.vendors`):
- `id`, `owner_id` (FK to users), `business_name`, `service_type`, etc.

**Events Table** (`public.events`):
- `id`, `builder_id` (FK to users), `title`, `event_date`, `status`, `budget`, etc.

### Authentication Flow

1. **Signup** (`/app/api/auth/signup/route.ts`):
   - Creates auth user via Supabase
   - Creates record in `users` table with `role` mapping:
     - `community_builder` → `role: 'builder'`
     - `venue_owner` → `role: 'owner'`
     - `vendor` → `role: 'vendor'`
   - Optionally creates `venues` or `vendors` record if applicable
   - Returns session token

2. **Login** (`/app/api/auth/login/route.ts`):
   - Authenticates via Supabase
   - Fetches user from `users` table
   - Determines dashboard path from `role`:
     - `builder` → `/builder`
     - `owner` → `/venue`
     - `vendor` → `/vendor`
   - Updates `last_login_at`

3. **Session Management**:
   - Middleware (`/middleware.ts`) protects routes
   - Checks authentication on dashboard routes
   - Redirects to `/login` if not authenticated
   - Redirects to correct dashboard based on `user_type`

4. **Client-Side Auth**:
   - `useUser()` hook (`/lib/hooks/useUser.ts`) fetches from `/api/auth/user`
   - React Query caches user data
   - Auto-refreshes session before expiry

### Key Files

- `/app/api/auth/signup/route.ts` - User registration
- `/app/api/auth/login/route.ts` - User login
- `/app/api/auth/user/route.ts` - Get current user
- `/app/api/auth/logout/route.ts` - Logout
- `/app/api/auth/refresh/route.ts` - Refresh session
- `/lib/auth.ts` - Auth utilities (uses dynamic imports for server client)
- `/lib/hooks/useUser.ts` - React hook for current user
- `/middleware.ts` - Route protection

---

## API Routes Structure

### Authentication Routes (`/app/api/auth/`)

- `POST /api/auth/signup` - Create new user
- `POST /api/auth/login` - Authenticate user
- `GET /api/auth/user` - Get current user
- `POST /api/auth/logout` - Logout
- `POST /api/auth/refresh` - Refresh session

### Builder Routes (`/app/api/builder/`)

- `GET /api/builder/stats` - Dashboard statistics
- `GET /api/builder/events` - List events
- `POST /api/builder/events` - Create event
- `GET /api/builder/events/[id]` - Get event
- `PATCH /api/builder/events/[id]` - Update event
- `DELETE /api/builder/events/[id]` - Delete event

### Venue Routes (`/app/api/venue/`)

- `GET /api/venue/stats` - Dashboard statistics
- `GET /api/venue/requests` - Booking requests
- `GET /api/venue/availability` - Monthly availability
- `GET /api/venue/blocks` - List blocked dates
- `POST /api/venue/blocks` - Block dates
- `PATCH /api/venue/bookings/[id]` - Accept/decline booking

### Vendor Routes (`/app/api/vendor/`)

- `GET /api/vendor/stats` - Dashboard statistics
- `GET /api/vendor/bookings` - Booking requests
- `GET /api/vendor/availability` - Monthly availability
- `GET /api/vendor/blocks` - List blocked dates
- `POST /api/vendor/blocks` - Block dates

### Messaging Routes (`/app/api/messages/`)

- `GET /api/messages/threads` - List message threads
- `GET /api/messages/threads/[threadId]` - Get thread messages
- `POST /api/messages/threads/create` - Create thread
- `POST /api/messages/send` - Send message

### Onboarding Routes (`/app/api/onboarding/`)

- `GET /api/onboarding/check` - Check if user is onboarded
- `POST /api/onboarding/venue` - Complete venue onboarding
- `POST /api/onboarding/vendor` - Complete vendor onboarding

---

## Common Issues & Debugging

### 1. "Cannot find module 'critters'"

**Cause**: Missing Next.js dependency  
**Fix**: `npm install critters`

### 2. "You're importing a component that needs next/headers"

**Cause**: Server-side Supabase client imported in client component  
**Fix**: 
- Check if file has `'use client'` directive
- Ensure `lib/supabase/server.ts` is NOT imported at top level in client components
- Use dynamic imports: `const { createClient } = await import('@/lib/supabase/server')`
- See `/lib/auth.ts` for example of dynamic imports

### 3. "500 Internal Server Error" on dashboard

**Possible causes:**
- API route authorization failing (check `role` vs `user_type` mismatch)
- Missing user record in `users` table
- Database query error

**Common scenario**: After login, dashboard returns 500 error. This often happens because:
- API routes were checking `user.user_metadata?.user_type` (old pattern)
- System now uses `users` table with `role` field (required)
- Authorization should check BOTH `role` and `user_type` fields

**Debug steps:**
1. Check terminal logs for specific error
2. Verify user exists in `users` table with correct `role`:
   - `community_builder` → `role: 'builder'`
   - `venue_owner` → `role: 'owner'`
   - `vendor` → `role: 'vendor'`
3. Check API route authorization logic - should look like:
   ```typescript
   const { data: userProfile } = await supabase
     .from('users')
     .select('role, user_type')
     .eq('id', user.id)
     .single()
   
   const isBuilder = userProfile.role === 'builder' || 
                     userProfile.user_type === 'community_builder'
   ```
4. Verify Supabase environment variables are set
5. Check that signup route creates user with correct `role` mapping

### 4. Authentication redirects not working

**Check:**
- Middleware is running (`middleware.ts` exists)
- User has correct `role` in `users` table
- `user_type` matches expected value
- Session is valid (check cookies)

### 5. React Query not refetching

**Check:**
- Query key includes all dependencies
- `staleTime` and `cacheTime` settings in `providers.tsx`
- Manual invalidation: `queryClient.invalidateQueries(['key'])`

### 6. TypeScript errors in API routes

**Common issues:**
- Missing type assertions for Supabase responses
- `as any` needed for some Supabase operations (e.g., inserts with computed fields)

---

## Environment Variables

Required in `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key  # Optional, for admin ops
NEXT_PUBLIC_SITE_URL=https://3rdspace.com  # For SEO/metadata
```

---

## Key Conventions

1. **Server/Client Separation**: 
   - API routes = server-only
   - Client components = fetch from API routes
   - Never mix server/client Supabase clients

2. **Data Fetching**:
   - All data via React Query hooks
   - Hooks in `/lib/hooks/*` wrap React Query
   - API routes handle all database operations

3. **Error Handling**:
   - `ErrorBoundary` for component errors
   - `ErrorState` for data fetch errors
   - Toast notifications for user feedback
   - Error utilities in `/lib/utils/errorHandling.ts`

4. **Loading States**:
   - Skeleton loaders for lists/cards
   - Spinners for buttons
   - Progress bars for uploads
   - Components in `/components/shared/`

5. **Mobile Responsiveness**:
   - Tailwind breakpoints: `sm:640px`, `md:768px`, `lg:1024px`, `xl:1280px`
   - Mobile-first design
   - Touch targets min 44x44px

6. **Type Safety**:
   - TypeScript strict mode
   - Database types from Supabase in `/lib/types/database.ts`
   - Enums in `/lib/types/enums.ts`

---

## Testing

### Unit Tests
```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report
```

### E2E Tests
```bash
npm run test:e2e      # Run Playwright tests
npm run test:e2e:ui  # UI mode
```

### Type Checking
```bash
npm run type-check    # TypeScript compilation check
```

---

## Important Notes for Debugging

1. **Always check terminal logs** - Next.js shows detailed errors
2. **Check browser console** - Client-side errors appear here
3. **Verify Supabase connection** - Test with simple query
4. **Check environment variables** - Restart dev server after changes
5. **Server/client boundaries** - Most common source of errors
6. **Database schema** - Verify tables and columns match code expectations
7. **Authorization logic** - API routes check `role` from `users` table, not just `user_type`

---

## Recent Changes (Context)

1. **Authentication Migration**: Moved all auth logic to API routes
2. **User Table Migration**: System now uses `users` table with `role` field (required)
3. **Dynamic Imports**: `lib/auth.ts` uses dynamic imports to avoid bundling server client
4. **API Route Authorization**: Updated to check both `role` and `user_type` fields
5. **Dashboard Pages**: Complete implementation for all three user types

---

## Quick Reference

- **Dev Server**: `npm run dev` (usually `http://localhost:3000` or `3002`)
- **Build**: `npm run build`
- **Lint**: `npm run lint`
- **Type Check**: `npm run type-check`

---

This summary should help ChatGPT or any AI assistant understand the project structure and debug issues effectively.
